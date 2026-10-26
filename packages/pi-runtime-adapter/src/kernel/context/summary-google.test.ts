import type { AgentProviderRuntimeConfig } from "@deepwrite/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProviderRuntime } from "../../provider-runtime";
import { resolveSummaryModel } from "./summary-model";
import { summarizeMessages } from "./summarize";
import { summarizeInPlace } from "./summarize-in-place";
import { ConversationContextState } from "./state";
import { user } from "./context.test-support";

const config: AgentProviderRuntimeConfig = {
  id: "summary-test",
  label: "Summary model",
  provider: "custom",
  modelId: "gemini-3.8-flash",
  api: "google-generative-ai",
  baseUrl: "https://summary.example.test/v1beta",
  apiKey: "invalid-summary-test-key",
  reasoning: true,
  contextWindow: 1_048_576,
  maxTokens: 65_536,
  defaultThinkingLevel: "high",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0.1, 0.7, 1]
};

afterEach(() => vi.unstubAllGlobals());

describe("Gemini checkpoint output budget", () => {
  it.each(["serialized", "in-place"] as const)(
    "uses the model generation limit and a prompt-only length target for %s summaries",
    async (kind) => {
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) => {
          const raw =
            init?.body ?? (input instanceof Request ? await input.text() : "");
          bodies.push(JSON.parse(String(raw)) as Record<string, unknown>);
          return new Response(
            `data: ${JSON.stringify({
              candidates: [
                {
                  content: { role: "model", parts: [{ text: "完整检查点" }] },
                  finishReason: "STOP"
                }
              ]
            })}\n\n`,
            { headers: { "content-type": "text/event-stream" } }
          );
        })
      );
      const provider = buildProviderRuntime(config, undefined, "high");
      const run = {
        ...provider,
        thinkingLevel: "high" as const,
        runtime: {
          mode: "provider" as const,
          provider: "custom",
          model: config.modelId
        }
      };
      const summarize = async (dedicated?: AgentProviderRuntimeConfig) => {
        const summary = resolveSummaryModel(run, dedicated);
        const request = {
          task: "general" as const,
          targetTokens: 6_144,
          signal: new AbortController().signal,
          state: new ConversationContextState(),
          onUsage: () => {}
        };
        return kind === "serialized"
          ? summarizeMessages(summary, [user("整理约束")], undefined, request)
          : summarizeInPlace(
              summary,
              { systemPrompt: "写作", tools: [], sessionId: "test-session" },
              [user("整理约束")],
              request
            );
      };
      await expect(summarize()).resolves.toBe("完整检查点");
      expect(bodies[0]).toMatchObject({
        generationConfig: {
          maxOutputTokens: 65_536,
          thinkingConfig: { thinkingLevel: "HIGH" }
        }
      });
      expect(JSON.stringify(bodies[0])).toContain(
        "正文长度目标约为 6144 token"
      );
      // A dedicated summary model keeps its explicitly chosen effort and limit.
      await expect(
        summarize({
          ...config,
          defaultThinkingLevel: "medium",
          maxTokens: 32_768
        })
      ).resolves.toBe("完整检查点");
      expect(bodies[1]).toMatchObject({
        generationConfig: {
          maxOutputTokens: 32_768,
          thinkingConfig: { thinkingLevel: "MEDIUM" }
        }
      });
      await expect(summarize({ ...config, maxTokens: 8_192 })).resolves.toBe(
        "完整检查点"
      );
      expect(bodies[2]).toMatchObject({
        generationConfig: { maxOutputTokens: 8_192 }
      });
      // Even a misconfigured output limit larger than the model window is
      // constrained by Pi's actual request context, not a fixed summary cap.
      await expect(
        summarize({ ...config, contextWindow: 10_000 })
      ).resolves.toBe("完整检查点");
      const generation = bodies[3]!.generationConfig as {
        maxOutputTokens: number;
      };
      expect(generation.maxOutputTokens).toBeGreaterThan(0);
      expect(generation.maxOutputTokens).toBeLessThan(10_000);
      expect(run.thinkingLevel).toBe("high");
      expect(run.model.maxTokens).toBe(65_536);
    }
  );
});
