import type { ExtrasConversationAgentDefinition } from "../definition";
import { withWebSearchTool } from "../../web-search/mount";
import { buildNormalTools } from "../tools/chat-normal-tools";
import {
  chatFauxResponse,
  chatReadOnlyBoundary,
  chatSoftwareContext
} from "./chat-prompt";

/** General chat about DeepWrite, limited to catalog and summary tools. */
export const chatNormalAgent: ExtrasConversationAgentDefinition<"chat-normal"> =
  {
    id: "chat-normal",
    interaction: "conversation",
    boundaryTitle: "普通聊天",
    boundary: ({ input }) => [
      "普通模式只能查看目录与摘要，不能读取任何书籍、技能或素材正文。",
      ...chatReadOnlyBoundary(),
      ...chatSoftwareContext(input.runtime)
    ],
    tools: ({ input }, services) =>
      withWebSearchTool(buildNormalTools(input.runtime), services.webSearch),
    conversationKey: () => "normal",
    faux: (_task, turn) =>
      chatFauxResponse(
        "普通",
        "正在结合 DeepWrite 当前状态与只读查询工具组织回复。",
        turn
      )
  };
