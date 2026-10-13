import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bookConversationLogicalKey,
  conversationHistoryKeyFor
} from "@deepwrite/contracts";
import { MemoryDav, connect, device, item } from "../engine/sync-test-support";
import { conversationService, message } from "./conversation-test-support";

const BOOK = "book:book_example";
const LOGICAL = bookConversationLogicalKey(BOOK)!;
const KEY = conversationHistoryKeyFor(LOGICAL);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function pair(enable = true) {
  const dav = new MemoryDav();
  let tick = Date.parse("2026-10-12T00:00:00.000Z");
  const now = () => new Date((tick += 1000)).toISOString();
  const clients = await Promise.all(
    [
      ["pc", [item()]],
      ["laptop", []]
    ].map(async ([name, items]) => {
      const base = device(
        name as string,
        dav,
        items as ReturnType<typeof item>[]
      );
      const root = await mkdtemp(
        join(tmpdir(), "deepwrite-conversation-sync-")
      );
      roots.push(root);
      const options = {
        ...base.options,
        runtime: { ...base.options.runtime, now }
      };
      return { base, ...conversationService(options, root) };
    })
  );
  const [pc, laptop] = clients as [(typeof clients)[0], (typeof clients)[0]];
  const space = await connect({ ...pc.base, service: pc.service });
  await pc.service.sync([], true);
  await connect({ ...laptop.base, service: laptop.service }, space);
  await laptop.service.sync([], true);
  if (enable) {
    await pc.service.configureConversations([BOOK]);
    await laptop.service.configureConversations([BOOK]);
  }
  return { dav, pc, laptop };
}
const contents = (client: {
  core: {
    scope(key: string): Map<string, { messages: Record<string, unknown>[] }>;
  };
}) =>
  client.core
    .scope(KEY)
    .get("s1")
    ?.messages.map((value) => value.content);

describe("desktop conversation sync", () => {
  it("publishes nothing until the user chooses works", async () => {
    const { dav, pc } = await pair(false);
    pc.core.write(KEY, "s1", (session) => {
      session.messages.push(message("m1", "你好", "2026-10-01T10:00:00.000Z"));
    });
    await pc.service.sync();
    expect(
      [...dav.files.keys()].some((path) => path.includes("/conversations/"))
    ).toBe(false);
  });

  it("exchanges, continues, removes and deletes conversations between devices", async () => {
    const { dav, pc, laptop } = await pair();
    pc.core.write(KEY, "s1", (session) => {
      session.messages.push(
        message("m1", "写第一章", "2026-10-01T10:00:00.000Z"),
        message("m2", "第一章写好了", "2026-10-01T10:00:05.000Z", "assistant")
      );
    });
    await pc.service.sync();
    await laptop.service.sync();
    expect(contents(laptop)).toEqual(["写第一章", "第一章写好了"]);
    const received = laptop.core.scope(KEY).get("s1")!.messages[0]!;
    expect(received.remote).toMatchObject({ device: "测试设备" });
    expect(laptop.lease.changed.at(-1)).toEqual([LOGICAL]);

    laptop.core.write(KEY, "s1", (session) => {
      session.messages.push(
        message("m3", "再写第二章", "2026-10-02T10:00:00.000Z"),
        message("m4", "第二章写好了", "2026-10-02T10:00:05.000Z", "assistant")
      );
    });
    await laptop.service.sync();
    await pc.service.sync();
    expect(contents(pc)).toEqual([
      "写第一章",
      "第一章写好了",
      "再写第二章",
      "第二章写好了"
    ]);
    expect(pc.core.scope(KEY).get("s1")!.messages[0]!.remote).toBeUndefined();

    // Converged devices transfer nothing more.
    await laptop.service.sync();
    await pc.service.sync();
    const puts = dav.puts.length;
    await laptop.service.sync();
    await pc.service.sync();
    expect(dav.puts.slice(puts)).toEqual([]);

    pc.core.write(KEY, "s1", (session) => {
      session.messages = session.messages.filter((value) => value.id !== "m4");
    });
    await pc.service.sync();
    await laptop.service.sync();
    expect(contents(laptop)).toEqual([
      "写第一章",
      "第一章写好了",
      "再写第二章"
    ]);

    laptop.core.write(KEY, "s1", (session) => {
      session.deleted = true;
    });
    await laptop.service.sync();
    await pc.service.sync();
    expect(pc.core.scope(KEY).get("s1")?.deleted).toBe(true);
  });

  it("leaves a conversation the window cannot release for a later sync", async () => {
    const { pc, laptop } = await pair();
    pc.core.write(KEY, "s1", (session) => {
      session.messages.push(message("m1", "你好", "2026-10-01T10:00:00.000Z"));
    });
    await pc.service.sync();
    laptop.lease.released = false;
    const status = await laptop.service.sync();
    expect(status.conversations?.issues).toEqual([
      { key: BOOK, title: "测试作品", code: "conversationsBusy" }
    ]);
    expect(laptop.core.scope(KEY).get("s1")).toBeUndefined();
    laptop.lease.released = true;
    const retried = await laptop.service.sync();
    expect(retried.conversations?.issues).toEqual([]);
    expect(contents(laptop)).toEqual(["你好"]);
  });

  it("keeps both continuations when two devices continued one conversation", async () => {
    const { pc, laptop } = await pair();
    pc.core.write(KEY, "s1", (session) => {
      session.messages.push(message("m1", "开始", "2026-10-01T10:00:00.000Z"));
    });
    await pc.service.sync();
    await laptop.service.sync();
    pc.core.write(KEY, "s1", (session) => {
      session.messages.push(
        message("p1", "电脑续写", "2026-10-03T10:00:00.000Z")
      );
    });
    laptop.core.write(KEY, "s1", (session) => {
      session.messages.push(
        message("q1", "笔记本续写", "2026-10-02T10:00:00.000Z")
      );
    });
    await pc.service.sync();
    await laptop.service.sync();
    await pc.service.sync();
    expect(contents(pc)).toEqual(["开始", "笔记本续写", "电脑续写"]);
    expect(contents(laptop)).toEqual(["开始", "笔记本续写", "电脑续写"]);
  });
});
