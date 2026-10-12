<script setup lang="ts">
import { ref } from "vue";
import { createScopedTranslator } from "../i18n";
import { uiMessage } from "../ui-feedback";
import {
  invalidSiteOfficialKeyLine,
  parseSiteOfficialKeyLines
} from "../composables/siteOfficialKeyBatch";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.siteOfficialModelsPanel");
const batchT = createScopedTranslator("workspace.siteOfficialQuotaMerge");
defineProps<{
  configured: boolean;
  enabledModelCount: number;
  busy: boolean;
  saving: boolean;
}>();
const emit = defineEmits<{ saveToken: [apiKey: string]; clearToken: [] }>();
const editorOpen = ref(false);
const tokenDraft = ref("");

function openEditor(): void {
  tokenDraft.value = "";
  editorOpen.value = true;
}

function closeEditor(): void {
  tokenDraft.value = "";
  editorOpen.value = false;
}

function submitToken(): void {
  const apiKey = tokenDraft.value;
  const keys = parseSiteOfficialKeyLines(apiKey);
  const invalidLine = invalidSiteOfficialKeyLine(keys, true);
  if (!keys.length || invalidLine !== undefined) {
    uiMessage.warning(
      invalidLine !== undefined
        ? batchT("invalidKeyLine", { line: invalidLine })
        : t("enterAnOfficialSiteModelKey")
    );
    return;
  }
  emit("saveToken", apiKey);
  closeEditor();
}
</script>

<template>
  <section class="site-token-card" :class="{ 'is-configured': configured }">
    <div class="site-token-status">
      <span class="site-token-icon">
        <AppIcon name="model" :size="20" />
      </span>
      <div>
        <strong>{{
          configured ? t("siteKeyAdded") : t("addYourSiteKey")
        }}</strong>
        <small>
          {{
            configured
              ? t("valueModelsEnabledTheKeyIsNeverReturnedTo", {
                  arg0: enabledModelCount
                })
              : t("relatedModelsJoinTheListAfterYouSaveA")
          }}
        </small>
      </div>
      <span class="site-token-badge">
        {{ configured ? t("configured") : t("notConfigured") }}
      </span>
    </div>
    <form
      v-if="editorOpen"
      class="site-token-form"
      @submit.prevent="submitToken"
    >
      <label>
        <span>{{ t("modelKey") }}</span>
        <textarea
          v-model="tokenDraft"
          rows="4"
          autocomplete="new-password"
          autocapitalize="off"
          :spellcheck="false"
          aria-describedby="site-token-description"
          :placeholder="t('enterOfficialSiteModelKey')"
          :disabled="busy"
        />
      </label>
      <small id="site-token-description">{{
        t("multipleKeysDescription")
      }}</small>
      <div class="site-token-form-actions">
        <button type="button" :disabled="busy" @click="closeEditor">
          {{ t("cancel") }}
        </button>
        <button class="is-primary" type="submit" :disabled="busy">
          {{ saving ? t("saving") : configured ? t("updateKey") : t("addKey") }}
        </button>
      </div>
    </form>
    <div v-else class="site-token-actions">
      <button
        class="is-primary"
        type="button"
        :disabled="busy"
        @click="openEditor"
      >
        <AppIcon name="plus" :size="15" />
        {{ configured ? t("replaceKey") : t("addKey") }}
      </button>
      <button
        v-if="configured"
        class="is-remove"
        type="button"
        :disabled="busy"
        @click="emit('clearToken')"
      >
        {{ t("removeKey") }}
      </button>
    </div>
  </section>
</template>

<style scoped src="./site-official-token-card.css"></style>
