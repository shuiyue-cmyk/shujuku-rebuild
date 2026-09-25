import { describe, expect, it } from 'vitest';

import {
  buildEmptyAgentWorldbookSnapshot_ACU,
  renderAgentWorldbookBrowseCatalog_ACU,
  renderAgentWorldbookCatalog_ACU,
  renderAgentWorldbookEntries_ACU,
  renderAgentWorldbookHits_ACU,
  selectTriggeredWorldbookEntries_ACU,
  type AgentWorldbookEntryView_ACU,
  type AgentWorldbookSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-worldbook-read';

function snapshot_ACU(): AgentWorldbookSnapshot_ACU {
  return {
    available: true,
    entries: [
      { bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑', '禁区'], constant: false, content: '黑色晶屑是禁区核心的碎片。', tokens: 18 },
      { bookName: '设定集', uid: '9', title: '守门人', keys: [], constant: true, content: '守门人世代驻守铁门。', tokens: 12 },
    ],
  };
}

describe('世界书目录渲染', () => {
  it('每条一行：标题、关键词、10 字摘要、token 估算与精读地址', () => {
    const catalog = renderAgentWorldbookCatalog_ACU(snapshot_ACU());
    expect(catalog).toContain('晶屑设定｜关键词：晶屑、禁区');
    expect(catalog).toContain('守门人｜关键词：（无）');
    expect(catalog).toContain('摘要：黑色晶屑是禁区核心的');
    expect(catalog).toContain('约 18 token');
    expect(catalog).toContain('$WORLDBOOK:设定集:7');
    expect(catalog).toContain('$WORLDBOOK:设定集:9');
    // 目录只有标题与元信息，不注入条目全文。
    expect(catalog).not.toContain('黑色晶屑是禁区核心的碎片。');
  });

  it('读取失败与空快照分别如实标注，不混为一谈', () => {
    expect(renderAgentWorldbookCatalog_ACU(buildEmptyAgentWorldbookSnapshot_ACU(false))).toContain('目录不可用');
    expect(renderAgentWorldbookCatalog_ACU(buildEmptyAgentWorldbookSnapshot_ACU(true))).toContain('当前没有已启用的世界书条目');
  });
});

describe('世界书命中提示', () => {
  it('常开条目始终命中，关键词条目按扫描文本包含匹配命中', () => {
    const hits = renderAgentWorldbookHits_ACU(snapshot_ACU(), '主角捡起一枚晶屑端详。');
    expect(hits).toContain('晶屑设定（关键词命中｜约 18 token）');
    expect(hits).toContain('守门人（常开｜约 12 token）');
    expect(hits).toContain('$WORLDBOOK:设定集:7');
  });

  it('无关键词命中时只列常开条目；全无命中与不可用分别如实说明', () => {
    const onlyConstant = renderAgentWorldbookHits_ACU(snapshot_ACU(), '与设定无关的日常对话。');
    expect(onlyConstant).toContain('守门人（常开');
    expect(onlyConstant).not.toContain('晶屑设定');

    const noConstant: AgentWorldbookSnapshot_ACU = {
      available: true,
      entries: [{ bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑'], constant: false, content: 'x', tokens: 1 }],
    };
    expect(renderAgentWorldbookHits_ACU(noConstant, '无关文本')).toContain('没有命中任何世界书条目');
    expect(renderAgentWorldbookHits_ACU(buildEmptyAgentWorldbookSnapshot_ACU(false), '晶屑')).toContain('无法给出命中提示');
  });
});

describe('世界书迭代触发（与剧情推进/填表注入引擎同一口径）', () => {
  function cascadeEntries(): AgentWorldbookEntryView_ACU[] {
    return [
      { bookName: '设定集', uid: '1', title: '常开', keys: [], constant: true, preventRecursion: false, content: '禁区入口有守门人。', tokens: 8 },
      { bookName: '设定集', uid: '2', title: '守门人', keys: ['守门人'], constant: false, content: '守门人佩戴晶屑。', tokens: 8 },
      { bookName: '设定集', uid: '3', title: '晶屑', keys: ['晶屑'], constant: false, content: '晶屑不能带离。', tokens: 6 },
      { bookName: '设定集', uid: '4', title: '只看原文', keys: ['晶屑'], constant: false, excludeRecursion: true, content: '这条不该被常量正文带出。', tokens: 6 },
    ];
  }

  it('常量正文可以继续触发关键词条目；排除递归的条目只看最初扫描文本', () => {
    const triggered = selectTriggeredWorldbookEntries_ACU(cascadeEntries(), '今天只是进城。');
    expect(triggered.map(entry => entry.uid)).toEqual(['1', '2', '3']);
  });

  it('阻止递归的已触发条目正文不再带出别的条目', () => {
    const entries = cascadeEntries();
    entries[1].preventRecursion = true;
    const triggered = selectTriggeredWorldbookEntries_ACU(entries, '今天只是进城。');
    expect(triggered.map(entry => entry.uid)).toEqual(['1', '2']);
  });

  it('命中提示同样列出级联带出的条目，但仍只给清单不注入全文', () => {
    const hits = renderAgentWorldbookHits_ACU({ available: true, entries: cascadeEntries() }, '今天只是进城。');
    expect(hits).toContain('守门人（关键词命中');
    expect(hits).toContain('晶屑（关键词命中');
    expect(hits).toContain('$WORLDBOOK:设定集:3');
    expect(hits).not.toContain('这条不该被常量正文带出。');
    // 清单口径不变：全文仍要靠 read 走读取预算门禁，命中提示本身不放大注入。
    expect(hits).not.toContain('守门人世代驻守铁门。');
    expect(hits).not.toContain('禁区入口有守门人。');
  });
});

describe('世界书浏览目录（总纲自阅口径，移植上游 6aaa0a2）', () => {
  it('目录前附浏览说明：这是全部已启用条目清单，按行尾地址 read，不含命中全文', () => {
    const text = renderAgentWorldbookBrowseCatalog_ACU(snapshot_ACU());
    expect(text).toContain('不是命中清单');
    expect(text).toContain('需要哪一条就按行尾地址 read');
    expect(text).toContain('晶屑设定｜关键词：');
    expect(text).toContain('$WORLDBOOK:设定集:7');
    // 浏览目录同样只是清单：全文仍要靠 read 走读取预算门禁。
    expect(text).not.toContain('黑色晶屑是禁区核心的碎片。');
  });
});

describe('世界书条目精读', () => {
  it('按书名 + uid 返回全文，未知 uid 如实列出', () => {
    const text = renderAgentWorldbookEntries_ACU(snapshot_ACU(), '设定集', ['7', '99']);
    expect(text).toContain('黑色晶屑是禁区核心的碎片。');
    expect(text).toContain('以下 uid 不存在于「设定集」的已启用条目中：99');
  });

  it('未知书名、地址不完整与读取失败都回灌可修正的错误文本', () => {
    expect(renderAgentWorldbookEntries_ACU(snapshot_ACU(), '不存在的书', ['7'])).toContain('不存在世界书「不存在的书」');
    expect(renderAgentWorldbookEntries_ACU(snapshot_ACU(), '', [])).toContain('地址不完整');
    expect(renderAgentWorldbookEntries_ACU(buildEmptyAgentWorldbookSnapshot_ACU(false), '设定集', ['7'])).toContain('读取失败');
  });
});
