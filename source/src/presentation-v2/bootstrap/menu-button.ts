/**
 * menu-button — 在 host document 的 #extensionsMenu 中挂 UI v2 按钮（D15）
 *
 * 与旧菜单按钮（startup.ts 中的 TTonly·数据库 旧UI）共存，互不影响。
 * 依赖 host document 解析（D15.1），因此也只在 host document 上注册按钮。
 *
 * 注入时序（TT dev 实态，见 TT src/scripts/extensions.js）：
 * #extensionsMenu / #extensionsMenuButton 由 addExtensionsButtonAndMenu 经
 * renderTemplateAsync('wandMenu'/'wandButton') 运行时注入（menu 挂 document.body 下，
 * button 挂 #leftSendForm 下），门控 ensureExtensionsUiReady 由 eventSource once
 * APP_READY 触发。因此本按钮改事件驱动，不再长轮询硬等：
 * 1) 立即试一次（宿主已就绪时零等待）；
 * 2) 订阅 APP_READY（SillyTavern_API_ACU.eventSource，once 优先、on 兜底）；
 * 3) MutationObserver 观察 host document.body 等 #extensionsMenu 出现；
 * 4) 保留短轮询兜底（事件源缺失的宿主）；
 * 5) 主容器长期缺失时走备用入口：挂 wandButton 同宿主 #leftSendForm 旁。
 * 任一路径成功即一次性注入（重复进入幂等）；双锚点缺失则放弃并记错。
 */
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { SillyTavern_API_ACU } from '../../shared/host-api';
import { getAcuHostDocument, getAcuHostWindow, getAcuHostSource } from './host-document';
import { openAcuV2App } from './mount';
import { isAcuTauriRuntime, getAcuTauriReady } from '../../shared/host-bridge';

const MENU_CONTAINER_ID = 'acu-v2-menu-container';
const MENU_ITEM_ID = 'acu-v2-menu-item';
const SEND_FORM_ID = 'leftSendForm';
const EXTENSIONS_MENU_ID = 'extensionsMenu';
const EXTENSIONS_MENU_BUTTON_ID = 'extensionsMenuButton';
const BOUND_FLAG = 'acuV2Bound';
/** 短轮询兜底：6 轮 × 2s（原 10×1s + 30×2s 长轮询已退役，事件路径覆盖正常宿主）。 */
const FALLBACK_POLL_ROUNDS = 6;
const FALLBACK_POLL_INTERVAL_MS = 2000;
const MENU_CLOSE_DELAY_MS = 150;

let menuButtonInstalled_ACU = false;
let menuButtonInitStarted_ACU = false;
let menuButtonObserver_ACU: MutationObserver | null = null;

/** 注册 UI v2 菜单按钮；TT 下先等 TT 内部 ABI 就绪再进事件驱动流程。 */
export function registerAcuV2MenuButton(): void {
  // TT 适配：TauriTavern 下先等 TT 内部 ABI 就绪（宿主异步引导，避免扩展先于 store/菜单就绪注册失败）
  if (isAcuTauriRuntime()) {
    const { ready, promise } = getAcuTauriReady();
    if (!ready && promise) {
      promise.then(() => startMenuButtonInit_ACU()).catch(() => startMenuButtonInit_ACU());
    } else if (!ready) {
      startMenuButtonInit_ACU(); // 布尔未就绪：交给事件 + 短轮询兜底
    } else {
      startMenuButtonInit_ACU();
    }
    return;
  }
  startMenuButtonInit_ACU();
}

/** 事件驱动入口（幂等）：立即试一次，失败则挂 APP_READY + MutationObserver + 短轮询。 */
function startMenuButtonInit_ACU(): void {
  if (menuButtonInitStarted_ACU) return;
  menuButtonInitStarted_ACU = true;
  if (tryInsertMenuButton_ACU()) return;
  subscribeAppReadyOnce_ACU();
  watchExtensionsMenuOnce_ACU();
  scheduleFallbackPoll_ACU(0);
}

/** 订阅宿主 APP_READY（TT dev extensions.js initExtensions 同款门控：once APP_READY）。 */
function subscribeAppReadyOnce_ACU(): void {
  try {
    const api = SillyTavern_API_ACU as any;
    const eventSource = api?.eventSource;
    if (!eventSource) return;
    const appReady = api?.eventTypes?.APP_READY ?? 'app_ready';
    const handler = (): void => { tryInsertMenuButton_ACU(); };
    if (typeof eventSource.once === 'function') {
      eventSource.once(appReady, handler);
    } else if (typeof eventSource.on === 'function') {
      eventSource.on(appReady, handler);
    }
  } catch {
    // 事件源不可用：交给 MutationObserver + 短轮询兜底。
  }
}

/** 观察 host body，等 TT 运行时注入 #extensionsMenu（addExtensionsButtonAndMenu 挂 document.body）。 */
function watchExtensionsMenuOnce_ACU(): void {
  try {
    const doc = getAcuHostDocument();
    if (!doc?.body || menuButtonObserver_ACU) return;
    const hostWin = getAcuHostWindow() as any;
    const ObserverCtor = hostWin?.MutationObserver ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    if (typeof ObserverCtor !== 'function') return;
    const observer = new ObserverCtor(() => {
      if (menuButtonInstalled_ACU) {
        disconnectMenuButtonObserver_ACU();
        return;
      }
      let menu: Element | null = null;
      try {
        menu = getAcuHostDocument()?.getElementById(EXTENSIONS_MENU_ID);
      } catch {
        menu = null;
      }
      if (menu) tryInsertMenuButton_ACU();
    });
    menuButtonObserver_ACU = observer;
    observer.observe(doc.body, { childList: true, subtree: true });
  } catch {
    // 观察失败：短轮询兜底仍在。
  }
}

function disconnectMenuButtonObserver_ACU(): void {
  try {
    menuButtonObserver_ACU?.disconnect();
  } catch {
    // 忽略断开时的宿主异常。
  }
  menuButtonObserver_ACU = null;
}

/** 短轮询兜底（事件源缺失的宿主）；耗尽后走备用入口或放弃。 */
function scheduleFallbackPoll_ACU(retry: number): void {
  if (menuButtonInstalled_ACU) return;
  if (retry >= FALLBACK_POLL_ROUNDS) {
    insertFallbackOrGiveUp_ACU();
    return;
  }
  setTimeout(() => {
    if (menuButtonInstalled_ACU) return;
    if (tryInsertMenuButton_ACU()) return;
    scheduleFallbackPoll_ACU(retry + 1);
  }, FALLBACK_POLL_INTERVAL_MS);
}

/**
 * 单次注入尝试：主容器存在即注入（已存在则只补绑点击），成功返回 true。
 * 失败返回 false，由事件/轮询路径重试。
 */
function tryInsertMenuButton_ACU(): boolean {
  if (menuButtonInstalled_ACU) return true;
  let doc: Document | null = null;
  try {
    doc = getAcuHostDocument();
  } catch {
    return false;
  }
  if (!doc) return false;
  const existing = doc.getElementById(MENU_CONTAINER_ID);
  if (existing) {
    const item = existing.querySelector(`#${MENU_ITEM_ID}`) ?? existing;
    ensureClickBound_ACU(item);
    markMenuButtonInstalled_ACU('exists');
    return true;
  }
  const menu = doc.getElementById(EXTENSIONS_MENU_ID);
  if (!menu) return false;
  menu.appendChild(buildMenuButton_ACU(doc));
  markMenuButtonInstalled_ACU(getAcuHostSource());
  return true;
}

/**
 * 备用入口：主容器长期缺失时，挂 wandButton 同宿主 #leftSendForm 旁
 * （TT dev extensions.js：wandButton 模板即挂 #leftSendForm 下）。
 * 双锚点缺失则放弃并记错。
 */
function insertFallbackOrGiveUp_ACU(): void {
  if (menuButtonInstalled_ACU) return;
  let doc: Document | null = null;
  try {
    doc = getAcuHostDocument();
  } catch {
    doc = null;
  }
  const sendForm = doc?.getElementById(SEND_FORM_ID);
  if (doc && sendForm?.parentNode) {
    const button = buildMenuButton_ACU(doc);
    sendForm.parentNode.insertBefore(button, sendForm.nextSibling);
    markMenuButtonInstalled_ACU('fallback-leftSendForm');
    logDebug_ACU('[ACU-V2] menu button registered beside #leftSendForm (#extensionsMenu missing, fallback entry).');
    return;
  }
  disconnectMenuButtonObserver_ACU();
  logError_ACU('[ACU-V2] menu button registration aborted: #extensionsMenu and #leftSendForm both missing.');
}

function markMenuButtonInstalled_ACU(where: string): void {
  menuButtonInstalled_ACU = true;
  disconnectMenuButtonObserver_ACU();
  logDebug_ACU(`[ACU-V2] menu button registered into ${where}`);
}

function buildMenuButton_ACU(doc: Document): HTMLElement {
  const container = doc.createElement('div');
  container.className = 'extension_container interactable';
  container.id = MENU_CONTAINER_ID;
  container.tabIndex = 0;
  const item = doc.createElement('div');
  item.className = 'list-group-item flex-container flexGap5 interactable';
  item.id = MENU_ITEM_ID;
  item.title = '打开 TTonly·数据库';
  item.innerHTML =
    '<div class="fa-fw fa-solid fa-database extensionsMenuExtensionButton"></div>' +
    '<span>TTonly·数据库</span>';
  ensureClickBound_ACU(item);
  container.appendChild(item);
  return container;
}

function ensureClickBound_ACU(item: Element): void {
  const el = item as HTMLElement;
  if (el.dataset && el.dataset[BOUND_FLAG] === '1') return;
  try {
    if (el.dataset) el.dataset[BOUND_FLAG] = '1';
  } catch {
    // dataset 不可用也继续绑（重复进入由 installed 标志拦截）。
  }
  item.addEventListener('click', handleClick);
}

async function handleClick(event: Event): Promise<void> {
  event.stopPropagation();
  let doc: Document | null = null;
  try {
    doc = getAcuHostDocument();
  } catch {
    doc = null;
  }
  if (doc) {
    const menuButton = doc.getElementById(EXTENSIONS_MENU_BUTTON_ID);
    const menu = doc.getElementById(EXTENSIONS_MENU_ID);
    if (menuButton && menu && isMenuVisible_ACU(menu)) {
      menuButton.click();
      await new Promise(resolve => setTimeout(resolve, MENU_CLOSE_DELAY_MS));
    }
  }
  await openAcuV2App();
}

/** jQuery :visible 的原生等价：只看菜单自身的 display（fadeIn/fadeOut 切的就是它）。 */
function isMenuVisible_ACU(menu: Element): boolean {
  try {
    const view = menu.ownerDocument?.defaultView;
    if (view && typeof view.getComputedStyle === 'function') {
      return view.getComputedStyle(menu).display !== 'none';
    }
  } catch {
    // 取不到计算样式时按可见处理（宁可多关一次菜单，不阻塞开应用）。
    return true;
  }
  return (menu as HTMLElement).style?.display !== 'none';
}

/** 仅供测试使用：重置模块级一次性状态（生产代码不调用）。 */
export function __resetAcuV2MenuButtonForTests_ACU(): void {
  menuButtonInstalled_ACU = false;
  menuButtonInitStarted_ACU = false;
  disconnectMenuButtonObserver_ACU();
}
