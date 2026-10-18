import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WEB_SEARCH_PROVIDERS,
  matchesWebSearchKeyImport,
  type ModelConfigInput
} from "@deepwrite/contracts";

const failingKey = "invalid-test-unreadable-key";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => {
      const text = value.toString("utf8");
      if (text === failingKey) throw new Error("cannot decrypt");
      return text;
    }
  }
}));

const { ModelConfigStore } = await import("./model-config-store");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

function model(id: string, overrides: Partial<ModelConfigInput>) {
  return {
    id,
    label: `模型 ${id}`,
    provider: "deepseek",
    modelId: "deepseek-chat",
    api: "openai-completions",
    baseUrl: `https://${WEB_SEARCH_PROVIDERS.deepseek.keyImport.baseUrlHosts[0]}/v1`,
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
    temperatureOptions: [0.1, 0.7, 1],
    ...overrides
  } as ModelConfigInput;
}

describe("ModelConfigStore.listKeySources", () => {
  it("returns matching saved models with their decrypted keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-model-key-sources-"));
    roots.push(root);
    const store = new ModelConfigStore(root, {
      freeModelCatalog: {
        initialize: async () => undefined,
        getCatalog: async () => ({
          revision: "",
          enabled: false,
          message: "",
          manifestAvailable: false,
          canDeprecateMissingModels: false,
          defaultModelId: "",
          models: [],
          apiKeys: {}
        })
      }
    });
    await store.save({
      models: [
        model("m_chat", { apiKey: "invalid-test-chat-key" }),
        model("m_nokey", {}),
        model("m_unreadable", { apiKey: failingKey }),
        model("m_relay", {
          baseUrl: "https://relay.example.test/v1",
          apiKey: "invalid-test-relay-key"
        })
      ],
      defaultModelId: "m_chat"
    });

    const rule = WEB_SEARCH_PROVIDERS.deepseek.keyImport;
    const sources = await store.listKeySources((candidate) =>
      matchesWebSearchKeyImport(candidate, rule)
    );
    expect(sources).toEqual([
      { id: "m_chat", label: "模型 m_chat", apiKey: "invalid-test-chat-key" }
    ]);

    const seen: boolean[] = [];
    await store.listKeySources((candidate) => {
      seen.push(candidate.hasApiKey);
      return false;
    });
    expect(seen.sort()).toEqual([false, true, true, true]);
  });
});
