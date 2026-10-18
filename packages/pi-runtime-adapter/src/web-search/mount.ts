import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WebSearchSession } from "./session";
import { WEB_SEARCH_TOOL_NAME, buildWebSearchTool } from "./tool";

/**
 * The one place a tool list gains web search. Without a session (search is off
 * or unconfigured) or when it is already there, the list is returned as is.
 */
export function withWebSearchTool(
  tools: AgentTool[],
  session: WebSearchSession | undefined
): AgentTool[] {
  if (!session || tools.some((tool) => tool.name === WEB_SEARCH_TOOL_NAME))
    return tools;
  return [...tools, buildWebSearchTool(session)];
}
