import { isLongChapterContinuityReadOnly } from "./renderer";
import {
  committedWorkspace,
  describe,
  expect,
  it
} from "./long-workspace-operations.test-support";

describe("continuity checkpoint edit policy", () => {
  it("advances the editable checkpoint with the ledger and restores it on removal", () => {
    const index = committedWorkspace();
    const [first, second] = index.chapters;
    expect(isLongChapterContinuityReadOnly(index, first!)).toBe(false);
    expect(isLongChapterContinuityReadOnly(index, second!)).toBe(false);
    const next = {
      ...index.ledger.commits[0]!,
      id: "commit_second",
      sequence: 2,
      chapterCardId: second!.chapterCardId
    };
    second!.commitId = next.id;
    index.ledger.commits.push(next);
    expect(isLongChapterContinuityReadOnly(index, first!)).toBe(true);
    expect(isLongChapterContinuityReadOnly(index, second!)).toBe(false);
    index.ledger.commits.pop();
    second!.commitId = null;
    expect(isLongChapterContinuityReadOnly(index, first!)).toBe(false);
  });

  it("keeps earlier chapters of the latest batch read-only, including empty files", () => {
    const index = committedWorkspace();
    const [first, second] = index.chapters;
    const record = index.ledger.commits[0]!;
    index.ledger.commits[0] = {
      ...record,
      mode: "text_files_batch",
      chapterCardId: second!.chapterCardId,
      chapterCardIds: [first!.chapterCardId, second!.chapterCardId],
      checkpointChapterCardId: second!.chapterCardId
    };
    second!.commitId = record.id;
    expect(isLongChapterContinuityReadOnly(index, first!)).toBe(true);
    expect(isLongChapterContinuityReadOnly(index, second!)).toBe(false);
  });
});
