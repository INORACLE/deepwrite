<script setup lang="ts">
import { computed } from "vue";
import type {
  SubagentAgentMode,
  SubagentWebSearchMode
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";
import AgentTeamSegmented from "./AgentTeamSegmented.vue";
import { SUBAGENT_WEB_SEARCH_LABELS } from "./agentTeamSettingsMeta";

const t = createScopedTranslator("components.subagentWebSearchField");

const WEB_SEARCH_MODES = [
  "inherit",
  "on",
  "off"
] as const satisfies readonly SubagentWebSearchMode[];

// A member saved before this setting existed follows the main agent.
const stored = defineModel<SubagentWebSearchMode | undefined>({
  required: true
});
const props = defineProps<{
  name: string;
  disabled: boolean;
  agentMode: SubagentAgentMode;
}>();

const mode = computed<SubagentWebSearchMode>({
  get: () => stored.value ?? "inherit",
  set: (value) => {
    stored.value = value;
  }
});
const bare = computed(() => props.agentMode === "pure-bare");

function modeOptions(): { value: SubagentWebSearchMode; label: string }[] {
  return WEB_SEARCH_MODES.map((value) => ({
    value,
    label: SUBAGENT_WEB_SEARCH_LABELS[value]
  }));
}

function modeHint(): string {
  if (bare.value) return t("bareHint");
  if (mode.value === "on") return t("onHint");
  if (mode.value === "off") return t("offHint");
  return t("inheritHint");
}
</script>

<template>
  <div class="web-search-field">
    <span class="web-search-field-label">{{ t("webSearch") }}</span>
    <AgentTeamSegmented
      v-model="mode"
      :options="modeOptions()"
      :name="name"
      :label="t('subagentWebSearch')"
      :disabled="disabled || bare"
    />
    <p class="web-search-hint">{{ modeHint() }}</p>
  </div>
</template>

<style scoped>
.web-search-field {
  display: grid;
  justify-items: start;
  gap: 6px;
}
.web-search-field-label {
  color: var(--text-secondary);
  font-size: 0.821429rem;
  font-weight: 620;
}
.web-search-hint {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  line-height: 1.5;
}
</style>
