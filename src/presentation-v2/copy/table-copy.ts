export const tableCopy = {
  panels: {
    templatePreset: {
      title: "表格模板预设",
      description:
        "下拉框切换当前使用的表格模板，星标设为全局默认。可直接导出当前生效模板；当它在可视化编辑器中修改过但尚未保存到预设库时，面板会提示与预设库内容不同，导出将以当前生效模板为准。点击按钮，可导入新预设、管理全部预设。内置默认预设无法修改，请使用「从默认新建」。",
    },
    injectionTarget: {
      title: "写入目标世界书",
      description:
        "表格数据写入的世界书。默认使用角色卡主世界书，可指定其他。角色卡无世界书时，需要新建世界书并为角色卡绑定。",
    },
    entries: {
      title: "附加世界书条目",
      description:
        "填表时附加给AI参考的世界书条目。默认跟随角色卡，也可手动指定并按条目开关。与写入目标世界书互不影响。",
    },
  },
  worldbook: {
    emptyDefault: "所选世界书中无可显示的条目。",
    emptyCharacter:
      "未解析到角色卡世界书。打开聊天后会显示条目；也可手动选择一本。",
    emptyManual: "请先选择一本世界书。",
  },
};
