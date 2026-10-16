import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isOnDemandMaterial,
  MATERIAL_ON_DEMAND_MARKER,
  MaterialQueryInputSchema,
  parseMaterialMarkdown,
  type LongMaterialConvertInput
} from "@deepwrite/contracts";
import { MaterialQueryService } from "../material-query-service";
import { longMaterialFixture } from "./test-support";

describe("transferring all long chapter bodies", { timeout: 60_000 }, () => {
  it("is opt-in, including when the source has selected sample chapters", async () => {
    const fixture = await longMaterialFixture(3);
    const index = (
      await fixture.longs.getWorkspaceIndex({ bookId: fixture.bookId })
    ).workspaceIndex;
    const request: LongMaterialConvertInput = {
      bookId: fixture.bookId,
      options: {
        ...fixture.options,
        sampleChapterIds: [
          index.chapters.find(({ bodyStatus }) => bodyStatus === "written")!
            .chapterCardId
        ]
      },
      target: { action: "create", title: "测试素材" },
      operationId: "bodies-default"
    };
    const service = fixture.service();
    const first = await service.convert(request);
    expect(first.entries.some(({ key }) => key.startsWith("body:"))).toBe(
      false
    );
    expect(first.entries.some(({ key }) => key.startsWith("sample:"))).toBe(
      true
    );
    const again = await service.convert({
      ...request,
      target: { action: "update", packId: first.pack.id }
    });
    expect(again.counts.unchanged).toBe(first.entries.length);
  });

  it("copies every non-empty body losslessly to Draft, without generated metadata or duplicate samples", async () => {
    const fixture = await longMaterialFixture(4);
    const index = (
      await fixture.longs.getWorkspaceIndex({ bookId: fixture.bookId })
    ).workspaceIndex;
    const original =
      "---\r\ncustom: source\r\n---\r\n\r\n" +
      "完整正文😀末尾".repeat(4000) +
      "\r\n\n  ";
    const firstBody = join(
      fixture.projectDirectory,
      index.chapters[0]!.body.path
    );
    await writeFile(firstBody, original, "utf8");
    await writeFile(
      join(fixture.projectDirectory, index.chapters[1]!.body.path),
      " \n\t",
      "utf8"
    );
    // Even if the index says 'empty', an existing non-empty body must be copied.
    await fixture.longs.store.transactManaged(
      fixture.projectDirectory,
      async ({ index: current }) => {
        current.chapters[2]!.bodyStatus = "empty";
        return { operations: [], result: undefined };
      }
    );
    const service = fixture.service();
    const request: LongMaterialConvertInput = {
      bookId: fixture.bookId,
      options: {
        ...fixture.options,
        sections: [],
        transferAllBodies: true,
        sampleChapterIds: [index.chapters[0]!.chapterCardId]
      },
      target: { action: "create", title: "全部正文" },
      operationId: "bodies-all"
    };
    const preview = await service.plan(request);
    const converted = await service.convert(request);
    expect(preview.plan.entries.map(({ key }) => key)).toEqual(
      converted.entries.map(({ key }) => key)
    );
    const bodies = converted.entries.filter(({ key }) =>
      key.startsWith("body:")
    );
    expect(bodies.length).toBeGreaterThan(3);
    expect(
      bodies.every(
        ({ kind, stageId }) => kind === "draft" && stageId === "draft_excerpt"
      )
    ).toBe(true);
    expect(converted.entries.some(({ key }) => key.startsWith("sample:"))).toBe(
      false
    );
    expect(
      bodies.some(({ key }) => key.includes(index.chapters[1]!.chapterCardId))
    ).toBe(false);
    expect(
      bodies.some(({ key }) => key.includes(index.chapters[2]!.chapterCardId))
    ).toBe(true);
    const contents = await Promise.all(
      bodies
        .filter(({ key }) =>
          key.startsWith(`body:${index.chapters[0]!.chapterCardId}:`)
        )
        .map(async (entry) => {
          const doc = await fixture.catalog.readDocument({
            projectId: entry.libraryId!,
            target: "document",
            documentId: entry.entryId!
          });
          expect(isOnDemandMaterial(doc.content)).toBe(true);
          expect(parseMaterialMarkdown(doc.content).name).toBeUndefined();
          expect(
            parseMaterialMarkdown(doc.content).description
          ).toBeUndefined();
          return doc.content.slice(MATERIAL_ON_DEMAND_MARKER.length + 1);
        })
    );
    expect(contents.join("")).toBe(original);
    expect(await readFile(firstBody, "utf8")).toBe(original);
    const record = await fixture.service().store.read(converted.pack.id);
    expect(record.options.transferAllBodies).toBe(true);
    expect(
      Object.entries(record.entries)
        .filter(([key]) => key.startsWith("body:"))
        .every(([, entry]) => entry.description === "")
    ).toBe(true);
    const update = {
      ...request,
      target: { action: "update" as const, packId: converted.pack.id }
    };
    expect((await fixture.service().convert(update)).counts.unchanged).toBe(
      converted.entries.length
    );
    // Switching the option off does not silently delete persistent materials.
    const disabled = await service.convert({
      ...update,
      options: { ...request.options, transferAllBodies: false }
    });
    expect(disabled.counts.stale).toBe(bodies.length);
  });

  it("only advertises the library overview; full-text search and explicit reads still reach bodies", async () => {
    const fixture = await longMaterialFixture(3);
    const converted = await fixture.service().convert({
      bookId: fixture.bookId,
      options: { ...fixture.options, transferAllBodies: true },
      target: { action: "create", title: "正文按需读" },
      operationId: "bodies-query"
    });
    const libraryId = converted.libraries.find(
      ({ kind }) => kind === "draft"
    )!.libraryId;
    await fixture.longs.updateBindings({
      bookId: fixture.bookId,
      linkedMaterialIdsByKind: { draft: [libraryId] },
      linkedSkillIdsByKind: {}
    });
    const queries = new MaterialQueryService(fixture.catalog, fixture.longs);
    const scope = {
      bookId: fixture.bookId,
      bookType: "long",
      stageId: "draft",
      kinds: ["draft"]
    };
    const query = (input: Record<string, unknown>) =>
      queries.query(MaterialQueryInputSchema.parse({ scope, ...input }));
    const listed = await query({ mode: "list" });
    expect(listed.total).toBe(1);
    expect(listed.entries[0]!.title).toBe("《铜铃记》正文 · 库说明");
    const entry = converted.entries.find(({ key }) => key.startsWith("body:"))!;
    expect(JSON.stringify(listed)).not.toContain(entry.title);
    expect(JSON.stringify(listed)).not.toContain("主角沈砚听见铜铃");
    const overview = await query({
      mode: "read",
      entry_id: listed.entries[0]!.id
    });
    expect(overview.content).toContain(entry.title);
    expect(overview.content).toContain("只在本库说明中列出");
    const searched = await query({ mode: "search", query: "主角沈砚听见铜铃" });
    expect(searched.total).toBe(3);
    const read = await query({
      mode: "read",
      entry_id: searched.entries[0]!.id
    });
    expect(read.content).toContain("主角沈砚听见铜铃");
    expect(
      (await query({ mode: "read", entry_name: entry.title })).status
    ).toBe("ok");
    expect((await query({ mode: "search", query: entry.title })).total).toBe(1);
    // Live bindings also protect the new overview route.
    await fixture.longs.updateBindings({
      bookId: fixture.bookId,
      linkedMaterialIdsByKind: { draft: [] },
      linkedSkillIdsByKind: {}
    });
    expect(
      (await query({ mode: "read", entry_id: listed.entries[0]!.id })).status
    ).toBe("not_found");
    expect(
      (await query({ mode: "read", entry_id: searched.entries[0]!.id })).status
    ).toBe("not_found");
  });
});
