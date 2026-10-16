import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ImageModelSettings,
  ImageModelSettingsInput
} from "@deepwrite/contracts/renderer";
import { useImageModelSettings } from "./useImageModelSettings";
import { uiMessage } from "../ui-feedback";
function fixture(): ImageModelSettings {
  return {
    activeProfileId: "img_active",
    profiles: [
      {
        id: "img_active",
        presetId: "openai-compatible",
        name: "Active",
        baseUrl: "https://images.example.test/v1",
        model: "test-image",
        defaultAspectRatio: "1:1",
        hasApiKey: true
      },
      {
        id: "img_empty",
        presetId: "openai-compatible",
        name: "No key",
        baseUrl: "https://images.example.test/v1",
        model: "test-image",
        defaultAspectRatio: "1:1",
        hasApiKey: false
      }
    ]
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("image settings editor", () => {
  it("can edit a configuration without a key and preserves other configurations and secrets", async () => {
    const stored = fixture();
    const saveSettings = vi.fn(async (input: ImageModelSettingsInput) => ({
      ...input,
      profiles: input.profiles.map(({ apiKey, clearApiKey, id, ...p }) => ({
        ...p,
        id: id ?? "img_new",
        hasApiKey:
          !clearApiKey &&
          (Boolean(apiKey) ||
            Boolean(stored.profiles.find((s) => s.id === id)?.hasApiKey))
      }))
    }));
    vi.stubGlobal("window", {
      deepwrite: {
        imageModels: { getSettings: async () => stored, saveSettings }
      }
    });
    const c = useImageModelSettings();
    await c.load();
    c.edit(false, "img_empty");
    expect(c.draft.value?.name).toBe("No key");
    c.draft.value!.apiKey = "invalid_test_key";
    await c.save();
    const input = saveSettings.mock.calls[0]![0];
    expect(
      input.profiles.find((p) => p.id === "img_active")
    ).not.toHaveProperty("apiKey");
    expect(input.profiles.every((p) => !("hasApiKey" in p))).toBe(true);
    expect(c.draft.value).toBeNull();
    expect(
      c.settings.value.profiles.find((p) => p.id === "img_empty")?.hasApiKey
    ).toBe(true);
  });
  it("keeps a failed save editable without changing the saved settings", async () => {
    const stored = fixture();
    vi.stubGlobal("window", {
      deepwrite: {
        imageModels: {
          getSettings: async () => stored,
          saveSettings: async () => {
            throw new Error("test save rejected");
          }
        }
      }
    });
    const c = useImageModelSettings();
    await c.load();
    c.edit();
    c.draft.value!.name = "Changed";
    await c.save();
    expect(c.draft.value?.name).toBe("Changed");
    expect(c.settings.value.profiles[0]?.name).toBe("Active");
    expect(c.saving.value).toBe(false);
  });

  it("switches an existing profile to MiniMax with native capabilities and preserves its saved key", async () => {
    const stored = fixture();
    vi.stubGlobal("window", {
      deepwrite: { imageModels: { getSettings: async () => stored } }
    });
    const c = useImageModelSettings();
    await c.load();
    c.edit();
    c.draft.value!.quality = "high";
    c.draft.value!.defaultAspectRatio = "9:16";
    c.applyPreset("minimax-image");
    expect(c.draft.value).toMatchObject({
      id: "img_active",
      presetId: "minimax-image",
      model: "image-01",
      defaultAspectRatio: "3:4",
      watermark: false
    });
    expect(c.draft.value!.quality).toBeUndefined();
    expect(c.draft.value!.apiKey).toBeUndefined();
    expect(c.draft.value!.clearApiKey).toBeUndefined();
    expect(c.settings.value.profiles[0]!.hasApiKey).toBe(true);
  });

  it("shows the safe MiniMax business error received over IPC and completes the test state", async () => {
    const error = vi.spyOn(uiMessage, "error").mockReturnValue(-1);
    const message = "MiniMax 账户余额不足，请检查账户余额。";
    vi.stubGlobal("window", {
      deepwrite: {
        imageModels: {
          getSettings: async () => fixture(),
          test: async () => {
            throw { code: "image.operation_failed", message };
          },
          getUsage: async () => []
        }
      }
    });
    const c = useImageModelSettings();
    await c.load();
    await c.test("A book cover");
    expect(error).toHaveBeenCalledWith(message);
    expect(c.testRequestId.value).toBeNull();
    expect(c.preview.value).toBe("");
  });
});
