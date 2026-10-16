import { z } from "zod";
import {
  CoverAspectRatioSchema,
  type CoverAspectRatio
} from "../book-identity/limits";

export const IMAGE_PRESET_IDS = [
  "volcengine-seedream",
  "aliyun-qwen-image",
  "siliconflow",
  "zhipu-cogview",
  "minimax-image",
  "openai-compatible"
] as const;
export const ImagePresetIdSchema = z.enum(IMAGE_PRESET_IDS);
export type ImagePresetId = z.infer<typeof ImagePresetIdSchema>;
export interface ImageModelPreset {
  id: ImagePresetId;
  label: string;
  protocol: "openai-images" | "dashscope-async" | "minimax-images";
  variant:
    "openai" | "volcengine" | "siliconflow" | "zhipu" | "dashscope" | "minimax";
  baseUrl: string;
  model: string;
  aspectRatios: Partial<Record<CoverAspectRatio, string>>;
  maxImagesPerRequest: number;
  promptLanguage: "zh" | "en";
  rendersCjkText: boolean;
  supportsNegativePrompt: boolean;
  supportsWatermark: boolean;
  supportsQuality: boolean;
  maxPromptCharacters?: number;
}
const sizes = {
  "3:4": "1728x2304",
  "2:3": "1664x2496",
  "9:16": "1600x2848",
  "1:1": "2048x2048",
  "16:9": "2848x1600"
} as const;
export const IMAGE_MODEL_PRESETS: Record<ImagePresetId, ImageModelPreset> = {
  "volcengine-seedream": {
    id: "volcengine-seedream",
    label: "火山方舟 · 豆包 Seedream",
    protocol: "openai-images",
    variant: "volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seedream-4-0-250828",
    aspectRatios: sizes,
    maxImagesPerRequest: 1,
    promptLanguage: "zh",
    rendersCjkText: true,
    supportsNegativePrompt: false,
    supportsWatermark: true,
    supportsQuality: false
  },
  "aliyun-qwen-image": {
    id: "aliyun-qwen-image",
    label: "阿里云百炼 · 通义千问图像",
    protocol: "dashscope-async",
    variant: "dashscope",
    baseUrl: "https://dashscope.aliyuncs.com",
    model: "qwen-image-plus",
    aspectRatios: {
      "3:4": "1104*1472",
      "9:16": "928*1664",
      "1:1": "1328*1328",
      "16:9": "1664*928"
    },
    maxImagesPerRequest: 1,
    promptLanguage: "zh",
    rendersCjkText: true,
    supportsNegativePrompt: true,
    supportsWatermark: true,
    supportsQuality: false
  },
  siliconflow: {
    id: "siliconflow",
    label: "硅基流动",
    protocol: "openai-images",
    variant: "siliconflow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "Kwai-Kolors/Kolors",
    aspectRatios: {
      "3:4": "768x1024",
      "9:16": "576x1024",
      "1:1": "1024x1024",
      "16:9": "1024x576"
    },
    maxImagesPerRequest: 1,
    promptLanguage: "zh",
    rendersCjkText: false,
    supportsNegativePrompt: true,
    supportsWatermark: false,
    supportsQuality: false
  },
  "zhipu-cogview": {
    id: "zhipu-cogview",
    label: "智谱 · CogView",
    protocol: "openai-images",
    variant: "zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "cogview-4-250304",
    aspectRatios: {
      "3:4": "768x1024",
      "2:3": "1024x1536",
      "9:16": "864x1536",
      "1:1": "1024x1024",
      "16:9": "1536x864"
    },
    maxImagesPerRequest: 1,
    promptLanguage: "zh",
    rendersCjkText: false,
    supportsNegativePrompt: false,
    supportsWatermark: true,
    supportsQuality: true
  },
  "minimax-image": {
    id: "minimax-image",
    label: "MiniMax · Image-01",
    protocol: "minimax-images",
    variant: "minimax",
    baseUrl: "https://api.minimax.cn/v1",
    model: "image-01",
    aspectRatios: {
      "3:4": "864x1152",
      "2:3": "832x1248",
      "9:16": "720x1280",
      "1:1": "1024x1024",
      "16:9": "1280x720"
    },
    maxImagesPerRequest: 1,
    promptLanguage: "en",
    rendersCjkText: false,
    supportsNegativePrompt: false,
    supportsWatermark: true,
    supportsQuality: false,
    maxPromptCharacters: 1500
  },
  "openai-compatible": {
    id: "openai-compatible",
    label: "OpenAI 兼容",
    protocol: "openai-images",
    variant: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-1",
    aspectRatios: {
      "2:3": "1024x1536",
      "1:1": "1024x1024"
    },
    maxImagesPerRequest: 1,
    promptLanguage: "en",
    rendersCjkText: false,
    supportsNegativePrompt: false,
    supportsWatermark: false,
    supportsQuality: true
  }
};
const compatibleSizes = {
  "3:4": "768x1024",
  "2:3": "1024x1536",
  "9:16": "864x1536",
  "1:1": "1024x1024",
  "16:9": "1536x864"
} as const;
const qwenCompatibleSizes: ImageModelPreset["aspectRatios"] =
  Object.fromEntries(
    Object.entries(IMAGE_MODEL_PRESETS["aliyun-qwen-image"].aspectRatios).map(
      ([ratio, size]) => [ratio, size.replace("*", "x")]
    )
  );

export function imageModelAspectRatios(
  presetId: ImagePresetId,
  model?: string
): ImageModelPreset["aspectRatios"] {
  const preset = IMAGE_MODEL_PRESETS[presetId];
  if (presetId !== "openai-compatible") return preset.aspectRatios;
  const name = (model?.trim() || preset.model).split("/").at(-1)!.toLowerCase();
  if (
    /^gpt-image-1(?:-mini|\.5)?(?:-\d{4}-\d{2}-\d{2})?$/u.test(name) ||
    name.startsWith("dall-e-")
  )
    return preset.aspectRatios;
  if (
    /^qwen-image(?:-|$)/u.test(name) &&
    !/^qwen-image-(?:2\.0|3\.0)(?:-|$)/u.test(name)
  )
    return qwenCompatibleSizes;
  return compatibleSizes;
}

export const ImageModelCapabilitySchema = z
  .object({
    aspectRatios: z.array(CoverAspectRatioSchema).min(1).max(5),
    promptLanguage: z.enum(["zh", "en"]),
    rendersCjkText: z.boolean(),
    maxPromptCharacters: z.number().int().positive().max(8000).optional()
  })
  .strict();
export type ImageModelCapability = z.infer<typeof ImageModelCapabilitySchema>;
export function imageModelCapability(
  presetId: ImagePresetId,
  model?: string
): ImageModelCapability {
  const preset = IMAGE_MODEL_PRESETS[presetId];
  return {
    aspectRatios: Object.keys(
      imageModelAspectRatios(presetId, model)
    ) as CoverAspectRatio[],
    promptLanguage: preset.promptLanguage,
    rendersCjkText: (!model || model === preset.model) && preset.rendersCjkText,
    ...(preset.maxPromptCharacters
      ? { maxPromptCharacters: preset.maxPromptCharacters }
      : {})
  };
}
