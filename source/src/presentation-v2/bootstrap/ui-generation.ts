/**
 * ui-generation — 经典界面（v2）与新版界面（v3）的选择开关
 *
 * 两代界面共用同一个挂载根节点与同一个 Pinia（状态、路由、主题全部共享），
 * 只替换根组件。新版界面由 presentation-v3 在启动时注册；未注册时永远是经典界面，
 * 因此只直接调用 mount 的场景（含 v2 测试）行为不变。
 *
 * 偏好存 acu_v2_ui_state.uiGeneration，本机生效，不进业务配置。
 */
import { markRaw, type Component } from 'vue';
import { readSection, writeSection } from '../stores/persistence';

export type AcuUiGeneration = 'classic' | 'next';

const SECTION_KEY = 'uiGeneration';

interface PersistedUiGeneration {
  value?: unknown;
}

let nextRootComponent: Component | null = null;

/** 由 presentation-v3 启动时调用：登记新版界面根组件。 */
export function registerNextUiRoot_ACU(component: Component): void {
  nextRootComponent = markRaw(component);
}

export function isNextUiAvailable_ACU(): boolean {
  return nextRootComponent !== null;
}

/** 当前生效的界面代：新版已注册时默认新版，用户可切回经典。 */
export function readUiGeneration_ACU(): AcuUiGeneration {
  if (!nextRootComponent) return 'classic';
  const persisted = readSection<PersistedUiGeneration>(SECTION_KEY);
  return persisted?.value === 'classic' ? 'classic' : 'next';
}

export function writeUiGeneration_ACU(generation: AcuUiGeneration): void {
  writeSection(SECTION_KEY, { value: generation } satisfies PersistedUiGeneration);
}

/** 按当前偏好挑选根组件；classicRoot 由 mount 传入，避免本模块反向依赖 App.vue。 */
export function resolveUiRootComponent_ACU(classicRoot: Component): Component {
  return readUiGeneration_ACU() === 'next' && nextRootComponent ? nextRootComponent : classicRoot;
}

/** 仅供测试：清除注册。 */
export function __resetUiGenerationForTests(): void {
  nextRootComponent = null;
}
