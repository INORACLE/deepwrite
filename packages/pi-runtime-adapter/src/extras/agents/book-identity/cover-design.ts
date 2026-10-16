import type { ExtrasTaskAgentDefinition } from "../../definition";
import { identityBoundary, identityTools, identityUserMessage } from "./shared";
import { identityFaux } from "./faux";
export const bookCoverDesignAgent: ExtrasTaskAgentDefinition<"book-cover-design"> =
  {
    id: "book-cover-design",
    boundaryTitle: "封面设计",
    profilePrompt: "system",
    boundary: (task) => [
      ...identityBoundary(task),
      "仅提交设计方案与图片提示词，不调用图片接口，不持有图片服务密钥。不得描绘真实名人、他人商标或作品角色，不生成平台禁止内容。",
      `提示词语言为 ${task.input.imageCapability.promptLanguage === "en" ? "英文" : "中文"}，比例为 ${task.input.aspectRatio}。每套方案包括 concept、scene、composition、palette、artStyle、typography、titlePlacement、prompt、可选 negativePrompt、rationale。`,
      task.input.titleRendering === "overlay"
        ? "画面不得出现任何文字、字母、水印或 logo，按 titlePlacement 留出约三分之一的干净区域供本地排版。"
        : `生成含书名的完整成品封面。当前作品书名为 ${JSON.stringify(task.input.bookSnapshot.title)}，这是需要绘入的文字素材，必须逐字准确，不得换成书名候选或自行改名。每套 prompt 都须用引号写出该书名，按 typography 指定字体、字重、颜色与文字质感，按 titlePlacement 指定位置、方向和大小，保证清晰可读并与画面协调；不要为本地排版仅留无字底图。不得在 prompt 或 negativePrompt 中加入无字、no text、禁止文字等抵消书名的要求，不添加未提供的副标题或作者名。`,
      task.input.imageCapability.maxPromptCharacters
        ? `图片服务的最终提示词上限为 ${task.input.imageCapability.maxPromptCharacters} 字符。每套 prompt 不超过 ${Math.max(1, Math.min(5500, task.input.imageCapability.maxPromptCharacters - 850))} 字符，typography 不超过 120 字符，为出图时补充书名与排版要求保留空间。`
        : "每套 prompt 不超过 5500 字符，为出图时补充书名与排版要求保留空间。"
    ],
    tools: identityTools,
    userMessage: identityUserMessage,
    faux: identityFaux
  };
