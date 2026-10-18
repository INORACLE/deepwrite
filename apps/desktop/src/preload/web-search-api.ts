import {
  WebSearchImportKeyInputSchema,
  WebSearchKeyImportCandidatesSchema,
  WebSearchListKeyImportCandidatesInputSchema,
  WebSearchSetEnabledInputSchema,
  WebSearchSettingsInputSchema,
  WebSearchSettingsSchema,
  WebSearchTestInputSchema,
  WebSearchTestResultSchema,
  createEnvelope,
  type WebSearchApi
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export const webSearch: WebSearchApi = {
  async getSettings() {
    const id = browserId("cmd_web_search_settings");
    return WebSearchSettingsSchema.parse(
      await invokeCommand(
        createEnvelope("webSearch.getSettings", {}, { id, correlationId: id })
      )
    );
  },
  async saveSettings(rawInput) {
    const input = WebSearchSettingsInputSchema.parse(rawInput);
    const id = browserId("cmd_web_search_save");
    return WebSearchSettingsSchema.parse(
      await invokeCommand(
        createEnvelope("webSearch.saveSettings", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async setEnabled(rawInput) {
    const input = WebSearchSetEnabledInputSchema.parse(rawInput);
    const id = browserId("cmd_web_search_enabled");
    return WebSearchSettingsSchema.parse(
      await invokeCommand(
        createEnvelope("webSearch.setEnabled", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async test(rawInput) {
    const input = WebSearchTestInputSchema.parse(rawInput);
    const id = browserId("cmd_web_search_test");
    return WebSearchTestResultSchema.parse(
      await invokeCommand(
        createEnvelope("webSearch.test", input, { id, correlationId: id })
      )
    );
  },
  async listKeyImportCandidates(rawInput) {
    const input = WebSearchListKeyImportCandidatesInputSchema.parse(rawInput);
    const id = browserId("cmd_web_search_candidates");
    return WebSearchKeyImportCandidatesSchema.parse(
      await invokeCommand(
        createEnvelope("webSearch.listKeyImportCandidates", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async importKey(rawInput) {
    const input = WebSearchImportKeyInputSchema.parse(rawInput);
    const id = browserId("cmd_web_search_import");
    return WebSearchSettingsSchema.parse(
      await invokeCommand(
        createEnvelope("webSearch.importKey", input, {
          id,
          correlationId: id
        })
      )
    );
  }
};
