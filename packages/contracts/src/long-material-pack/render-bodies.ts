import type { LongMaterialPlannedEntry } from "./entry";
import { LONG_MATERIAL_ENTRY_TARGET_CHARACTERS } from "./limits";
import { chapterLabel, partTitle } from "./markdown";
import type { LongMaterialSource } from "./source";

/** Lossless chunks: joining them reproduces the exact source Markdown. */
function bodyParts(body: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(
      start + LONG_MATERIAL_ENTRY_TARGET_CHARACTERS,
      body.length
    );
    if (end < body.length) {
      const newline = body.lastIndexOf("\n", end - 1);
      if (newline > start) end = newline + 1;
      // Do not cut a UTF-16 surrogate pair when a long paragraph has no break.
      else if (/[\uD800-\uDBFF]/u.test(body[end - 1]!)) end -= 1;
    }
    parts.push(body.slice(start, end));
    start = end;
  }
  return parts;
}

export function renderBodies(
  source: LongMaterialSource
): LongMaterialPlannedEntry[] {
  return (source.bodies ?? [])
    .filter(({ body }) => body.trim())
    .flatMap((chapter) => {
      const parts = bodyParts(chapter.body);
      return parts.map((body, index) => ({
        key: `body:${chapter.chapterId}:${index + 1}`,
        kind: "draft",
        stageId: "draft_excerpt",
        title: partTitle(
          `正文·${chapterLabel(chapter.number, chapter.title)}`,
          index,
          parts.length
        ),
        description: "",
        body,
        readOnDemand: true
      }));
    });
}
