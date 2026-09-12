/**
 * useApiPresetStaleness — “API二次确认”总闸回归
 *
 * 默认打开：预设修订后选择器标黄；关闭 apiReconfirm 后全库不再标黄；
 * 重开后恢复（底层修订号/确认态未动）。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useApiPresetStaleness } from '../../../src/presentation-v2/composables/useApiPresetStaleness';
import { useDevOptionsStore } from '../../../src/presentation-v2/stores/dev-options-store';
import { bumpApiPresetRevision_ACU } from '../../../src/service/settings/api-preset-staleness';

function mountKey(key: string) {
  let api: ReturnType<typeof useApiPresetStaleness> | null = null;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(defineComponent({
    setup() {
      api = useApiPresetStaleness(key);
      return () => h('div');
    },
  }));
  app.mount(host);
  if (!api) throw new Error('staleness not mounted');
  return { api, app, host };
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  setActivePinia(createPinia());
});

describe('API二次确认开关', () => {
  it('默认打开：修订后标黄；关闭即不黄；重开恢复', async () => {
    const { api, app, host } = mountKey('reconfirm-probe');
    const dev = useDevOptionsStore();
    expect(dev.apiReconfirm).toBe(true);

    bumpApiPresetRevision_ACU('test');
    await nextTick();
    expect(api.isStale.value).toBe(true);

    dev.setApiReconfirm(false);
    await nextTick();
    expect(api.isStale.value).toBe(false);

    dev.setApiReconfirm(true);
    await nextTick();
    expect(api.isStale.value).toBe(true);

    app.unmount();
    host.remove();
  });

  it('缺省存量视为打开（老版本无该键）', async () => {
    const { app, host } = mountKey('reconfirm-default-probe');
    expect(useDevOptionsStore().apiReconfirm).toBe(true);
    app.unmount();
    host.remove();
  });
});
