import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { callOpenAICompatible, fetchModelList, isApiDeadlineError, isApiTimeoutError, resolveApiTimeoutMs, resolveOverallDeadlineMs } from '../../src/service/biotracker/vendor/api.js';

const ORIGINAL_GLOBALS = {
  fetch: globalThis.fetch,
  window: globalThis.window,
  document: globalThis.document,
  location: globalThis.location,
  SillyTavern: globalThis.SillyTavern,
};

afterEach(() => {
  Object.entries(ORIGINAL_GLOBALS).forEach(([key, value]) => {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  });
});

function installBrowserHost(fetchImpl) {
  globalThis.window = {};
  globalThis.document = { cookie: 'csrf_token=test-csrf' };
  globalThis.location = {
    origin: 'http://localhost:8000',
    href: 'http://localhost:8000/',
  };
  globalThis.SillyTavern = {
    getContext: () => null,
    getRequestHeaders: () => ({ 'X-ST-Header': 'host-value' }),
  };
  globalThis.fetch = fetchImpl;
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(data);
    },
  };
}

test('fetchModelList uses the SillyTavern backend proxy for a cross-origin API', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ response: JSON.stringify({ models: [{ name: 'grok-4' }, 'ollama-local'] }) });
  });

  const models = await fetchModelList({
    apiUrl: 'https://example-model-host.test/v1',
    apiKey: '',
  });

  assert.deepEqual(models, ['grok-4', 'ollama-local']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/backends/chat-completions/status');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-ST-Header'], 'host-value');
  assert.equal(calls[0].options.headers['X-CSRF-Token'], 'test-csrf');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.chat_completion_source, 'custom');
  assert.equal(body.custom_url, 'https://example-model-host.test/v1');
  assert.equal(body.reverse_proxy, 'https://example-model-host.test/v1');
  assert.equal(body.proxy_password, '');
});

test('callOpenAICompatible sends chat completions through the SillyTavern backend proxy', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({ operations: [] }) } }],
    });
  });

  const result = await callOpenAICompatible({
    apiUrl: 'https://example-model-host.test/v1/chat/completions',
    apiKey: 'secret-key',
    model: 'grok-compatible',
  }, { recent_messages: [] }, 'Return JSON.');

  assert.deepEqual(result, { operations: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/backends/chat-completions/generate');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.chat_completion_source, 'custom');
  assert.equal(body.custom_url, 'https://example-model-host.test/v1');
  assert.equal(body.proxy_password, 'secret-key');
  assert.equal(body.custom_include_headers, 'Authorization: Bearer secret-key');
  assert.equal(body.model, 'grok-compatible');
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(Array.isArray(body.messages), true);
});

test('callOpenAICompatible 采用数据库配置的温度与 max_tokens（适配层同步进 settings 的场景）', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] });
  });

  await callOpenAICompatible({
    apiUrl: 'https://example-model-host.test/v1/chat/completions',
    apiKey: 'secret-key',
    model: 'grok-compatible',
    temperature: 1,
    maxTokens: 60000,
  }, { recent_messages: [] }, 'Return JSON.');

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.temperature, 1, '温度应采用数据库配置的 1');
  assert.equal(body.max_tokens, 60000, 'max_tokens 应采用数据库配置的 60000');
});

test('callOpenAICompatible 追踪内部调用未同步 settings 时经 probe 兜底采用数据库配置', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] });
  });

  // 适配层注入的 probe：读取数据库主 API 配置（温度 1 / max_tokens 60000）
  globalThis.__bs_biotracker_api_probe__ = () => ({ temperature: 1, maxTokens: 60000 });
  try {
    await callOpenAICompatible({
      apiUrl: 'https://example-model-host.test/v1/chat/completions',
      apiKey: 'secret-key',
      model: 'grok-compatible',
      // settings 未同步：无 temperature/maxTokens 字段（追踪内部直连场景）
    }, { recent_messages: [] }, 'Return JSON.');
  } finally {
    delete globalThis.__bs_biotracker_api_probe__;
  }

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.temperature, 1, 'probe 兜底应传入数据库温度 1，而非默认 0.2');
  assert.equal(body.max_tokens, 60000, 'probe 兜底应传入数据库 max_tokens');
});

test('fetchModelList falls back to direct access when the SillyTavern proxy returns 403', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/backends/chat-completions/status') {
      return {
        ok: false,
        status: 403,
        async text() {
          return '<!DOCTYPE html><pre>Forbidden</pre>';
        },
      };
    }
    assert.equal(url, 'https://relay.example.test/v1/models');
    return jsonResponse({ data: [{ id: 'relay-model' }] });
  });

  const models = await fetchModelList({
    apiUrl: 'https://relay.example.test/v1',
    apiKey: 'relay-key',
  });

  assert.deepEqual(models, ['relay-model']);
  assert.deepEqual(calls.map((call) => call.url), [
    '/api/backends/chat-completions/status',
    'https://relay.example.test/v1/models',
  ]);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer relay-key');
});

test('callOpenAICompatible falls back to direct access when the SillyTavern proxy returns 403', async () => {
  const calls = [];
  installBrowserHost(async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/backends/chat-completions/generate') {
      return {
        ok: false,
        status: 403,
        async text() {
          return '<!DOCTYPE html><pre>Forbidden</pre>';
        },
      };
    }
    assert.equal(url, 'https://relay.example.test/v1/chat/completions');
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({ operations: [] }) } }],
    });
  });

  const result = await callOpenAICompatible({
    apiUrl: 'https://relay.example.test/v1',
    apiKey: 'relay-key',
    model: 'relay-model',
  }, { recent_messages: [] }, 'Return JSON.');

  assert.deepEqual(result, { operations: [] });
  assert.deepEqual(calls.map((call) => call.url), [
    '/api/backends/chat-completions/generate',
    'https://relay.example.test/v1/chat/completions',
  ]);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer relay-key');
});

test('callOpenAICompatible aborts a hanging request instead of waiting forever', async () => {
  const calls = [];
  installBrowserHost((url, options) => {
    calls.push({ url, options });
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });

  await assert.rejects(
    callOpenAICompatible({
      apiUrl: 'https://relay.example.test/v1',
      apiKey: 'relay-key',
      model: 'relay-model',
      apiTimeoutMs: 1000,
    }, { recent_messages: [] }, 'Return JSON.'),
    (error) => isApiTimeoutError(error) && /自动终止/.test(error.message),
  );

  // 超时不重试，只发一次；也不会退回直连再卡一轮
  assert.deepEqual(calls.map((call) => call.url), ['/api/backends/chat-completions/generate']);
});

test('resolveApiTimeoutMs clamps input and treats 0 as unlimited', () => {
  assert.equal(resolveApiTimeoutMs({}), 180000);
  assert.equal(resolveApiTimeoutMs({ apiTimeoutMs: 0 }), 0);
  assert.equal(resolveApiTimeoutMs({ apiTimeoutMs: 500 }), 1000);
  assert.equal(resolveApiTimeoutMs({ apiTimeoutMs: 99999999 }), 1800000);
});

test('resolveOverallDeadlineMs bounds even an unlimited per-request timeout', () => {
  // 一整轮 = (maxRetries 3 + 1) 次，所以是单次超时的 4 倍
  assert.equal(resolveOverallDeadlineMs({}), 180000 * 4);
  assert.equal(resolveOverallDeadlineMs({ apiTimeoutMs: 30000 }), 120000);
  // 单次超时设为 0（不限制）时仍有终点，不会永远挂着
  assert.equal(resolveOverallDeadlineMs({ apiTimeoutMs: 0 }), 180000 * 4);
});

test('the retry counter counts total tries so 3/3 can no longer hide a 4th attempt', async () => {
  const warnings = [];
  const previousToastr = globalThis.toastr;
  globalThis.toastr = { warning: (message) => warnings.push(String(message)) };
  const badContent = { choices: [{ message: { content: '这不是 JSON' } }] };
  const goodContent = { choices: [{ message: { content: JSON.stringify({ operations: [] }) } }] };
  const bodies = [];
  let call = 0;
  installBrowserHost(async (url, options) => {
    call += 1;
    bodies.push(JSON.parse(options.body));
    // 第 1 轮的 primary + JSON 纠错子请求都坏 → 触发一次重试；第 2 轮 primary 就好
    return jsonResponse(call <= 2 ? badContent : goodContent);
  });

  try {
    const result = await callOpenAICompatible({
      apiUrl: 'https://relay.example.test/v1',
      apiKey: 'k',
      model: 'm',
      temperature: 1,
      maxTokens: 60000,
      apiTimeoutMs: 180000,
    }, { recent_messages: [] }, 'Return JSON.');
    assert.deepEqual(result, { operations: [] });
    assert.equal(warnings.length, 1, '应只重试一次');
    // 分母是总轮次 4，而不是旧的 maxRetries 3
    assert.match(warnings[0], /第 1\/4 次失败/);
    assert.doesNotMatch(warnings[0], /\/3 /);
    // JSON 纠错子请求（第 2 个）也应采用数据库配置的温度/max_tokens，而非硬编码 0.1
    assert.equal(bodies[1].temperature, 1, 'JSON 纠错重试温度应采用数据库配置');
    assert.equal(bodies[1].max_tokens, 60000, 'JSON 纠错重试 max_tokens 应采用数据库配置');
  } finally {
    if (previousToastr === undefined) delete globalThis.toastr;
    else globalThis.toastr = previousToastr;
  }
});

test('the overall deadline terminates a run that keeps failing, without hanging forever', async () => {
  const badContent = { choices: [{ message: { content: '仍然不是 JSON' } }] };
  let calls = 0;
  installBrowserHost(async () => {
    calls += 1;
    return jsonResponse(badContent);
  });

  // 单次超时 1s → 总时限 4s。响应很快但一直坏，重试在第 3 次的 3s 间隔里撞上总时限，
  // 循环下一轮开头发现已到点，抛出总时限错误而不是继续无止境地试。
  await assert.rejects(
    callOpenAICompatible({
      apiUrl: 'https://relay.example.test/v1',
      apiKey: 'k',
      model: 'm',
      apiTimeoutMs: 1000,
    }, { recent_messages: [] }, 'Return JSON.'),
    (error) => isApiDeadlineError(error) && /总时限/.test(error.message),
  );
  assert.ok(calls > 0 && calls < 20, `请求次数应有界，实际 ${calls}`);
});
