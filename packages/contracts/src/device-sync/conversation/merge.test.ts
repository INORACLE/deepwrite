import { describe, expect, it } from "vitest";
import { stableSyncJson } from "../value";
import {
  deriveConversationSession,
  mergeConversationSessions,
  orderConversationEntries,
  planConversationSession,
  type ConversationNativeSession
} from "./merge";
import {
  conversationSyncSessionSchema,
  type ConversationSyncEntry,
  type ConversationSyncSession
} from "./schemas";

const hash = (seed: string) => seed.repeat(64).slice(0, 64);
function entry(
  id: string,
  parent: string | null,
  createdAt: string,
  options: { record?: string; at?: string } = {}
): ConversationSyncEntry {
  return {
    id,
    parent,
    createdAt,
    record: { hash: hash(options.record ?? "a"), pack: hash("f") },
    bytes: 10,
    at: options.at ?? createdAt
  };
}
function session(
  messages: ConversationSyncEntry[],
  extra: Partial<ConversationSyncSession> = {}
): ConversationSyncSession {
  return conversationSyncSessionSchema.parse({
    schemaVersion: 1,
    kind: "deepwrite.conversation-session",
    id: "session_1",
    createdAt: "2026-10-01T00:00:00.000Z",
    state: { deleted: false, at: "2026-10-01T00:00:00.000Z" },
    messages,
    removed: [],
    ...extra
  });
}
const ids = (value: ConversationSyncSession) =>
  value.messages.map((item) => item.id);

describe("conversation merge", () => {
  it("keeps the written order even when a device clock runs behind", () => {
    const pc = session([
      entry("m1", null, "2026-10-01T10:00:00.000Z"),
      entry("m2", "m1", "2026-10-01T10:01:00.000Z")
    ]);
    // The phone continued later, but its clock is an hour behind.
    const phone = session([
      ...pc.messages,
      entry("m3", "m2", "2026-10-01T09:30:00.000Z"),
      entry("m4", "m3", "2026-10-01T09:31:00.000Z")
    ]);
    expect(ids(mergeConversationSessions([pc, phone]))).toEqual([
      "m1",
      "m2",
      "m3",
      "m4"
    ]);
  });

  it("keeps both continuations of one conversation, earliest first", () => {
    const base = [entry("m1", null, "2026-10-01T10:00:00.000Z")];
    const pc = session([
      ...base,
      entry("p1", "m1", "2026-10-01T11:00:00.000Z"),
      entry("p2", "p1", "2026-10-01T11:01:00.000Z")
    ]);
    const phone = session([
      ...base,
      entry("q1", "m1", "2026-10-01T10:30:00.000Z")
    ]);
    const merged = mergeConversationSessions([pc, phone]);
    expect(ids(merged)).toEqual(["m1", "q1", "p1", "p2"]);
    expect(stableSyncJson(mergeConversationSessions([phone, pc]))).toBe(
      stableSyncJson(merged)
    );
  });

  it("applies removals over any copy and prefers the newest record", () => {
    const a = session([
      entry("m1", null, "2026-10-01T10:00:00.000Z"),
      entry("m2", "m1", "2026-10-01T10:01:00.000Z", {
        record: "b",
        at: "2026-10-02T00:00:00.000Z"
      })
    ]);
    const b = session([entry("m1", null, "2026-10-01T10:00:00.000Z")], {
      removed: [{ id: "m2", at: "2026-10-01T12:00:00.000Z" }]
    });
    const c = session([
      entry("m1", null, "2026-10-01T10:00:00.000Z", {
        record: "c",
        at: "2026-10-03T00:00:00.000Z"
      })
    ]);
    const merged = mergeConversationSessions([a, b, c]);
    expect(ids(merged)).toEqual(["m1"]);
    expect(merged.messages[0]?.record.hash).toBe(hash("c"));
    expect(merged.removed).toEqual([
      { id: "m2", at: "2026-10-01T12:00:00.000Z" }
    ]);
  });

  it("lets the latest deletion or restoration win, and a deletion win a tie", () => {
    const at = "2026-10-05T00:00:00.000Z";
    const kept = session([], { state: { deleted: false, at } });
    const deleted = session([], { state: { deleted: true, at } });
    expect(mergeConversationSessions([kept, deleted]).state.deleted).toBe(true);
    const restored = session([], {
      state: { deleted: false, at: "2026-10-06T00:00:00.000Z" }
    });
    expect(mergeConversationSessions([deleted, restored]).state.deleted).toBe(
      false
    );
  });

  it("orders a message whose parent is gone as a new start", () => {
    const order = orderConversationEntries([
      entry("orphan", "missing", "2026-10-01T09:00:00.000Z"),
      entry("m1", null, "2026-10-01T10:00:00.000Z"),
      entry("m2", "m1", "2026-10-01T10:01:00.000Z")
    ]).map((item) => item.id);
    expect(order).toEqual(["orphan", "m1", "m2"]);
  });
});

function native(
  messages: string[],
  extra: Partial<ConversationNativeSession> = {}
): ConversationNativeSession {
  return {
    id: "session_1",
    createdAt: "2026-10-01T00:00:00.000Z",
    deleted: false,
    messages: messages.map((id, index) => ({
      id,
      createdAt: `2026-10-01T10:0${index}:00.000Z`,
      ref: { hash: hash("a"), pack: hash("f") },
      bytes: 10,
      foreign: false
    })),
    pending: [],
    ...extra
  };
}
const now = "2026-10-12T00:00:00.000Z";

describe("deriving this device's conversation", () => {
  it("records new local messages with the message they followed", () => {
    const derived = deriveConversationSession({
      prev: null,
      confirmed: null,
      native: native(["m1", "m2"]),
      now
    });
    expect(derived?.messages.map((item) => [item.id, item.parent])).toEqual([
      ["m1", null],
      ["m2", "m1"]
    ]);
    expect(derived?.state).toEqual({
      deleted: false,
      at: "2026-10-01T00:00:00.000Z"
    });
  });

  it("infers a removal only for messages this device held", () => {
    const prev = session([
      entry("m1", null, "2026-10-01T10:00:00.000Z"),
      entry("m2", "m1", "2026-10-01T10:01:00.000Z"),
      entry("r1", "m2", "2026-10-01T10:02:00.000Z")
    ]);
    // r1 arrived from another device but could not be written here yet.
    const derived = deriveConversationSession({
      prev,
      confirmed: { native: "live", ids: ["m1", "m2"] },
      native: native(["m1"]),
      now
    });
    expect(derived?.removed).toEqual([{ id: "m2", at: now }]);
    expect(ids(derived!)).toEqual(["m1", "r1"]);
  });

  it("does not let a stale copy of another device's message replace it", () => {
    const prev = session([
      entry("m1", null, "2026-10-01T10:00:00.000Z", { record: "b" })
    ]);
    const local = native(["m1"]);
    local.messages[0]!.foreign = true;
    const derived = deriveConversationSession({
      prev,
      confirmed: { native: "live", ids: ["m1"] },
      native: local,
      now
    });
    expect(derived?.messages[0]?.record.hash).toBe(hash("b"));
  });

  it("marks a session deleted only when this device held and then lost it", () => {
    const prev = session([entry("m1", null, "2026-10-01T10:00:00.000Z")]);
    expect(
      deriveConversationSession({
        prev,
        confirmed: { native: "live", ids: ["m1"] },
        native: null,
        now
      })?.state
    ).toEqual({ deleted: true, at: now });
    expect(
      deriveConversationSession({
        prev,
        confirmed: { native: "absent", ids: [] },
        native: null,
        now
      })
    ).toBe(prev);
  });

  it("keeps a merged deletion that could not be applied yet", () => {
    const prev = session([entry("m1", null, "2026-10-01T10:00:00.000Z")], {
      state: { deleted: true, at: "2026-10-10T00:00:00.000Z" }
    });
    const derived = deriveConversationSession({
      prev,
      confirmed: { native: "live", ids: ["m1"] },
      native: native(["m1"]),
      now
    });
    expect(derived?.state).toEqual(prev.state);
  });

  it("records a local archive and restore", () => {
    const prev = session([entry("m1", null, "2026-10-01T10:00:00.000Z")]);
    const archived = deriveConversationSession({
      prev,
      confirmed: { native: "live", ids: ["m1"] },
      native: native(["m1"], { deleted: true }),
      now
    });
    expect(archived?.state).toEqual({ deleted: true, at: now });
    expect(archived?.removed).toEqual([]);
  });
});

describe("planning local changes", () => {
  const merged = session(
    [
      entry("m1", null, "2026-10-01T10:00:00.000Z"),
      entry("m2", "m1", "2026-10-01T10:01:00.000Z", { record: "b" })
    ],
    { removed: [{ id: "old", at: now }] }
  );

  it("creates a missing session with all of its messages", () => {
    const plan = planConversationSession(merged, null);
    expect(plan).toMatchObject({ create: true, order: ["m1", "m2"] });
    expect(plan.put.map((item) => item.id)).toEqual(["m1", "m2"]);
  });

  it("writes changed messages, removes removed ones and keeps the rest", () => {
    const plan = planConversationSession(merged, {
      deleted: false,
      messages: [
        { id: "m1", hash: hash("a") },
        { id: "old", hash: hash("a") },
        { id: "m2", hash: hash("a") }
      ],
      pending: []
    });
    expect(plan.unchanged).toBe(false);
    expect(plan.remove).toEqual(["old"]);
    expect(plan.put.map((item) => item.id)).toEqual(["m2"]);
    expect(plan.order).toEqual(["m1", "m2"]);
  });

  it("reports nothing to do when the device already holds the session", () => {
    const plan = planConversationSession(merged, {
      deleted: false,
      messages: [
        { id: "m1", hash: hash("a") },
        { id: "m2", hash: hash("b") }
      ],
      pending: []
    });
    expect(plan.unchanged).toBe(true);
  });

  it("archives a deleted session and restores a revived one", () => {
    const deleted = { ...merged, state: { deleted: true, at: now } };
    expect(
      planConversationSession(deleted, {
        deleted: false,
        messages: [],
        pending: []
      }).archive
    ).toBe(true);
    expect(planConversationSession(deleted, null).unchanged).toBe(true);
    expect(
      planConversationSession(merged, {
        deleted: true,
        messages: [
          { id: "m1", hash: hash("a") },
          { id: "m2", hash: hash("b") }
        ],
        pending: []
      })
    ).toMatchObject({ restore: true, unchanged: false });
  });
});
