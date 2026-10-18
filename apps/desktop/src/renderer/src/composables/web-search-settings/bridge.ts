import type { WebSearchProviderId } from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../../i18n";

export const webSearchT = createScopedTranslator(
  "components.webSearchSettings"
);

export interface WebSearchDraft {
  activeProviderId: WebSearchProviderId;
  maxResults: number;
  perRunCallLimit: number;
  /** A key typed but not saved yet; blank keeps the saved one. */
  apiKey: string;
  clearKey: boolean;
}

export function webSearchApi() {
  const bridge = window.deepwrite;
  if (!bridge) throw new Error(webSearchT("bridgeNotReady"));
  return bridge.webSearch;
}

type MessageKey = Parameters<typeof webSearchT>[0];

/** A new provider adds its messages and one entry to each table. */
const PROVIDER_LABEL_KEYS: Record<WebSearchProviderId, MessageKey> = {
  deepseek: "providerDeepseek"
};
const PROVIDER_NAME_KEYS: Record<WebSearchProviderId, MessageKey> = {
  deepseek: "providerNameDeepseek"
};

/** Full name, as in the provider list. */
export function webSearchProviderLabel(id: WebSearchProviderId): string {
  return webSearchT(PROVIDER_LABEL_KEYS[id]);
}

/** Short name for use inside sentences and button labels. */
export function webSearchProviderName(id: WebSearchProviderId): string {
  return webSearchT(PROVIDER_NAME_KEYS[id]);
}
