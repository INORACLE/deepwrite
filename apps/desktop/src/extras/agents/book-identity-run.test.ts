import { describe, expect, it, vi } from "vitest";
import {
  BookSchema,
  BookTitleDesignProfileSchema,
  BookSynopsisDesignProfileSchema,
  BookCoverDesignProfileSchema,
  CommandEnvelopeSchema,
  createCatalogDraftDirectory,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type ExtrasAgentTask
} from "@deepwrite/contracts";
import type { ExtrasAgentConfigStore } from "./config-store";
import { runExtrasAgent, type ExtrasAgentRunDependencies } from "./run-service";

const now = "2026-10-02T00:00:00.000Z";
function fixture() {
  const book = BookSchema.parse({
    id: "book_test",
    title: "测试作品",
    bookType: "short",
    genre: "悬疑",
    status: "editing",
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
    documents: [],
    draft: createCatalogDraftDirectory(now),
    createdAt: now,
    updatedAt: now
  });
  const resolve = vi.fn(async (agentId: string) =>
    (agentId === "book-title-design"
      ? BookTitleDesignProfileSchema
      : agentId === "book-cover-design"
        ? BookCoverDesignProfileSchema
        : BookSynopsisDesignProfileSchema
    ).parse({
      id: "default",
      name: "通用",
      description: "设计方法",
      systemPrompt: "先读取作品事实。"
    })
  );
  const requestAgent = vi.fn<
    (command: CommandEnvelope) => Promise<CommandResult>
  >(async (command) => {
    if (command.type !== "agent.extras_run") throw new Error("wrong command");
    return {
      status: "accepted",
      requestId: command.id,
      payload: {
        sessionId: command.payload.sessionId,
        runId: `run_${command.id}`,
        acceptedAt: now,
        runtime: { provider: "faux", model: "faux", mode: "local-faux" }
      }
    };
  });
  const core = vi.fn<(command: CommandEnvelope) => Promise<CommandResult>>(
    async (command) => {
      if (command.type === "catalog.snapshot")
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            schemaVersion: 1,
            revision: 1,
            books: [book],
            materials: [],
            materialGroups: [],
            skills: [],
            skillGroups: [],
            updatedAt: now
          }
        };
      if (command.type === "bookIdentity.readContext")
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            adopted: {},
            recentTitles: [],
            recentSynopsisHooks: [],
            recentCoverConcepts: [],
            seedCandidates: []
          }
        };
      throw new Error("wrong query");
    }
  );
  const deps: ExtrasAgentRunDependencies = {
    evaluationMode: true,
    configStore: () => ({ resolve }) as unknown as ExtrasAgentConfigStore,
    chatSources: {
      core,
      listModels: vi.fn(),
      queryUsage: vi.fn(),
      appVersion: () => "test"
    },
    resolveModel: vi.fn(async () => undefined),
    resolveContextCompaction: vi.fn(async () => ({
      contextCompactionSettings: { enabled: false, budgetTokens: 16000 }
    })),
    requestAgent,
    acquireConversation: () => () => undefined,
    activeRuns: new Map(),
    terminalRuns: new Set(),
    pendingUsageContexts: new Map()
  };
  const command = (field: "title" | "synopsis" | "cover", id: string) => {
    const taskInput = {
      jobId: `job_${id}`,
      book: { projectType: "short" as const, projectId: book.id },
      candidateCount: 2
    };
    const task: ExtrasAgentTask =
      field === "cover"
        ? {
            agentId: "book-cover-design",
            profileId: "default",
            input: {
              ...taskInput,
              imagesPerCandidate: 1,
              aspectRatio: "3:4",
              titleRendering: "model"
            }
          }
        : {
            agentId:
              field === "title" ? "book-title-design" : "book-synopsis-design",
            profileId: "default",
            input: taskInput
          };
    const parsed = CommandEnvelopeSchema.parse(
      createEnvelope(
        "extrasAgent.run",
        { sessionId: `session_${id}`, task },
        { id, context: { correlationId: id, sessionId: `session_${id}` } }
      )
    );
    if (parsed.type !== "extrasAgent.run") throw new Error("wrong command");
    return parsed;
  };
  return { deps, core, resolve, requestAgent, command };
}
describe("book identity run registration", () => {
  it("keeps an explicit model-lettering choice even when CJK capability is unknown", async () => {
    const f = fixture();
    f.deps.imageCapability = async () => ({
      aspectRatios: ["3:4"],
      promptLanguage: "en",
      rendersCjkText: false,
      maxPromptCharacters: 1500
    });
    expect(
      await runExtrasAgent(f.deps, f.command("cover", "cmd_cover"))
    ).toMatchObject({ status: "accepted" });
    expect(f.requestAgent.mock.calls[0]![0]).toMatchObject({
      payload: {
        task: {
          agentId: "book-cover-design",
          input: {
            titleRendering: "model",
            bookSnapshot: { title: "测试作品" },
            imageCapability: {
              rendersCjkText: false,
              maxPromptCharacters: 1500
            }
          }
        }
      }
    });
    expect(f.deps.activeRuns.get("run_cmd_cover")?.bookIdentity).toMatchObject({
      request: { titleRendering: "model" }
    });
  });
  it("uses Main's book snapshot, excludes unrelated chat usage, and permits different fields", async () => {
    const f = fixture();
    expect(
      await runExtrasAgent(f.deps, f.command("title", "cmd_title"))
    ).toMatchObject({ status: "accepted" });
    expect(
      await runExtrasAgent(f.deps, f.command("synopsis", "cmd_synopsis"))
    ).toMatchObject({ status: "accepted" });
    expect(f.deps.activeRuns.size).toBe(2);
    const title = f.deps.activeRuns.get("run_cmd_title")?.bookIdentity;
    expect(title).toMatchObject({
      book: { projectType: "short", projectId: "book_test" },
      field: "title",
      candidateCount: 2,
      profile: { id: "default", name: "通用" }
    });
    expect(title?.roundId).toMatch(/^round_/);
    expect(f.deps.chatSources.listModels).not.toHaveBeenCalled();
    expect(f.deps.chatSources.queryUsage).not.toHaveBeenCalled();
    expect(f.requestAgent).toHaveBeenCalledTimes(2);
  });
  it("rejects the same book and field both during admission and after acceptance", async () => {
    const f = fixture();
    let finish!: (result: CommandResult) => void;
    f.requestAgent.mockImplementationOnce(
      (command) =>
        new Promise((resolve) => {
          finish = (result) => resolve({ ...result, requestId: command.id });
        })
    );
    const first = runExtrasAgent(f.deps, f.command("title", "cmd_title"));
    while (!f.requestAgent.mock.calls.length) await Promise.resolve();
    expect(
      await runExtrasAgent(f.deps, f.command("title", "cmd_second"))
    ).toMatchObject({
      status: "rejected",
      error: { code: "book_identity.field_busy" }
    });
    finish({
      status: "accepted",
      requestId: "cmd_title",
      payload: {
        sessionId: "session_cmd_title",
        runId: "run_cmd_title",
        acceptedAt: now,
        runtime: { provider: "faux", model: "faux", mode: "local-faux" }
      }
    });
    expect(await first).toMatchObject({ status: "accepted" });
    expect(
      await runExtrasAgent(f.deps, f.command("title", "cmd_third"))
    ).toMatchObject({
      status: "rejected",
      error: { code: "book_identity.field_busy" }
    });
    expect(f.requestAgent).toHaveBeenCalledTimes(1);
  });
  it("requires a selected model in normal operation and releases failed admission", async () => {
    const f = fixture();
    f.deps.evaluationMode = false;
    expect(
      await runExtrasAgent(f.deps, f.command("title", "cmd_failed"))
    ).toMatchObject({
      status: "rejected",
      error: { message: "请选择可用模型。" }
    });
    expect(f.requestAgent).not.toHaveBeenCalled();
    f.deps.evaluationMode = true;
    expect(
      await runExtrasAgent(f.deps, f.command("title", "cmd_retry"))
    ).toMatchObject({ status: "accepted" });
  });
});
