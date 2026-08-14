// bootstrap.js —— biotracker 弹窗 iframe 桥接数据库插件宿主环境
// 同源 iframe 可直接引用 parent 窗口对象（函数/对象引用跨窗口共享）。
// 模拟 SillyTavern/宿主全局，让 index.js 的 bootstrap 用数据库适配层的 ctx。
(function () {
  try {
    const parentWindow = window.parent;
    const bridge = parentWindow.__ACU_BIOTRACKER_BRIDGE__;
    if (!bridge) return;
    // 宿主全局模拟：getContextSafe()/host.js 读这些
    window.SillyTavern = {
      getContext: function () {
        return bridge.createCtx();
      },
      getRequestHeaders: function () {
        return bridge.getRequestHeaders ? bridge.getRequestHeaders() : {};
      },
    };
    window.TavernHelper = parentWindow.TavernHelper;
    window.toastr = parentWindow.toastr;
    window.jQuery = parentWindow.jQuery;
    window.$ = parentWindow.$;
    window.__TAURITAVERN__ = parentWindow.__TAURITAVERN__;
    window.__TAURITAVERN_MAIN_READY__ = parentWindow.__TAURITAVERN_MAIN_READY__;
    window.topLevelWindow_ACU = parentWindow;
    // 加载 biotracker 前端（自动 bootstrap：appReady 或 250ms 重试）
    import('./index.js');
  } catch (error) {
    console.error('[BS BioTracker][bootstrap] 桥接失败', error);
  }
})();
