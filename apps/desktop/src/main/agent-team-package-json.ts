import {
  AGENT_TEAM_PACKAGE_FORMAT,
  AGENT_TEAM_PACKAGE_VERSION,
  AgentTeamImportProfileSchema,
  AgentTeamImportSettingsSchema,
  AgentTeamPackageManifestSchema,
  AgentTeamProfileSchema,
  type AgentTeamProfile
} from "@deepwrite/contracts";
import { createAgentTeamProfile } from "./agent-team-profile-factory";
import { nativeMessages, nativeText } from "./native-i18n";

export const AGENT_TEAM_CONFIG_MAX_BYTES = 4 * 1024 * 1024;

export function createAgentTeamPackageJson(
  team: AgentTeamProfile,
  now = new Date()
): Buffer {
  const manifest = AgentTeamPackageManifestSchema.parse({
    format: AGENT_TEAM_PACKAGE_FORMAT,
    version: AGENT_TEAM_PACKAGE_VERSION,
    exportedAt: now.toISOString(),
    team
  });
  const data = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (data.length > AGENT_TEAM_CONFIG_MAX_BYTES) {
    throw new Error(nativeText("agentTeamConfigTooLarge"));
  }
  return data;
}

export function readAgentTeamPackageJson(
  data: Buffer,
  fallbackName?: string
): AgentTeamProfile {
  if (data.length === 0 || data.length > AGENT_TEAM_CONFIG_MAX_BYTES) {
    throw new Error(nativeText("agentTeamConfigTooLarge"));
  }
  let text: string;
  try {
    // TextDecoder also removes a UTF-8 BOM written by some Windows editors.
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new Error(nativeText("agentTeamConfigInvalidEncoding"));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(nativeText("agentTeamConfigInvalidJson"));
  }

  const record =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const schema =
    "format" in record || "team" in record
      ? AgentTeamPackageManifestSchema
      : "settings" in record
        ? AgentTeamImportProfileSchema
        : AgentTeamImportSettingsSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      nativeMessages().invalidAgentTeamConfig(
        issue?.path.join(".") || "root",
        issue?.message || "Invalid configuration"
      )
    );
  }
  const value = parsed.data;
  if ("format" in value) return value.team;
  if ("settings" in value) {
    return AgentTeamProfileSchema.parse({
      ...value,
      id: value.id ?? "team_import"
    });
  }
  return createAgentTeamProfile(value.workspaceType, fallbackName, value);
}
