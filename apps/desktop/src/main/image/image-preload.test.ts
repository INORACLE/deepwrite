import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../preload/invoke", () => ({
  invokeCommand: invoke,
  browserId: () => "image_command_test"
}));
import { imageModels } from "../../preload/image-models-api";
import { bookIdentity } from "../../preload/book-identity-api";

describe("image and identity preload validation", () => {
  beforeEach(() => invoke.mockReset());

  it("rejects secret-bearing settings responses", async () => {
    invoke.mockResolvedValue({
      activeProfileId: null,
      profiles: [],
      apiKey: "invalid-placeholder"
    });
    await expect(imageModels.getSettings()).rejects.toThrow();
  });

  it("rejects invalid HTTPS endpoints before IPC", async () => {
    await expect(
      imageModels.saveSettings({
        activeProfileId: null,
        profiles: [
          {
            name: "test",
            presetId: "openai-compatible",
            baseUrl: "http://image.example.test/v1",
            model: "invalid-test-model",
            defaultAspectRatio: "1:1"
          }
        ]
      })
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("validates a MiniMax configuration in both directions through the existing API", async () => {
    const profile = {
      id: "img_test",
      name: "MiniMax test",
      presetId: "minimax-image" as const,
      baseUrl: "https://image.example.test/v1",
      model: "image-01",
      defaultAspectRatio: "9:16" as const,
      watermark: false
    };
    invoke.mockResolvedValue({
      activeProfileId: profile.id,
      profiles: [{ ...profile, hasApiKey: true }]
    });
    const saved = await imageModels.saveSettings({
      activeProfileId: profile.id,
      profiles: [{ ...profile, apiKey: "invalid-test-image-key" }]
    });
    expect(invoke.mock.calls[0]![0].payload.profiles[0].presetId).toBe(
      "minimax-image"
    );
    expect(saved.profiles[0]).toMatchObject({
      presetId: "minimax-image",
      hasApiKey: true
    });
    expect(saved.profiles[0]).not.toHaveProperty("apiKey");
  });

  it("validates image previews and cancellation replies", async () => {
    invoke.mockResolvedValue({
      requestId: "request_test",
      previewDataUrl: "https://signed.example.test/image.png",
      width: 600,
      height: 800
    });
    await expect(
      imageModels.test({
        requestId: "request_test",
        profileId: "img_test",
        prompt: "无字底图",
        aspectRatio: "3:4"
      })
    ).rejects.toThrow();
    invoke.mockResolvedValue({ cancelled: true });
    await imageModels.cancel({ requestId: "request_test" });
    await bookIdentity.cancelRender({ requestId: "request_test" });
    expect(invoke.mock.calls.at(-1)![0].type).toBe("bookIdentity.cancelRender");
  });

  it("rejects inconsistent export references", async () => {
    await expect(
      bookIdentity.exportCover({
        book: { projectType: "short", projectId: "book_test" },
        size: "original",
        imageId: "img_test"
      })
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
