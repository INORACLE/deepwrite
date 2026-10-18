import { z } from "zod";
import { TemperatureSchema, ThinkingLevelSchema } from "./models";
import {
  SHORT_WORKSPACE_AGENT_IDS,
  ShortWorkspaceAgentIdSchema,
  type ShortWorkspaceAgentId
} from "./workspace";
import {
  SCRIPT_WORKSPACE_AGENT_IDS,
  ScriptWorkspaceAgentIdSchema,
  type ScriptWorkspaceAgentId
} from "./script-workspace";
import {
  SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH,
  ShortAgentSubagentModelModeSchema,
  SubagentAgentModeSchema,
  SubagentWebSearchModeSchema,
  SubagentDrawSettingsSchema,
  validateSubagentCustomModel,
  type ShortAgentSubagentModelMode
} from "./subagent-settings";

export * from "./subagent-settings";

export const SHORT_AGENT_SUBAGENT_MAX_COUNT = 60;
export const SCRIPT_AGENT_SUBAGENT_MAX_COUNT = 60;
export const LONG_AGENT_SUBAGENT_MAX_COUNT = 60;
export const SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH = 120;
export const SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH = 80;
export const SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH = 1_000;
export const SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH = 20_000;
/** Upper bound of children a parallel team runs at the same time. */
export const SUBAGENT_PARALLEL_MAX_CONCURRENCY = 5;
/**
 * Upper bound of tasks one `spawn_subagent` call accepts. Tasks beyond the
 * concurrency limit queue in the scheduler, so this only guards against a
 * runaway call; it is enforced at execution with an actionable message, never
 * as a schema rejection that would discard the whole call.
 */
export const SUBAGENT_TASK_BATCH_MAX_COUNT = 60;

/**
 * Team-wide switch: when on, independent subagent tasks of one delegation
 * call run concurrently. Older settings and packages omit it.
 */
export const AgentTeamParallelSubagentsSchema = z.boolean().default(false);

export const ShortAgentSubagentDefinitionSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH)
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
        "Subagent id may contain only letters, numbers, underscores, and hyphens."
      ),
    name: z.string().trim().min(1).max(SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH),
    description: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_DESCRIPTION_MAX_LENGTH),
    systemPrompt: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_SYSTEM_PROMPT_MAX_LENGTH),
    enabled: z.boolean(),
    /** Older settings and packages omit it and run as `standard`. */
    agentMode: SubagentAgentModeSchema.default("standard"),
    /** Older settings and packages omit it and follow the main agent. */
    webSearchMode: SubagentWebSearchModeSchema.optional(),
    modelMode: ShortAgentSubagentModelModeSchema.default("inherit"),
    modelId: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH)
      .optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    temperature: TemperatureSchema.optional(),
    /** Older settings and packages omit it: draw mode off. */
    draw: SubagentDrawSettingsSchema.optional()
  })
  .superRefine((value, context) => validateSubagentCustomModel(value, context));
export type ShortAgentSubagentDefinition = z.infer<
  typeof ShortAgentSubagentDefinitionSchema
>;

function validateUniqueSubagents(
  subagents: readonly ShortAgentSubagentDefinition[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = new Map<string, number>();
  const names = new Map<string, number>();
  subagents.forEach((subagent, index) => {
    const normalizedId = subagent.id.toLocaleLowerCase();
    const existingIdIndex = ids.get(normalizedId);
    if (existingIdIndex !== undefined) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Duplicate subagent id: ${subagent.id}`
      });
    } else {
      ids.set(normalizedId, index);
    }

    const normalizedName = subagent.name.toLocaleLowerCase();
    const existingNameIndex = names.get(normalizedName);
    if (existingNameIndex !== undefined) {
      context.addIssue({
        code: "custom",
        path: [index, "name"],
        message: `Duplicate subagent name: ${subagent.name}`
      });
    } else {
      names.set(normalizedName, index);
    }
  });
}

export const ShortAgentSubagentDefinitionsSchema = z
  .array(ShortAgentSubagentDefinitionSchema)
  .max(SHORT_AGENT_SUBAGENT_MAX_COUNT)
  .superRefine(validateUniqueSubagents);

/** Script aliases are intentionally separate so their shape can diverge later. */
export const ScriptAgentSubagentModelModeSchema =
  ShortAgentSubagentModelModeSchema;
export type ScriptAgentSubagentModelMode = ShortAgentSubagentModelMode;
export const ScriptAgentSubagentDefinitionSchema =
  ShortAgentSubagentDefinitionSchema;
export type ScriptAgentSubagentDefinition = ShortAgentSubagentDefinition;
export const ScriptAgentSubagentDefinitionsSchema = z
  .array(ScriptAgentSubagentDefinitionSchema)
  .max(SCRIPT_AGENT_SUBAGENT_MAX_COUNT)
  .superRefine(validateUniqueSubagents);
export const LongAgentSubagentDefinitionsSchema = z
  .array(ShortAgentSubagentDefinitionSchema)
  .max(LONG_AGENT_SUBAGENT_MAX_COUNT)
  .superRefine(validateUniqueSubagents);

export const AgentTeamSchema = z.object({
  parentAgentId: ShortWorkspaceAgentIdSchema,
  subagents: ShortAgentSubagentDefinitionsSchema
});
export type AgentTeam = z.infer<typeof AgentTeamSchema>;

function validateCompleteAgentTeams(
  teams: readonly { parentAgentId: ShortWorkspaceAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = teams.map((team) => team.parentAgentId);
  ids.forEach((id, index) => {
    if (ids.indexOf(id) !== index) {
      context.addIssue({
        code: "custom",
        path: ["teams", index, "parentAgentId"],
        message: `Duplicate parent agent team: ${id}`
      });
    }
  });
  for (const id of SHORT_WORKSPACE_AGENT_IDS) {
    if (!ids.includes(id)) {
      context.addIssue({
        code: "custom",
        path: ["teams"],
        message: `Missing parent agent team: ${id}`
      });
    }
  }
}

export const AgentTeamSettingsSchema = z
  .object({
    workspaceType: z.literal("short"),
    parallelSubagents: AgentTeamParallelSubagentsSchema,
    teams: z.array(AgentTeamSchema).length(SHORT_WORKSPACE_AGENT_IDS.length)
  })
  .superRefine((value, context) =>
    validateCompleteAgentTeams(value.teams, context)
  );
export type AgentTeamSettings = z.infer<typeof AgentTeamSettingsSchema>;

export const AgentTeamSettingsInputSchema = AgentTeamSettingsSchema;
export type AgentTeamSettingsInput = z.infer<
  typeof AgentTeamSettingsInputSchema
>;

export const DEFAULT_AGENT_TEAM_SETTINGS: AgentTeamSettings = {
  workspaceType: "short",
  parallelSubagents: false,
  teams: SHORT_WORKSPACE_AGENT_IDS.map((parentAgentId) => ({
    parentAgentId,
    subagents: []
  }))
};

export const ScriptAgentTeamSchema = z.object({
  parentAgentId: ScriptWorkspaceAgentIdSchema,
  subagents: ScriptAgentSubagentDefinitionsSchema
});
export type ScriptAgentTeam = z.infer<typeof ScriptAgentTeamSchema>;

function validateCompleteScriptAgentTeams(
  teams: readonly { parentAgentId: ScriptWorkspaceAgentId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = teams.map((team) => team.parentAgentId);
  ids.forEach((id, index) => {
    if (ids.indexOf(id) !== index) {
      context.addIssue({
        code: "custom",
        path: ["teams", index, "parentAgentId"],
        message: `Duplicate script parent agent team: ${id}`
      });
    }
  });
  for (const id of SCRIPT_WORKSPACE_AGENT_IDS) {
    if (!ids.includes(id)) {
      context.addIssue({
        code: "custom",
        path: ["teams"],
        message: `Missing script parent agent team: ${id}`
      });
    }
  }
}

export const ScriptAgentTeamSettingsSchema = z
  .object({
    workspaceType: z.literal("script"),
    parallelSubagents: AgentTeamParallelSubagentsSchema,
    teams: z
      .array(ScriptAgentTeamSchema)
      .length(SCRIPT_WORKSPACE_AGENT_IDS.length)
  })
  .superRefine((value, context) =>
    validateCompleteScriptAgentTeams(value.teams, context)
  );
export type ScriptAgentTeamSettings = z.infer<
  typeof ScriptAgentTeamSettingsSchema
>;

export const ScriptAgentTeamSettingsInputSchema = ScriptAgentTeamSettingsSchema;
export type ScriptAgentTeamSettingsInput = z.infer<
  typeof ScriptAgentTeamSettingsInputSchema
>;

export const WorkspaceAgentTeamSettingsSchema = z.discriminatedUnion(
  "workspaceType",
  [AgentTeamSettingsSchema, ScriptAgentTeamSettingsSchema]
);
export type WorkspaceAgentTeamSettings = z.infer<
  typeof WorkspaceAgentTeamSettingsSchema
>;

export const WorkspaceAgentTeamSettingsInputSchema = z.discriminatedUnion(
  "workspaceType",
  [AgentTeamSettingsInputSchema, ScriptAgentTeamSettingsInputSchema]
);
export type WorkspaceAgentTeamSettingsInput = z.infer<
  typeof WorkspaceAgentTeamSettingsInputSchema
>;

export const DEFAULT_SCRIPT_AGENT_TEAM_SETTINGS: ScriptAgentTeamSettings = {
  workspaceType: "script",
  parallelSubagents: false,
  teams: SCRIPT_WORKSPACE_AGENT_IDS.map((parentAgentId) => ({
    parentAgentId,
    subagents: []
  }))
};
