import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  ModelConfigInputSchema,
  createEnvelope
} from "./index";

describe("retired official-site contracts", () => {
  it.each([
    ["models.refreshOfficial", {}],
    ["models.queryOfficialBalance", {}],
    ["models.saveOfficialToken", { apiKey: "invalid-retired-test-key" }],
    ["models.clearOfficialToken", {}],
    ["models.setOfficialModelEnabled", { modelId: "retired", enabled: true }]
  ] as const)("rejects the retired %s command", (type, payload) => {
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(type, payload, { id: "retired-command" })
      ).success
    ).toBe(false);
  });

  it("accepts the new official-site key command", () => {
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(
          "models.saveSiteOfficialToken",
          { apiKey: "invalid-site-test-key" },
          { id: "site-command" }
        )
      ).success
    ).toBe(true);
  });

  it("rejects retired ownership in active model settings", () => {
    const model = {
      id: "retired-official-writer",
      label: "Retired writer",
      provider: "custom",
      modelId: "writer",
      api: "openai-completions",
      baseUrl: "https://models.example.test/v1",
      reasoning: false,
      defaultThinkingLevel: "off",
      managedBy: "deepwrite-official"
    };
    expect(ModelConfigInputSchema.safeParse(model).success).toBe(false);
    expect(
      ModelConfigInputSchema.safeParse({
        ...model,
        id: "deepwrite-site-official-writer",
        managedBy: undefined
      }).success
    ).toBe(true);
  });
});
