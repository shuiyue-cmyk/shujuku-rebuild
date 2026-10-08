function createPromptTemplateNonce_ACU(): string {
  try {
    const randomUUID = (globalThis as any)?.crypto?.randomUUID;
    if (typeof randomUUID === 'function') {
      const uuid = String(randomUUID.call((globalThis as any).crypto) || '');
      if (uuid) return uuid.replace(/[^a-zA-Z0-9_-]/g, '');
    }
  } catch { /* 老宿主无 crypto 时走带进程内熵的兜底 */ }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/**
 * 把不可信 payload（聊天正文、世界书、表格投影等）变成对 EJS/random/SQL/ORM/if 均惰性的 nonce token。
 * 用法：可信模板里的占位符先 protect 成 token → 跑完全部模板解释器 → 最后一次性 restore。
 * 所有候选 token 都对本轮可信模板与全部不可信源做包含检查；即使随机源重复或
 * payload 猜中候选，也会继续换一个 token，避免恢复时覆盖/串值。
 * @param tokenLabel token 里的用途标签（只含 A-Z0-9_），便于日志里辨认来源。
 */
export function createUntrustedTemplateGuard_ACU(reservedValues: unknown[], tokenLabel = 'UNTRUSTED') {
  const occupiedTexts = reservedValues.map(value => value === null || value === undefined ? '' : String(value));
  const tokenValues = new Map<string, string>();
  const valueTokens = new Map<string, string>();
  let tokenIndex = 0;

  const buildToken = (): string => {
    for (let attempt = 0; attempt < 1024; attempt += 1) {
      const nonce = createPromptTemplateNonce_ACU() || 'fallback';
      const token = `__ACU_${tokenLabel}_${nonce}_${tokenIndex++}__`;
      if (tokenValues.has(token)) continue;
      if (occupiedTexts.some(text => text.includes(token))) continue;
      occupiedTexts.push(token);
      return token;
    }
    throw new Error(`${tokenLabel.toLowerCase()}_placeholder_nonce_collision`);
  };

  return {
    protect(value: unknown): string {
      const text = value === null || value === undefined ? '' : String(value);
      if (!text) return '';
      const existing = valueTokens.get(text);
      if (existing) return existing;
      const token = buildToken();
      valueTokens.set(text, token);
      tokenValues.set(token, text);
      return token;
    },
    restore(value: unknown): string {
      let restored = value === null || value === undefined ? '' : String(value);
      for (const [token, payload] of tokenValues) restored = restored.split(token).join(payload);
      return restored;
    },
  };
}
