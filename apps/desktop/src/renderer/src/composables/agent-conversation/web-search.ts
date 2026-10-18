import { createScopedTranslator } from "../../i18n";

const t = createScopedTranslator("workspace.webSearch");

/** Why the switch cannot be turned on; says where search is set up. */
export function workspaceWebSearchDisabledReason(): string {
  return t("setUpInSettings");
}

/** The prompt field of a run's switch: only an on switch is sent. */
export function workspaceWebSearchPromptFields(enabled: boolean): {
  webSearchEnabled?: true;
} {
  return enabled ? { webSearchEnabled: true } : {};
}
