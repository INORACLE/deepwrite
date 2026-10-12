import { createScopedTranslator } from "../i18n";
import { computed, ref } from "vue";
import type { DeepWriteApi } from "@deepwrite/contracts";
import { isDeepWriteSiteOfficialModel } from "@deepwrite/contracts/renderer";
import type { useSettingsStore } from "../stores/settingsStore";
import { beginSiteOfficialQuotaRequest } from "./siteOfficialQuotaRequests";
import {
  invalidSiteOfficialKeyLine,
  mergeSiteOfficialKeyBatch,
  notifySiteOfficialKeyBatch,
  parseSiteOfficialKeyLines,
  type SiteOfficialBatchNotifications
} from "./siteOfficialKeyBatch";

const t = createScopedTranslator("workspace.siteOfficialQuotaMerge");

interface QuotaMergeContext {
  api(): DeepWriteApi | undefined;
  settingsStore: ReturnType<typeof useSettingsStore>;
  notifications: SiteOfficialBatchNotifications;
}

export function useSiteOfficialQuotaMerge(context: QuotaMergeContext) {
  const { settingsStore: store, notifications } = context;
  const open = ref(false);
  const sourceKey = ref("");
  const pending = ref(false);
  let targetRevision = "";
  const disabledReason = computed(() => {
    if (store.siteOfficialModelsSaving || store.siteOfficialModelsRefreshing) {
      return t("waitForTheCurrentOperationToFinish");
    }
    if (
      !store.modelSettings?.models.some(
        (model) => isDeepWriteSiteOfficialModel(model) && model.hasApiKey
      )
    ) {
      return t("addTheCurrentKeyFirst");
    }
    if (store.siteOfficialQuota?.unlimited)
      return t("unlimitedKeysDoNotNeedAdditionalQuota");
    if (!store.siteOfficialQuota?.targetRevision)
      return t("refreshTheCurrentKeySQuotaFirst");
    return "";
  });

  function show(): void {
    if (disabledReason.value || pending.value) return;
    targetRevision = store.siteOfficialQuota!.targetRevision!;
    sourceKey.value = "";
    open.value = true;
  }

  function close(): void {
    if (pending.value) return;
    sourceKey.value = "";
    targetRevision = "";
    open.value = false;
  }

  async function submit(): Promise<void> {
    if (pending.value || !open.value) return;
    const sources = parseSiteOfficialKeyLines(sourceKey.value);
    const invalidLine = invalidSiteOfficialKeyLine(sources);
    if (!sources.length || invalidLine !== undefined) {
      notifications.warning(
        invalidLine !== undefined
          ? t("invalidKeyLine", { line: invalidLine })
          : t("enterAValidSourceKey")
      );
      return;
    }
    if (
      disabledReason.value ||
      store.siteOfficialQuota?.targetRevision !== targetRevision
    ) {
      notifications.warning(
        disabledReason.value ||
          t("theCurrentKeyConfigurationChangedRefreshTheQuotaAnd")
      );
      close();
      return;
    }
    const api = context.api();
    if (!api) {
      notifications.error(
        t("theDesktopServiceIsTemporarilyUnavailablePleaseTryAgain")
      );
      return;
    }
    pending.value = true;
    store.siteOfficialModelsSaving = true;
    const current = beginSiteOfficialQuotaRequest(store);
    try {
      const result = await mergeSiteOfficialKeyBatch({
        models: api.models,
        sources,
        quota: store.siteOfficialQuota,
        current,
        applyQuota: (quota) => {
          store.siteOfficialQuota = quota;
        }
      });
      notifySiteOfficialKeyBatch(result, notifications, sources.length > 1);
      if (!result.failed.length) {
        open.value = false;
        targetRevision = "";
      }
      if (!result.succeeded.length) return;
      try {
        const quota = await api.models.querySiteOfficialQuota();
        if (current()) store.siteOfficialQuota = quota;
      } catch {
        // The merge result already contains the authoritative post-merge quota.
        notifications.warning(
          t("quotaTransferredUsageHasNotRefreshedYetRefreshThe")
        );
      }
    } finally {
      sourceKey.value = "";
      pending.value = false;
      store.siteOfficialModelsSaving = false;
    }
  }

  return { open, sourceKey, pending, disabledReason, show, close, submit };
}
