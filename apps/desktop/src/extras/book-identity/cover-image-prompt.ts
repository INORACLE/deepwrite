import type {
  BookCoverCandidate,
  CoverTitleRendering
} from "@deepwrite/contracts";
import { SafeImageError } from "../../main/image/image-http";

const titleRegions = {
  top: "upper third of the cover",
  bottom: "lower third of the cover",
  right: "right side of the cover, arranged vertically",
  center: "center of the cover"
} as const;

function removeTextBans(prompt: string): string {
  return prompt
    .replace(
      /\b(?:no|without)\s+(?:(?:any|visible|written)\s+)?(?:text|letters|lettering|words|typography)\b|\b(?:text|lettering|typography)[ -]free\b/giu,
      ""
    )
    .replace(
      /(?:不(?:要|得)?(?:出现|包含|绘制|生成|添加)|禁止|避免|没有|无)(?:任何)?(?:文字|文本|字母|书名|标题|汉字)|无字/gu,
      ""
    )
    .trim();
}

function modelNegativePrompt(prompt?: string): string | undefined {
  const filtered = prompt
    ?.split(/[,，;；\n]+/u)
    .filter(
      (part) =>
        !/(?:文字|文本|字母|字体|汉字|书名|标题|字幕|题字|排版|\b(?:text|letters?|lettering|typography|titles?|captions?|words?)\b)/iu.test(
          part
        )
    )
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  return filtered || undefined;
}

/** Applied at every render, including manually edited or older candidates. */
export function buildCoverImagePrompt(
  candidate: Pick<
    BookCoverCandidate,
    "prompt" | "negativePrompt" | "typography" | "titlePlacement"
  >,
  titleRendering: CoverTitleRendering,
  currentTitle = "",
  maxPromptCharacters = 8000
): { prompt: string; negativePrompt?: string } {
  const region = titleRegions[candidate.titlePlacement];
  const instructions =
    titleRendering === "model"
      ? maxPromptCharacters < 8000
        ? [
            "Create a complete, finished book cover with readable title lettering.",
            `The exact current book title is ${JSON.stringify(currentTitle)}. Reproduce it accurately without translation; it supersedes any earlier title.`,
            `Place the title in the ${region}. Typography style: ${candidate.typography.trim() || "a clear, readable font matching the artwork"}. Use strong contrast and keep the main subject visible.`,
            "Do not add a subtitle, author name, watermark, logo or other text. These title requirements override conflicting scene instructions."
          ].join("\n")
        : [
            "Create a complete, finished book cover with its title rendered directly into the image.",
            `The exact current book title is ${JSON.stringify(currentTitle)}. Reproduce every character accurately; do not rename, translate or substitute it. This current title supersedes any earlier title in the scene description.`,
            `Place the title in the ${region}. Typography style: ${candidate.typography.trim() || "choose a clear, readable font matching the artwork"}. Set a suitable size, weight, color and texture with strong contrast; integrate the lettering with the composition without covering the main subject.`,
            "Do not add a subtitle, author name, watermark, logo or other text. These title requirements override any conflicting instructions that omit lettering in the scene description."
          ].join("\n")
      : [
          "Create only a text-free book cover background. Do not render any text, letters, book title, subtitle, author name, watermark or logo.",
          `Leave a clean, quiet area covering approximately one third of the image in the ${region}, with enough contrast for later local title typography. Keep the main subject outside this area.`
        ].join("\n");
  if (titleRendering === "model" && !currentTitle.trim())
    throw new SafeImageError("当前作品没有有效书名，请先设置书名再生成封面。");
  const prompt = [
    titleRendering === "model"
      ? removeTextBans(candidate.prompt)
      : candidate.prompt.trim(),
    instructions
  ]
    .filter(Boolean)
    .join("\n\n");
  if (prompt.length > maxPromptCharacters)
    throw new SafeImageError(
      `封面提示词加上书名与排版要求后超过 ${maxPromptCharacters} 字符，请缩短方案提示词后重试。`
    );
  const negativePrompt =
    titleRendering === "model"
      ? modelNegativePrompt(candidate.negativePrompt)
      : candidate.negativePrompt;
  return { prompt, ...(negativePrompt ? { negativePrompt } : {}) };
}
