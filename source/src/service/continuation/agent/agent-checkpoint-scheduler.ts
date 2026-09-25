/**
 * service/continuation/agent/agent-checkpoint-scheduler.ts — 续写基线跟随表格落层（TT-only）
 *
 * 缓冲层数与 periodic 步长直接引用 chat-service 的现常量，retainRecentLayers 每次读取 settings。
 * 不在这里复制一份节奏参数。不耦合 simulation。
 */

import {
  PERIODIC_V2_FULL_CHECKPOINT_ROLL_STEP_AI_LAYERS_ACU,
  RETAIN_RECENT_CHECKPOINT_BUFFER_LAYERS_ACU,
} from '../../chat/chat-service';
import { registerMaterialCheckpointFloorSync_ACU, registerMaterialCheckpointRecoveryAdapter_ACU } from '../../chat/material-checkpoint-sync';
import { settings_ACU } from '../../runtime/state-manager';
import {
  assertSingleActiveContinuationCheckpoint_ACU,
  continuationCheckpointArtifact_ACU,
  graftContinuationCheckpoint_ACU,
  relocateContinuationCheckpoint_ACU,
} from './agent-module-frame';
import { agentModuleFrameDeps_ACU } from './agent-module-store';

export interface TableCheckpointCadence_ACU {
  retainRecentLayers: number;
  bufferLayers: number;
  periodicStepLayers: number;
}

/** 表格当前生效的 checkpoint 节奏。缓冲与步长是 chat-service 的常量本身，不是副本。 */
export function readTableCheckpointCadence_ACU(): TableCheckpointCadence_ACU {
  return {
    retainRecentLayers: settings_ACU.retainRecentLayers || 0,
    bufferLayers: RETAIN_RECENT_CHECKPOINT_BUFFER_LAYERS_ACU,
    periodicStepLayers: PERIODIC_V2_FULL_CHECKPOINT_ROLL_STEP_AI_LAYERS_ACU,
  };
}

function syncMaterialBaselinesToTableFloor_ACU(chat: unknown[], anchorIndex: number): void {
  relocateContinuationCheckpoint_ACU(chat, anchorIndex, agentModuleFrameDeps_ACU());
}

let installed_ACU = false;

export function installMaterialCheckpointScheduler_ACU(): void {
  if (installed_ACU) return;
  installed_ACU = true;
  registerMaterialCheckpointFloorSync_ACU(syncMaterialBaselinesToTableFloor_ACU);
  const deps = agentModuleFrameDeps_ACU();
  registerMaterialCheckpointRecoveryAdapter_ACU({
    capture(message) {
      const continuation = continuationCheckpointArtifact_ACU(message, deps);
      if (!continuation) return null;
      return { continuation };
    },
    graftContinuation(message, artifact) {
      return graftContinuationCheckpoint_ACU(message, artifact as { swipeId: string; snapshot: import('./agent-model').AgentModuleSnapshot_ACU }, deps);
    },
    assertContinuation(chat) {
      return assertSingleActiveContinuationCheckpoint_ACU(chat, deps);
    },
  });
}

installMaterialCheckpointScheduler_ACU();
