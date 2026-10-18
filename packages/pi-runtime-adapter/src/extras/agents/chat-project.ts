import { chatAssistantProjectKey } from "@deepwrite/contracts";
import type { ExtrasConversationAgentDefinition } from "../definition";
import { withWebSearchTool } from "../../web-search/mount";
import { buildNormalTools } from "../tools/chat-normal-tools";
import {
  buildLongProjectTools,
  buildShortProjectTools
} from "../tools/chat-project-tools";
import {
  chatFauxResponse,
  chatProjectStructure,
  chatReadOnlyBoundary,
  chatSoftwareContext
} from "./chat-prompt";

/**
 * Read-only chat about one book. The profile prompt is the user's prompt for
 * that project; project content is only reachable through query tools.
 */
export const chatProjectAgent: ExtrasConversationAgentDefinition<"chat-project"> =
  {
    id: "chat-project",
    interaction: "conversation",
    boundaryTitle: "项目聊天",
    boundary: ({ input }) => [
      "你是用户当前所选书籍的只读项目助手，可以跨阶段分析、核验和讨论，但不能修改项目。",
      ...chatReadOnlyBoundary(),
      ...chatSoftwareContext(input.runtime),
      "",
      "【当前项目结构】",
      ...chatProjectStructure(input.runtime)
    ],
    tools: ({ input }, services) => {
      const book = input.runtime.projectBook;
      return withWebSearchTool(
        [
          ...buildNormalTools(input.runtime),
          ...(book.bookType === "long"
            ? buildLongProjectTools({
                runId: services.runId,
                sessionId: services.sessionId,
                book,
                executor: services.longCommandExecutor
              })
            : buildShortProjectTools(book))
        ],
        services.webSearch
      );
    },
    conversationKey: ({ input }) => chatAssistantProjectKey(input.project),
    faux: (_task, turn) =>
      chatFauxResponse(
        "项目",
        "正在结合当前项目结构与只读查询工具核对信息。",
        turn
      )
  };
