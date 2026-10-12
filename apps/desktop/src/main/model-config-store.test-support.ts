import { rm } from "node:fs/promises";
import { afterEach, vi } from "vitest";
import type { ModelConfigInput } from "@deepwrite/contracts";
import type { DeepWriteFreeModelCatalog } from "./deepwrite-free-model-config";

const temporaryRoots: string[] = [];

function managedModel(
  modelId: string,
  overrides: Partial<ModelConfigInput> = {}
): ModelConfigInput {
  return {
    id: "deepwrite-free-writing",
    label: "DeepWrite 免费模型",
    provider: "custom",
    modelId,
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1],
    managedBy: "deepwrite-free",
    ...overrides
  };
}

function emptyCatalog(): DeepWriteFreeModelCatalog {
  return {
    revision: "",
    enabled: false,
    message: "",
    manifestAvailable: false,
    canDeprecateMissingModels: false,
    defaultModelId: "",
    models: [],
    apiKeys: {}
  };
}

function customModel(): ModelConfigInput {
  return {
    id: "custom-writer",
    label: "自定义写作模型",
    provider: "custom",
    modelId: "writer-v1",
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1]
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

export { temporaryRoots, managedModel, emptyCatalog, customModel };
export type { DeepWriteFreeModelCatalog };
