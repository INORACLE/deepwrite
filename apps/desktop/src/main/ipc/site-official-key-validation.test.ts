import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type ModelSettings
} from "@deepwrite/contracts";
import {
  listRemoteModels,
  type ListRemoteModelsInput
} from "../list-remote-models";
import {
  handleModelCommands,
  type ModelCommandContext
} from "./model-commands";
import { siteOfficialOperationState } from "./site-official-operation";

vi.mock("../deepwrite-public-data-config", () => ({
  DEEPWRITE_PUBLIC_DATA_API_BASE_URL: "https://gateway.example.test"
}));

const replacementKey = "replacement_test_only_invalid";
const current: ModelSettings = {
  models: [
    {
      id: "deepwrite-site-official-writer-test",
      label: "Writer Test",
      provider: "deepwrite-site",
      modelId: "writer-test",
      api: "openai-completions",
      baseUrl: "https://gateway.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      thinkingLevelOptions: ["low", "high"],
      temperatureOptions: [0.1, 0.7, 1],
      hasApiKey: true
    }
  ],
  defaultModelId: "deepwrite-site-official-writer-test"
};

function setup(
  quotaStatus: number,
  remaining: number | null,
  catalogStatus = 200
) {
  const remoteFetch = vi.fn(async (rawUrl: string, init?: RequestInit) => {
    const url = new URL(rawUrl);
    const headers = new Headers(init?.headers);
    if (url.pathname === "/v1/key/quota") {
      expect(headers.get("Authorization")).toBe(`Bearer ${replacementKey}`);
      return remaining === null
        ? Response.json(
            { error: { message: `untrusted ${replacementKey}` } },
            { status: quotaStatus }
          )
        : Response.json(
            {
              object: "api_key_quota",
              unlimited: false,
              remaining,
              used: 10 - remaining,
              total: 10
            },
            { status: quotaStatus }
          );
    }
    expect(url.pathname).toBe("/api/v1/public/models");
    expect(url.searchParams.has("key")).toBe(false);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("x-goog-api-key")).toBe(false);
    return Response.json(
      { object: "list", data: [{ id: "writer-test" }] },
      { status: catalogStatus }
    );
  });
  const store = {
    list: vi.fn(async () => current),
    save: vi.fn(async () => current),
    resolveDraftApiKey: vi.fn(async () => "previous_test_only_invalid")
  };
  const syncConfiguredModels = vi.fn(async () => undefined);
  const ctx = {
    requireModelConfigStore: () => store,
    requireModelUsageStore: () => ({ syncConfiguredModels }),
    listRemoteModels: vi.fn((input: ListRemoteModelsInput) =>
      listRemoteModels(input, remoteFetch)
    ),
    remoteFetch
  } as unknown as ModelCommandContext;
  const command = CommandEnvelopeSchema.parse(
    createEnvelope(
      "models.saveSiteOfficialToken",
      { apiKey: replacementKey },
      { id: "cmd_replace_site_key" }
    )
  );
  return { ctx, command, remoteFetch, store, syncConfiguredModels };
}

describe("new-site key validation with an anonymous model catalog", () => {
  it("rejects an exhausted replacement key without overwriting the current key", async () => {
    const { ctx, command, store, remoteFetch, syncConfiguredModels } = setup(
      200,
      0
    );
    const result = await handleModelCommands(ctx, command);
    expect(result).toMatchObject({
      status: "rejected",
      error: { message: expect.stringContaining("额度已用完") }
    });
    expect(store.save).not.toHaveBeenCalled();
    expect(store.resolveDraftApiKey).not.toHaveBeenCalled();
    expect(syncConfiguredModels).not.toHaveBeenCalled();
    expect(remoteFetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(replacementKey);
  });

  it.each([401, 403, 503])(
    "does not accept a replacement key when quota validation returns HTTP %i",
    async (status) => {
      const { ctx, command, store, remoteFetch } = setup(status, null);
      const result = await handleModelCommands(ctx, command);
      expect(result).toMatchObject({
        status: "rejected",
        error: { message: expect.stringContaining("密钥校验失败") }
      });
      expect(store.save).not.toHaveBeenCalled();
      expect(ctx.listRemoteModels).not.toHaveBeenCalled();
      expect(remoteFetch).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain(replacementKey);
    }
  );

  it("validates the key through quota and loads the catalog without credentials", async () => {
    const { ctx, command, store, remoteFetch } = setup(200, 5);
    await expect(handleModelCommands(ctx, command)).resolves.toMatchObject({
      status: "accepted"
    });
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [expect.objectContaining({ apiKey: replacementKey })]
      })
    );
    expect(store.resolveDraftApiKey).not.toHaveBeenCalled();
    expect(remoteFetch).toHaveBeenCalledTimes(2);
    expect(ctx.listRemoteModels).toHaveBeenCalledOnce();
  });

  it.each([403, 503])(
    "reports a public catalog HTTP %i failure independently of key validation",
    async (status) => {
      const { ctx, command, store, remoteFetch } = setup(200, 5, status);
      const result = await handleModelCommands(ctx, command);
      expect(result).toMatchObject({
        status: "rejected",
        error: {
          message: expect.stringContaining(
            `/api/v1/public/models：HTTP ${status}`
          )
        }
      });
      expect(store.save).not.toHaveBeenCalled();
      expect(remoteFetch).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(result)).not.toContain(replacementKey);
    }
  );

  it("does not expose untrusted catalog failures containing a key", async () => {
    const { ctx, command, store } = setup(200, 5);
    ctx.listRemoteModels = vi.fn(async () => {
      throw new Error(`request failed with ${replacementKey}`);
    });
    const result = await handleModelCommands(ctx, command);
    expect(result).toMatchObject({ status: "rejected" });
    expect(JSON.stringify(result)).not.toContain(replacementKey);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("holds the key operation lock until the public catalog request settles", async () => {
    const { ctx, command, store } = setup(200, 5);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.listRemoteModels = vi.fn(async () => {
      await pending;
      return [];
    });
    const saving = handleModelCommands(ctx, command);
    try {
      await vi.waitFor(() =>
        expect(ctx.listRemoteModels).toHaveBeenCalledOnce()
      );
      expect(siteOfficialOperationState(store).busy).toBe(true);
    } finally {
      release();
      await saving;
    }
    expect(siteOfficialOperationState(store).busy).toBe(false);
    expect(store.save).not.toHaveBeenCalled();
  });
});
