import { computed, shallowRef, watch, type ShallowRef } from "vue";
import type {
  DeepWriteApi,
  DecompositionRegistry,
  LongBookDecompositionJob
} from "@deepwrite/contracts/renderer";

const registryDone = (job: LongBookDecompositionJob | null) =>
  job?.units["registry:merge"]?.status === "done";

/**
 * The registry belongs to one task. Its ids (`c1`, `c2`, …) restart in every
 * book, so a registry that outlives its task would name another book's units.
 * Reading it yields nothing unless it was loaded for the open task.
 */
export function createDecompositionRegistryBinding(options: {
  api(): DeepWriteApi;
  job: ShallowRef<LongBookDecompositionJob | null>;
}) {
  const { api, job } = options;
  const owned = shallowRef<{
    jobId: string;
    registry: DecompositionRegistry;
  } | null>(null);
  let sequence = 0;
  const registry = computed<DecompositionRegistry | null>({
    get: () =>
      owned.value && owned.value.jobId === job.value?.id
        ? owned.value.registry
        : null,
    set: (value) => {
      sequence++;
      owned.value =
        value && job.value ? { jobId: job.value.id, registry: value } : null;
    }
  });
  /** Loads this task's registry, or drops it while the task has none. */
  async function sync(current: LongBookDecompositionJob) {
    const jobId = current.id;
    const request = ++sequence;
    if (!registryDone(current)) {
      if (owned.value?.jobId === jobId) owned.value = null;
      return;
    }
    const next = await api().longBookDecomposition.getRegistry(jobId);
    // Answers for another task, or older than the last request, are stale.
    if (request === sequence && job.value?.id === jobId)
      owned.value = { jobId, registry: next };
  }
  // Auto-continue goes from registry to integration inside one run, so the
  // registry must follow the task instead of waiting for the run to end.
  const stopWatching = watch(
    () => (registryDone(job.value) ? job.value!.id : null),
    (jobId) => {
      if (jobId && owned.value?.jobId !== jobId)
        void sync(job.value!).catch(() => undefined);
    }
  );
  return { registry, sync, dispose: stopWatching };
}
