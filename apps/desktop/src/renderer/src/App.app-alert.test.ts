import { describe, expect, it } from "vitest";
import source from "./WorkspaceShell.vue?raw";
import dialogLayerSource from "./components/WorkspaceDialogLayer.vue?raw";
import modelCoordinatorSource from "./composables/useModelSettingsCoordinator.ts?raw";
import dialogCoordinatorSource from "./composables/useWorkspaceDialogModuleCoordinator.ts?raw";
import featureHostCoordinatorSource from "./composables/useWorkspaceFeatureHostCoordinator.ts?raw";
import featureHostModuleSource from "./composables/workspaceFeatureHostModule.ts?raw";
import lifecycleSource from "./composables/useWorkspaceLifecycleCoordinator.ts?raw";
import settingsSource from "./stores/settingsStore.ts?raw";

const featureHostSource = `${featureHostCoordinatorSource}\n${featureHostModuleSource}`;

describe("App remote alerts", () => {
  it("loads alerts at startup without a model notice fallback", () => {
    expect(source).toMatch(
      /startDesktopSideEffects:[\s\S]*?loadAppAlerts\(\)/u
    );
    expect(source).toContain("useSettingsFeatureCoordinator({");
    expect(modelCoordinatorSource).toContain("await api.get()");
    expect(settingsSource).not.toContain(
      "officialSiteModelsAvailableWithYourKey"
    );
    expect(source).toContain(
      '@open-official-models="featureHost.openOfficialModelsSettings"'
    );
    expect(featureHostSource).toContain(
      'issueBackground(() => openSettings("site-official-models"))'
    );
    expect(featureHostSource).toContain(
      'if (initialCategory === "site-official-models")'
    );
    expect(featureHostSource).toContain(
      "issueBackground(options.loaders.loadSiteOfficialModels)"
    );
  });

  it("shows unseen desktop content and acknowledges it when dismissed", () => {
    expect(modelCoordinatorSource).toContain("snapshot.shouldShowDesktop");
    expect(modelCoordinatorSource).toContain("snapshot.desktopRevision");
    expect(modelCoordinatorSource).toContain(
      "api.acknowledgeDesktop(revision)"
    );
    expect(dialogCoordinatorSource).toContain('kind: "startup-alert"');
    expect(dialogLayerSource).toContain("<StartupAlertDialog");
    expect(dialogLayerSource).toContain("@close=\"emit('closeStartupAlert')\"");
    expect(source).toContain('@close-startup-alert="closeStartupAlert"');
  });

  it("checks the remote alert again when a hidden window regains focus", () => {
    expect(source).toMatch(
      /async function refreshWorkspaceOnWindowFocus\(\): Promise<void> \{[\s\S]*?loadAppAlerts\(\)/u
    );
    expect(source).toContain("refreshOnFocus: refreshWorkspaceOnWindowFocus");
    expect(lifecycleSource).toContain("options.refreshOnFocus()");
    expect(lifecycleSource).toContain("trailingFocusRefreshRequested = true");
  });
});
