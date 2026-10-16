import { IMAGE_MODEL_PRESETS } from "@deepwrite/contracts";
import { imageJson, SafeImageError, type ImageFetcher } from "../image-http";
import type { ImageGeneration, ImageSource } from "./openai-images";

const preset = IMAGE_MODEL_PRESETS["minimax-image"];
const maxPromptCharacters = preset.maxPromptCharacters ?? 1500;

const errorMessages: Readonly<Record<number, string>> = {
  1001: "MiniMax 图片服务请求超时，请稍后重试。",
  1002: "MiniMax 图片服务请求过于频繁，请稍后重试。",
  1004: "MiniMax 图片服务授权失败，请检查 API Key。",
  1008: "MiniMax 账户余额不足，请检查账户余额。",
  1026: "MiniMax 图片描述未通过内容检查，请调整提示词后重试。",
  1027: "MiniMax 图片未通过内容检查，请调整提示词后重试。",
  2013: "MiniMax 图片请求参数无效，请检查模型和提示词。",
  2045: "MiniMax 图片服务请求过于频繁，请稍后重试。",
  2049: "MiniMax 图片服务授权失败，请检查 API Key。",
  2056: "MiniMax 图片服务用量达到限制，请稍后重试。"
};

function assertMiniMaxSuccess(raw: Record<string, unknown>): void {
  const response = raw.base_resp;
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    !("status_code" in response) ||
    typeof response.status_code !== "number" ||
    !Number.isSafeInteger(response.status_code) ||
    response.status_code < 0
  )
    throw new SafeImageError("MiniMax 图片服务响应格式无效。");
  const code = response.status_code;
  if (code !== 0)
    // Never expose status_msg: providers may echo keys, prompts or signed URLs.
    throw new SafeImageError(
      errorMessages[code] ??
        `MiniMax 图片生成失败（错误码 ${code}），请稍后重试。`
    );
}

export async function generateMiniMaxImages(
  input: ImageGeneration,
  fetcher: ImageFetcher,
  signal: AbortSignal
): Promise<ImageSource[]> {
  if (!preset.aspectRatios[input.aspectRatio])
    throw new SafeImageError("当前图片模型不支持所选比例。");
  if (input.prompt.length > maxPromptCharacters)
    throw new SafeImageError(
      `MiniMax 图片提示词不得超过 ${maxPromptCharacters} 字符，请缩短后重试。`
    );
  const raw = await imageJson(
    `${input.profile.baseUrl.replace(/\/$/u, "")}/image_generation`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.profile.apiKey}`
      },
      body: JSON.stringify({
        model: input.profile.model,
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
        n: input.images,
        response_format: "base64",
        ...(input.profile.watermark !== undefined
          ? { aigc_watermark: input.profile.watermark }
          : {})
      })
    },
    fetcher,
    signal
  );
  assertMiniMaxSuccess(raw);
  const data = raw.data;
  if (typeof data !== "object" || data === null || Array.isArray(data))
    throw new SafeImageError("MiniMax 图片服务响应格式无效。");
  const output = data as Record<string, unknown>;
  const base64 =
    Array.isArray(output.image_base64) && output.image_base64.length > 0;
  const values = base64
    ? output.image_base64
    : (output.image_urls ?? output.image_base64);
  if (!Array.isArray(values))
    throw new SafeImageError("MiniMax 图片服务响应格式无效。");
  if (!values.length)
    throw new SafeImageError("MiniMax 未返回可用图片，请调整提示词后重试。");
  if (values.length !== input.images)
    throw new SafeImageError("图片服务返回的张数与请求不一致。");
  return values.map((value: unknown) => {
    if (typeof value !== "string" || !value.trim())
      throw new SafeImageError("MiniMax 图片服务返回了无效图片。");
    return base64 ? { base64: value } : { url: value };
  });
}
