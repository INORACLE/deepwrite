import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { FolderCatalogStore } from "../folder-catalog-store";
import { LongWorkspaceService } from "../long-workspace-service";
import { withBookIdentityCommands } from "./commands";

// Real project transactions and SQLite/profile copies need a disk integration budget.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
});

it("resolves short, script and long books through their registries and emits durable revisions", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-identity-command-"))
  );
  roots.push(root);
  const catalog = new FolderCatalogStore({ userDataPath: root });
  const longs = new LongWorkspaceService({ userDataPath: root });
  const short = await catalog.createShortBook(
    { title: "短篇测试", genre: "其他" },
    root
  );
  const script = await catalog.createScriptBook(
    { title: "剧本测试", genre: "其他" },
    root
  );
  const long = await longs.create(root, { title: "长篇测试", genre: "其他" });
  const events: SystemEventEnvelope[] = [];
  let forwarded = false;
  const handle = withBookIdentityCommands(
    async () => catalog,
    longs,
    async (command) => {
      forwarded = true;
      return { status: "accepted", requestId: command.id, payload: {} };
    }
  );
  for (const book of [
    { projectType: "short", projectId: short.resource.id },
    { projectType: "script", projectId: script.resource.id },
    { projectType: "long", projectId: long.book.id }
  ] as const) {
    const result = await handle(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "bookIdentity.addManualCandidate",
          {
            book,
            field: "title",
            candidate: {
              title: "灯火将明",
              angle: "悬念",
              rationale: "保留情绪",
              keywords: []
            }
          },
          {
            id: `manual_${book.projectType}`,
            context: { correlationId: "identity_test" }
          }
        )
      ),
      (event) => events.push(event)
    );
    expect(result.status).toBe("accepted");
    if (result.status === "accepted")
      expect(result.payload).toMatchObject({
        bookId: book.projectId,
        revision: 1
      });
    const path =
      book.projectType === "long"
        ? (await longs.catalog.open(book.projectId)).projectDirectory
        : await catalog.managedProjectDirectory(book.projectId);
    expect(
      JSON.parse(
        await readFile(join(path, "book-identity", "identity.json"), "utf8")
      )
    ).toMatchObject({ bookId: book.projectId, revision: 1 });
  }
  expect(events.map((event) => event.type)).toEqual([
    "book_identity.updated",
    "book_identity.updated",
    "book_identity.updated"
  ]);
  expect(events[0]?.payload).toMatchObject({
    bookKey: `short:${short.resource.id}`,
    revision: 1
  });
  const wrongType = await handle(
    CommandEnvelopeSchema.parse(
      createEnvelope(
        "bookIdentity.get",
        {
          book: { projectType: "script", projectId: short.resource.id }
        },
        { id: "wrong_type", context: { correlationId: "identity_test" } }
      )
    ),
    () => undefined
  );
  expect(wrongType.status).toBe("rejected");
  expect(forwarded).toBe(false);
  await handle(
    CommandEnvelopeSchema.parse(
      createEnvelope(
        "system.health",
        {},
        { id: "health", context: { correlationId: "identity_test" } }
      )
    ),
    () => undefined
  );
  expect(forwarded).toBe(true);
});
