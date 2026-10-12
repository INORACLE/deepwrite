<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ConversationRunClock from "../../components/ConversationRunClock.vue";
import { createScopedTranslator } from "../../i18n";
import type { TrackedSubagentPackage } from "../agent-runtime/subagentRunTracker";
import DecompositionSubtaskDialog from "./DecompositionSubtaskDialog.vue";
import DecompositionSubtaskTable from "./DecompositionSubtaskTable.vue";
import {
  buildSubtaskRows,
  subtaskCounts,
  subtaskParentState,
  type SubtaskFilter
} from "./subtask-board";
import type { LongBookDecompositionController } from "./useLongBookDecomposition";

const t = createScopedTranslator("extras.longBookDecomposition");
const FILTERS: readonly SubtaskFilter[] = [
  "all",
  "running",
  "queued",
  "unassigned",
  "finished"
];
const props = defineProps<{ controller: LongBookDecompositionController }>();
const emit = defineEmits<{ view: [unitId: string, title: string] }>();

const filter = ref<SubtaskFilter>("all");
const selected = ref<{ package: string; key: string } | null>(null);
const packages = computed(() => props.controller.subtasks.packages.value);
const latest = computed(() => packages.value[0]);
const earlier = computed(() => packages.value.slice(1));
const job = computed(() => props.controller.job.value);
const rows = computed(() =>
  latest.value ? buildSubtaskRows(latest.value) : []
);
const counts = computed(() => subtaskCounts(rows.value));
const delegated = computed(() => rows.value.filter(({ run }) => run).length);
const shown = computed(() =>
  filter.value === "all"
    ? rows.value
    : rows.value.filter((row) => row.group === filter.value)
);
const parentState = computed(() =>
  subtaskParentState(
    props.controller.subtasks.parent.value,
    props.controller.waitingForSlot.value,
    latest.value
  )
);
const parentTone = computed(() => {
  if (parentState.value === "ended")
    return latest.value?.outcome === "failed" ? "is-danger" : "is-neutral";
  if (parentState.value === "idle") return "is-neutral";
  return parentState.value === "retry" || parentState.value === "waitingForSlot"
    ? "is-warning"
    : "is-accent";
});
/** An ended package shows how it ended; only a running one is still planning. */
const emptyText = computed(() => {
  const pkg = latest.value;
  if (rows.value.length) return t("subtaskFilterEmpty");
  if (!pkg?.endedAt) return t("subtasksEmpty");
  return pkg.failureReason
    ? t("subtasksFailed", { reason: pkg.failureReason })
    : t("subtasksEndedEmpty");
});
const phaseLabel = (pkg: TrackedSubagentPackage) =>
  pkg.phase === "registry"
    ? t("registryPhase")
    : t(pkg.phase as "read" | "integrate" | "review");
/** Looked up by key each time, so the dialog follows the run as it streams. */
const opened = computed(() => {
  const target = selected.value;
  const pkg = packages.value.find(({ id }) => id === target?.package);
  const row = pkg
    ? buildSubtaskRows(pkg).find(({ key }) => key === target?.key)
    : undefined;
  return row?.run ? { run: row.run, unitIds: row.unitIds } : undefined;
});
function elapsed(pkg: TrackedSubagentPackage, now: number): string {
  const seconds = Math.max(
    0,
    Math.round(
      ((pkg.endedAt ? Date.parse(pkg.endedAt) : now) -
        Date.parse(pkg.startedAt)) /
        1_000
    )
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
const outcomeText = (pkg: TrackedSubagentPackage) =>
  t(
    pkg.outcome === "failed"
      ? "failed"
      : pkg.outcome === "stopped"
        ? "stopped"
        : "completedStatus"
  );
watch(
  () => job.value?.id,
  () => {
    selected.value = null;
    filter.value = "all";
  }
);
</script>

<template>
  <section v-if="latest && job" class="decomposition-subtasks">
    <header class="decomposition-subtasks-heading">
      <h3>{{ t("subtasks") }}</h3>
      <ConversationRunClock v-slot="{ now }" :active="!latest.endedAt">
        <span class="decomposition-subtasks-meta">
          {{
            t("subtaskPackageMeta", {
              phase: phaseLabel(latest),
              count: latest.unitIds.length
            })
          }}
          · {{ elapsed(latest, now) }}
        </span>
      </ConversationRunClock>
    </header>
    <div class="decomposition-subtask-lead">
      <span class="decomposition-pill" :class="parentTone">{{
        t(`subtaskParent_${parentState}`)
      }}</span>
      <strong>{{ t("subtaskLead") }}</strong>
      <span>{{ t("subtaskLeadHint", { count: delegated }) }}</span>
    </div>
    <div v-if="rows.length" class="decomposition-segmented" role="group">
      <button
        v-for="item in FILTERS"
        :key="item"
        type="button"
        :aria-pressed="filter === item"
        @click="filter = item"
      >
        {{ t(`subtaskFilter_${item}`, { count: counts[item] }) }}
      </button>
    </div>
    <DecompositionSubtaskTable
      v-if="shown.length"
      :rows="shown"
      :job="job"
      :registry="controller.registry.value"
      @open="selected = { package: latest.id, key: $event }"
    />
    <p v-else class="decomposition-subtasks-empty">
      {{ emptyText }}
    </p>
    <details
      v-for="pkg in earlier"
      :key="pkg.id"
      class="decomposition-subtasks-earlier"
    >
      <summary>
        {{
          t("subtaskEarlierSummary", {
            phase: phaseLabel(pkg),
            count: pkg.message.subagentRuns?.length ?? 0,
            outcome: outcomeText(pkg),
            time: elapsed(pkg, 0)
          })
        }}
      </summary>
      <DecompositionSubtaskTable
        :rows="buildSubtaskRows(pkg)"
        :job="job"
        :registry="controller.registry.value"
        @open="selected = { package: pkg.id, key: $event }"
      />
    </details>
  </section>
  <DecompositionSubtaskDialog
    v-if="opened && job"
    :run="opened.run"
    :unit-ids="opened.unitIds"
    :job="job"
    :registry="controller.registry.value"
    @close="selected = null"
    @view="
      (unitId, title) => {
        selected = null;
        emit('view', unitId, title);
      }
    "
  />
</template>
