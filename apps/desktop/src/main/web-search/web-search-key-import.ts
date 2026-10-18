import {
  matchesWebSearchKeyImport,
  webSearchProvider,
  type WebSearchImportKeyInput,
  type WebSearchKeyImportCandidate,
  type WebSearchKeyImportCandidates,
  type WebSearchKeyImportModel,
  type WebSearchKeyImportRule,
  type WebSearchProviderId,
  type WebSearchSettings
} from "@deepwrite/contracts";
import { SafeWebSearchError } from "./web-search-errors";
import type { WebSearchSecrets } from "./web-search-secrets";
import {
  toPublicSettings,
  withProfileKeySource,
  type WebSearchStore
} from "./web-search-store";

export interface WebSearchModelKeySource {
  id: string;
  label: string;
  apiKey: string;
}

/** Main-only view of the saved custom models; decrypted keys never leave Main. */
export interface WebSearchKeySourceReader {
  listKeySources(
    match: (model: WebSearchKeyImportModel) => boolean
  ): Promise<WebSearchModelKeySource[]>;
}

export interface WebSearchKeyImportDependencies {
  store: WebSearchStore;
  secrets: WebSearchSecrets;
  keySources: WebSearchKeySourceReader;
  now: () => number;
}

function importRule(providerId: WebSearchProviderId): WebSearchKeyImportRule {
  const rule = webSearchProvider(providerId).keyImport;
  if (!rule) throw new SafeWebSearchError("该搜索服务暂不支持从模型导入密钥。");
  return rule;
}

function keyHint(apiKey: string): string {
  return apiKey.length >= 8 ? `…${apiKey.slice(-4)}` : "";
}

function currentKey(
  secrets: WebSearchSecrets,
  encrypted: string | undefined
): string | undefined {
  if (!encrypted) return undefined;
  try {
    return secrets.decrypt(encrypted);
  } catch {
    // An unreadable saved key simply matches no candidate.
    return undefined;
  }
}

/** Candidates are grouped by key, so models sharing one key are offered once. */
export async function listKeyImportCandidates(
  deps: WebSearchKeyImportDependencies,
  providerId: WebSearchProviderId
): Promise<WebSearchKeyImportCandidates> {
  const rule = importRule(providerId);
  const sources = await deps.keySources.listKeySources((model) =>
    matchesWebSearchKeyImport(model, rule)
  );
  const encrypted = (await deps.store.read()).encryptedApiKeys[providerId];
  const active = currentKey(deps.secrets, encrypted);
  const groups = new Map<string, WebSearchModelKeySource[]>();
  for (const source of sources)
    groups.set(source.apiKey, [...(groups.get(source.apiKey) ?? []), source]);
  const candidates: WebSearchKeyImportCandidate[] = [...groups].map(
    ([apiKey, models]) => ({
      sourceModelId: models[0]!.id,
      keyHint: keyHint(apiKey),
      models: models.map(({ id, label }) => ({ id, label })),
      matchesCurrentKey: apiKey === active
    })
  );
  return { candidates, hasCurrentKey: Boolean(encrypted) };
}

/**
 * Copies the chosen model's key into the search settings and turns search on.
 * The source is re-checked here, so a stale candidate list cannot import a
 * model that no longer qualifies.
 */
export async function importKey(
  deps: WebSearchKeyImportDependencies,
  input: WebSearchImportKeyInput
): Promise<WebSearchSettings> {
  const rule = importRule(input.providerId);
  const sources = await deps.keySources.listKeySources((model) =>
    matchesWebSearchKeyImport(model, rule)
  );
  const source = sources.find((entry) => entry.id === input.sourceModelId);
  if (!source)
    throw new SafeWebSearchError("所选模型已不符合导入条件，请重新导入。");
  const encrypted = deps.secrets.encrypt(source.apiKey);
  const importedAt = new Date(deps.now()).toISOString();
  const state = await deps.store.update(({ settings, encryptedApiKeys }) => ({
    settings: {
      ...settings,
      enabled: true,
      activeProviderId: input.providerId,
      profiles: withProfileKeySource(settings.profiles, input.providerId, {
        kind: "model",
        modelId: source.id,
        modelLabel: source.label,
        importedAt
      })
    },
    encryptedApiKeys: { ...encryptedApiKeys, [input.providerId]: encrypted }
  }));
  return toPublicSettings(state);
}
