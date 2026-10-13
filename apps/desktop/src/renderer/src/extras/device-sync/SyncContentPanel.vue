<script setup lang="ts">
import { createScopedTranslator } from "../../i18n";
import { computed } from "vue";
import type { SyncKind, SyncStatus } from "@deepwrite/contracts/renderer";
import SyncContentGroup from "./SyncContentGroup.vue";
import { conversationMessages, conversationRows } from "./presentation";
import type { ConversationScopeItem } from "./useSyncScope";

const t = createScopedTranslator("extras");

const props = defineProps<{
  status: SyncStatus;
  items: SyncStatus["items"];
  conversationItems: ConversationScopeItem[];
}>();
defineEmits<{
  toggle: [key: string, included: boolean];
  toggleMany: [keys: string[], included: boolean];
  toggleConversations: [keys: string[], included: boolean];
}>();
const conversations = computed(() => conversationRows(props.conversationItems));
const conversationStatus = computed(() => conversationMessages(props.status));
const categories: {
  id: string;
  title: string;
  kinds: SyncKind[];
  note?: string;
}[] = [
  {
    id: "workspace",
    get title() {
      return t("cloudBackup.workspace");
    },
    kinds: ["book", "long-book"]
  },
  {
    id: "skill",
    get title() {
      return t("cloudBackup.skillLibrary");
    },
    kinds: ["skill-library", "skill-group"]
  },
  {
    id: "material",
    get title() {
      return t("cloudBackup.materialLibrary");
    },
    kinds: ["material-library", "material-group"]
  },
  {
    id: "model",
    get title() {
      return t("deviceSync.modelConfig");
    },
    get note() {
      return t("deviceSync.modelConfigNote");
    },
    kinds: ["model-config"]
  }
];
const groups = computed(() =>
  categories.map((category) => ({
    id: category.id,
    title: category.title,
    note: category.note,
    items: props.items.filter((item) => category.kinds.includes(item.kind))
  }))
);
</script>

<template>
  <section class="sync-card sync-content-panel">
    <h2>{{ t("deviceSync.syncContents") }}</h2>
    <p>{{ t("deviceSync.scopeDescription") }}</p>
    <template v-for="group in groups" :key="group.id">
      <SyncContentGroup
        :title="group.title"
        :items="group.items"
        :note="group.note"
        @toggle="(key, included) => $emit('toggle', key, included)"
        @toggle-many="(keys, included) => $emit('toggleMany', keys, included)"
      />
      <SyncContentGroup
        v-if="group.id === 'workspace' && status.conversations"
        :title="t('deviceSync.conversations')"
        :items="conversations"
        :note="t('deviceSync.conversationsNote')"
        :messages="conversationStatus"
        @toggle="
          (key, included) => $emit('toggleConversations', [key], included)
        "
        @toggle-many="
          (keys, included) => $emit('toggleConversations', keys, included)
        "
      />
    </template>
  </section>
</template>
