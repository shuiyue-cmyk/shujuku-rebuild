import { settings_ACU } from '../runtime/state-manager';

export interface TokenSavingsSettings_ACU {
  enabled: boolean;
  autoChronicle: boolean;
  concurrency: number;
  compressionPreset: string;
  auditPreset: string;
}

export function readTokenSavingsSettings_ACU(): TokenSavingsSettings_ACU {
  const value = settings_ACU?.tokenSavings;
  const concurrency = Number(value?.concurrency);
  return {
    enabled: value?.enabled === true,
    autoChronicle: value?.autoChronicle === true,
    concurrency: Number.isSafeInteger(concurrency) && concurrency >= 1
      ? concurrency : 2,
    compressionPreset: typeof value?.compressionPreset === 'string' ? value.compressionPreset.trim() : '',
    auditPreset: typeof value?.auditPreset === 'string' ? value.auditPreset.trim() : '',
  };
}
