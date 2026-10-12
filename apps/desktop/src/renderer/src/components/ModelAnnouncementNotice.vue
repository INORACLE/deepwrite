<script setup lang="ts">
import { createScopedTranslator } from "../i18n";

const t = createScopedTranslator("components.modelSettingsFeature");

defineProps<{ messages: readonly string[] }>();
const emit = defineEmits<{ openOfficialModels: [] }>();
</script>

<template>
  <div
    v-if="messages.length"
    class="model-announcement-notice"
    :aria-label="t('modelAnnouncements')"
  >
    <button
      v-for="(message, index) in messages"
      :key="`${index}:${message}`"
      class="model-announcement-link"
      type="button"
      :title="t('officialSiteModels')"
      @click="emit('openOfficialModels')"
    >
      {{ message }}
    </button>
  </div>
</template>

<style scoped>
.model-announcement-notice {
  display: grid;
  gap: 5px;
  color: #2563eb;
  font-size: 0.928571rem;
  line-height: 1.6;
}

:global(html[data-theme="dark"] .model-announcement-notice) {
  color: #60a5fa;
}

.model-announcement-link {
  width: fit-content;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: pre-line;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.model-announcement-link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.model-announcement-link:focus-visible {
  border-radius: 3px;
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>
