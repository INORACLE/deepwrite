import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { ExtrasAgentConfigStore } from "./config-store";
import { runExtrasAgent, type ExtrasAgentRunDependencies } from "./run-service";

const project = { projectType: "short" as const, projectId: "short_a" };

vi.mock("./task-resolver", () => ({
  resolveExtrasTask: vi.fn(
    async (_store: unknown, _sources: unknown, task: { agentId: string }) => ({
      task:
        task.agentId === "chat-project"
          ? {
              agentId: "chat-project",
              profile: {
                id: "short:short_a",
                name: "短篇",
                project: { projectType: "short", projectId: "short_a" },
                systemPrompt: "只读顾问。"
              },
              input: {
                project: { projectType: "short", projectId: "short_a" },
                runtime: { projectBook: { id: "short_a", bookType: "short" } }
              }
            }
          : task.agentId === "chat-normal"
            ? {
                agentId: "chat-normal",
                profile: {
                  id: "default",
                  name: "普通聊天",
                  description: "测试",
                  systemPrompt: "只读顾问。"
                },
                input: { runtime: {} }
              }
            : {
                agentId: "chat-roleplay",
                profile: {
                  id: "role",
                  name: "角色",
                  systemPrompt: "只读顾问。"
                },
                input: {}
              }
    })
  )
}));

const searchSettings = {
  providerId: "deepseek" as const,
  baseUrl: "https://search.example.test",
  apiKey: "invalid-test-search-key",
  maxResults: 8,
  perRunCallLimit: 20
};

function fixture(
  resolveWebSearch?: () => Promise<typeof searchSettings | undefined>
) {
  const requestAgent = vi.fn(
    async (command: CommandEnvelope): Promise<CommandResult> => ({
      status: "accepted",
      requestId: command.id,
      payload: {
        sessionId: "session",
        runId: "run",
        acceptedAt: "2026-10-17T00:00:00.000Z",
        runtime: { mode: "local-faux", provider: "example", model: "fixture" }
      }
    })
  );
  const resolve = vi.fn(resolveWebSearch ?? (async () => undefined));
  const deps: ExtrasAgentRunDependencies = {
    activeRuns: new Map(),
    terminalRuns: new Set(),
    pendingUsageContexts: new Map(),
    acquireConversation: () => () => undefined,
    resolveModel: async () => undefined,
    ...(resolveWebSearch ? { resolveWebSearch: resolve } : {}),
    requestAgent,
    configStore: () => ({}) as unknown as ExtrasAgentConfigStore,
    resolveContextCompaction: async () => ({
      contextCompactionSettings: { enabled: false, budgetTokens: 16000 }
    }),
    chatSources: {} as ExtrasAgentRunDependencies["chatSources"]
  };
  async function run(
    agentId: "chat-normal" | "chat-project" | "chat-roleplay"
  ) {
    const parsed = CommandEnvelopeSchema.parse(
      createEnvelope(
        "extrasAgent.run",
        {
          sessionId: "session",
          task: {
            agentId,
            profileId: agentId === "chat-project" ? "short:short_a" : "p",
            input: agentId === "chat-project" ? { project } : {}
          },
          conversation: { message: "查一下近期同类题材" }
        },
        {
          id: `cmd-${agentId}`,
          context: { sessionId: "session", correlationId: `c-${agentId}` }
        }
      )
    );
    if (parsed.type !== "extrasAgent.run")
      throw new Error("Wrong fixture command");
    const result = await runExtrasAgent(deps, parsed);
    return {
      result,
      spec: requestAgent.mock.lastCall?.[0]?.payload as Record<string, unknown>
    };
  }
  return { run, resolve };
}

describe("extras runs and web search", () => {
  it.each(["chat-normal", "chat-project"] as const)(
    "attaches the settings to %s",
    async (agentId) => {
      const { run } = fixture(async () => searchSettings);
      const { result, spec } = await run(agentId);
      expect(result).toMatchObject({ status: "accepted" });
      expect(spec.webSearch).toEqual(searchSettings);
    }
  );

  it("never asks for or attaches them for an agent that may not search", async () => {
    const { run, resolve } = fixture(async () => searchSettings);
    const { result, spec } = await run("chat-roleplay");
    expect(result).toMatchObject({ status: "accepted" });
    expect(resolve).not.toHaveBeenCalled();
    expect(spec).not.toHaveProperty("webSearch");
  });

  it("sends nothing while search is off or the capability is missing", async () => {
    for (const resolve of [async () => undefined, undefined]) {
      const { run } = fixture(resolve);
      const { spec } = await run("chat-normal");
      expect(spec).not.toHaveProperty("webSearch");
    }
  });
});
