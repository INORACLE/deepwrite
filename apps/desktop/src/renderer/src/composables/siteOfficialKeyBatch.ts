import type {
  DeepWriteApi,
  SiteOfficialQuota,
  SiteOfficialQuotaMergeResult
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import { getErrorCode, getErrorDetail } from "../i18n/errors";
import type { UiMessageOptions } from "../ui-feedback";

const t = createScopedTranslator("workspace.siteOfficialQuotaMerge");

export interface SiteOfficialKeyLine {
  key: string;
  line: number;
}

export interface SiteOfficialBatchNotifications {
  warning(message: string, options?: UiMessageOptions): void;
  error(message: string, options?: UiMessageOptions): void;
  success(message: string, options?: UiMessageOptions): void;
}

interface BatchResult {
  succeeded: { line: number; transferred: string }[];
  failed: { line: number; message: string }[];
}

export function parseSiteOfficialKeyLines(raw: string): SiteOfficialKeyLine[] {
  return raw.split(/\r\n?|\n/u).flatMap((value, index) => {
    const key = value.trim();
    return key ? [{ key, line: index + 1 }] : [];
  });
}

export function invalidSiteOfficialKeyLine(
  keys: SiteOfficialKeyLine[],
  saving = false
): number | undefined {
  return keys.find(
    ({ key }, index) =>
      key.length > (saving && keys.length === 1 && index === 0 ? 16_000 : 1_024)
  )?.line;
}

export async function mergeSiteOfficialKeyBatch(context: {
  models: DeepWriteApi["models"];
  sources: SiteOfficialKeyLine[];
  quota: SiteOfficialQuota | null;
  target?: SiteOfficialKeyLine;
  current(): boolean;
  applyQuota(quota: SiteOfficialQuota): void;
}): Promise<BatchResult> {
  const { models, sources, quota, target } = context;
  const result: BatchResult = { succeeded: [], failed: [] };
  const seen = new Map(target ? [[target.key, target.line]] : []);
  let stopped = quota?.unlimited
    ? t("unlimitedKeysDoNotNeedAdditionalQuota")
    : quota?.targetRevision
      ? ""
      : t("refreshTheCurrentKeySQuotaFirst");

  for (const source of sources) {
    if (!stopped && !context.current()) {
      stopped = t("theCurrentKeyConfigurationChangedRefreshTheQuotaAnd");
    }
    if (stopped) {
      result.failed.push({
        line: source.line,
        message: t("keyNotTransferred", { reason: stopped })
      });
      continue;
    }
    const duplicate = seen.get(source.key);
    if (duplicate !== undefined) {
      result.failed.push({
        line: source.line,
        message: t("duplicateKeyLine", { line: duplicate })
      });
      continue;
    }
    seen.set(source.key, source.line);
    try {
      const merged: SiteOfficialQuotaMergeResult =
        await models.mergeSiteOfficialQuota({
          sourceKey: source.key,
          targetRevision: quota!.targetRevision!
        });
      if (context.current()) context.applyQuota(merged.quota);
      result.succeeded.push({
        line: source.line,
        transferred: merged.transferred
      });
    } catch (error: unknown) {
      let message =
        getErrorDetail(error) ??
        t("quotaTransferFailedRefreshTheQuotaToCheckThe");
      // Keep even unexpected transport diagnostics from echoing pasted keys.
      for (const { key } of target ? [target, ...sources] : sources) {
        message = message.replaceAll(key, "***");
      }
      result.failed.push({ line: source.line, message });
      if (
        ["invalid_api_key", "target_changed", "models_busy"].includes(
          getErrorCode(error) ?? ""
        )
      ) {
        stopped = message;
      }
    }
  }
  return result;
}

export function notifySiteOfficialKeyBatch(
  result: BatchResult,
  notifications: SiteOfficialBatchNotifications,
  includeLineNumbers = true
): void {
  const { succeeded, failed } = result;
  if (failed.length) {
    const details = failed
      .map(({ line, message }) =>
        includeLineNumbers
          ? t("failedKeyLine", { line, reason: message })
          : message
      )
      .join("；");
    const message = t("batchTransferResult", {
      succeeded: succeeded.length,
      failed: failed.length,
      details
    });
    const options = {
      duration: Math.min(60_000, Math.max(15_000, failed.length * 4_000))
    };
    if (succeeded.length) notifications.warning(message, options);
    else notifications.error(includeLineNumbers ? message : details, options);
    return;
  }
  if (succeeded.length === 1) {
    notifications.success(
      t("transferredTheSourceKeyHasBeenPermanentlyDeactivated", {
        transferred: succeeded[0]!.transferred
      })
    );
  } else if (succeeded.length) {
    notifications.success(
      t("allSourceKeysTransferred", { count: succeeded.length })
    );
  }
}
