import { SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS } from "@deepwrite/contracts";
import type { WorkspaceRuntimeContext } from "@deepwrite/contracts";

import { renderCreativePlotStructure } from "./prompts-writing";
import type { AgentRunInput } from "./runtime-types";

type WritingWorkspace =
  | NonNullable<WorkspaceRuntimeContext["shortWorkspace"]>
  | NonNullable<WorkspaceRuntimeContext["scriptWorkspace"]>;

/** Where the work stands, without any rule about changing it. */
function renderReadOnlyWorkspaceContext(
  workspace: WritingWorkspace,
  workspaceKind: "短篇" | "剧本"
): string {
  const unit = workspaceKind === "剧本" ? "剧集" : "小节";
  const structure = workspace.characterStructure ?? { format: "text" as const };
  const stage = workspace.plotStages.find(
    (item) => item.id === workspace.activeStageId
  );
  const section = workspace.activeSectionId
    ? workspace.expertDraft.sections.find(
        (item) => item.id === workspace.activeSectionId
      )
    : undefined;
  const sections = workspace.expertDraft.sections;
  return [
    "【当前作品位置】",
    `当前阶段：${stage?.title ?? workspace.activeStageId} (${workspace.activeStageId})`,
    `正文目录：${
      sections.length
        ? sections
            .map((item, index) => `${index + 1}. ${item.title} (${item.id})`)
            .join("；")
        : "无"
    }`,
    `当前${unit}：${section ? `${section.title} (${section.id})` : "未选择"}`,
    structure.format === "list"
      ? `人物为条目样式；人物条目索引：${
          structure.items.length
            ? structure.items
                .map((item) => `${item.title} (${item.id})`)
                .join("、")
            : "无"
        }`
      : "人物为文本样式：全部人物写在总稿（kind=character_overview、id=character_design）。"
  ].join("\n");
}

function readOnlyRuntimeSystemRequirements(
  input: AgentRunInput,
  workspaceType: "short" | "script"
): string {
  const workspace =
    workspaceType === "script"
      ? input.workspaceContext!.scriptWorkspace!
      : input.workspaceContext!.shortWorkspace!;
  const workspaceKind = workspaceType === "script" ? "剧本" : "短篇";
  return [
    "【当前剧情结构配置（顺序即执行顺序）】",
    renderCreativePlotStructure(workspace),
    "",
    renderReadOnlyWorkspaceContext(workspace, workspaceKind),
    "",
    "【DeepWrite 当前工具边界（只读）】",
    `本任务只使用 read 读取${workspaceKind}作品、query_linked_material_entries 读取素材${
      input.webSearch ? "、web_search 查证公开资料" : ""
    }；没有 create、edit、delete，不能修改作品，也不得声称已经修改。`,
    "read 一次读全目标，不分页。kind=draft_section 必须同时给出 document=body 或 character_state。kind=draft、id=draft、include_all_sections=true 可读取全部正文，不传 document 时默认 body；合计超过五万字时按工具提示优先分小节精读。",
    ...(workspaceType === "script"
      ? [
          "",
          "【剧本正文格式硬约束（交付给主智能体的剧本正文片段同样适用）】",
          SCRIPT_SCREENPLAY_FORMAT_REQUIREMENTS.trim()
        ]
      : [])
  ].join("\n");
}

/** Requirements for `pure-read` children: reading rules, no writing rules. */
export function shortReadOnlyRuntimeSystemRequirements(
  input: AgentRunInput
): string {
  if (!input.workspaceContext?.shortWorkspace || !input.agentProfile) return "";
  return readOnlyRuntimeSystemRequirements(input, "short");
}

export function scriptReadOnlyRuntimeSystemRequirements(
  input: AgentRunInput
): string {
  if (!input.workspaceContext?.scriptWorkspace || !input.scriptAgentProfile) {
    return "";
  }
  return readOnlyRuntimeSystemRequirements(input, "script");
}
