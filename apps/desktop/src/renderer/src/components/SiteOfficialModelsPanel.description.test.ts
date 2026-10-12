import { createPinia } from "pinia";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { ModelConfig } from "@deepwrite/contracts";
import SiteOfficialModelsPanel from "./SiteOfficialModelsPanel.vue";

function renderPanel(
  description?: string,
  keyConfigured = true
): Promise<string> {
  const model: ModelConfig = {
    id: "deepwrite-site-official-writer",
    label: "Writer",
    description,
    provider: "deepwrite-site",
    modelId: "writer",
    api: "openai-completions",
    baseUrl: "https://gateway.example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["high"],
    temperatureOptions: [0.1, 0.7, 1],
    hasApiKey: keyConfigured,
    enabled: keyConfigured
  };
  const app = createSSRApp({
    render: () =>
      h(SiteOfficialModelsPanel, {
        settings: { models: [model], defaultModelId: model.id },
        saving: false,
        refreshing: false,
        quota: null,
        testingModelId: null
      })
  });
  app.use(createPinia());
  return renderToString(app);
}

describe("site model descriptions", () => {
  it("shows keyless models and allows refresh while disabling testing and activation", async () => {
    const html = await renderPanel("适合日常写作", false);
    expect(html).toContain("Writer");
    expect(html).toContain("适合日常写作");
    const refresh = html.match(
      /<button[^>]*class="site-models-refresh"[^>]*>/u
    )?.[0];
    expect(refresh).toBeDefined();
    expect(refresh).not.toContain("disabled");
    for (const className of ["site-model-test", "site-model-toggle"]) {
      expect(
        html.match(
          new RegExp(`<button[^>]*class="${className}"[^>]*>`, "u")
        )?.[0]
      ).toContain("disabled");
    }
  });
  it("renders description text after the availability badge and escapes HTML", async () => {
    const html = await renderPanel("适合写作 <script>unsafe</script>");
    const descriptionIndex = html.indexOf('class="site-model-description"');
    expect(descriptionIndex).toBeGreaterThan(
      html.indexOf('class="site-model-available"')
    );
    expect(html).toContain("适合写作 &lt;script&gt;unsafe&lt;/script&gt;");
    expect(html).not.toContain("<script>unsafe</script>");
  });

  it.each([undefined, "", "   "])(
    "omits the description element for %j",
    async (description) => {
      expect(await renderPanel(description)).not.toContain(
        'class="site-model-description"'
      );
    }
  );
});
