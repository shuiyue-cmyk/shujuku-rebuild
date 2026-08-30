/** Legacy quick-reply loop fields are retired and must not be persisted again. */

function isRecord_ACU(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function stripLegacyLoopPromptFieldsInPlace_ACU(source: unknown): boolean {
  if (!isRecord_ACU(source) || !isRecord_ACU(source.loopSettings)) return false;
  const loopSettings = source.loopSettings;
  const hadLegacyFields = Object.prototype.hasOwnProperty.call(loopSettings, 'quickReplyContent')
    || Object.prototype.hasOwnProperty.call(loopSettings, 'currentPromptIndex');
  delete loopSettings.quickReplyContent;
  delete loopSettings.currentPromptIndex;
  return hadLegacyFields;
}

export function stripLegacyLoopPromptFields_ACU(source: unknown): unknown {
  if (!isRecord_ACU(source)) return source;
  const result: Record<string, unknown> = { ...source };
  if (!isRecord_ACU(source.loopSettings)) return result;
  result.loopSettings = { ...source.loopSettings };
  stripLegacyLoopPromptFieldsInPlace_ACU(result);
  return result;
}
