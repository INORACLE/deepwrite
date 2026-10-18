<script setup lang="ts">
import { createScopedTranslator } from "../../i18n";
import { ref } from "vue";
import type { ThinkingLevel } from "@deepwrite/contracts/renderer";
import ContextCompactionButton from "../../components/ContextCompactionButton.vue";
import VoiceInputBar from "../../components/VoiceInputBar.vue";
import { useVoiceInput } from "../../composables/useVoiceInput";
import { useSettingsStore } from "../../stores/settingsStore";
import AppIcon from "../../components/AppIcon.vue";
import PopupSelect, {
  type PopupSelectOption,
  type PopupSelectValue
} from "../../components/PopupSelect.vue";

const t = createScopedTranslator("extras");

const settingsStore = useSettingsStore();

const props = defineProps<{
  sessionId?: string;
  hasHistory?: boolean;
  draft: string;
  runtimeAvailable: boolean;
  busy: boolean;
  canSend: boolean;
  canStop: boolean;
  selectedModelId: string;
  modelOptions: PopupSelectOption[];
  thinkingLevel: ThinkingLevel;
  thinkingOptions: PopupSelectOption[];
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  send: [];
  stop: [];
  selectModel: [modelId: string];
  selectThinking: [level: ThinkingLevel];
}>();

const input = ref<HTMLTextAreaElement | null>(null);
const voice = useVoiceInput({
  sessionKey: () => props.sessionId ?? "",
  draft: () => props.draft,
  input,
  updateDraft: (value) => emit("update:draft", value),
  canStart: () => props.runtimeAvailable && !props.busy,
  canSend: () => props.canSend && props.runtimeAvailable && !props.busy,
  send: () => emit("send")
});

function focus(): void {
  input.value?.focus();
}

function handleInput(event: Event): void {
  emit("update:draft", (event.target as HTMLTextAreaElement).value);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (props.canSend && !voice.active.value) emit("send");
}

function handleThinking(value: PopupSelectValue): void {
  emit("selectThinking", value as ThinkingLevel);
}

defineExpose({ focus });
</script>

<template>
  <footer class="chat-assistant-composer">
    <textarea
      ref="input"
      :value="draft"
      :placeholder="
        runtimeAvailable
          ? t('chatAssistant.messageAssistant')
          : t('chatAssistant.desktopRequiredToSend')
      "
      :disabled="!runtimeAvailable || busy || voice.active.value"
      rows="1"
      @input="handleInput"
      @keydown="handleKeydown"
    />
    <VoiceInputBar
      v-if="voice.active.value"
      :state="voice.state.value"
      :elapsed-ms="voice.elapsedMs.value"
      :levels="voice.levels.value"
      :send-disabled="busy || !runtimeAvailable"
      @cancel="voice.cancel"
      @stop="voice.stop"
      @send="voice.stopAndSend"
      @retry="voice.retry"
    />
    <div v-else class="chat-assistant-toolbar">
      <button
        class="chat-assistant-placeholder-action"
        type="button"
        disabled
        :title="t('chatAssistant.attachmentsComingSoon')"
        :aria-label="t('chatAssistant.attachmentsComingSoon')"
      >
        <AppIcon name="plus" :size="19" />
      </button>
      <ContextCompactionButton
        v-if="
          settingsStore.generalSettings.contextCompaction.showManualButton &&
          sessionId &&
          hasHistory
        "
        :session-id="sessionId"
        :disabled="busy || !runtimeAvailable"
      />
      <span class="chat-assistant-toolbar-spacer" />
      <PopupSelect
        :model-value="selectedModelId"
        :options="modelOptions"
        :accessible-label="t('chatAssistant.chatModel')"
        :placeholder="t('chatAssistant.defaultModel')"
        variant="compact"
        size="small"
        align="end"
        :disabled="modelOptions.length === 0"
        :menu-min-width="220"
        :menu-z-index="95"
        @update:model-value="emit('selectModel', String($event))"
      />
      <PopupSelect
        :model-value="thinkingLevel"
        :options="thinkingOptions"
        :accessible-label="t('longBookAnalysis.thinkingLevel')"
        variant="compact"
        size="small"
        align="end"
        :menu-z-index="95"
        @update:model-value="handleThinking"
      />
      <button
        class="chat-assistant-placeholder-action"
        type="button"
        :disabled="!runtimeAvailable || busy"
        :title="t('chatAssistant.voiceInput')"
        :aria-label="t('chatAssistant.voiceInput')"
        @click="voice.start"
      >
        <AppIcon name="mic" :size="18" />
      </button>
      <button
        v-if="canStop"
        class="chat-assistant-send is-stop"
        type="button"
        :aria-label="t('chatAssistant.stopGeneration')"
        @click="emit('stop')"
      >
        <AppIcon name="stop" :size="15" />
      </button>
      <button
        v-else
        class="chat-assistant-send"
        type="button"
        :aria-label="t('chatAssistant.sendMessage')"
        :disabled="!canSend"
        @click="emit('send')"
      >
        <AppIcon name="arrow-up" :size="19" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.chat-assistant-composer {
  container-type: inline-size;
  position: relative;
  margin: 0 12px 12px;
  padding: 10px 12px 8px;
  background: var(--surface-raised);
  border: 1px solid var(--theme-line);
  border-radius: 22px;
  box-shadow: 0 8px 24px color-mix(in srgb, #000 7%, transparent);
}
.chat-assistant-composer textarea {
  display: block;
  width: 100%;
  min-height: 42px;
  max-height: 150px;
  resize: none;
  padding: 8px 10px;
  color: var(--text-primary);
  font: inherit;
  line-height: 1.5;
  background: transparent;
  border: 0;
  outline: 0;
}
.chat-assistant-composer textarea::placeholder {
  color: var(--text-tertiary);
}
.chat-assistant-toolbar {
  display: flex;
  align-items: center;
  gap: 7px;
}
.chat-assistant-toolbar-spacer {
  flex: 1;
}
.chat-assistant-placeholder-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 10px;
  gap: 5px;
  color: var(--text-secondary);
  background: transparent;
  border: 0;
  border-radius: 10px;
  font: inherit;
  white-space: nowrap;
}
.chat-assistant-placeholder-action {
  width: 34px;
  padding: 0;
}
.chat-assistant-placeholder-action:disabled {
  opacity: 0.42;
}
.chat-assistant-send {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  padding: 0;
  color: var(--surface-main);
  background: var(--text-primary);
  border: 0;
  border-radius: 50%;
}
.chat-assistant-send:disabled {
  opacity: 0.35;
}
.chat-assistant-send.is-stop {
  color: var(--text-primary);
  background: var(--surface-selected);
}
</style>
