import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeviceSyncConversationSessionWrite } from "@deepwrite/contracts";
import { ConversationDatabase } from "./database";

const KEY = "conversation-history:book-a1b2c3d4%3Achat";
const roots: string[] = [];
const databases: ConversationDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function open() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-conversation-sync-"));
  roots.push(root);
  const database = new ConversationDatabase(join(root, "history.sqlite"));
  databases.push(database);
  return database;
}
const value = (id: string, content: string, status = "completed") => ({
  id,
  role: "user",
  content,
  createdAt: "2026-10-01T10:00:00.000Z",
  status
});
function write(
  overrides: Partial<DeviceSyncConversationSessionWrite> = {}
): DeviceSyncConversationSessionWrite {
  return {
    sessionId: "s1",
    expectedRevision: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    restore: false,
    archive: false,
    remove: [],
    put: [
      { id: "m1", value: value("m1", "第一条") },
      { id: "m2", value: value("m2", "第二条") }
    ],
    order: ["m1", "m2"],
    ...overrides
  };
}
const ids = (database: ConversationDatabase) =>
  database
    .syncExport(KEY, ["s1"])
    .sessions[0]?.messages.map((message) => message.id);

describe("conversation storage for device sync", () => {
  it("writes whole sessions atomically through revisioned batches", async () => {
    const database = await open();
    expect(database.syncApply(KEY, [write()]).results).toEqual([
      { sessionId: "s1", status: "applied", revision: 1 }
    ]);
    const listed = database.list({ key: KEY, limit: 10 });
    expect(listed.sessions.map((session) => session.sessionId)).toEqual(["s1"]);
    expect(database.syncExport(KEY, ["s1"]).sessions[0]).toMatchObject({
      revision: 1,
      deleted: false,
      metadata: { createdAt: "2026-10-01T09:00:00.000Z", draft: "" }
    });

    expect(
      database.syncApply(KEY, [
        write({
          expectedRevision: 1,
          put: [{ id: "m0", value: value("m0", "插入的第一条") }],
          remove: ["m2"],
          order: ["m0", "m1"]
        })
      ]).results[0]?.status
    ).toBe("applied");
    expect(ids(database)).toEqual(["m0", "m1"]);

    // An export taken before another write is stale.
    expect(
      database.syncApply(KEY, [
        write({ expectedRevision: 1, put: [], order: [] })
      ]).results[0]?.status
    ).toBe("changed");

    database.syncApply(KEY, [
      write({
        expectedRevision: 2,
        put: [],
        order: ["m0", "m1"],
        archive: true
      })
    ]);
    expect(database.syncInventory([KEY]).scopes[KEY]?.sessions).toEqual([
      { sessionId: "s1", revision: 3, deleted: true, messageCount: 2 }
    ]);
    database.syncApply(KEY, [
      write({
        expectedRevision: 3,
        restore: true,
        put: [{ id: "m3", value: value("m3", "恢复后的消息") }],
        order: ["m0", "m1", "m3"]
      })
    ]);
    expect(
      database.syncInventory([KEY]).scopes[KEY]?.sessions[0]
    ).toMatchObject({
      deleted: false,
      messageCount: 3
    });
  });

  it("does not touch a session with a running reply", async () => {
    const database = await open();
    database.syncApply(KEY, [
      write({
        put: [{ id: "m1", value: value("m1", "生成中", "streaming") }],
        order: ["m1"]
      })
    ]);
    expect(
      database.syncApply(KEY, [
        write({ expectedRevision: 1, put: [], order: [], archive: true })
      ]).results[0]?.status
    ).toBe("busy");
  });
});
