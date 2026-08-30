import { clickSendButton_ACU, setSendTextareaValue_ACU } from '../../shared/host-input';
import { SillyTavern_API_ACU } from '../../shared/host-api';

/** Minimal host boundary: only final plain text may reach SillyTavern input. */
export interface ContinuationHostTurnAdapter_ACU {
  send(instruction: string): boolean;
  removeLastMessage(): Promise<boolean>;
}

export class SillyTavernHostTurnAdapter_ACU implements ContinuationHostTurnAdapter_ACU {
  send(instruction: string): boolean {
    if (typeof instruction !== 'string' || !instruction.trim()) return false;
    if (!setSendTextareaValue_ACU(instruction)) return false;
    return clickSendButton_ACU();
  }

  async removeLastMessage(): Promise<boolean> {
    try {
      if (typeof SillyTavern_API_ACU?.deleteLastMessage !== 'function') return false;
      await SillyTavern_API_ACU.deleteLastMessage();
      return true;
    } catch {
      return false;
    }
  }
}
