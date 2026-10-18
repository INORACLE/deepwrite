import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  ExtrasAgentConversation,
  ExtrasAgentResolvedTask,
  WebSearchRuntimeConfig
} from "@deepwrite/contracts";
import type { AgentRunBuildContext } from "../kernel/run-plan";
import { PiAgentRuntimeAdapter } from "../adapter";
import type { AgentRuntimeEvent } from "../runtime-types";
import type {
  BoundExtrasConversationAgent,
  BoundExtrasTaskAgent,
  ExtrasAgentRunServices
} from "./definition";
import { planExtrasRun, resolveExtrasAgent } from "./run-plan";

const TEST_SERVICES: ExtrasAgentRunServices = {
  runId: "run-test",
  sessionId: "session-test"
};

type TestBound<
  Agent extends { tools(services: ExtrasAgentRunServices): AgentTool[] }
> = Omit<Agent, "tools"> & {
  tools(services?: ExtrasAgentRunServices): AgentTool[];
};

/** Binds a one-shot task agent; tools default to test run services. */
export function resolveTaskAgent(
  task: ExtrasAgentResolvedTask
): TestBound<BoundExtrasTaskAgent> {
  const agent = resolveExtrasAgent(task);
  if (agent.interaction !== "task") throw new Error("Not a task agent.");
  return {
    ...agent,
    tools: (services = TEST_SERVICES) => agent.tools(services)
  };
}

/** Binds a conversation agent; tools default to test run services. */
export function resolveConversationAgent(
  task: ExtrasAgentResolvedTask
): TestBound<BoundExtrasConversationAgent> {
  const agent = resolveExtrasAgent(task);
  if (agent.interaction !== "conversation")
    throw new Error("Not a conversation agent.");
  return {
    ...agent,
    tools: (services = TEST_SERVICES) => agent.tools(services)
  };
}

/**
 * What a conversation turn is assembled from: the system prompt and the tools,
 * with or without the search settings Main may attach to a run.
 */
export function buildConversationRun(
  task: ExtrasAgentResolvedTask,
  options: { webSearch?: WebSearchRuntimeConfig } = {}
) {
  return planExtrasRun({
    runId: "run-test",
    spec: {
      sessionId: "session-test",
      task,
      conversation: { message: "你好" },
      ...(options.webSearch ? { webSearch: options.webSearch } : {})
    }
  }).build({
    runtime: { provider: "deepwrite", model: "faux", mode: "local-faux" },
    parentSignal: new AbortController().signal
  } as unknown as AgentRunBuildContext);
}

export function toolNamed(tools: AgentTool[], name: string): AgentTool {
  const found = tools.find((item) => item.name === name);
  if (!found) throw new Error(`Missing tool: ${name}`);
  return found;
}

export function toolText(result: AgentToolResult<unknown>): string {
  return result.content
    .map((item) => (item.type === "text" ? item.text : ""))
    .join("\n");
}

/** Runs an extras task on the local faux model and collects its events. */
export async function runFauxExtras(
  task: ExtrasAgentResolvedTask,
  runtime = new PiAgentRuntimeAdapter({ tokensPerSecond: 0 }),
  turn?: {
    sessionId?: string;
    runId?: string;
    conversation: ExtrasAgentConversation;
  }
): Promise<AgentRuntimeEvent[]> {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.startExtras({
    runId: turn?.runId ?? `run-${task.agentId}`,
    spec: {
      sessionId: turn?.sessionId ?? `session-${task.agentId}`,
      task,
      ...(turn ? { conversation: turn.conversation } : {})
    }
  })) {
    events.push(event);
  }
  return events;
}
