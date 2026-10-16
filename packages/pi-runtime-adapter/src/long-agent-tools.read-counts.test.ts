import { LongReadDocumentResultSchema } from "@deepwrite/contracts";
import {
  committedFixtureIndex,
  describe,
  documentExecutor,
  expect,
  fixtureStoryPlotIndex,
  fixtureWorldbuildingIndex,
  it,
  longTools,
  resultText,
  toolByName,
  vi,
  type LongCommandExecutor
} from "./long-agent-tools.test-support";

const body = "# 甲 A，\n\t乙\u3000🙂";
const blank = " \r\n\t\u00a0\u3000\ufeff";

function snapshot() {
  const index = committedFixtureIndex();
  index.worldbuilding = fixtureWorldbuildingIndex().worldbuilding;
  index.plot.storyPlots = fixtureStoryPlotIndex().plot.storyPlots;
  index.plot.volumes[0]!.summary = body;
  index.plot.arcs[0]!.summary = blank;
  index.plot.foreshadowing.push({
    id: "foreshadow_one",
    title: "旧伏笔",
    coreQuestion: "谁？",
    hiddenTruth: "甲",
    truthEventId: null,
    expectedReaderEffect: "惊讶",
    status: "planned",
    beats: []
  });
  return index;
}

const documentTargets = [
  { id: "book_line" },
  { id: "character_overview" },
  { id: "world_rules" },
  { id: "world_magic" },
  { id: "worlditem_memory" },
  { id: "storyplot_one" },
  ...["core_profile", "relationships", "current_state", "history"].map(
    (document) => ({ id: "character_alice", document })
  ),
  ...["card", "body", "character_state", "handoff"].map((document) => ({
    id: "chapter_one",
    document
  }))
];

describe("long read counts", () => {
  it.each(documentTargets)(
    "counts full document $id $document",
    async (target) => {
      const index = snapshot();
      const executor = documentExecutor(index);
      // All existing document reads return this body; metadata must not be counted.
      executor.mockImplementation(async (command) => {
        const result = await documentExecutor(index)(command);
        if (command.type !== "long.readDocument") return result;
        if (result.status !== "accepted")
          throw new Error("Expected a document");
        return {
          ...result,
          payload: {
            ...LongReadDocumentResultSchema.parse(result.payload),
            content: body,
            totalCharacters: Array.from(body).length
          }
        };
      });
      const read = toolByName(longTools({ index, executor }), "read");
      expect(read.description).toContain("去除空白，包含标点和 Markdown 符号");
      const text = resultText(await read.execute("read", target));
      expect(text).toContain("当前字数：7 字");
      expect(text).toContain(body);
    }
  );

  it("counts whitespace-only document content as zero", async () => {
    const index = snapshot();
    const read = toolByName(
      longTools({
        index,
        executor: documentExecutor(index, { [index.bookLine.id]: blank })
      }),
      "read"
    );
    const text = resultText(await read.execute("blank", { id: "book_line" }));
    expect(text).toContain("当前字数：0 字");
    expect(text).toContain(blank);
  });

  it("counts index-backed record bodies, not titles and metadata", async () => {
    const index = snapshot();
    const read = toolByName(
      longTools({ index, executor: documentExecutor(index) }),
      "read"
    );
    const text = resultText(await read.execute("record", { id: "volume_one" }));
    expect(text).toContain("当前字数：7 字");
    expect(text).toContain(body);
    expect(
      resultText(await read.execute("blank", { id: "arc_one" }))
    ).toContain("当前字数：0 字");
    const foreshadowing = resultText(
      await read.execute("canonical", { id: "foreshadow_one" })
    );
    // Includes the Markdown headings in the canonical read body.
    expect(foreshadowing).toContain("当前字数：25 字");
    expect(foreshadowing).toContain("## 核心问题");
  });

  it.each(["current_state", "history"])(
    "counts missing inline %s as zero without reading a file",
    async (document) => {
      const index = fixtureWorldbuildingIndex();
      const executor = documentExecutor(index);
      const read = toolByName(longTools({ index, executor }), "read");
      const text = resultText(
        await read.execute("empty", { id: "character_alice", document })
      );
      expect(text).toContain("当前字数：0 字");
      expect(text).toContain("（正文为空）");
      expect(
        executor.mock.calls.some(
          ([command]) => command.type === "long.readDocument"
        )
      ).toBe(false);
    }
  );

  it("counts the assembled document, ignoring Core page lengths and whitespace", async () => {
    const index = snapshot();
    const base = documentExecutor(index);
    const executor = vi.fn<LongCommandExecutor>(async (command, signal) => {
      if (command.type !== "long.readDocument") return base(command, signal);
      const first = command.payload.offset === 0;
      return {
        status: "accepted",
        requestId: command.id,
        payload: {
          bookId: index.bookId,
          file: index.bookLine,
          offset: command.payload.offset,
          content: first ? "# 甲 A，\n" : "\t乙\u3000🙂",
          totalCharacters: Array.from(body).length,
          nextOffset: first ? 7 : null
        }
      };
    });
    const read = toolByName(longTools({ index, executor }), "read");
    const text = resultText(await read.execute("paged", { id: "book_line" }));
    expect(text).toContain(body);
    expect(text).toContain("当前字数：7 字");
    expect(
      executor.mock.calls.filter(
        ([command]) => command.type === "long.readDocument"
      )
    ).toHaveLength(2);
  });

  it("counts the latest same-run document proposal", async () => {
    const index = snapshot();
    const tools = longTools({ index, executor: documentExecutor(index) });
    const target = { id: "book_line" };
    const read = toolByName(tools, "read");
    expect(resultText(await read.execute("before", target))).toContain(
      "当前字数：0 字"
    );
    await toolByName(tools, "edit").execute("edit", {
      ...target,
      content: body,
      summary: "写入故事线"
    });
    const text = resultText(await read.execute("after", target));
    expect(text).toContain("当前字数：7 字");
    expect(text).toContain(body);
  });
});
