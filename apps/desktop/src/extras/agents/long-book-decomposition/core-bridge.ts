import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type DecompositionControlInput
} from "@deepwrite/contracts";
import type { ExtrasAgentCommandContext } from "../index";
import {
  restoreDecompositionUsage,
  takeDecompositionUsage
} from "../../../main/decomposition-usage";

type CoreContext = Pick<
  ExtrasAgentCommandContext,
  "core" | "coreLong" | "getWorkspaceDirectory"
>;

export async function decompositionCore(
  context: CoreContext,
  command: CommandEnvelope,
  payload: Record<string, unknown>,
  type = "longBookDecomposition.coreAccess"
): Promise<CommandResult> {
  const workspaceDirectory = await context.getWorkspaceDirectory();
  if (!workspaceDirectory) throw new Error("请先在设置中选择工作目录。");
  const request = CommandEnvelopeSchema.parse(
    createEnvelope(
      type,
      { workspaceDirectory, ...payload },
      { id: `${command.id}-core`, context: command.context }
    )
  );
  // Whole-book writes and recovery can take minutes; stop/list retain a short wait.
  const longOperation =
    request.type === "longBookDecomposition.coreCreate" ||
    (request.type === "longBookDecomposition.coreAccess" &&
      (["get", "save-registry"].includes(request.payload.operation) ||
        (request.payload.operation === "control" &&
          ["resume", "advance"].includes(
            request.payload.control?.action ?? ""
          ))));
  const core =
    longOperation && context.coreLong ? context.coreLong : context.core;
  const result = await core(request);
  return { ...result, requestId: command.id };
}

/** Control calls carry the usage Main observed since the previous one. */
export async function controlWithUsage(
  context: CoreContext,
  command: CommandEnvelope,
  control: DecompositionControlInput
): Promise<CommandResult> {
  const usage = takeDecompositionUsage(control.jobId);
  try {
    const result = await decompositionCore(context, command, {
      operation: "control",
      jobId: control.jobId,
      control,
      ...(usage ? { usage } : {})
    });
    if (result.status !== "accepted" && usage)
      restoreDecompositionUsage(control.jobId, usage);
    return result;
  } catch (error) {
    if (usage) restoreDecompositionUsage(control.jobId, usage);
    throw error;
  }
}
