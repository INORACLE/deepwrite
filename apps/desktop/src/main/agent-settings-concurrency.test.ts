import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  LibraryAgentSettingsInputSchema,
  LongAgentSettingsInputSchema,
  ScriptWorkspaceAgentSettingsInputSchema,
  ShortWorkspaceAgentSettingsInputSchema,
  createEnvelope,
  CommandEnvelopeSchema
} from "@deepwrite/contracts";
import { ExtrasAgentConfigStore } from "../extras/agents/config-store";
import { LibraryAgentConfigStore } from "./library-agent-config-store";
import { LongAgentConfigStore } from "./long-agent-config-store";
import { WorkspaceAgentConfigStore } from "./workspace-agent-config-store";
import {
  withLibraryAgentBaseline,
  withLongAgentBaseline,
  withWorkspaceAgentBaseline
} from "../renderer/src/utils/agentSettingsBaseline";

const roots: string[] = [];
async function root() {
  const path = await mkdtemp(join(tmpdir(), "deepwrite-settings-concurrency-"));
  roots.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

it("preserves different extras profiles from stale windows after intervening reads", async () => {
  const path = await root();
  const store = new ExtrasAgentConfigStore(path);
  const original = (await store.list("long-book-analysis")).profiles.map(
    ({ builtin: _builtin, ...profile }) => profile
  );
  const first = structuredClone(original);
  const second = structuredClone(original);
  first[0]!.description = "window A";
  second[1]!.description = "window B";
  await store.save({
    agentId: "long-book-analysis",
    profiles: first,
    baseProfiles: original
  });
  await store.list("long-book-analysis");
  await store.resolve("long-book-analysis", original[0]!.id);
  await store.save({
    agentId: "long-book-analysis",
    profiles: second,
    baseProfiles: original
  });
  const restarted = await new ExtrasAgentConfigStore(path).list(
    "long-book-analysis"
  );
  expect(restarted.profiles[0]!.description).toBe("window A");
  expect(restarted.profiles[1]!.description).toBe("window B");
  expect(
    await readFile(
      join(path, "config/extras-agents/long-book-analysis.json"),
      "utf8"
    )
  ).not.toContain("baseProfiles");
});

it("carries each library form baseline through the validated command into persistence", async () => {
  const path = await root();
  const store = new LibraryAgentConfigStore(path);
  const original = await store.list();
  const first = LibraryAgentSettingsInputSchema.parse(original);
  const second = LibraryAgentSettingsInputSchema.parse(original);
  first.agents[0]!.systemPrompt = "window A";
  second.agents[1]!.systemPrompt = "window B";
  const command = CommandEnvelopeSchema.parse(
    createEnvelope(
      "libraryAgents.save",
      withLibraryAgentBaseline(first, original),
      { id: "library-a" }
    )
  );
  if (command.type !== "libraryAgents.save")
    throw new Error("Unexpected command");
  await store.save(command.payload);
  await store.list();
  await store.save(
    LibraryAgentSettingsInputSchema.parse(
      withLibraryAgentBaseline(second, original)
    )
  );
  const saved = await new LibraryAgentConfigStore(path).list();
  expect(saved.agents[0]!.systemPrompt).toBe("window A");
  expect(saved.agents[1]!.systemPrompt).toBe("window B");
  expect(
    await readFile(join(path, "config/library-agents.json"), "utf8")
  ).not.toContain("baseAgents");
});

it.each([false, true])(
  "keeps short plot-stage and agent edits with queued=%s",
  async (queued) => {
    const store = new WorkspaceAgentConfigStore(await root());
    const original = await store.list("short");
    const first = ShortWorkspaceAgentSettingsInputSchema.parse(original);
    const second = ShortWorkspaceAgentSettingsInputSchema.parse(original);
    first.defaultPlotStageIds = original.defaultPlotStageIds.slice(0, 1);
    second.agents[0]!.systemPrompt = "window B";
    const firstInput = ShortWorkspaceAgentSettingsInputSchema.parse(
      withWorkspaceAgentBaseline(first, original)
    );
    const secondInput = ShortWorkspaceAgentSettingsInputSchema.parse(
      withWorkspaceAgentBaseline(second, original)
    );
    const saving = store.save(firstInput);
    if (!queued) await saving;
    await Promise.all([saving, store.save(secondInput)]);
    const saved = await store.list("short");
    expect(saved.defaultPlotStageIds).toEqual(first.defaultPlotStageIds);
    expect(saved.agents[0]!.systemPrompt).toBe("window B");
  }
);

it("an unchanged long form preserves the latest saved profile", async () => {
  const store = new LongAgentConfigStore(await root());
  const original = await store.list();
  const input = {
    workspaceType: "long" as const,
    agents: original.agents.map(
      ({ id, systemPrompt, welcomeShortcuts, readAccess }) => ({
        id,
        systemPrompt,
        welcomeShortcuts,
        readAccess
      })
    )
  };
  const first = LongAgentSettingsInputSchema.parse(
    withLongAgentBaseline(input, original)
  );
  first.agents[0]!.systemPrompt = "window A";
  await store.save(first);
  await store.list();
  await store.save(
    LongAgentSettingsInputSchema.parse(withLongAgentBaseline(input, original))
  );
  expect((await store.list()).agents[0]!.systemPrompt).toBe("window A");
});

it("an unchanged script form preserves the latest saved profile", async () => {
  const store = new WorkspaceAgentConfigStore(await root());
  const original = await store.list("script");
  const input = ScriptWorkspaceAgentSettingsInputSchema.parse(original);
  const first = ScriptWorkspaceAgentSettingsInputSchema.parse(
    withWorkspaceAgentBaseline(input, original)
  );
  first.agents[0]!.systemPrompt = "window A";
  await store.save(first);
  await store.list("script");
  await store.save(
    ScriptWorkspaceAgentSettingsInputSchema.parse(
      withWorkspaceAgentBaseline(input, original)
    )
  );
  expect((await store.list("script")).agents[0]!.systemPrompt).toBe("window A");
});

it("keeps concurrent extras additions and deletions when a stale form saves", async () => {
  const store = new ExtrasAgentConfigStore(await root());
  const defaults = (await store.list("long-book-analysis")).profiles.map(
    ({ builtin: _builtin, ...profile }) => profile
  );
  const removed = { ...defaults[0]!, id: "custom_old", name: "old custom" };
  await store.save({
    agentId: "long-book-analysis",
    profiles: [...defaults, removed]
  });
  const baseProfiles = (await store.list("long-book-analysis")).profiles.map(
    ({ builtin: _builtin, ...profile }) => profile
  );
  const added = { ...defaults[0]!, id: "custom_new", name: "new custom" };
  await store.save({
    agentId: "long-book-analysis",
    baseProfiles,
    profiles: [...defaults, added]
  });
  const stale = structuredClone(baseProfiles);
  stale[1]!.description = "window B";
  const saved = await store.save({
    agentId: "long-book-analysis",
    baseProfiles,
    profiles: stale
  });
  if (saved.agentId !== "long-book-analysis")
    throw new Error("Unexpected extras agent");
  expect(saved.profiles.some(({ id }) => id === removed.id)).toBe(false);
  expect(saved.profiles.some(({ id }) => id === added.id)).toBe(true);
  expect(saved.profiles[1]!.description).toBe("window B");
});

it("rejects an invalid baseline without replacing persisted settings", async () => {
  const store = new LibraryAgentConfigStore(await root());
  const original = await store.list();
  const input = LibraryAgentSettingsInputSchema.parse(original);
  await expect(
    store.save({ ...input, baseAgents: [input.agents[0]!, input.agents[0]!] })
  ).rejects.toThrow();
  expect(await store.list()).toEqual(original);
});
