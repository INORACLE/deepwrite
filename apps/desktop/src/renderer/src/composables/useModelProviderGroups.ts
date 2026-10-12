import { createScopedTranslator } from "../i18n";
import { computed, ref, type Ref } from "vue";
import { MODEL_PROVIDER_OPTIONS } from "../components/modelProviderPresets";
import type { ModelConfigRow } from "../components/modelSettingsDraft";

const t = createScopedTranslator("workspace.modelProviderGroups");

export function useModelProviderGroups(rows: Ref<ModelConfigRow[]>) {
  const expandedProviders = ref(new Set<string>());
  const modelProviderGroups = computed(() => {
    const groups = new Map<
      string,
      { key: string; label: string; count: number; rows: ModelConfigRow[] }
    >();
    let currentModelId: string | undefined;
    let currentGroup: ReturnType<typeof groups.get>;
    for (const row of rows.value) {
      if (row.type === "model") {
        const model = row.model;
        currentModelId = model.id;
        const key = `${model.managedBy ?? "custom"}:${model.provider}`;
        currentGroup = groups.get(key);
        if (!currentGroup) {
          const label =
            model.managedBy === "deepwrite-free"
              ? t("deepwriteFreeModels")
              : (MODEL_PROVIDER_OPTIONS.find(
                  (option) => option.value === model.provider
                )?.label ?? model.provider);
          currentGroup = { key, label, count: 0, rows: [] };
          groups.set(key, currentGroup);
        }
        currentGroup.count++;
        currentGroup.rows.push(row);
      } else if (currentGroup && row.key === `editor:${currentModelId}`) {
        currentGroup.rows.push(row);
      }
    }
    return [...groups.values()];
  });
  function toggleProvider(key: string): void {
    if (expandedProviders.value.has(key)) expandedProviders.value.delete(key);
    else expandedProviders.value.add(key);
  }
  return { modelProviderGroups, expandedProviders, toggleProvider };
}
