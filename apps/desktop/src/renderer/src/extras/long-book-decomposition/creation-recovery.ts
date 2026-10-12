import type { ShallowRef } from "vue";
import {
  DecompositionCommandRecoverySchema,
  type DeepWriteApi,
  type LongBookDecompositionJob,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import { getErrorPayload } from "../../i18n/errors";

/** A lost creation reply must not hide the durable task or create another target. */
export function createDecompositionCreationRecovery(options: {
  api(): DeepWriteApi;
  job: ShallowRef<LongBookDecompositionJob | null>;
  jobs: ShallowRef<LongBookDecompositionJob[]>;
  isDisposed(): boolean;
}) {
  let pendingJobId: string | undefined;
  let refreshSequence = 0;
  function adopt(jobs: LongBookDecompositionJob[]) {
    refreshSequence++;
    if (options.isDisposed()) return;
    options.jobs.value = jobs;
    if (!pendingJobId) return;
    // Respect a task the user selected while the original creation was pending.
    if (options.job.value && options.job.value.id !== pendingJobId) {
      pendingJobId = undefined;
      return;
    }
    const saved = jobs.find(({ id }) => id === pendingJobId);
    if (saved) {
      options.job.value = saved;
      if (saved.phase !== "prepare_target") pendingJobId = undefined;
    }
  }
  async function refresh() {
    // Listing does not wait behind this task's still-running creation command.
    const sequence = ++refreshSequence;
    const jobs = await options.api().longBookDecomposition.listJobs();
    if (sequence === refreshSequence) adopt(jobs);
  }
  return {
    adopt,
    async recover(cause: unknown) {
      if (options.isDisposed()) return;
      const recovery = DecompositionCommandRecoverySchema.safeParse(
        getErrorPayload(cause)?.details
      );
      pendingJobId = recovery.success ? recovery.data.jobId : undefined;
      await refresh();
    },
    handleEvent(event: SystemEventEnvelope) {
      if (
        !options.isDisposed() &&
        pendingJobId &&
        event.type === "decomposition.target_updated" &&
        event.payload.jobId === pendingJobId
      )
        void refresh().catch(() => undefined);
    }
  };
}
