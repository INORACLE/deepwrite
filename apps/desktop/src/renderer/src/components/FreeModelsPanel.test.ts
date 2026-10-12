import { describe, expect, it } from "vitest";
import source from "./FreeModelsPanel.vue?raw";
import { freeModelStatus, isFreeModelAvailable } from "./freeModelPresentation";

describe("FreeModelsPanel", () => {
  it("treats a keyless free endpoint as available when its status is not disabled", () => {
    expect(isFreeModelAvailable({ status: undefined })).toBe(true);
    expect(freeModelStatus({ status: undefined })).toBe("可用");
    expect(isFreeModelAvailable({ status: 0 })).toBe(true);
  });

  it("disables models explicitly marked unavailable", () => {
    expect(isFreeModelAvailable({ status: 1 })).toBe(false);
    expect(freeModelStatus({ status: 1 })).toBe("暂不可用");
    expect(source).toContain("!isFreeModelAvailable(model)");
  });

  it("shows cached current and deprecated models without refreshing on entry", () => {
    expect(source).toContain("deepwriteFreeModels");
    expect(source).toContain("deepwriteFreeDeprecatedModels");
    expect(source).toContain("retiredModels");
    expect(source).not.toContain("onMounted");
    expect(source).toContain("refreshList");
    expect(source).toContain("<ModelAnnouncementNotice");
    expect(source).not.toContain(
      "chooseWhichFreeModelsAppearInModelSettingsAnd"
    );
  });

  it("uses the persisted enabled ids for switches", () => {
    expect(source).toContain("deepwriteFreeEnabledModelIds");
    expect(source).toContain(':checked="enabledModelIds.has(model.id)"');
    expect(source).toContain('emit("setModelEnabled"');
  });

  it("lets users test every currently available model and shows its progress", () => {
    expect(source).toContain('v-if="isFreeModelAvailable(model)"');
    expect(source).toContain('emit("test", toModelInput(model))');
    expect(source).toContain("testing");
    expect(source).toContain("testingModelId !== null");
  });
});
