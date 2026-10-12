<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const t = createScopedTranslator("components.siteOfficialQuotaMergeDialog");

const props = defineProps<{
  pending: boolean;
  returnFocus?: HTMLElement | null;
}>();
const sourceKey = defineModel<string>("sourceKey", { required: true });
const emit = defineEmits<{ close: []; submit: [] }>();
const form = ref<HTMLFormElement | null>(null);
const input = ref<HTMLTextAreaElement | null>(null);
let previousFocus: HTMLElement | null = null;

function close(): void {
  if (!props.pending) emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
  if (event.key === "Tab") {
    const elements = Array.from(
      form.value?.querySelectorAll<HTMLElement>(
        "textarea:not(:disabled), button:not(:disabled)"
      ) ?? []
    );
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) {
      event.preventDefault();
      form.value?.focus();
      return;
    }
    if (!form.value?.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

watch(
  () => props.pending,
  async (pending) => {
    await nextTick();
    if (pending) form.value?.focus();
    else input.value?.focus();
  }
);

onMounted(() => {
  document.addEventListener("keydown", onKeydown, true);
  previousFocus =
    props.returnFocus ??
    (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
  input.value?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown, true);
  sourceKey.value = "";
  // The trigger is disabled while this dialog is open. Restore focus only
  // after the parent's closing render has enabled it again.
  void nextTick(() => previousFocus?.focus());
});
</script>

<template>
  <Teleport to="body">
    <div
      class="dialog-backdrop site-quota-merge-backdrop"
      @mousedown.self="close"
    >
      <form
        ref="form"
        tabindex="-1"
        class="workspace-dialog site-quota-merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-quota-merge-title"
        aria-describedby="site-quota-merge-description"
        :aria-busy="pending"
        @submit.prevent="emit('submit')"
      >
        <header>
          <h2 id="site-quota-merge-title">
            {{ t("addQuota") }}
          </h2>
          <button
            type="button"
            class="dialog-close"
            :aria-label="t('close')"
            :disabled="pending"
            @click="close"
          >
            ×
          </button>
        </header>
        <div class="dialog-content">
          <p id="site-quota-merge-description">
            {{ t("allUnusedQuotaFromTheSourceKeyTransfersTo") }}
          </p>
          <label for="site-quota-source-key">{{ t("sourceKey") }}</label>
          <textarea
            id="site-quota-source-key"
            ref="input"
            v-model="sourceKey"
            rows="4"
            autocomplete="new-password"
            autocapitalize="off"
            :spellcheck="false"
            :placeholder="t('enterTheKeyProvidingTheQuota')"
            :disabled="pending"
          />
          <small>{{ t("theSourceKeyIsUsedOnlyForThisTransfer") }}</small>
        </div>
        <footer>
          <button type="button" :disabled="pending" @click="close">
            {{ t("cancel") }}
          </button>
          <button class="is-danger" type="submit" :disabled="pending">
            {{
              pending ? t("transferring") : t("transferQuotaAndRevokeSourceKey")
            }}
          </button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.site-quota-merge-backdrop {
  z-index: 1200;
  padding: 16px;
}
.site-quota-merge-dialog {
  width: min(480px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  border: 1px solid var(--theme-line);
  background: var(--surface-main);
  color: var(--text-primary);
  font-size: 1rem;
}
h2 {
  font-size: 1.2rem;
}
.dialog-content {
  display: grid;
  gap: 12px;
}
p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
}
label {
  color: var(--text-primary);
}
small {
  color: var(--text-tertiary);
  line-height: 1.6;
}
.site-quota-merge-dialog textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 110px;
  padding: 10px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  line-height: 1.6;
  resize: vertical;
}
.site-quota-merge-dialog textarea:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
footer {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 20px;
}
footer button {
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
footer .is-danger {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--on-danger, white);
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
