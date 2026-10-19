import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repairConversationStorage } from "./offline-repair";
import { ConversationDatabase } from "./database";
import { migrateLegacyFile } from "./legacy-file-migration";
import {
  legacyFixtureKey,
  replayLegacyUnderNewPath,
  seedLegacyProfile,
  useOldMigrationPath
} from "./legacy-migration-fixture.test-support";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
const roots: string[] = [];
async function profile() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-offline-repair-"));
  roots.push(root);
  const path = join(root, "profile");
  await mkdir(path);
  return path;
}
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

describe("offline conversation repair", () => {
  it("backs up the failing replay, repairs it through the production importer, and preserves current messages", async () => {
    const path = await profile();
    const fixture = await seedLegacyProfile(path);
    const database = new ConversationDatabase(fixture.path);
    await migrateLegacyFile(database.database, fixture.source);
    useOldMigrationPath(
      database,
      "C:\\fixture\\old\\conversation-persistence.json"
    );
    database.commit({
      key: legacyFixtureKey,
      sessionId: "session",
      expectedRevision: 0,
      generation: 0,
      sequence: 1,
      batchId: "remove-first",
      operations: [{ type: "removeMessages", messageIds: ["first"] }]
    });
    await expect(
      replayLegacyUnderNewPath(database, fixture.source)
    ).rejects.toThrow("duplicate message");
    database.close();
    const result = await repairConversationStorage(path);
    expect(result).toMatchObject({
      status: "repaired",
      sessions: 2,
      messages: 2
    });
    expect(
      await readFile(
        join(
          result.backupPath!,
          "renderer-state",
          "conversation-persistence.json"
        ),
        "utf8"
      )
    ).toBe(fixture.original);
    const backup = new DatabaseSync(
      join(result.backupPath!, "renderer-state", "conversations.sqlite"),
      { readOnly: true }
    );
    try {
      expect(
        backup.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count
      ).toBe(3);
      expect(
        backup
          .prepare(
            "SELECT COUNT(*) AS count FROM migrations WHERE state = 'normalizing'"
          )
          .get()?.count
      ).toBe(1);
    } finally {
      backup.close();
    }
    const repaired = new ConversationDatabase(fixture.path);
    try {
      expect(
        repaired
          .messages({ key: legacyFixtureKey, sessionId: "session" })
          .messages.map((message) => message.messageId)
      ).toEqual(["second"]);
      expect(
        repaired.database.prepare("PRAGMA quick_check").get()?.quick_check
      ).toBe("ok");
      expect(
        repaired.database
          .prepare("SELECT state FROM migrations WHERE source = ?")
          .get(fixture.source)?.state
      ).toBe("complete");
      expect(result.backupVerified).toBe(true);
    } finally {
      repaired.close();
    }
  });

  it("reports invalid old JSON without deleting it or pretending the repair succeeded", async () => {
    const path = await profile();
    const fixture = await seedLegacyProfile(path);
    const original = '{"version":1,"entries":';
    await writeFile(fixture.source, original);
    const result = await repairConversationStorage(path);
    expect(result).toMatchObject({
      status: "failed",
      phase: "legacy-migration",
      code: "migration_invalid"
    });
    expect(await readFile(fixture.source, "utf8")).toBe(original);
    expect(
      await readFile(
        join(
          result.backupPath!,
          "renderer-state",
          "conversation-persistence.json"
        ),
        "utf8"
      )
    ).toBe(original);
  });

  it("retains a corrupt database byte for byte and requires explicit reset before isolating history", async () => {
    const path = await profile();
    const fixture = await seedLegacyProfile(path);
    const original = "INVALID_FIXTURE_SQLITE_BYTES";
    await writeFile(fixture.path, original);
    const failed = await repairConversationStorage(path);
    expect(failed).toMatchObject({
      status: "failed",
      code: "database_corrupt",
      phase: "database-open",
      sqliteCode: 26
    });
    expect(await readFile(fixture.path, "utf8")).toBe(original);
    expect(
      await readFile(
        join(failed.backupPath!, "renderer-state", "conversations.sqlite"),
        "utf8"
      )
    ).toBe(original);
    const reset = await repairConversationStorage(path, true);
    expect(reset).toMatchObject({ status: "reset", sessions: 0, messages: 0 });
    expect(
      await readFile(
        join(
          reset.backupPath!,
          "original-renderer-state",
          "conversations.sqlite"
        ),
        "utf8"
      )
    ).toBe(original);
    expect(
      await readFile(
        join(
          reset.backupPath!,
          "original-renderer-state",
          "conversation-persistence.json"
        ),
        "utf8"
      )
    ).toBe(fixture.original);
    const database = new ConversationDatabase(fixture.path);
    try {
      await migrateLegacyFile(database.database, fixture.source);
      expect(database.list({ key: legacyFixtureKey }).sessions).toEqual([]);
      database.commit({
        key: legacyFixtureKey,
        sessionId: "new-session",
        expectedRevision: 0,
        generation: 0,
        sequence: 1,
        batchId: "new-write",
        operations: [
          {
            type: "putMessage",
            messageId: "new",
            position: 0,
            value: { role: "user", content: "恢复后新消息" }
          }
        ]
      });
      expect(
        database.session({ key: legacyFixtureKey, sessionId: "new-session" })
          ?.messageCount
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("leaves model settings, manuscripts and the external location pointer unchanged during explicit reset", async () => {
    const path = await profile();
    const fixture = await seedLegacyProfile(path);
    await mkdir(join(path, "config"));
    const modelPath = join(path, "config", "models.json");
    const bookPath = join(path, "manuscript.md");
    const pointerPath = join(path, "..", ".profile.storage-location.json");
    await writeFile(modelPath, '{"fixtureKey":"INVALID_TEST_CREDENTIAL"}');
    await writeFile(bookPath, "保留作品正文");
    await writeFile(
      pointerPath,
      JSON.stringify({ version: 1, currentPath: path })
    );
    const database = new ConversationDatabase(fixture.path);
    await migrateLegacyFile(database.database, fixture.source);
    database.close();
    const before = await Promise.all(
      [modelPath, bookPath, pointerPath].map((file) => readFile(file, "utf8"))
    );
    const result = await repairConversationStorage(path, true);
    expect(result.status).toBe("reset");
    expect(
      await Promise.all(
        [modelPath, bookPath, pointerPath].map((file) => readFile(file, "utf8"))
      )
    ).toEqual(before);
  });

  it("rejects a wrong profile path without creating a replacement history folder", async () => {
    const path = await profile();
    const result = await repairConversationStorage(path);
    expect(result).toMatchObject({
      status: "failed",
      code: "location_unavailable"
    });
    expect(result.backupPath).toBeUndefined();
    await expect(
      readFile(join(path, "renderer-state", "conversations.sqlite"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
