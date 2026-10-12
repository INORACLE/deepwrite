<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, onBeforeUnmount, onMounted } from "vue";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.libraryRemovalDialog");

const props = withDefaults(
  defineProps<{
    open: boolean;
    action: "remove" | "delete";
    domain: "material" | "skill";
    label: string;
    isGroup?: boolean;
    submitting?: boolean;
  }>(),
  {
    submitting: false
  }
);

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const resourceName = computed(() => {
  if (props.isGroup) {
    return props.domain === "material" ? t("materialGroup") : t("skillGroup");
  }
  return props.domain === "material" ? t("materialLibrary") : t("skillLibrary");
});

const memberResourceName = computed(() =>
  props.domain === "material" ? t("materialLibrary") : t("skillLibrary")
);

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog book-resource-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-removal-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ label }}</span>
            <h2 id="library-removal-dialog-title">
              {{
                t("titleMessage", {
                  action: action === "delete" ? t("delete") : t("remove"),
                  resource: resourceName
                })
              }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="submitting"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form class="dialog-content" @submit.prevent="emit('confirm')">
          <div class="book-remove-warning">
            <AppIcon name="trash" :size="20" />
            <div>
              <strong>{{
                t("summaryMessage", {
                  arg0: (action === "delete" ? t("delete") : t("remove")) ?? "",
                  arg1: label ?? ""
                })
              }}</strong>
              <p v-if="action === 'delete' && isGroup">
                {{
                  t("deleteGroupAndMembersWarning", {
                    resource: memberResourceName
                  })
                }}
              </p>
              <p v-else-if="action === 'delete'">
                {{
                  t("thisRemovesTheItemFromAndPermanentlyMessage", {
                    arg0: resourceName ?? ""
                  })
                }}
              </p>
              <p v-else>
                {{
                  t("thisOnlyUnregistersTheItemFromItsMessage", {
                    arg0: resourceName ?? "",
                    arg1: resourceName ?? ""
                  })
                }}
              </p>
            </div>
          </div>

          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="submitting"
              @click="requestClose"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button is-danger"
              type="submit"
              :disabled="submitting"
            >
              {{
                submitting
                  ? t("processing")
                  : action === "delete"
                    ? t("deleteLabel")
                    : t("confirmRemoval")
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
