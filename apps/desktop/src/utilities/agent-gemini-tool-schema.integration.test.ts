import {
  AgentPromptCommandPayloadSchema,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  type AgentPromptCommandPayload,
  type AgentProviderRuntimeConfig
} from "@deepwrite/contracts";
import {
  PiAgentRuntimeAdapter,
  type AgentRuntimeEvent
} from "@deepwrite/pi-runtime-adapter";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  shortProfile,
  shortWorkspace
} from "../../../../packages/pi-runtime-adapter/src/short-agent-tools.test-support";
import {
  profile as longProfile,
  workspace as longWorkspace
} from "../../../../packages/pi-runtime-adapter/src/long-agent-tools.test-support";
import {
  materialWorkspace,
  profile as libraryProfile,
  skillWorkspace
} from "../../../../packages/pi-runtime-adapter/src/library-agent-tools/test-fixtures";
import { createAgentRunInput } from "./agent-run-input";

type Domain = "short" | "script" | "long" | "material" | "skill";
interface ToolPayload {
  tools: Array<{
    function: {
      name: string;
      parameters: { properties: Record<string, Record<string, unknown>> };
    };
  }>;
}

const config: AgentProviderRuntimeConfig = {
  id: "gemini-tool-schema",
  label: "Gemini tool schema test",
  provider: "openai",
  api: "openai-completions",
  modelId: "google/gemini-3.8-flash",
  baseUrl: "https://gateway.example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["low", "high"],
  temperatureOptions: [0.2, 0.7, 1.2],
  apiKey: "invalid-desktop-schema-test-key"
};

function domainInput(domain: Domain): Partial<AgentPromptCommandPayload> {
  if (domain === "short") {
    return {
      agentProfile: shortProfile(),
      workspaceContext: { shortWorkspace: shortWorkspace("draft") }
    };
  }
  if (domain === "script") {
    return {
      scriptAgentProfile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!,
      workspaceContext: {
        scriptWorkspace: {
          ...shortWorkspace("draft"),
          activeAgentId: "script"
        }
      }
    };
  }
  if (domain === "long") {
    return {
      longAgentProfile: longProfile("long"),
      workspaceContext: {
        longWorkspace: longWorkspace("long", "draft", "chapter_one")
      }
    };
  }
  return {
    libraryAgentProfile: libraryProfile(domain),
    workspaceContext: {
      libraryWorkspace:
        domain === "material" ? materialWorkspace() : skillWorkspace()
    }
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("desktop Agent utility Gemini gateway tool schemas", () => {
  it.each(["short", "script", "long", "material", "skill"] as const)(
    "sends plain booleans from the %s App workflow and completes its turn",
    async (domain) => {
      let payload: ToolPayload | undefined;
      const fetcher: typeof globalThis.fetch = async (input, init) => {
        const body =
          init?.body ??
          (input instanceof Request ? await input.clone().text() : "");
        payload = JSON.parse(String(body)) as ToolPayload;
        const chunk = {
          id: "completion-schema-test",
          object: "chat.completion.chunk",
          created: 0,
          model: config.modelId,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "检查完成。" },
              finish_reason: "stop"
            }
          ]
        };
        return new Response(
          `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } }
        );
      };
      vi.stubGlobal("fetch", fetcher);
      const commandPayload = AgentPromptCommandPayloadSchema.parse({
        sessionId: `session-schema-${domain}`,
        message: "检查当前工作区。",
        thinkingLevel: "off",
        runtimeConfig: config,
        ...domainInput(domain)
      });
      const input = createAgentRunInput(
        commandPayload,
        `run-schema-${domain}`,
        new AbortController().signal
      );
      const events: AgentRuntimeEvent[] = [];
      for await (const event of new PiAgentRuntimeAdapter().start(input)) {
        events.push(event);
      }
      expect(events.filter((event) => event.type === "agent.error")).toEqual(
        []
      );
      expect(events.some((event) => event.type === "agent.completed")).toBe(
        true
      );
      expect(payload).toBeDefined();
      const fields =
        domain === "material" || domain === "skill"
          ? [
              [`edit_${domain}_entry`, "allow_overwrite_existing"],
              [`edit_${domain}_library_overview`, "allow_overwrite_existing"]
            ]
          : [
              ["edit", "allow_overwrite_existing"],
              ...(domain === "long" ? [] : [["read", "include_all_sections"]])
            ];
      for (const [name, field] of fields) {
        const tool = payload!.tools.find((item) => item.function.name === name);
        expect(tool).toBeDefined();
        const parameter = tool!.function.parameters.properties[field!]!;
        expect(parameter).toMatchObject({ type: "boolean" });
        expect(parameter).not.toHaveProperty("enum");
        expect(parameter).not.toHaveProperty("const");
      }
    }
  );
});
