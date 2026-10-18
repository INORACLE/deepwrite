import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { IpcCommandContext } from "./command-types";
import { handleSessionCommands } from "./session-commands";

describe("session user-input commands", () => {
  it("forwards an answer to the authoritative Agent even when Main's run mirror lags", async () => {
    const payload = {
      sessionId: "session_waiting",
      runId: "run_waiting",
      requestId: "request_scope",
      answers: [{ id: "scope", selectedOptionIds: ["all_with_overview"] }]
    };
    const command = CommandEnvelopeSchema.parse(
      createEnvelope("session.user_input_response", payload, {
        id: "command_user_input",
        context: {
          correlationId: "command_user_input",
          sessionId: payload.sessionId,
          runId: payload.runId
        }
      })
    );
    const requestCommand = vi.fn(async () => ({
      status: "accepted" as const,
      requestId: command.id,
      payload: {
        sessionId: payload.sessionId,
        runId: payload.runId,
        requestId: payload.requestId,
        resolvedAt: "2026-08-22T04:08:00.000Z"
      }
    }));
    const ctx = {
      activeRuns: new Map(),
      supervisor: { requestCommand }
    } as unknown as IpcCommandContext;

    await expect(handleSessionCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted",
      payload: {
        sessionId: payload.sessionId,
        runId: payload.runId,
        requestId: payload.requestId
      }
    });
    expect(requestCommand).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        type: "agent.user_input_response",
        payload
      }),
      10_000
    );
  });
});

const searchSettings = {
  providerId: "deepseek" as const,
  baseUrl: "https://search.example.test",
  apiKey: "invalid-test-search-key",
  maxResults: 8,
  perRunCallLimit: 20
};

function promptFixture(resolveWebSearch?: () => Promise<unknown>) {
  const requestCommand = vi.fn(
    async (
      _worker: string,
      command: CommandEnvelope
    ): Promise<CommandResult> => ({
      status: "accepted",
      requestId: command.id,
      payload: {
        sessionId: "session_workspace_search",
        runId: "run_workspace_search",
        runtime: {
          mode: "provider",
          provider: "openai",
          model: "writer-model"
        },
        acceptedAt: "2026-10-17T00:00:00.000Z"
      }
    })
  );
  const ctx = {
    activeRuns: new Map(),
    terminalRuns: new Set(),
    pendingUsageContexts: new Map(),
    supervisor: { requestCommand },
    requireModelConfigStore: () => ({
      resolve: vi.fn(async () => ({
        id: "writer",
        label: "Writer",
        provider: "openai",
        modelId: "writer-model",
        api: "openai-completions",
        baseUrl: "https://api.example.test/v1",
        reasoning: false,
        defaultThinkingLevel: "off",
        thinkingLevelOptions: ["low", "high"],
        temperatureOptions: [0.1, 0.7, 1],
        apiKey: "invalid-test-model-key"
      }))
    }),
    requireAgentTeamConfigStore: () => ({}),
    requireLibraryAgentConfigStore: () => ({}),
    requireGeneralSettingsStore: () => ({
      list: async () => ({
        settings: { contextCompaction: { enabled: false, budgetTokens: 16000 } }
      })
    }),
    ...(resolveWebSearch ? { resolveWebSearch } : {})
  } as unknown as IpcCommandContext;
  const prompt = (payload: Record<string, unknown> = {}) =>
    CommandEnvelopeSchema.parse(
      createEnvelope(
        "session.prompt",
        {
          sessionId: "session_workspace_search",
          message: "查一下近期同类题材",
          modelId: "writer",
          ...payload
        },
        {
          id: "command_workspace_search",
          context: { sessionId: "session_workspace_search" }
        }
      )
    );
  const internalPayload = () =>
    (requestCommand.mock.calls[0]![1] as { payload: Record<string, unknown> })
      .payload;
  return { ctx, prompt, internalPayload };
}

describe("session prompt web search", () => {
  it("hands the settings Main resolved to the Agent, for any model", async () => {
    const { ctx, prompt, internalPayload } = promptFixture(
      async () => searchSettings
    );
    await expect(handleSessionCommands(ctx, prompt())).resolves.toMatchObject({
      status: "accepted"
    });
    expect(internalPayload().webSearch).toEqual(searchSettings);
    expect(internalPayload()).not.toHaveProperty("webSearchEnabled");
  });

  it("sends no search settings while search is off, unconfigured or unavailable", async () => {
    for (const resolve of [async () => undefined, undefined]) {
      const { ctx, prompt, internalPayload } = promptFixture(resolve);
      await handleSessionCommands(ctx, prompt());
      expect(internalPayload()).not.toHaveProperty("webSearch");
    }
  });

  it("never lets the Renderer choose the settings or a key", async () => {
    const { ctx, prompt, internalPayload } = promptFixture(
      async () => searchSettings
    );
    const forged = {
      ...searchSettings,
      apiKey: "invalid-forged-key",
      baseUrl: "https://evil.example.test"
    };
    await handleSessionCommands(
      ctx,
      prompt({ webSearch: forged, webSearchEnabled: true })
    );
    expect(internalPayload().webSearch).toEqual(searchSettings);
    expect(JSON.stringify(internalPayload())).not.toContain(
      "invalid-forged-key"
    );
  });
});
