import { describe, expect, it } from "vitest";
import {
  IMAGE_MODEL_PRESETS,
  IMAGE_PRESET_IDS,
  ImageModelCapabilitySchema,
  imageModelAspectRatios,
  imageModelCapability
} from "./presets";

describe("image model aspect ratios", () => {
  it("exposes MiniMax native dimensions and its prompt limit to the workbench", () => {
    expect(imageModelAspectRatios("minimax-image", "image-01")).toEqual({
      "3:4": "864x1152",
      "2:3": "832x1248",
      "9:16": "720x1280",
      "1:1": "1024x1024",
      "16:9": "1280x720"
    });
    const capability = imageModelCapability("minimax-image", "image-01");
    expect(capability).toMatchObject({
      promptLanguage: "en",
      rendersCjkText: false,
      maxPromptCharacters: 1500
    });
    expect(ImageModelCapabilitySchema.safeParse(capability).success).toBe(true);
  });

  it("preserves each provider's existing dimensions for custom models", () => {
    for (const id of IMAGE_PRESET_IDS) {
      if (id === "openai-compatible") continue;
      expect(imageModelAspectRatios(id, "custom-test-model")).toEqual(
        IMAGE_MODEL_PRESETS[id].aspectRatios
      );
    }
  });

  it.each([
    undefined,
    "",
    "gpt-image-1",
    "gpt-image-1-mini",
    "gpt-image-1.5",
    "openai/gpt-image-1",
    "openai/gpt-image-1-mini-2025-10-06",
    "openai/gpt-image-1.5-2025-12-16",
    " OPENAI/GPT-IMAGE-1 ",
    "dall-e-2",
    "dall-e-3",
    "openai/dall-e-3"
  ])("keeps restricted OpenAI dimensions for %s", (model) => {
    expect(imageModelAspectRatios("openai-compatible", model)).toEqual({
      "2:3": "1024x1536",
      "1:1": "1024x1024"
    });
    expect(
      imageModelCapability("openai-compatible", model).aspectRatios
    ).toEqual(["2:3", "1:1"]);
  });

  it.each([
    "custom-test-image-model",
    "test-provider/custom-image-model",
    "qwen-image-2.0",
    "qwen-image-2.0-pro",
    "qwen-image-3.0",
    "test-provider/qwen-image-3.0-plus"
  ])("uses common ratios with 3:4 first for compatible model %s", (model) => {
    expect(imageModelAspectRatios("openai-compatible", model)).toEqual({
      "3:4": "768x1024",
      "2:3": "1024x1536",
      "9:16": "864x1536",
      "1:1": "1024x1024",
      "16:9": "1536x864"
    });
    const capability = imageModelCapability("openai-compatible", model);
    expect(capability.aspectRatios).toEqual([
      "3:4",
      "2:3",
      "9:16",
      "1:1",
      "16:9"
    ]);
    expect(capability.rendersCjkText).toBe(false);
    expect(ImageModelCapabilitySchema.safeParse(capability).success).toBe(true);
  });

  it.each([
    "qwen-image",
    "qwen-image-plus",
    "qwen-image-max",
    "test-provider/qwen-image-plus-2025-09-19"
  ])("uses legacy Qwen dimensions for compatible model %s", (model) => {
    expect(imageModelAspectRatios("openai-compatible", model)).toEqual({
      "3:4": "1104x1472",
      "9:16": "928x1664",
      "1:1": "1328x1328",
      "16:9": "1664x928"
    });
    expect(
      imageModelCapability("openai-compatible", model).aspectRatios
    ).toEqual(["3:4", "9:16", "1:1", "16:9"]);
  });
});
