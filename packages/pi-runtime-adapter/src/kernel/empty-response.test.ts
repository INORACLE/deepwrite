import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
  type FauxResponseStep
} from "@earendil-works/pi-ai";
import { AgentUserInputBroker } from "../user-input-broker";
import type { AgentRuntimeEvent } from "../runtime-types";
import { extrasOutputResult } from "../extras/output";
import { ConversationAgentCache } from "./run-agent";
import { AgentRunKernel } from "./run-kernel";

async function run(
  responses: FauxResponseStep[],
  tools: AgentTool[] = [],
  onEvent?: (event: AgentRuntimeEvent, controller: AbortController) => void
) {
  const agents = new ConversationAgentCache(new Map(), {});
  const controller = new AbortController();
  const kernel = new AgentRunKernel({
    agents,
    userInputBroker: new AgentUserInputBroker(),
    idleTimeoutMs: 0,
    tokensPerSecond: 0,
    evaluationMode: false,
    retryPolicy: { delaysMs: [0, 0], sleep: async () => {} },
    describe: () => ({
      mode: "local-faux",
      provider: "fixture",
      model: "empty-response-fixture"
    })
  });
  const events: AgentRuntimeEvent[] = [];
  for await (const event of kernel.run({
    target: {
      runId: "run_empty",
      sessionId: "session_empty",
      signal: controller.signal
    },
    eventSource: { runId: "run_empty", sessionId: "session_empty" },
    agentKey: "conversation",
    portableToolSchemaProfile: "default",
    build: () => ({ systemPrompt: "Complete the fixture task.", tools }),
    userMessageContent: () => "Continue the task.",
    fauxResponses: () => responses
  })) {
    events.push(event);
    onEvent?.(event, controller);
  }
  return {
    events,
    messages: agents.agents.get("conversation")!.state.messages
  };
}

describe("empty assistant responses in the shared run kernel", () => {
  it.each(["empty", "whitespace", "thinking"])(
    "recovers a %s reply after a tool without replaying that tool",
    async (kind) => {
      let executions = 0;
      const tool: AgentTool = {
        name: "read_once",
        label: "Read",
        description: "Read the fixture once.",
        parameters: Type.Object({}),
        async execute() {
          executions++;
          return {
            content: [{ type: "text", text: "Durable fixture result." }],
            details: {}
          };
        }
      };
      const empty = fauxAssistantMessage(
        kind === "thinking"
          ? fauxThinking("Planning without a reply.")
          : kind === "whitespace"
            ? " \n\t "
            : ""
      );
      const { events, messages } = await run(
        [
          fauxAssistantMessage(fauxToolCall("read_once", {}), {
            stopReason: "toolUse"
          }),
          empty,
          fauxAssistantMessage("The task is complete.")
        ],
        [tool]
      );

      expect(executions).toBe(1);
      expect(events.filter((e) => e.type === "agent.completed")).toMatchObject([
        { payload: { content: "The task is complete." } }
      ]);
      expect(events.filter((e) => e.type === "agent.error")).toEqual([]);
      expect(
        events.filter((e) => e.type === "agent.retry_scheduled")
      ).toMatchObject([
        {
          payload: {
            failedAttempt: 1,
            nextAttempt: 2,
            reason: expect.stringContaining("空回复")
          }
        }
      ]);
      expect(
        events.filter((e) => e.type === "agent.usage_observed")
      ).toMatchObject([
        { payload: { status: "completed", hadToolCall: true } },
        { payload: { status: "error", hadToolCall: false } },
        { payload: { status: "completed", hadToolCall: false } }
      ]);
      expect(messages.map((m) => m.role)).toEqual([
        "system",
        "user",
        "assistant",
        "toolResult",
        "assistant"
      ]);
    }
  );

  it("reports a failure after bounded retries instead of completing an empty run", async () => {
    const { events } = await run([
      fauxAssistantMessage(""),
      fauxAssistantMessage(""),
      fauxAssistantMessage("")
    ]);
    expect(
      events.filter((e) => e.type === "agent.retry_scheduled")
    ).toHaveLength(2);
    expect(events.filter((e) => e.type === "agent.completed")).toEqual([]);
    expect(events.filter((e) => e.type === "agent.error")).toMatchObject([
      { payload: { message: expect.stringContaining("空回复") } }
    ]);
    expect(events.at(-1)?.type).toBe("agent.error");
  });

  it("allows a result tool to complete an analysis without final prose", async () => {
    let submissions = 0;
    const tool: AgentTool = {
      name: "submit_result",
      label: "Submit",
      description: "Deliver the fixture analysis result.",
      parameters: Type.Object({}),
      async execute() {
        submissions++;
        return extrasOutputResult(
          { agentId: "revision-analysis", jobId: "fixture" },
          "Result delivered.",
          {
            kind: "revision-analysis-result",
            result: {
              title: "Fixture",
              description: "Fixture result",
              body: "Fixture skill",
              report: "Fixture report"
            }
          }
        );
      }
    };
    const { events } = await run(
      [
        fauxAssistantMessage(fauxToolCall("submit_result", {}), {
          stopReason: "toolUse"
        }),
        fauxAssistantMessage("")
      ],
      [tool]
    );
    expect(submissions).toBe(1);
    expect(
      events.filter((e) => e.type === "extras_agent.output_updated")
    ).toHaveLength(1);
    expect(events.filter((e) => e.type === "agent.retry_scheduled")).toEqual(
      []
    );
    expect(events.filter((e) => e.type === "agent.error")).toEqual([]);
    expect(events.at(-1)?.type).toBe("agent.completed");
  });

  it("can cancel an empty-response retry without emitting completion", async () => {
    const { events } = await run(
      [fauxAssistantMessage(""), fauxAssistantMessage("Recovered.")],
      [],
      (event, controller) => {
        if (event.type === "agent.retry_scheduled") controller.abort();
      }
    );
    expect(events.filter((e) => e.type === "agent.completed")).toEqual([]);
    expect(events.filter((e) => e.type === "agent.error")).toMatchObject([
      { payload: { code: "pi_agent.aborted" } }
    ]);
  });
});
