import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationDatabase } from "./database";
import { migrateLegacyFile } from "./legacy-file-migration";
import { LegacyConversationStore } from "./legacy-store";
import { LEGACY_FILE_MIGRATION_ID } from "./legacy-migration-state";
import {
  legacyFixtureDate,
  legacyFixtureKey as key,
  legacyFixturePreferenceKey,
  legacyProfilePaths,
  replayLegacyUnderNewPath,
  seedLegacyProfile,
  useOldMigrationPath
} from "./legacy-migration-fixture.test-support";

// Real project transactions and SQLite/profile copies need a disk integration budget.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const roots: string[] = [];
const databases: ConversationDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      /* Closed before copying the profile. */
    }
  }
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

function open(path: string) {
  const database = new ConversationDatabase(path);
  databases.push(database);
  return database;
}

async function fixture(content?: string) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-legacy-relocation-"));
  roots.push(root);
  const original = await seedLegacyProfile(join(root, "original"), content);
  return { root, ...original, database: open(original.path) };
}

async function relocate(
  value: Awaited<ReturnType<typeof fixture>>,
  name = "relocated"
) {
  value.database.close();
  const next = legacyProfilePaths(join(value.root, name));
  await cp(value.profile, next.profile, { recursive: true });
  return { ...value, ...next, database: open(next.path) };
}

function completed(database: ConversationDatabase) {
  return database.database
    .prepare("SELECT state, checked_records FROM migrations WHERE source = ?")
    .get(LEGACY_FILE_MIGRATION_ID);
}

it("keeps newer messages, preferences and permanent deletion through relocation and another fresh start", async () => {
  const original = await fixture();
  await migrateLegacyFile(original.database.database, original.source);
  original.database.commit({
    key,
    sessionId: "session",
    expectedRevision: 0,
    generation: 0,
    sequence: 1,
    batchId: "newer-conversation",
    operations: [
      {
        type: "patchMessage",
        messageId: "first",
        changes: [{ op: "append", path: ["content"], text: " 后续修改" }]
      },
      {
        type: "putMessage",
        messageId: "latest",
        position: 2,
        value: {
          id: "latest",
          role: "assistant",
          content: "最新回复",
          createdAt: legacyFixtureDate,
          status: "completed"
        }
      },
      { type: "setMetadata", value: { draft: "最新草稿" } }
    ]
  });
  original.database.commit({
    key,
    sessionId: "removed-session",
    expectedRevision: 0,
    generation: 0,
    sequence: 1,
    batchId: "delete-old-session",
    operations: [{ type: "setDeleted", deleted: true }]
  });
  original.database.purge({
    key,
    sessionId: "removed-session",
    expectedRevision: 1
  });
  new LegacyConversationStore(original.database.database).save(
    legacyFixturePreferenceKey,
    { layout: "latest" }
  );
  useOldMigrationPath(original.database, original.source);

  let moved = await relocate(original);
  for (const name of ["reinstalled", "moved-again"]) {
    await migrateLegacyFile(moved.database.database, moved.source);
    expect(completed(moved.database)?.state).toBe("complete");
    expect(
      moved.database
        .messages({ key, sessionId: "session" })
        .messages.map((message) => message.value.content)
    ).toEqual(["原始正文 后续修改", "原始正文", "最新回复"]);
    expect(moved.database.session({ key, sessionId: "session" })).toMatchObject(
      { revision: 1, metadata: { draft: "最新草稿" }, messageCount: 3 }
    );
    expect(
      moved.database.session({ key, sessionId: "removed-session" })
    ).toBeNull();
    expect(
      new LegacyConversationStore(moved.database.database).load(
        legacyFixturePreferenceKey
      )
    ).toEqual({ layout: "latest" });
    expect(await readFile(moved.source, "utf8")).toBe(original.original);
    moved = await relocate(moved, name);
  }
  await migrateLegacyFile(moved.database.database, moved.source);
  expect(moved.database.database.prepare("PRAGMA quick_check").get()).toEqual({
    quick_check: "ok"
  });
});

it("automatically recovers a 1.6.303 failed duplicate replay without reparsing or changing live content", async () => {
  const original = await fixture();
  await migrateLegacyFile(original.database.database, original.source);
  useOldMigrationPath(original.database, original.source);
  const moved = await relocate(original);
  await expect(
    replayLegacyUnderNewPath(moved.database, moved.source)
  ).rejects.toThrow("duplicate message IDs");
  const nodes = moved.database.database
    .prepare("SELECT COUNT(*) AS count FROM nodes")
    .get()?.count;
  await migrateLegacyFile(moved.database.database, moved.source, () => {
    throw new Error("Completed history must not be replayed");
  });
  expect(completed(moved.database)).toMatchObject({
    state: "complete",
    checked_records: 3
  });
  expect(
    moved.database.session({ key, sessionId: "session" })?.messageCount
  ).toBe(2);
  expect(
    moved.database.database.prepare("SELECT COUNT(*) AS count FROM nodes").get()
      ?.count
  ).toBe(nodes);
  // Keep the failed path record and raw file available for recovery diagnostics.
  expect(
    moved.database.database
      .prepare("SELECT state FROM migrations WHERE source = ?")
      .get(moved.source)?.state
  ).toBe("superseded");
  expect(await readFile(moved.source, "utf8")).toBe(original.original);
});

it("resumes the furthest old normalization checkpoint after moving, ahead of a failed replay", async () => {
  const original = await fixture();
  original.database.database.exec(
    "CREATE TRIGGER fail_second BEFORE INSERT ON messages WHEN NEW.message_id = 'second' BEGIN SELECT RAISE(ABORT, 'simulated interruption'); END;"
  );
  await expect(
    migrateLegacyFile(original.database.database, original.source)
  ).rejects.toThrow("simulated interruption");
  useOldMigrationPath(original.database, original.source);
  const moved = await relocate(original);
  await expect(
    replayLegacyUnderNewPath(moved.database, moved.source)
  ).rejects.toThrow("duplicate message IDs");
  moved.database.database.exec("DROP TRIGGER fail_second");
  await migrateLegacyFile(moved.database.database, moved.source);
  expect(completed(moved.database)).toMatchObject({
    state: "complete",
    checked_records: 3
  });
  expect(
    moved.database
      .messages({ key, sessionId: "session" })
      .messages.map((message) => message.messageId)
  ).toEqual(["first", "second"]);
  await migrateLegacyFile(moved.database.database, moved.source);
  expect(
    moved.database
      .messages({ key, sessionId: "session" })
      .messages.map((message) => message.messageId)
  ).toEqual(["first", "second"]);
  expect(await readFile(moved.source, "utf8")).toBe(original.original);
});

it("resumes an old parsing checkpoint across a moved escaped UTF-8 file", async () => {
  const content = '正文😀\n\\"'.repeat(25_000);
  const original = await fixture(content);
  let savedOffset = 0;
  await expect(
    migrateLegacyFile(original.database.database, original.source, (offset) => {
      savedOffset = offset;
      throw new Error("simulated parsing interruption");
    })
  ).rejects.toThrow("simulated parsing interruption");
  useOldMigrationPath(original.database, original.source);
  const moved = await relocate(original);
  const offsets: number[] = [];
  await migrateLegacyFile(moved.database.database, moved.source, (offset) => {
    offsets.push(offset);
  });
  expect(offsets[0]).toBeGreaterThan(savedOffset);
  const value = new LegacyConversationStore(moved.database.database).load(key);
  expect(value).toMatchObject({
    conversations: [
      { sessionId: "session", messages: [{ content }, { content }] },
      { sessionId: "removed-session", messages: [{ content }] }
    ]
  });
  expect(completed(moved.database)?.state).toBe("complete");
});

it.each(["changed", "missing"])(
  "preserves pending history if the relocated source is %s",
  async (failure) => {
    const original = await fixture("正文".repeat(50_000));
    await expect(
      migrateLegacyFile(original.database.database, original.source, () => {
        throw new Error("simulated interruption");
      })
    ).rejects.toThrow("simulated interruption");
    useOldMigrationPath(original.database, original.source);
    const moved = await relocate(original);
    if (failure === "changed") await writeFile(moved.source, "{}");
    else await rm(moved.source);
    await expect(
      migrateLegacyFile(moved.database.database, moved.source)
    ).rejects.toThrow(
      failure === "changed"
        ? "changed during migration"
        : "missing during migration"
    );
    expect(completed(moved.database)).toBeUndefined();
    expect(await readFile(original.source, "utf8")).toBe(original.original);
  }
);

it.each(["changed", "missing"])(
  "uses the authoritative completed database when its moved legacy copy is %s",
  async (legacy) => {
    const original = await fixture();
    await migrateLegacyFile(original.database.database, original.source);
    useOldMigrationPath(original.database, original.source);
    const moved = await relocate(original);
    if (legacy === "changed") await writeFile(moved.source, "old invalid JSON");
    else await rm(moved.source);
    await migrateLegacyFile(moved.database.database, moved.source);
    expect(completed(moved.database)?.state).toBe("complete");
    expect(
      moved.database.session({ key, sessionId: "session" })?.messageCount
    ).toBe(2);
  }
);

it("adopts a completed Windows path regardless of drive or directory casing", async () => {
  const original = await fixture();
  await migrateLegacyFile(original.database.database, original.source);
  useOldMigrationPath(
    original.database,
    "C:\\Users\\fixture\\AppData\\Roaming\\DeepWrite\\renderer-state\\conversation-persistence.json"
  );
  const moved = await relocate(original);
  await migrateLegacyFile(moved.database.database, moved.source);
  expect(completed(moved.database)?.state).toBe("complete");
  expect(
    moved.database.session({ key, sessionId: "session" })?.messageCount
  ).toBe(2);
});
