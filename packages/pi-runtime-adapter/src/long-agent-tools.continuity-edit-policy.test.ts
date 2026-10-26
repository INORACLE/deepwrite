import {
  committedFixtureIndex,
  twoWrittenChaptersIndex,
  LongWorkspaceIndexSnapshotSchema,
  longLedgerCommitFileId,
  documentExecutor,
  longTools,
  toolByName,
  describe,
  it,
  expect
} from "./long-agent-tools.test-support";

describe("continuity edit tool permissions", () => {
  it.each([false, true])(
    "allows only the latest recorded checkpoint (historical=%s)",
    async (historical) => {
      const index = committedFixtureIndex();
      if (historical) {
        const two = twoWrittenChaptersIndex();
        index.plot.chapterCards.push(two.plot.chapterCards[1]!);
        index.chapters.push({ ...two.chapters[1]!, commitId: "commit_two" });
        index.ledger.commits.push({
          ...index.ledger.commits[0]!,
          id: "commit_two",
          sequence: 2,
          chapterCardId: "chapter_two",
          recordFile: {
            ...index.ledger.commits[0]!.recordFile,
            id: longLedgerCommitFileId("commit_two"),
            path: "long/ledger/commit-two.json"
          }
        });
        index.ledger.committedThroughChapterId = "chapter_two";
      }
      const validated = LongWorkspaceIndexSnapshotSchema.parse(index);
      const file = validated.chapters[0]!.characterState;
      const tools = longTools({
        index: validated,
        activeRoot: "continuity_ledger",
        executor: documentExecutor(validated, { [file.id]: "原章末状态。" })
      });
      await toolByName(tools, "read").execute("read-state", {
        id: "chapter_one",
        document: "character_state"
      });
      const edit = toolByName(tools, "edit").execute("edit-state", {
        id: "chapter_one",
        document: "character_state",
        replacements: [
          { original_text: "原章末状态。", new_text: "修订章末状态。" }
        ]
      });
      if (historical)
        await expect(edit).rejects.toThrow("历史章节的连续性文件为只读");
      else
        await expect(edit).resolves.toMatchObject({
          details: {
            kind: "long-continuity-file-proposal",
            files: [expect.objectContaining({ afterText: "修订章末状态。" })]
          }
        });
    }
  );
});
