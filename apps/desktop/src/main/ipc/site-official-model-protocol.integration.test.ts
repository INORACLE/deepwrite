import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  type CommandEnvelope,
  type CommandResult,
  type RemoteModelListItem
} from "@deepwrite/contracts";
import { PiAgentRuntimeAdapter } from "@deepwrite/pi-runtime-adapter";
import {
  refreshSiteOfficialModels,
  saveSiteOfficialModelToken
} from "../../preload/site-official-models-api";
import { testModel } from "../../preload/session-models-api";
import {
  listRemoteModels,
  type ListRemoteModelsInput
} from "../list-remote-models";
import { ModelConfigStore } from "../model-config-store";
import {
  emptyCatalog,
  temporaryRoots
} from "../model-config-store.test-support";
import {
  handleModelCommands,
  type ModelCommandContext
} from "./model-commands";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("electron", () => ({
  ipcRenderer: { invoke },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));
vi.mock("../deepwrite-public-data-config", () => ({
  DEEPWRITE_PUBLIC_DATA_API_BASE_URL: "https://gateway.example.test",
  deepWritePublicDataUrl: (filename: string) =>
    `https://gateway.example.test/${filename}`,
  deepWritePublicDataHeaders: (headers: Record<string, string>) => headers
}));

afterEach(() => vi.unstubAllGlobals());

const apiKey = "dw_sk_test_only_invalid";
const remoteModel = {
  id: "gem",
  label: "Gemini 3.8 Flash",
  description: "适合日常写作",
  provider: "deepwrite-site",
  api: "openai-responses",
  reasoning: true,
  supportsDeveloperRole: false,
  defaultThinkingLevel: "high",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0.1, 0.7, 1],
  contextWindow: 1_048_576,
  maxTokens: 65_536,
  input: 1,
  output: 3,
  cache: 0.05
} satisfies RemoteModelListItem;

function connectionResponse(): Response {
  const item = {
    id: "msg_test",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "OK", annotations: [] }]
  };
  const events = [
    { type: "response.created", response: { id: "resp_test" } },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: "resp_test",
        status: "completed",
        output: [item],
        usage: { input_tokens: 12, output_tokens: 2, total_tokens: 14 }
      }
    }
  ];
  return new Response(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } }
  );
}

function createStore(root: string): ModelConfigStore {
  return new ModelConfigStore(root, {
    freeModelCatalog: {
      initialize: async () => undefined,
      getCatalog: async () => emptyCatalog()
    }
  });
}

describe("site model protocol from HTTP catalog through preload and Agent", () => {
  it.each(["save", "refresh"] as const)(
    "%s keeps Gemini on Responses through storage and a real Pi connection test",
    async (operation) => {
      const root = await mkdtemp(join(tmpdir(), "deepwrite-site-protocol-"));
      temporaryRoots.push(root);
      const store = createStore(root);
      const id = "deepwrite-site-official-gem";
      if (operation === "refresh") {
        await store.save({
          defaultModelId: id,
          models: [
            {
              ...remoteModel,
              id,
              modelId: remoteModel.id,
              api: "openai-completions",
              baseUrl: "https://gateway.example.test/v1",
              enabled: false,
              apiKey
            }
          ]
        });
      }

      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        const headers = new Headers(init?.headers);
        if (url.pathname === "/api/v1/public/models") {
          expect(headers.has("Authorization")).toBe(false);
          expect(headers.has("x-goog-api-key")).toBe(false);
          expect(url.searchParams.has("key")).toBe(false);
          return Response.json({ object: "list", data: [remoteModel] });
        }
        expect(headers.get("Authorization")).toBe(`Bearer ${apiKey}`);
        if (url.pathname === "/v1/key/quota") {
          return Response.json({
            object: "api_key_quota",
            unlimited: false,
            total: 10,
            used: 0,
            remaining: 10
          });
        }
        if (url.pathname !== "/v1/responses") {
          return Response.json(
            { error: { message: "模型协议与请求接口不匹配。" } },
            { status: 400 }
          );
        }
        const payload = JSON.parse(String(init?.body));
        expect(payload).toMatchObject({
          model: "gem",
          reasoning: { effort: "high" },
          stream: true
        });
        expect(payload).not.toHaveProperty("messages");
        return connectionResponse();
      });
      vi.stubGlobal("fetch", fetcher);
      const requestCommand = vi.fn(
        async (
          _kind: string,
          command: CommandEnvelope
        ): Promise<CommandResult> => {
          if (command.type !== "agent.model_test") {
            throw new Error("Expected an Agent model test command.");
          }
          expect(command.payload.runtimeConfig).toMatchObject({
            api: "openai-responses",
            modelId: "gem",
            apiKey
          });
          return {
            status: "accepted",
            requestId: command.id,
            payload: await new PiAgentRuntimeAdapter().testConnection(
              command.payload.runtimeConfig
            )
          };
        }
      );
      const ctx = {
        requireModelConfigStore: () => store,
        requireModelUsageStore: () => ({
          syncConfiguredModels: async () => undefined,
          record: async () => undefined
        }),
        listRemoteModels: (input: ListRemoteModelsInput) =>
          listRemoteModels(input, fetcher),
        supervisor: { requestCommand }
      } as unknown as ModelCommandContext;
      invoke.mockImplementation(async (_channel, raw) =>
        handleModelCommands(ctx, CommandEnvelopeSchema.parse(raw))
      );

      const settings =
        operation === "save"
          ? await saveSiteOfficialModelToken(apiKey)
          : await refreshSiteOfficialModels();
      expect(settings.models).toHaveLength(1);
      const model = settings.models[0]!;
      expect(model).toMatchObject({
        id,
        modelId: "gem",
        label: "Gemini 3.8 Flash",
        description: "适合日常写作",
        api: "openai-responses",
        baseUrl: "https://gateway.example.test/v1",
        enabled: operation === "save",
        hasApiKey: true
      });
      expect(settings.defaultModelId).toBe(id);
      expect(JSON.stringify(settings)).not.toContain(apiKey);
      await expect(createStore(root).resolve(id)).resolves.toMatchObject({
        description: "适合日常写作",
        api: "openai-responses",
        modelId: "gem",
        apiKey
      });

      await expect(testModel(model)).resolves.toMatchObject({
        modelId: id,
        ok: true,
        contextWindow: 1_048_576,
        maxTokens: 65_536,
        usage: { inputTokens: 12, outputTokens: 2, totalTokens: 14 }
      });
      expect(requestCommand).toHaveBeenCalledOnce();
      expect(
        fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname)
      ).toEqual([
        ...(operation === "save" ? ["/v1/key/quota"] : []),
        "/api/v1/public/models",
        "/v1/responses"
      ]);
    }
  );
});
