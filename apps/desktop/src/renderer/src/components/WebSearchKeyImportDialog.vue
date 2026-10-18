<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import type { WebSearchKeyImportCandidate } from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";

const t = createScopedTranslator("components.webSearchSettings");

const props = defineProps<{
  request: {
    candidates: WebSearchKeyImportCandidate[];
    hasCurrentKey: boolean;
  } | null;
  providerLabel: string;
  busy: boolean;
}>();
const emit = defineEmits<{ close: []; confirm: [sourceModelId: string] }>();

const selectedId = ref("");
const list = ref<HTMLElement | null>(null);
const open = computed(() => props.request !== null);
const selected = computed(() =>
  props.request?.candidates.find(
    (candidate) => candidate.sourceModelId === selectedId.value
  )
);

function keyLabel(candidate: WebSearchKeyImportCandidate): string {
  return candidate.keyHint
    ? t("keyLabel", { hint: candidate.keyHint })
    : t("keyLabelHidden");
}

function usedBy(candidate: WebSearchKeyImportCandidate): string {
  return t("usedBy", {
    models: candidate.models
      .map((model) => model.label)
      .join(t("modelSeparator"))
  });
}

function requestClose(): void {
  if (!props.busy) emit("close");
}

function submit(): void {
  const candidate = selected.value;
  if (!candidate || candidate.matchesCurrentKey || props.busy) return;
  emit("confirm", candidate.sourceModelId);
}

function handleKeydown(event: KeyboardEvent): void {
  if (open.value && event.key === "Escape") requestClose();
}

watch(
  () => props.request,
  (request) => {
    if (!request) return;
    // The key already in use first, otherwise the first one on offer.
    selectedId.value =
      (
        request.candidates.find((candidate) => candidate.matchesCurrentKey) ??
        request.candidates[0]
      )?.sourceModelId ?? "";
    void nextTick(() =>
      list.value?.querySelector<HTMLInputElement>("input:checked")?.focus()
    );
  },
  { immediate: true }
);

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="request" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog web-search-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-search-import-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ t("dialogEyebrow") }}</span>
            <h2 id="web-search-import-title">
              {{ t("dialogTitle", { provider: providerLabel }) }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="busy"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form class="dialog-content" @submit.prevent="submit">
          <p class="dialog-description">
            {{ t("dialogDescription", { provider: providerLabel }) }}
          </p>
          <div ref="list" class="web-search-import-options" role="radiogroup">
            <label
              v-for="candidate in request.candidates"
              :key="candidate.sourceModelId"
              class="web-search-import-option"
              :class="{ 'is-selected': candidate.sourceModelId === selectedId }"
            >
              <input
                v-model="selectedId"
                type="radio"
                name="web-search-import-key"
                :value="candidate.sourceModelId"
                :disabled="busy"
              />
              <span class="web-search-import-text">
                <strong>{{ keyLabel(candidate) }}</strong>
                <small>{{ usedBy(candidate) }}</small>
              </span>
              <em v-if="candidate.matchesCurrentKey">{{ t("inUse") }}</em>
            </label>
          </div>
          <p v-if="request.hasCurrentKey" class="dialog-note">
            {{ t("replaceNotice") }}
          </p>
          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="busy"
              @click="requestClose"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button"
              type="submit"
              :disabled="busy || !selected || selected.matchesCurrentKey"
            >
              {{ t("import") }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./web-search-settings.css"></style>
