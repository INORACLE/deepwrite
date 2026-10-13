import type {
  AgentMessage,
  AgentTool,
  ThinkingLevel as PiThinkingLevel
} from "@earendil-works/pi-agent-core";
import type { AgentRunInput, AgentUserInputRequester } from "./runtime-types";
import type { BuildSpawnSubagentToolInput } from "./subagent-types";
import type { PortableToolSchemaProfile } from "./portable-tool-schema";
import { createLibraryManagementRuntime } from "./library-management-runtime";
import { createMaterialQueryRunner } from "./material-query-runtime";
import { buildLibraryAgentTools } from "./library-agent-tools";
import {
  buildLongWorkspaceTools,
  createLongWorkspaceToolSharedState
} from "./long-agent-tools";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools,
  createScriptWorkspaceToolSharedState,
  createShortWorkspaceToolSharedState
} from "./short-agent-tools";
import { buildSubagentAuthoringTools } from "./subagent-authoring-tools";
import { buildSubagentMaterialContext } from "./prompts-material";
import { buildSpawnSubagentTool } from "./subagent-runtime";
import { workspaceContextPolicy } from "./workspace-context-policy";
import { writeApprovalBoundary } from "./write-approval";
import { buildProviderRuntime, toPiThinkingLevel } from "./provider-runtime";
import {
  scriptReadOnlyRuntimeSystemRequirements,
  scriptRuntimeSystemRequirements,
  shortReadOnlyRuntimeSystemRequirements,
  shortRuntimeSystemRequirements
} from "./prompts";
export interface BuildRunToolsOptions extends Pick<
  BuildSpawnSubagentToolInput,
  | "model"
  | "streamFn"
  | "parentRuntime"
  | "parentSignal"
  | "toolExecutionHooks"
  | "retryPolicy"
  | "timeoutMs"
> {
  parentRuntime: NonNullable<BuildSpawnSubagentToolInput["parentRuntime"]>;
  toolExecutionHooks: NonNullable<
    BuildSpawnSubagentToolInput["toolExecutionHooks"]
  >;
  thinkingLevel: PiThinkingLevel;
  requestUserInput: AgentUserInputRequester;
  getParentMessages: () => readonly AgentMessage[];
  portableToolSchemaProfile: PortableToolSchemaProfile;
  subagentTimeoutMs?: number;
  onContextCompacted?: (listener: () => void) => void;
}
export function buildRunTools(
  input: AgentRunInput,
  options: BuildRunToolsOptions
): AgentTool[] {
  const {
    model,
    thinkingLevel: effectiveThinkingLevel,
    streamFn: spawnStreamFn,
    parentRuntime: runtime,
    requestUserInput,
    portableToolSchemaProfile
  } = options;
  const {
    shortWorkspace,
    scriptWorkspace,
    longWorkspace,
    libraryWorkspace,
    subagentAuthoring
  } = input.workspaceContext ?? {};
  const writingToolSharedState =
    scriptWorkspace && input.scriptAgentProfile
      ? createScriptWorkspaceToolSharedState(scriptWorkspace)
      : shortWorkspace && input.agentProfile
        ? createShortWorkspaceToolSharedState(shortWorkspace)
        : undefined;
  const longToolSharedState =
    longWorkspace && input.longAgentProfile
      ? createLongWorkspaceToolSharedState()
      : undefined;
  const buildWritingTools = (
    onContextCompacted = options.onContextCompacted
  ): AgentTool[] => {
    if (scriptWorkspace && input.scriptAgentProfile) {
      return buildScriptWorkspaceTools({
        workspace: scriptWorkspace,
        profile: input.scriptAgentProfile,
        writeApprovalMode: input.writeApprovalMode ?? "request-approval",
        autoApproveCrossStageOperations:
          input.autoApproveCrossStageOperations === true,
        attachedSkills: input.workspaceContext?.attachedSkills,
        attachedMaterials: input.workspaceContext?.attachedMaterials,
        queryMaterials: createMaterialQueryRunner(input),
        requestUserInput,
        ...(onContextCompacted ? { onContextCompacted } : {}),
        ...(writingToolSharedState
          ? { sharedState: writingToolSharedState }
          : {})
      });
    }
    return shortWorkspace && input.agentProfile
      ? buildShortWorkspaceTools({
          workspace: shortWorkspace,
          profile: input.agentProfile,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
          autoApproveCrossStageOperations:
            input.autoApproveCrossStageOperations === true,
          attachedSkills: input.workspaceContext?.attachedSkills,
          attachedMaterials: input.workspaceContext?.attachedMaterials,
          queryMaterials: createMaterialQueryRunner(input),
          requestUserInput,
          ...(onContextCompacted ? { onContextCompacted } : {}),
          ...(writingToolSharedState
            ? { sharedState: writingToolSharedState }
            : {})
        })
      : [];
  };
  const buildLongTools = (
    includeAskUserQuestion = true,
    onContextCompacted = options.onContextCompacted
  ): AgentTool[] =>
    longWorkspace && input.longAgentProfile
      ? buildLongWorkspaceTools({
          workspace: longWorkspace,
          profile: input.longAgentProfile,
          sessionId: input.sessionId,
          runId: input.runId,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
          autoApproveCrossStageOperations:
            input.autoApproveCrossStageOperations === true,
          attachedSkills: input.workspaceContext?.attachedSkills,
          attachedMaterials: input.workspaceContext?.attachedMaterials,
          queryMaterials: createMaterialQueryRunner(input),
          ...(input.longCommandExecutor
            ? { executor: input.longCommandExecutor }
            : {}),
          requestUserInput,
          includeAskUserQuestion,
          ...(onContextCompacted ? { onContextCompacted } : {}),
          ...(longToolSharedState ? { sharedState: longToolSharedState } : {})
        })
      : [];
  const management = createLibraryManagementRuntime(input);
  let tools: AgentTool[] = subagentAuthoring
    ? buildSubagentAuthoringTools(subagentAuthoring)
    : libraryWorkspace && input.libraryAgentProfile
      ? buildLibraryAgentTools({
          workspace: libraryWorkspace,
          profile: input.libraryAgentProfile,
          writeApprovalMode: input.writeApprovalMode ?? "request-approval",
          attachedSkills: input.workspaceContext?.attachedSkills
        })
      : longWorkspace && input.longAgentProfile
        ? buildLongTools()
        : (scriptWorkspace && input.scriptAgentProfile) ||
            (shortWorkspace && input.agentProfile)
          ? buildWritingTools()
          : [];
  if (
    ((scriptWorkspace && input.scriptAgentProfile) ||
      (shortWorkspace && input.agentProfile) ||
      (longWorkspace && input.longAgentProfile)) &&
    !subagentAuthoring
  ) {
    const parentPolicy = workspaceContextPolicy(input);
    const childContextPolicy = parentPolicy && {
      settings: parentPolicy.settings,
      task: parentPolicy.task,
      toolCompactors: parentPolicy.toolCompactors,
      ...(parentPolicy.rehydrate ? { rehydrate: parentPolicy.rehydrate } : {})
    };
    const spawnTool = buildSpawnSubagentTool({
      parentSessionId: input.sessionId,
      ...((options.parentSignal ?? input.signal)
        ? { parentSignal: options.parentSignal ?? input.signal }
        : {}),
      parentRuntime: runtime,
      model,
      thinkingLevel: effectiveThinkingLevel,
      streamFn: spawnStreamFn,
      requestUserInput,
      definitions: [
        ...(input.subagentDefinitions ?? []),
        ...management.definitions
      ],
      prepareChild: management.prepareChild,
      getParentMessages: options.getParentMessages,
      ...(childContextPolicy ? { contextPolicy: childContextPolicy } : {}),
      materialContext: buildSubagentMaterialContext(input),
      ...(input.subagentRuntimeConfigs
        ? { subagentRuntimeConfigs: input.subagentRuntimeConfigs }
        : {}),
      buildCustomModelRuntime: (config, options) => {
        const childThinking =
          options?.thinkingLevel ?? config.defaultThinkingLevel ?? "medium";
        const childTemperature =
          childThinking === "off"
            ? (options?.temperature ?? config.temperatureOptions[1])
            : undefined;
        const childRuntime = buildProviderRuntime(
          config,
          childTemperature,
          childThinking,
          { portableToolSchemaProfile }
        );
        return {
          model: childRuntime.model,
          streamFn: childRuntime.streamFn,
          thinkingLevel: toPiThinkingLevel(childThinking)
        };
      },
      buildChildTools:
        longWorkspace && input.longAgentProfile
          ? (listener) => buildLongTools(false, listener)
          : buildWritingTools,
      ...(scriptWorkspace
        ? {
            systemPromptRequirements: scriptRuntimeSystemRequirements(input),
            pureReadSystemPromptRequirements:
              scriptReadOnlyRuntimeSystemRequirements(input)
          }
        : shortWorkspace
          ? {
              systemPromptRequirements: shortRuntimeSystemRequirements(input),
              pureReadSystemPromptRequirements:
                shortReadOnlyRuntimeSystemRequirements(input)
            }
          : longWorkspace
            ? {
                systemPromptRequirements: [
                  "这是长篇主智能体委派的单层子任务。只能使用继承的长篇查询/提案工具和当前 bookId。交回结果时列出已提交的修改。",
                  writeApprovalBoundary(input.writeApprovalMode)
                ].join("\n"),
                pureReadSystemPromptRequirements:
                  "这是长篇主智能体委派的单层只读子任务。只能使用 read、list 读取当前 bookId 的作品，以及 query_linked_material_entries 读取素材；没有任何写入工具，不能修改作品，也不得声称已修改或已提交连续性账本。"
              }
            : {}),
      toolExecutionHooks: options.toolExecutionHooks,
      ...(options.retryPolicy ? { retryPolicy: options.retryPolicy } : {}),
      ...(options.subagentTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.subagentTimeoutMs }),
      depth: 0,
      ...(input.parallelSubagents === true && input.subagentDefinitions?.length
        ? { parallel: true }
        : {})
    });
    if (spawnTool) tools = [...tools, spawnTool];
  }

  return tools;
}
