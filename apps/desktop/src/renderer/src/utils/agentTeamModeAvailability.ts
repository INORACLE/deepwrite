import { createScopedTranslator } from "../i18n";
import type {
  AgentTeamCatalogSnapshot,
  AgentTeamWorkspaceType,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";

const t = createScopedTranslator("workspace.agentTeamModeAvailability");

export interface AgentTeamModeAvailabilityInput {
  catalog: AgentTeamCatalogSnapshot | null;
  workspaceType: AgentTeamWorkspaceType;
  parentAgentId: string;
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
}

export interface AgentTeamModeAvailability {
  available: boolean;
  description: string;
}

/**
 * Members the main agent can delegate to: the enabled subagents of the
 * enabled team for this writing type and parent agent.
 */
export function enabledTeamMembers(
  catalog: AgentTeamCatalogSnapshot,
  workspaceType: AgentTeamWorkspaceType,
  parentAgentId: string
): readonly ShortAgentSubagentDefinition[] {
  const enabledTeamId = catalog.enabledTeamIds[workspaceType];
  if (!enabledTeamId) return [];
  const profile = catalog.teams.find(
    (team) => team.id === enabledTeamId && team.workspaceType === workspaceType
  );
  const teams: readonly {
    parentAgentId: string;
    subagents: readonly ShortAgentSubagentDefinition[];
  }[] = profile?.settings.teams ?? [];
  return (
    teams
      .find((team) => team.parentAgentId === parentAgentId)
      ?.subagents.filter((member) => member.enabled) ?? []
  );
}

export function resolveAgentTeamModeAvailability(
  input: AgentTeamModeAvailabilityInput
): AgentTeamModeAvailability {
  if (input.loading) {
    return {
      available: false,
      description: t("loadingAgentTeamConfiguration")
    };
  }
  if (input.loadError) {
    return {
      available: false,
      description: t("failedToLoadAgentTeamsRetryFromTheAgent")
    };
  }
  if (!input.loaded || !input.catalog) {
    return {
      available: false,
      description: t("agentTeamConfigurationHasNotLoadedYet")
    };
  }
  if (
    enabledTeamMembers(input.catalog, input.workspaceType, input.parentAgentId)
      .length === 0
  ) {
    return {
      available: false,
      description: t("thisAgentHasNoEnabledTeamWithAvailableMembers")
    };
  }
  return {
    available: true,
    description: t("allowThisMainAgentToCallSubagentsInEnabled")
  };
}
