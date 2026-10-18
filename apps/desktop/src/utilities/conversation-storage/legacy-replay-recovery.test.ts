import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationDatabase } from "./database";
import { JsonNodes, type ValueRef } from "./json-nodes";
import { migrateLegacyFile } from "./legacy-file-migration";
import {
  legacyFixtureKey as key,
  legacyFixturePreferenceKey as preferenceKey,
  legacyProfilePaths,
  replayLegacyUnderNewPath,
  seedLegacyProfile,
  useOldMigrationPath
} from "./legacy-migration-fixture.test-support";
import { LegacyConversationStore } from "./legacy-store";
import { Statements } from "./schema";

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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-replay-recovery-"));
  roots.push(root);
  const original = await seedLegacyProfile(join(root, "original"));
  return { root, ...original, database: open(original.path) };
}

async function failedReplay(original: Awaited<ReturnType<typeof fixture>>) {
  useOldMigrationPath(original.database, original.source);
  original.database.close();
  const moved = legacyProfilePaths(join(original.root, "custom"));
  await cp(original.profile, moved.profile, { recursive: true });
  const database = open(moved.path);
  await expect(
    replayLegacyUnderNewPath(database, moved.source)
  ).rejects.toThrow(/duplicate message IDs|UNIQUE constraint/);
  return { ...moved, database };
}

function backupValues(database: ConversationDatabase) {
  const nodes = new JsonNodes(new Statements(database.database));
  return database.database
    .prepare(
      "SELECT value_ref FROM legacy_backups WHERE key LIKE 'migration-replay:%' ORDER BY id"
    )
    .all()
    .map((row) => nodes.read(JSON.parse(String(row.value_ref)) as ValueRef));
}

async function removedMessageFixture() {
  const original = await fixture();
  await migrateLegacyFile(original.database.database, original.source);
  original.database.commit({
    key,
    sessionId: "session",
    expectedRevision: 0,
    generation: 0,
    sequence: 1,
    batchId: "remove-first-message",
    operations: [
      { type: "removeMessages", messageIds: ["first"] },
      {
        type: "patchMessage",
        messageId: "second",
        changes: [{ op: "set", path: ["content"], value: "最新正文" }]
      },
      { type: "setMetadata", value: { draft: "最新草稿" } }
    ]
  });
  return failedReplay(original);
}

it("quarantines a removed message reinserted before the old replay failed, without overwriting later edits", async () => {
  const moved = await removedMessageFixture();
  expect(
    moved.database.session({ key, sessionId: "session" })?.messageCount
  ).toBe(2);
  await migrateLegacyFile(moved.database.database, moved.source);
  expect(
    moved.database.messages({ key, sessionId: "session" }).messages
  ).toMatchObject([{ messageId: "second", value: { content: "最新正文" } }]);
  expect(moved.database.session({ key, sessionId: "session" })).toMatchObject({
    revision: 1,
    generation: 1,
    sequence: 1,
    metadata: { draft: "最新草稿" },
    messageCount: 1
  });
  expect(backupValues(moved.database)).toMatchObject([
    { id: "first", content: "原始正文" }
  ]);
  await migrateLegacyFile(moved.database.database, moved.source);
  expect(backupValues(moved.database)).toHaveLength(1);
  // A new legitimate write with the same ID must survive later restarts.
  moved.database.commit({
    key,
    sessionId: "session",
    expectedRevision: 1,
    generation: 1,
    sequence: 2,
    batchId: "new-first-message",
    operations: [
      {
        type: "putMessage",
        messageId: "first",
        position: 2,
        value: { id: "first", role: "user", content: "新的消息" }
      }
    ]
  });
  await migrateLegacyFile(moved.database.database, moved.source);
  expect(
    moved.database.messages({ key, sessionId: "session" }).messages
  ).toMatchObject([
    { messageId: "second", value: { content: "最新正文" } },
    { messageId: "first", value: { content: "新的消息" } }
  ]);
});

it.each(["populated", "empty", "all"])(
  "restores permanent deletion after the old replay resurrected %s sessions",
  async (kind) => {
    const original = await fixture();
    if (kind === "empty") {
      const raw = JSON.parse(original.original);
      raw.entries[key].conversations[0].messages = [];
      await writeFile(original.source, JSON.stringify(raw));
    }
    const preserved = await readFile(original.source, "utf8");
    await migrateLegacyFile(original.database.database, original.source);
    new LegacyConversationStore(original.database.database).save(
      preferenceKey,
      { layout: "latest" }
    );
    for (const sessionId of kind === "all"
      ? ["session", "removed-session"]
      : ["session"]) {
      original.database.commit({
        key,
        sessionId,
        expectedRevision: 0,
        generation: 0,
        sequence: 1,
        batchId: `purge-${sessionId}`,
        operations: [{ type: "setDeleted", deleted: true }]
      });
      original.database.purge({ key, sessionId, expectedRevision: 1 });
    }
    const moved = await failedReplay(original);
    expect(
      moved.database.session({ key, sessionId: "session" })
    ).not.toBeNull();
    await migrateLegacyFile(moved.database.database, moved.source);
    expect(moved.database.session({ key, sessionId: "session" })).toBeNull();
    if (kind === "all")
      expect(
        moved.database.session({ key, sessionId: "removed-session" })
      ).toBeNull();
    else
      expect(
        moved.database.session({ key, sessionId: "removed-session" })
          ?.messageCount
      ).toBe(1);
    expect(
      moved.database.database
        .prepare("SELECT active_session_id FROM scopes WHERE key = ?")
        .get(key)?.active_session_id
    ).toBeNull();
    expect(
      new LegacyConversationStore(moved.database.database).load(preferenceKey)
    ).toEqual({ layout: "latest" });
    expect(backupValues(moved.database)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: "session", draft: "旧草稿" })
      ])
    );
    expect(await readFile(moved.source, "utf8")).toBe(preserved);
    await migrateLegacyFile(moved.database.database, moved.source);
    expect(moved.database.session({ key, sessionId: "session" })).toBeNull();
    expect(moved.database.database.prepare("PRAGMA quick_check").get()).toEqual(
      { quick_check: "ok" }
    );
  }
);

it("removes a deleted preference reinserted by an incomplete replay, retaining a backup", async () => {
  const original = await fixture();
  const raw = JSON.parse(original.original);
  const reordered = JSON.stringify({
    version: 1,
    entries: {
      [preferenceKey]: raw.entries[preferenceKey],
      [key]: raw.entries[key]
    }
  });
  await writeFile(original.source, reordered);
  await migrateLegacyFile(original.database.database, original.source);
  new LegacyConversationStore(original.database.database).remove(preferenceKey);
  const moved = await failedReplay(original);
  const legacy = new LegacyConversationStore(moved.database.database);
  expect(legacy.load(preferenceKey)).toEqual({ layout: "old" });
  await migrateLegacyFile(moved.database.database, moved.source);
  expect(legacy.load(preferenceKey)).toBeUndefined();
  expect(backupValues(moved.database)).toEqual([{ layout: "old" }]);
  expect(await readFile(moved.source, "utf8")).toBe(reordered);
});

it("preserves a replayed message that was explicitly edited during recovery", async () => {
  const moved = await removedMessageFixture();
  moved.database.commit({
    key,
    sessionId: "session",
    expectedRevision: 1,
    generation: 1,
    sequence: 2,
    batchId: "manual-recovery-edit",
    operations: [
      {
        type: "patchMessage",
        messageId: "first",
        changes: [{ op: "set", path: ["content"], value: "用户已恢复并修改" }]
      }
    ]
  });
  await migrateLegacyFile(moved.database.database, moved.source);
  expect(
    moved.database.messages({ key, sessionId: "session" }).messages
  ).toMatchObject([
    { messageId: "first", value: { content: "用户已恢复并修改" } },
    { messageId: "second", value: { content: "最新正文" } }
  ]);
  expect(backupValues(moved.database)).toHaveLength(0);
});

it("rolls back quarantine and marker adoption together if recovery is interrupted", async () => {
  const moved = await removedMessageFixture();
  moved.database.database.exec(
    "CREATE TRIGGER fail_recovery BEFORE UPDATE OF state ON migrations WHEN NEW.state = 'superseded' BEGIN SELECT RAISE(ABORT, 'recovery interrupted'); END;"
  );
  await expect(
    migrateLegacyFile(moved.database.database, moved.source)
  ).rejects.toThrow("recovery interrupted");
  expect(
    moved.database.session({ key, sessionId: "session" })?.messageCount
  ).toBe(2);
  expect(backupValues(moved.database)).toHaveLength(0);
  moved.database.database.exec("DROP TRIGGER fail_recovery");
  await migrateLegacyFile(moved.database.database, moved.source);
  expect(
    moved.database.session({ key, sessionId: "session" })?.messageCount
  ).toBe(1);
  expect(backupValues(moved.database)).toHaveLength(1);
});
