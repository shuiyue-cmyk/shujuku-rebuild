import { stopChronicleAutoCompression_ACU } from '../../presentation/bootstrap/chronicle-auto-compression';
import { readTokenSavingsSettings_ACU, type TokenSavingsSettings_ACU } from '../../service/optimization/token-savings-settings';
import { settings_ACU } from '../../service/runtime/state-manager';
import { withSettingsWrite_ACU } from '../../service/settings/settings-write-service';

export function updateTokenSavingsSettings_UB(patch: Partial<TokenSavingsSettings_ACU>) {
  const settings = { ...readTokenSavingsSettings_ACU(), ...patch };
  const result = withSettingsWrite_ACU(['tokenSavings'], () => { settings_ACU.tokenSavings = settings; });
  if (result.ok && (!settings.enabled || !settings.autoChronicle
    || patch.compressionPreset !== undefined || patch.auditPreset !== undefined)) {
    stopChronicleAutoCompression_ACU();
  }
  return result;
}
