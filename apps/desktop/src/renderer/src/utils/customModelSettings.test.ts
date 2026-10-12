import { describe, expect, it } from "vitest";
import type { ModelConfigInput } from "@deepwrite/contracts";
import { mergeCustomModelSettings } from "./customModelSettings";

function model(
  id: string,
  managedBy?: ModelConfigInput["managedBy"]
): ModelConfigInput {
  return {
    id,
    label: id,
    provider: managedBy ?? "custom",
    modelId: id,
    api: "openai-completions",
    baseUrl: "",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["medium"],
    temperatureOptions: [0.1, 0.7, 1],
    ...(managedBy ? { managedBy } : {})
  };
}

describe("mergeCustomModelSettings", () => {
  it("updates custom models while preserving managed models and their order", () => {
    const official = model("deepwrite-site-official-writer");
    const custom = model("custom-old");
    const free = model("free", "deepwrite-free");
    const edited = { ...custom, label: "edited" };
    const added = model("custom-new");

    const result = mergeCustomModelSettings(
      [official, custom, free],
      [edited, added],
      official.id
    );

    expect(result.models).toEqual([official, edited, free, added]);
    expect(result.defaultModelId).toBe(official.id);
  });

  it("removes deleted custom models without deleting managed models", () => {
    const official = model("deepwrite-site-official-writer");
    const free = model("free", "deepwrite-free");

    const result = mergeCustomModelSettings(
      [model("deleted"), official, free],
      [],
      "deleted"
    );

    expect(result.models).toEqual([official, free]);
    expect(result.defaultModelId).toBe(official.id);
  });

  it("accepts a custom model as the new global default", () => {
    const custom = model("custom");
    const result = mergeCustomModelSettings(
      [model("deepwrite-site-official-writer")],
      [custom],
      custom.id
    );

    expect(result.defaultModelId).toBe(custom.id);
  });

  it("preserves the user-configured official-site model outside custom edits", () => {
    const site = model("deepwrite-site-official-deepseek-v4-flash");
    const custom = model("custom");
    const result = mergeCustomModelSettings(
      [site, custom],
      [{ ...custom, label: "edited" }],
      custom.id
    );

    expect(result.models).toEqual([site, { ...custom, label: "edited" }]);
  });
});
