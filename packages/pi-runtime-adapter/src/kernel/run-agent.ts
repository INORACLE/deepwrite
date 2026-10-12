import {
  Agent,
  type AgentTool,
  type StreamFn,
  type ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  normalizeContext,
  toToolDeclaration,
  type Api,
  type Model
} from "@earendil-works/pi-ai";
import {
  cacheConversationAgent,
  selectConversationAgentForRun
} from "../conversation-agent-rebuild";
import type { AgentToolExecutionHooks } from "../subagent-runtime";
import { restoredConversationMessages } from "./run-model";
import type { AgentRunPlan } from "./run-plan";

const CONVERSATION_AGENT_CACHE_LIMIT = 100;

export interface RunAgentState {
  systemPrompt: string;
  model: Model<Api>;
  thinkingLevel: PiThinkingLevel;
  tools: AgentTool[];
  streamFn: StreamFn;
}

/** Owns the conversation-agent cache shared by every agent domain. */
export class ConversationAgentCache {
  constructor(
    readonly agents: Map<string, Agent>,
    private readonly hooks: AgentToolExecutionHooks
  ) {}

  /** Returns the cached agent for a keyed plan, or undefined for a fresh run. */
  select(plan: AgentRunPlan): Agent | undefined {
    if (!plan.agentKey) return undefined;
    return selectConversationAgentForRun(
      this.agents,
      plan.agentKey,
      plan.target.conversationHistoryMode
    );
  }

  /** Refreshes a reused agent or creates one; only keyed plans are cached. */
  prepare(
    plan: AgentRunPlan,
    reusable: Agent | undefined,
    state: RunAgentState
  ): Agent {
    if (reusable) {
      if (reusable.state.isStreaming) {
        throw new Error("The selected conversation agent is already running.");
      }
      reusable.state.messages = normalizeContext({
        systemPrompt: state.systemPrompt,
        tools: state.tools.map(toToolDeclaration),
        messages: reusable.state.messages.filter(
          (message) => message.role !== "system"
        )
      }).messages;
      reusable.state.model = state.model;
      reusable.state.thinkingLevel = state.thinkingLevel;
      reusable.state.tools = state.tools;
      reusable.streamFunction = state.streamFn;
      if (this.hooks.beforeToolCall) {
        reusable.beforeToolCall = this.hooks.beforeToolCall;
      } else {
        delete reusable.beforeToolCall;
      }
      if (this.hooks.afterToolCall) {
        reusable.afterToolCall = this.hooks.afterToolCall;
      } else {
        delete reusable.afterToolCall;
      }
      reusable.sessionId = plan.target.sessionId;
      reusable.toolExecution = "sequential";
      if (plan.agentKey) {
        cacheConversationAgent(this.agents, plan.agentKey, reusable);
      }
      return reusable;
    }
    const restoredMessages = restoredConversationMessages(
      plan.target,
      state.model
    );
    const agent = new Agent({
      initialState: {
        systemPrompt: state.systemPrompt,
        model: state.model,
        thinkingLevel: state.thinkingLevel,
        ...(restoredMessages.length ? { messages: restoredMessages } : {}),
        tools: state.tools
      },
      streamFn: state.streamFn,
      ...this.hooks,
      sessionId: plan.target.sessionId,
      toolExecution: "sequential"
    });
    if (plan.agentKey) {
      cacheConversationAgent(this.agents, plan.agentKey, agent);
      this.trim();
    }
    return agent;
  }

  private trim(limit = CONVERSATION_AGENT_CACHE_LIMIT): void {
    if (this.agents.size <= limit) return;
    for (const [key, agent] of this.agents) {
      if (this.agents.size <= limit) return;
      if (!agent.state.isStreaming) {
        this.agents.delete(key);
      }
    }
  }
}
