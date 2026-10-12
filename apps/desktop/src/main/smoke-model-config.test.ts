import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelConfigStore } from "./model-config-store";
import { modelSmokeOptions } from "./smoke-model-config";
import { smokeErrorMessage } from "./smoke";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: vi.fn()
  }
}));

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("Faux smoke model configuration", () => {
  it("initializes and resolves without network credentials or secure storage", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Network unavailable"));
    vi.stubGlobal("fetch", fetcher);
    const root = await mkdtemp(join(tmpdir(), "deepwrite-smoke-model-config-"));
    roots.push(root);
    const store = new ModelConfigStore(root, {
      appVersion: "1.0.0",
      ...modelSmokeOptions({ DEEPWRITE_SMOKE: "1" })
    });

    await store.initialize();
    await expect(store.list()).resolves.toMatchObject({
      models: [],
      defaultModelId: ""
    });
    await expect(store.resolve()).resolves.toBeUndefined();
    await expect(store.refreshFreeModels()).resolves.toMatchObject({
      models: []
    });
    expect(fetcher).not.toHaveBeenCalled();
    const saved = JSON.parse(
      await readFile(join(root, "config", "models.json"), "utf8")
    );
    expect(saved.encryptedApiKeys).toEqual({});
  });

  it.each([
    {},
    { DEEPWRITE_SMOKE: "0" },
    {
      DEEPWRITE_SMOKE: "1",
      DEEPWRITE_SMOKE_SUITE: "decomposition-real-model"
    }
  ])(
    "retains the real model catalog outside Faux smoke (%j)",
    (environment) => {
      expect(modelSmokeOptions(environment)).toEqual({});
    }
  );
});

describe("smoke error reporting", () => {
  it("reports a structured IPC rejection instead of losing its message", () => {
    expect(
      smokeErrorMessage({ code: "fixture.run_failed", message: "模型不可用" })
    ).toBe("fixture.run_failed: 模型不可用");
    expect(smokeErrorMessage(new Error("Desktop startup failed"))).toBe(
      "Desktop startup failed"
    );
    expect(smokeErrorMessage(undefined)).toBe("unknown");
  });
});
