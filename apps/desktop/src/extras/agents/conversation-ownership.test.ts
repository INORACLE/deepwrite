import { expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandResult,
  type CommandEnvelope
} from "@deepwrite/contracts";
import {
  acquireConversationOperation,
  releaseConversationRun
} from "../../main/ipc/conversation-operation-guard";
import type { ActiveRun } from "../../main/ipc/command-types";
import { runExtrasAgent, type ExtrasAgentRunDependencies } from "./run-service";
import type { ExtrasAgentConfigStore } from "./config-store";

function fixture() {
  const activeRuns = new Map<string, ActiveRun>();
  const resolve = vi.fn(async () => undefined);
  const requestAgent = vi.fn(
    async (command: CommandEnvelope): Promise<CommandResult> => ({
      status: "accepted",
      requestId: command.id,
      payload: {
        sessionId: "session",
        runId: "run",
        acceptedAt: new Date().toISOString(),
        runtime: { mode: "local-faux", provider: "example", model: "fixture" }
      }
    })
  );
  const deps: ExtrasAgentRunDependencies = {
    activeRuns,
    terminalRuns: new Set(),
    pendingUsageContexts: new Map(),
    acquireConversation: (sessionId, ownerId) =>
      acquireConversationOperation(activeRuns, sessionId, "prompt", ownerId),
    resolveModel: resolve,
    requestAgent,
    configStore: () =>
      ({
        resolve: async () => ({
          id: "role",
          name: "角色",
          systemPrompt: "与用户对话。"
        })
      }) as unknown as ExtrasAgentConfigStore,
    resolveContextCompaction: async () => ({
      contextCompactionSettings: { enabled: false, budgetTokens: 16000 }
    }),
    chatSources: {
      core: async () => {
        throw new Error("Roleplay should not query Core");
      },
      listModels: async () => ({}),
      queryUsage: async () => ({}),
      appVersion: () => "1.0.0"
    }
  };
  function command(id: string) {
    const parsed = CommandEnvelopeSchema.parse(
      createEnvelope(
        "extrasAgent.run",
        {
          sessionId: "session",
          task: { agentId: "chat-roleplay", profileId: "role", input: {} },
          conversation: { message: "Continue" }
        },
        { id, context: { sessionId: "session", correlationId: id } }
      )
    );
    if (parsed.type !== "extrasAgent.run")
      throw new Error("Wrong fixture command");
    return parsed;
  }
  const owner = () => requestAgent.mock.lastCall![0].id;
  return { deps, activeRuns, resolve, requestAgent, command, owner };
}

it("serializes conversation extras prompts with workspace prompts through drainage", async () => {
  const f = fixture();
  let finishResolve!: () => void;
  f.resolve.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishResolve = () => resolve(undefined);
      })
  );
  const first = runExtrasAgent(f.deps, f.command("first"));
  expect(await runExtrasAgent(f.deps, f.command("second"))).toMatchObject({
    status: "rejected",
    error: { code: "agent.session_busy" }
  });
  expect(
    acquireConversationOperation(f.activeRuns, "session", "prompt", "workspace")
  ).toBeUndefined();
  finishResolve();
  expect(await first).toMatchObject({ status: "accepted" });
  f.activeRuns.clear();
  expect(await runExtrasAgent(f.deps, f.command("third"))).toMatchObject({
    status: "rejected",
    error: { code: "agent.session_busy" }
  });
  releaseConversationRun(f.activeRuns, "session", f.owner());
  expect(await runExtrasAgent(f.deps, f.command("after-drain"))).toMatchObject({
    status: "accepted"
  });
  releaseConversationRun(f.activeRuns, "session", f.owner());
});

it("rechecks the saved chat budget before dispatch and releases a rejected prompt", async () => {
  const f = fixture();
  let budgetTokens = 64_000;
  f.deps.resolveContextCompaction = async () => ({
    contextCompactionSettings: { enabled: true, budgetTokens }
  });
  const command = f.command("budget");
  command.payload.conversation!.message = "字".repeat(60_000);
  expect(await runExtrasAgent(f.deps, command)).toMatchObject({
    status: "rejected",
    error: { code: "session.prompt_budget_exceeded" }
  });
  expect(f.requestAgent).not.toHaveBeenCalled();
  budgetTokens = 128_000;
  expect(await runExtrasAgent(f.deps, command)).toMatchObject({
    status: "accepted"
  });
  expect(f.requestAgent).toHaveBeenCalledOnce();
  expect(f.requestAgent.mock.lastCall?.[0]).toMatchObject({
    payload: {
      conversation: { message: command.payload.conversation!.message },
      contextCompactionSettings: { budgetTokens: 128_000 }
    }
  });
  releaseConversationRun(f.activeRuns, "session", f.owner());
});

it("releases a preparation rejection and retains uncertain Agent acceptance", async () => {
  const f = fixture();
  f.resolve.mockRejectedValueOnce(new Error("Fixture preparation failed"));
  expect(await runExtrasAgent(f.deps, f.command("failed"))).toMatchObject({
    status: "rejected"
  });
  f.requestAgent.mockRejectedValueOnce(new Error("Fixture timeout"));
  expect(await runExtrasAgent(f.deps, f.command("unknown"))).toMatchObject({
    status: "rejected"
  });
  expect(await runExtrasAgent(f.deps, f.command("blocked"))).toMatchObject({
    status: "rejected",
    error: { code: "agent.session_busy" }
  });
  releaseConversationRun(f.activeRuns, "session", f.owner());
  expect(await runExtrasAgent(f.deps, f.command("retry"))).toMatchObject({
    status: "accepted"
  });
  releaseConversationRun(f.activeRuns, "session", f.owner());
});

it("uses fresh ownership for reused Renderer ids and preserves rejection request ids", async () => {
  const f = fixture();
  expect(await runExtrasAgent(f.deps, f.command("reused"))).toMatchObject({
    status: "accepted",
    requestId: "reused"
  });
  const oldOwner = f.owner();
  f.activeRuns.clear();
  releaseConversationRun(f.activeRuns, "session", oldOwner);
  let resolveModel!: () => void;
  f.resolve.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveModel = () => resolve(undefined);
      })
  );
  f.requestAgent.mockImplementationOnce(async (internal) => ({
    status: "rejected",
    requestId: internal.id,
    error: { code: "fixture.rejected", message: "Rejected" }
  }));
  const second = runExtrasAgent(f.deps, f.command("reused"));
  expect(releaseConversationRun(f.activeRuns, "session", oldOwner)).toBe(false);
  expect(await runExtrasAgent(f.deps, f.command("reused"))).toMatchObject({
    status: "rejected",
    error: { code: "agent.session_busy" }
  });
  resolveModel();
  expect(await second).toMatchObject({
    status: "rejected",
    requestId: "reused",
    error: { code: "fixture.rejected" }
  });
  expect(f.owner()).not.toBe(oldOwner);
  expect(f.owner()).not.toBe("reused");
});
