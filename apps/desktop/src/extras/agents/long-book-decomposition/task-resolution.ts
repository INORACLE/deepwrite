import { randomUUID } from "node:crypto";
import {
  ExtrasAgentResolvedTaskSchema,
  LongBookDecompositionJobSchema,
  DecompositionResolvedInputSchema,
  type CommandEnvelope,
  type ExtrasAgentTask
} from "@deepwrite/contracts";
import type { ExtrasAgentCommandContext } from "../index";
import { decompositionCore } from "./core-bridge";

export async function resolveDecompositionTask(
  context: ExtrasAgentCommandContext,
  command: CommandEnvelope,
  task: Extract<ExtrasAgentTask, { agentId: "long-book-decomposition" }>
) {
  const attemptId = `ldattempt_${randomUUID().replaceAll("-", "")}`;
  const result = await decompositionCore(context, command, {
    operation: "open",
    jobId: task.input.jobId,
    task: task.input,
    profileId: task.profileId,
    attemptId
  });
  if (result.status !== "accepted") throw new Error(result.error.message);
  const raw = result.payload as { job: unknown; input: unknown };
  const job = LongBookDecompositionJobSchema.parse(raw.job);
  const input = DecompositionResolvedInputSchema.parse(raw.input);
  return {
    task: ExtrasAgentResolvedTaskSchema.parse({
      agentId: task.agentId,
      profile: job.profile,
      input
    }),
    decompositionJobId: job.id,
    decompositionOutputVersion: job.outputVersion,
    decompositionAttemptId: attemptId,
    decompositionUnitIds: Object.keys(input.units),
    decompositionPhase: input.phase
  };
}
