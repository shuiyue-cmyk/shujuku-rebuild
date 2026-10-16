/**
 * 默认界面风格下用的是 Claude 配色主题时，告知还有完整的 Claude 界面风格并询问是否切换。
 * 两个入口：外观里点选 Claude 主题；打开面板时发现已在用（这一提示上线前就选好的用户）。
 * 只问一次：弹窗前即记入本机外观设置，不论用户选切换还是保持，之后都不再问。
 */
import { useAppearanceStore } from '../../presentation-v2/stores/appearance-store';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';

export function isClaudeThemeId_UB(id: unknown): id is 'claude' | 'claude-night' {
  return id === 'claude' || id === 'claude-night';
}

export async function suggestClaudeStyleOnce_UB(themeId: unknown): Promise<void> {
  if (!isClaudeThemeId_UB(themeId)) return;
  const appearanceStore = useAppearanceStore();
  if (appearanceStore.isClaudeStyle || appearanceStore.claudeStyleSuggested) return;
  appearanceStore.markClaudeStyleSuggested();
  const confirmed = await useDialogStore().confirm({
    title: '试试 Claude 整体风格？',
    message: '除了 Claude 配色，数据库还有完整的 Claude 界面风格：按 Claude 的界面规范重排层次、字号和控件，侧栏可以收起。要现在切换吗？之后可在「外观与界面 → 界面风格」随时切回默认。',
    confirmLabel: '切换到 Claude 风格',
    cancelLabel: '保持当前',
  });
  if (!confirmed) return;
  // 明暗跟所选主题一致：Claude → 浅色，Claude 夜 → 深色
  appearanceStore.setClaudeColorMode(themeId === 'claude-night' ? 'dark' : 'light');
  appearanceStore.setUiStyle('claude');
}
