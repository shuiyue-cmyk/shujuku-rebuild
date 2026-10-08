/**
 * Vector API composable — Embedding / Rerank 校验和保存
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

async function importComposable(config: any, saveResult: any = { saved: true, storageType: "memory" }) {
  vi.resetModules();
  const saveSettings = vi.fn(() => saveResult);
  vi.doMock("../../../src/service/vector/vector-memory-config", () => ({
    getCurrentVectorMemoryConfig_ACU: () => config,
    // 与真实实现同语义：先写活配置再保存，保存失败按快照回滚。
    updateGlobalVectorMemoryConfigFields_ACU: (patch: any) => {
      const snapshot = JSON.parse(JSON.stringify(config));
      Object.assign(config, patch);
      const result = saveSettings();
      if (!result.saved) {
        Object.keys(config).forEach(key => delete config[key]);
        Object.assign(config, snapshot);
        return { ok: false, message: result.error || "保存失败，已回滚。" };
      }
      return { ok: true };
    },
    validateSummaryVectorIndexConfig_ACU: (input: any) => {
      const errors: string[] = [];
      if (!input.embeddingEndpoint) errors.push("缺少 embeddingEndpoint");
      if (!input.embeddingModel) errors.push("缺少 embeddingModel");
      if (!!input.rerankEndpoint !== !!input.rerankModel) {
        errors.push("rerankEndpoint 和 rerankModel 必须同时填写或同时留空");
      }
      return { valid: errors.length === 0, errors };
    },
  }));
  vi.doMock("../../../src/service/settings/settings-service", () => ({
    saveSettings_ACU: saveSettings,
  }));
  vi.doMock("../../../src/service/runtime/state-manager", () => ({
    settings_ACU: { toastMuteEnabled: false },
  }));
  const [{ createPinia, setActivePinia }, { useVectorApiConfig }] =
    await Promise.all([
      import("pinia"),
      import("../../../src/presentation-v2/composables/useVectorApiConfig"),
    ]);
  setActivePinia(createPinia());
  return { vector: useVectorApiConfig(), saveSettings };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useVectorApiConfig", () => {
  it("Embedding 缺失时阻止保存并返回错误", async () => {
    const config: any = {};
    const { vector, saveSettings } = await importComposable(config);

    expect(vector.save()).toBe(false);

    expect(vector.errors.value).toContain("缺少“向量化URL”");
    expect(vector.errors.value).toContain("缺少“向量化模型名”");
    expect(vector.errors.value.join(" ")).not.toContain("embeddingEndpoint");
    expect(vector.errors.value.join(" ")).not.toContain("embeddingModel");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  // R10A-08：校验失败时活配置不能已被改写（否则下一次任何保存都会把非法配置落盘）。
  it("R10A-08：校验失败时不改动当前生效的配置", async () => {
    const config: any = { embeddingEndpoint: "https://embed.test", embeddingModel: "embed-model" };
    const { vector, saveSettings } = await importComposable(config);
    vector.form.embeddingEndpoint = "";

    expect(vector.save()).toBe(false);

    expect(config.embeddingEndpoint).toBe("https://embed.test");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("R10A-08：存储保存失败时如实报失败并回滚", async () => {
    const config: any = { embeddingEndpoint: "https://embed.test", embeddingModel: "embed-model" };
    const { vector } = await importComposable(config, { saved: false, error: "磁盘已满" });
    vector.form.embeddingModel = "new-model";

    expect(vector.save()).toBe(false);

    expect(config.embeddingModel).toBe("embed-model");
    expect(vector.errors.value.join(" ")).toContain("磁盘已满");
  });

  it("Rerank endpoint/model 不成对时阻止保存", async () => {
    const config: any = {
      embeddingEndpoint: "https://embed.test",
      embeddingModel: "embed-model",
      rerankEndpoint: "https://rerank.test",
      rerankModel: "",
    };
    const { vector } = await importComposable(config);

    expect(vector.save()).toBe(false);

    expect(vector.errors.value).toContain(
      "“重排URL”和“重排模型名”需要同时填写，或者同时留空",
    );
    expect(vector.errors.value.join(" ")).not.toContain("rerankEndpoint");
    expect(vector.errors.value.join(" ")).not.toContain("rerankModel");
  });

  it("合法配置写回全局向量配置并保存 settings", async () => {
    const config: any = {
      embeddingEndpoint: "",
      embeddingModel: "",
      embeddingApiKey: "",
      rerankEndpoint: "",
      rerankModel: "",
      rerankApiKey: "",
      rerankInstruction: "默认指令",
    };
    const { vector, saveSettings } = await importComposable(config);
    vector.form.embeddingEndpoint = " https://embed.test ";
    vector.form.embeddingModel = " embed-model ";
    vector.form.rerankEndpoint = "https://rerank.test";
    vector.form.rerankModel = "rerank-model";
    vector.form.rerankInstruction = " 自定义指令 ";

    expect(vector.save()).toBe(true);

    expect(config.embeddingEndpoint).toBe("https://embed.test");
    expect(config.embeddingModel).toBe("embed-model");
    expect(config.rerankModel).toBe("rerank-model");
    expect(config.rerankInstruction).toBe("自定义指令");
    expect(saveSettings).toHaveBeenCalled();
  });

  it("rerankInstruction 清空后保存为空字符串", async () => {
    const config: any = {
      embeddingEndpoint: "https://embed.test",
      embeddingModel: "embed-model",
      rerankEndpoint: "",
      rerankModel: "",
      rerankApiKey: "",
      rerankInstruction: "原始指令",
    };
    const { vector, saveSettings } = await importComposable(config);

    expect(vector.form.rerankInstruction).toBe("原始指令");

    vector.form.rerankInstruction = "";
    expect(vector.save()).toBe(true);

    expect(config.rerankInstruction).toBe("");
    expect(saveSettings).toHaveBeenCalled();
  });

  it("refresh 读取配置中的 rerankInstruction", async () => {
    const config: any = {
      embeddingEndpoint: "https://embed.test",
      embeddingModel: "embed-model",
      rerankEndpoint: "",
      rerankModel: "",
      rerankApiKey: "",
      rerankInstruction: "测试指令内容",
    };
    const { vector } = await importComposable(config);

    expect(vector.form.rerankInstruction).toBe("测试指令内容");
  });
});
