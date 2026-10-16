import { describe, expect, it } from "vitest";
import { buildCoverImagePrompt } from "./cover-image-prompt";

const candidate = {
  prompt:
    "雨夜窗前的灯，no text, without letters, text-free，无字底图，不出现文字",
  negativePrompt: "文字, no text, typography, title, low quality, watermark",
  typography: "手写宋体，金色，粗体",
  titlePlacement: "right" as const
};

describe("cover image prompts", () => {
  it("uses the current title and candidate typography while removing conflicting text bans", () => {
    const result = buildCoverImagePrompt(candidate, "model", "旧城新雨");
    expect(result.prompt).toContain('exact current book title is "旧城新雨"');
    expect(result.prompt).toContain("complete, finished book cover");
    expect(result.prompt).toContain(
      "right side of the cover, arranged vertically"
    );
    expect(result.prompt).toContain("手写宋体，金色，粗体");
    expect(result.prompt).toContain("supersedes any earlier title");
    expect(result.prompt).not.toMatch(
      /no text|without letters|text-free|无字|不出现文字/u
    );
    expect(result.negativePrompt).toBe("low quality, watermark");
  });

  it("omits an entirely conflicting negative prompt and safely quotes literal title text", () => {
    const result = buildCoverImagePrompt(
      {
        ...candidate,
        negativePrompt: "文字、字母; without text",
        typography: ""
      },
      "model",
      '雨夜"来信"'
    );
    expect(result).not.toHaveProperty("negativePrompt");
    expect(result.prompt).toContain(JSON.stringify('雨夜"来信"'));
    expect(result.prompt).toContain("clear, readable font");
  });

  it("keeps a text-free background and reserves the selected title region for local composition", () => {
    const result = buildCoverImagePrompt(candidate, "overlay", "不应绘入");
    expect(result.prompt).toContain("only a text-free book cover background");
    expect(result.prompt).toContain("Do not render any text");
    expect(result.prompt).toContain("approximately one third");
    expect(result.prompt).toContain(
      "right side of the cover, arranged vertically"
    );
    expect(result.prompt).not.toContain("不应绘入");
    expect(result.negativePrompt).toBe(candidate.negativePrompt);
  });

  it("retains title and layout requirements within MiniMax's character limit", () => {
    const result = buildCoverImagePrompt(
      { ...candidate, prompt: `${"scene ".repeat(100)} no text` },
      "model",
      '雨夜"来信"',
      1500
    );
    expect(result.prompt.length).toBeLessThanOrEqual(1500);
    expect(result.prompt).toContain(JSON.stringify('雨夜"来信"'));
    expect(result.prompt).toContain(candidate.typography);
    expect(result.prompt).toContain("arranged vertically");
    expect(result.prompt).toContain("supersedes any earlier title");
    expect(result.prompt).not.toContain("no text");
    expect(result.negativePrompt).toBe("low quality, watermark");
  });

  it("rejects missing titles and oversized combined prompts before generation", () => {
    expect(() => buildCoverImagePrompt(candidate, "model", " ")).toThrow(
      "有效书名"
    );
    expect(() =>
      buildCoverImagePrompt(
        { ...candidate, prompt: "景".repeat(8000) },
        "model",
        "书名"
      )
    ).toThrow("超过 8000 字符");
    expect(
      buildCoverImagePrompt(
        {
          ...candidate,
          prompt: "景".repeat(5500),
          typography: "字".repeat(1000)
        },
        "model",
        "名".repeat(256)
      ).prompt.length
    ).toBeLessThanOrEqual(8000);
  });
});
