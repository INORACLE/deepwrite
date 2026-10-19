import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import type {
  DeepWriteApi,
  LibraryAgentDomain,
  LibraryAgentSettingsInput,
  LongAgentSettingsInput,
  WorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import { useAgentTeamCatalogCoordinator } from "./useAgentTeamCatalogCoordinator";
import {
  useModelSettingsCoordinator,
  type ModelSettingsNotifications
} from "./useModelSettingsCoordinator";

import {
  withWorkspaceAgentBaseline,
  withLongAgentBaseline,
  withLibraryAgentBaseline
} from "../utils/agentSettingsBaseline";

const t = createScopedTranslator("workspace");

export type SettingsFeatureNotifications = ModelSettingsNotifications;

export interface SettingsFeatureCoordinatorContext {
  api(): DeepWriteApi | undefined;
  settingsStore: ReturnType<typeof useSettingsStore>;
  notifications: SettingsFeatureNotifications;
  onModelsLoaded: Parameters<
    typeof useModelSettingsCoordinator
  >[0]["onModelsLoaded"];
}

function errorMessage(error: unknown, fallback: string): string {
  return formatError(error, fallback);
}

export function useSettingsFeatureCoordinator(
  context: SettingsFeatureCoordinatorContext
) {
  const { settingsStore, notifications: uiMessage } = context;
  const modelSettingsCoordinator = useModelSettingsCoordinator(context);
  const agentTeamCatalogCoordinator = useAgentTeamCatalogCoordinator(context);
  async function loadShortAndScriptAgentSettings(): Promise<void> {
    const api = context.api();
    if (!api) return;
    try {
      await settingsStore.ensureWorkspaceAgentsLoaded(() =>
        Promise.all([
          api.workspaceAgents.list("short"),
          api.workspaceAgents.list("script")
        ])
      );
    } catch (error: unknown) {
      uiMessage.error(
        errorMessage(
          error,
          t("settingsFeatureCoordinator.failedToLoadWorkspaceAgentSettings")
        )
      );
    }
  }

  async function loadLongAgentSettings(): Promise<boolean> {
    const api = context.api();
    if (!api) return false;
    try {
      await settingsStore.ensureLongAgentsLoaded(() => api.longAgents.list());
      return true;
    } catch (error: unknown) {
      uiMessage.error(
        errorMessage(
          error,
          t("settingsFeatureCoordinator.failedToLoadNovelAgentSettings")
        )
      );
      return false;
    }
  }

  async function ensureLongAgentSettingsLoaded(): Promise<boolean> {
    return settingsStore.longAgentLoaded || (await loadLongAgentSettings());
  }

  async function loadWorkspaceAgentSettings(): Promise<void> {
    await Promise.all([
      loadShortAndScriptAgentSettings(),
      loadLongAgentSettings()
    ]);
  }

  async function saveWorkspaceAgentSettings(
    settings: WorkspaceAgentSettingsInput
  ): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.workspaceAgentSaving) return;
    settingsStore.workspaceAgentSaving = true;
    try {
      const saved = await api.workspaceAgents.save(
        withWorkspaceAgentBaseline(
          settings,
          settingsStore.workspaceAgentSettings.find(
            (candidate) => candidate.workspaceType === settings.workspaceType
          )
        )
      );
      settingsStore.markLoaded("workspaceAgents", [
        ...settingsStore.workspaceAgentSettings.filter(
          (candidate) => candidate.workspaceType !== saved.workspaceType
        ),
        saved
      ]);
      uiMessage.success(
        t(
          "settingsFeatureCoordinator.savedAgentPromptsWelcomeShortcutsAndReadPermissionsChanges",
          {
            value:
              saved.workspaceType === "script"
                ? t("catalogWorkspace.screenplay")
                : t("catalogWorkspace.shortStory")
          }
        )
      );
    } catch (error: unknown) {
      uiMessage.error(
        errorMessage(
          error,
          t("settingsFeatureCoordinator.failedToSaveWorkspaceAgentSettings")
        )
      );
    } finally {
      settingsStore.workspaceAgentSaving = false;
    }
  }

  async function saveLongAgentSettings(
    settings: LongAgentSettingsInput
  ): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.longAgentSaving) return;
    settingsStore.longAgentSaving = true;
    try {
      const saved = await api.longAgents.save(
        withLongAgentBaseline(settings, settingsStore.longAgentSettings)
      );
      settingsStore.markLoaded("longAgents", saved);
      uiMessage.success(
        t(
          "settingsFeatureCoordinator.savedPromptsWelcomeShortcutsAndMaterialSkillReadPermissions"
        )
      );
    } catch (error: unknown) {
      uiMessage.error(
        errorMessage(
          error,
          t("settingsFeatureCoordinator.failedToSaveNovelAgentSettings")
        )
      );
    } finally {
      settingsStore.longAgentSaving = false;
    }
  }

  async function loadLibraryAgentSettings(): Promise<void> {
    const api = context.api();
    if (!api) return;
    try {
      await settingsStore.ensureLibraryAgentsLoaded(() =>
        api.libraryAgents.list()
      );
    } catch (error: unknown) {
      uiMessage.error(
        errorMessage(
          error,
          t("settingsFeatureCoordinator.failedToLoadLibraryAgentSettings")
        )
      );
    }
  }

  async function saveLibraryAgentSettings(
    settings: LibraryAgentSettingsInput
  ): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.libraryAgentSaving) return;
    settingsStore.libraryAgentSaving = true;
    try {
      const saved = await api.libraryAgents.save(
        withLibraryAgentBaseline(settings, settingsStore.libraryAgentSettings)
      );
      settingsStore.markLoaded("libraryAgents", saved);
      uiMessage.success(
        t(
          "settingsFeatureCoordinator.libraryAgentSettingsSavedChangesApplyToTheNext"
        )
      );
    } catch (error: unknown) {
      uiMessage.error(
        errorMessage(
          error,
          t("settingsFeatureCoordinator.failedToSaveLibraryAgentSettings")
        )
      );
    } finally {
      settingsStore.libraryAgentSaving = false;
    }
  }

  async function resetLibraryAgentSettings(
    domain: LibraryAgentDomain
  ): Promise<void> {
    const api = context.api();
    if (!api || settingsStore.libraryAgentSaving) return;
    settingsStore.libraryAgentSaving = true;
    try {
      const saved = await api.libraryAgents.reset(domain);
      settingsStore.markLoaded("libraryAgents", saved);
      uiMessage.success(
        t("settingsFeatureCoordinator.agentSettingsRestoredToDefaults", {
          value:
            domain === "skill"
              ? t("catalogWorkspace.skillLibrary")
              : t("catalogWorkspace.materialLibrary")
        })
      );
    } catch (error: unknown) {
      uiMessage.error(
        errorMessage(
          error,
          t("settingsFeatureCoordinator.failedToRestoreLibraryAgentDefaults")
        )
      );
    } finally {
      settingsStore.libraryAgentSaving = false;
    }
  }

  return {
    ...modelSettingsCoordinator,
    ...agentTeamCatalogCoordinator,
    loadShortAndScriptAgentSettings,
    loadLongAgentSettings,
    ensureLongAgentSettingsLoaded,
    loadWorkspaceAgentSettings,
    saveWorkspaceAgentSettings,
    saveLongAgentSettings,
    loadLibraryAgentSettings,
    saveLibraryAgentSettings,
    resetLibraryAgentSettings
  };
}
