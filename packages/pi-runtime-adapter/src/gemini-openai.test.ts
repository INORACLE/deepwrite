import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import {
  Type,
  normalizeContext,
  type Context,
  type ToolCall
} from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it } from "vitest";
import { buildProviderRuntime } from "./provider-runtime";

const config: AgentProviderRuntimeConfig = {
  id: "gemini-openai-test",
  label: "Gemini gateway",
  provider: "deepwrite-site",
  modelId: "gemini-3.8-flash-high",
  api: "openai-completions",
  baseUrl: "https://gateway.example.test/v1",
  reasoning: true,
  defaultThinkingLevel: "high",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0.1, 0.7, 1],
  apiKey: "invalid-gemini-gateway-test-key"
};

const context: Context = normalizeContext({
  systemPrompt: "Read the requested documents with tools.",
  messages: [{ role: "user", content: "Read both chapters.", timestamp: 1 }],
  tools: [
    {
      name: "read",
      description: "Read a document by its id.",
      parameters: Type.Object({ id: Type.String() })
    }
  ]
});

function response(deltas: Record<string, unknown>[]): Response {
  const chunks: Record<string, unknown>[] = deltas.map((delta) => ({
    id: "gemini-completion-test",
    object: "chat.completion.chunk",
    created: 0,
    model: config.modelId,
    choices: [{ index: 0, delta, finish_reason: null }]
  }));
  chunks.push({
    ...chunks[0]!,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
  });
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } }
  );
}

async function payloadFor(
  runtimeConfig: AgentProviderRuntimeConfig,
  requestContext: Context = context
): Promise<Record<string, unknown>> {
  const { model, streamFn } = buildProviderRuntime(runtimeConfig);
  let payload: Record<string, unknown> | undefined;
  await (
    await streamFn(model, requestContext, {
      maxTokens: 1_024,
      onPayload: (value) => {
        payload = value as Record<string, unknown>;
        throw new Error("Captured before transport");
      }
    })
  ).result();
  expect(payload).toBeDefined();
  return payload!;
}

describe("Gemini OpenAI-compatible gateway", () => {
  it.each(["gemini-3.8-flash-high", "google/gemini-3.8-flash-high"])(
    "recognizes %s without changing its configured protocol or route",
    (modelId) => {
      const builtin = getBuiltinModels("google").find(
        (model) => model.id === "gemini-3.8-flash"
      )!;
      const { model } = buildProviderRuntime({ ...config, modelId });
      expect(model).toMatchObject({
        id: modelId,
        api: "openai-completions",
        provider: "deepwrite-site",
        baseUrl: config.baseUrl,
        contextWindow: builtin.contextWindow,
        maxTokens: builtin.maxTokens,
        thinkingLevelMap: builtin.thinkingLevelMap
      });
      expect(
        buildProviderRuntime({
          ...config,
          modelId,
          requestModelId: "gateway-route",
          contextWindow: 32_000,
          maxTokens: 4_096
        }).model
      ).toMatchObject({
        id: "gateway-route",
        contextWindow: 32_000,
        maxTokens: 4_096
      });
    }
  );

  it("uses Gemini-compatible request fields through the OpenAI transport", async () => {
    const payload = await payloadFor(config);
    expect(payload).toHaveProperty("max_tokens", 1_024);
    expect(payload).not.toHaveProperty("max_completion_tokens");
    expect(payload).not.toHaveProperty("store");
    expect(payload.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({ role: "user" })
    ]);
  });

  it.each(["indexed", "id-only"] as const)(
    "keeps parallel %s calls, arguments and signatures paired on the next request",
    async (format) => {
      const { model, streamFn } = buildProviderRuntime(config);
      const rawChunks: unknown[] = [];
      const firstCall = {
        ...(format === "indexed" ? { index: 0 } : {}),
        id: "call-first",
        type: "function",
        function: { name: "read", arguments: '{"id":"chapter-first"}' },
        extra_content: { google: { thought_signature: "opaque-signature-A" } }
      };
      const secondCall = {
        ...(format === "indexed" ? { index: 1 } : {}),
        id: "call-second",
        type: "function",
        function: { name: "read", arguments: '{"id":"chapter-second"}' }
      };
      const fetcher: typeof fetch = async () =>
        response([{ tool_calls: [firstCall, secondCall] }]);
      const first = await (
        await streamFn(model, context, {
          fetch: fetcher,
          onProviderStreamEvent: (chunk) => {
            rawChunks.push(structuredClone(chunk));
          }
        })
      ).result();
      expect(first.stopReason).not.toBe("error");
      const calls = first.content.filter(
        (block): block is ToolCall => block.type === "toolCall"
      );
      expect(calls).toMatchObject([
        { id: "call-first", name: "read", arguments: { id: "chapter-first" } },
        { id: "call-second", name: "read", arguments: { id: "chapter-second" } }
      ]);
      expect(calls[0]!.thoughtSignature).toBeDefined();
      expect(calls[1]).not.toHaveProperty("thoughtSignature");
      expect(JSON.stringify(rawChunks)).toContain("opaque-signature-A");

      let nextPayload: Record<string, unknown> | undefined;
      const next = await (
        await streamFn(
          model,
          {
            ...context,
            messages: [
              ...context.messages,
              JSON.parse(JSON.stringify(first)),
              ...calls.map((call) => ({
                role: "toolResult" as const,
                toolCallId: call.id,
                toolName: call.name,
                content: [
                  { type: "text" as const, text: call.arguments.id as string }
                ],
                isError: false,
                timestamp: 2
              }))
            ]
          },
          {
            fetch: async (input, init) => {
              const body =
                init?.body ??
                (input instanceof Request ? await input.clone().text() : "");
              expect(JSON.parse(String(body))).toHaveProperty(
                "custom_field",
                "preserved"
              );
              return response([{ content: "Read both chapters." }]);
            },
            onPayload: (value) => {
              nextPayload = value as Record<string, unknown>;
              return { ...nextPayload, custom_field: "preserved" };
            }
          }
        )
      ).result();
      expect(next.stopReason).not.toBe("error");
      expect(nextPayload!.messages).toEqual([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            expect.objectContaining({
              id: "call-first",
              extra_content: {
                google: { thought_signature: "opaque-signature-A" }
              }
            }),
            expect.not.objectContaining({ extra_content: expect.anything() })
          ]
        }),
        expect.objectContaining({
          role: "tool",
          name: "read",
          tool_call_id: "call-first"
        }),
        expect.objectContaining({
          role: "tool",
          name: "read",
          tool_call_id: "call-second"
        })
      ]);
    }
  );

  it("retains a signature received before the call id while arguments are interleaved", async () => {
    const { model, streamFn } = buildProviderRuntime(config);
    const first = await (
      await streamFn(model, context, {
        fetch: async () =>
          response([
            {
              tool_calls: [
                {
                  index: 0,
                  function: { name: "read", arguments: '{"id":"chapter-' },
                  extra_content: {
                    google: { thought_signature: "opaque-early-signature" }
                  }
                }
              ]
            },
            {
              tool_calls: [
                {
                  index: 1,
                  id: "call-second",
                  function: {
                    name: "read",
                    arguments: '{"id":"chapter-second"}'
                  }
                }
              ]
            },
            {
              tool_calls: [
                {
                  index: 0,
                  id: "call-first",
                  function: { arguments: 'first"}' }
                }
              ]
            }
          ])
      })
    ).result();
    expect(first.stopReason).not.toBe("error");
    expect(first.content).toMatchObject([
      {
        type: "toolCall",
        id: "call-first",
        arguments: { id: "chapter-first" },
        thoughtSignature: expect.stringContaining("opaque-early-signature")
      },
      {
        type: "toolCall",
        id: "call-second",
        arguments: { id: "chapter-second" }
      }
    ]);
  });

  it("replays each original signature when sequential steps reuse a call id", async () => {
    const { model, streamFn } = buildProviderRuntime(config);
    let transcript = context;
    for (const signature of ["opaque-step-A", "opaque-step-B"]) {
      const message = await (
        await streamFn(model, transcript, {
          fetch: async () =>
            response([
              {
                tool_calls: [
                  {
                    index: 0,
                    id: "reused-call",
                    type: "function",
                    function: {
                      name: "read",
                      arguments: '{"id":"chapter-first"}'
                    },
                    extra_content: { google: { thought_signature: signature } }
                  }
                ]
              }
            ])
        })
      ).result();
      transcript = {
        ...transcript,
        messages: [
          ...transcript.messages,
          message,
          {
            role: "toolResult",
            toolCallId: "reused-call",
            toolName: "read",
            content: [{ type: "text", text: "Chapter content" }],
            isError: false,
            timestamp: 2
          }
        ]
      };
    }
    const payload = await payloadFor(config, transcript);
    const calls = (payload.messages as Array<Record<string, unknown>>)
      .filter((message) => message.role === "assistant")
      .flatMap(
        (message) => message.tool_calls as Array<Record<string, unknown>>
      );
    expect(calls).toMatchObject([
      {
        id: "reused-call",
        extra_content: { google: { thought_signature: "opaque-step-A" } }
      },
      {
        id: "reused-call",
        extra_content: { google: { thought_signature: "opaque-step-B" } }
      }
    ]);

    const changedModelPayload = await payloadFor(
      { ...config, modelId: "gemini-3.8-flash-other-route" },
      transcript
    );
    expect(JSON.stringify(changedModelPayload)).not.toContain("opaque-step-");
  });

  it("does not fabricate absent signatures or reinterpret OpenRouter replay metadata", async () => {
    const { model, streamFn } = buildProviderRuntime(config);
    const message = await (
      await streamFn(model, context, {
        fetch: async () =>
          response([
            {
              tool_calls: [
                {
                  index: 0,
                  id: "unsigned-call",
                  type: "function",
                  function: {
                    name: "read",
                    arguments: '{"id":"chapter-first"}'
                  }
                }
              ]
            }
          ])
      })
    ).result();
    const call = message.content.find((block) => block.type === "toolCall")!;
    expect(call).not.toHaveProperty("thoughtSignature");
    call.thoughtSignature = JSON.stringify({
      type: "reasoning.encrypted",
      id: call.id,
      data: "opaque-router-data"
    });
    const payload = await payloadFor(config, {
      ...context,
      messages: [
        ...context.messages,
        message,
        {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: "Chapter content" }],
          isError: false,
          timestamp: 2
        }
      ]
    });
    const assistant = (payload.messages as Array<Record<string, unknown>>).find(
      (value) => value.role === "assistant"
    )!;
    expect(assistant).toHaveProperty("reasoning_details");
    expect(assistant.tool_calls).toEqual([
      expect.not.objectContaining({ extra_content: expect.anything() })
    ]);
  });

  it("propagates provider errors through the compatibility stream", async () => {
    const { model, streamFn } = buildProviderRuntime(config);
    const result = await (
      await streamFn(model, context, {
        fetch: async () =>
          new Response(
            JSON.stringify({ error: { message: "Expected gateway failure" } }),
            { status: 400, headers: { "content-type": "application/json" } }
          )
      })
    ).result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("Expected gateway failure");
  });
});
