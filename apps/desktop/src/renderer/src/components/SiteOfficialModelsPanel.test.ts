import { describe, expect, it } from "vitest";
import source from "./SiteOfficialModelsPanel.vue?raw";
import tokenCard from "./SiteOfficialTokenCard.vue?raw";

describe("SiteOfficialModelsPanel", () => {
  it("opens the official site shop", () => {
    expect(source).toContain("siteStore");
    expect(source).toMatch(/href="https:\/\/[^/]+\/shop\/[A-Za-z0-9]+"/);
    expect(source).toContain('class="site-shop-button"');
    expect(source).not.toContain("新小站店铺");
    expect(source).not.toContain("旧小站店铺");
    expect(source.match(/href="https?:\/\/[^"]+"/g)).toHaveLength(1);
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
  });

  it("asks the user for a separate model key before showing the model", () => {
    expect(tokenCard).toContain("addYourSiteKey");
    expect(tokenCard).toContain("<textarea");
    expect(tokenCard).toContain('autocomplete="new-password"');
    expect(tokenCard).toContain('emit("saveToken", apiKey)');
    expect(tokenCard).toContain("relatedModelsJoinTheListAfterYouSaveA");
    expect(source).not.toContain("MAIN_VITE_DEEPWRITE_GATEWAY_API_KEY");
  });

  it("never renders the saved key and supports testing or removing the model", () => {
    expect(source).toContain("configuredModels.value.some");
    expect(tokenCard).toContain("valueModelsEnabledTheKeyIsNeverReturnedTo");
    expect(source).toContain("emit('clearToken')");
    expect(source).toContain('emit("test", toModelInput(model))');
  });

  it("renders every model discovered from the new-site catalog", () => {
    expect(source).toContain("props.settings?.models.filter");
    expect(source).toContain('v-for="model in configuredModels"');
    expect(source).toContain("valueModels");
    expect(source).toContain("model.api");
  });

  it("refreshes the full page, controls selector visibility, and shows quota progress", () => {
    expect(source).toContain("refreshPage");
    expect(source).toContain("emit('refresh')");
    expect(source).toContain('role="switch"');
    expect(source).toContain('emit("setModelEnabled"');
    expect(source).toContain('role="progressbar"');
    expect(source).toContain("currentKeyBalance");
    expect(source).toContain("quotaUsedPercentage");
    expect(source).toContain("unlimitedQuota");
    expect(source).toContain("quota?.unlimited");
  });
});
