import type { WebSearchSettings, WebSearchSettingsInput } from "./settings";
import type {
  WebSearchImportKeyInput,
  WebSearchKeyImportCandidates,
  WebSearchListKeyImportCandidatesInput,
  WebSearchSetEnabledInput,
  WebSearchTestInput,
  WebSearchTestResult
} from "./commands";

export interface WebSearchApi {
  getSettings(): Promise<WebSearchSettings>;
  saveSettings(input: WebSearchSettingsInput): Promise<WebSearchSettings>;
  setEnabled(input: WebSearchSetEnabledInput): Promise<WebSearchSettings>;
  test(input: WebSearchTestInput): Promise<WebSearchTestResult>;
  listKeyImportCandidates(
    input: WebSearchListKeyImportCandidatesInput
  ): Promise<WebSearchKeyImportCandidates>;
  importKey(input: WebSearchImportKeyInput): Promise<WebSearchSettings>;
}
