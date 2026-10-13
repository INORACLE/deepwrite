<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import type { ConversationSyncRemote } from "@deepwrite/contracts";

const t = createScopedTranslator("components.conversationRemoteDetails");

const props = defineProps<{ remote: ConversationSyncRemote }>();
type Proposal = NonNullable<ConversationSyncRemote["proposals"]>[number];
type Subagent = NonNullable<ConversationSyncRemote["subagents"]>[number];

const proposals = computed(() => props.remote.proposals ?? []);
const subagents = computed(() => props.remote.subagents ?? []);
const proposalStatus = {
  accepted: "proposalAccepted",
  rejected: "proposalRejected",
  conflict: "proposalConflict",
  error: "proposalError",
  discarded: "proposalDiscarded"
} as const satisfies Record<Exclude<Proposal["status"], "pending">, string>;
const subagentStatus = {
  completed: "subagentCompleted",
  error: "subagentError",
  stopped: "subagentStopped",
  skipped: "subagentSkipped"
} as const satisfies Record<Subagent["status"], string>;
function proposalLabel(proposal: Proposal): string {
  // A proposal is reviewed only on the device that made it.
  return proposal.status === "pending"
    ? t("proposalPending", { device: props.remote.device })
    : t(proposalStatus[proposal.status]);
}
</script>

<template>
  <section
    v-if="proposals.length || subagents.length"
    class="remote-details"
    :aria-label="t('syncedDetails')"
  >
    <ul v-if="proposals.length" :aria-label="t('proposals')">
      <li v-for="proposal in proposals" :key="proposal.id">
        <span class="remote-details-title">{{
          proposal.title || proposal.summary
        }}</span>
        <small>
          {{ proposalLabel(proposal) }} ·
          {{
            t("changes", {
              additions: proposal.additions,
              deletions: proposal.deletions
            })
          }}
        </small>
      </li>
    </ul>
    <ul v-if="subagents.length" :aria-label="t('subagents')">
      <li v-for="subagent in subagents" :key="subagent.id">
        <span class="remote-details-title">{{ subagent.name }}</span>
        <small>
          {{ t(subagentStatus[subagent.status]) }}
          <template v-if="subagent.summary"> · {{ subagent.summary }}</template>
        </small>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.remote-details {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-muted);
}
.remote-details ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.remote-details li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.remote-details-title {
  color: var(--text-primary);
}
.remote-details small {
  color: var(--text-secondary);
}
</style>
