/**
 * 续写资料模块的显示名：资料面板、待修复卡片、保存提示共用这一份（R10B-18：曾有三份映射，
 * 同一模块分别显示为「信息差」/「认知与信息差」、「故事年代学」/「故事年代学账本」）。
 */
export const CONTINUATION_MATERIAL_MODULES_ACU = ['hooks', 'infoGap', 'constraints', 'storyArc', 'chronology', 'webRefs', 'userRequirements'] as const;
export type ContinuationMaterialModule_ACU = typeof CONTINUATION_MATERIAL_MODULES_ACU[number];

export const CONTINUATION_MATERIAL_MODULE_LABELS_ACU: Record<ContinuationMaterialModule_ACU, string> = {
  hooks: '伏笔账本',
  infoGap: '认知与信息差',
  constraints: '长期约束',
  storyArc: '故事总纲',
  chronology: '故事年代学账本',
  webRefs: '百科资料库',
  userRequirements: '用户要求',
};
