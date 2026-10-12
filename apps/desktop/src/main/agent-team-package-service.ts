import { nativeMessages, nativeText } from "./native-i18n";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { BrowserWindow, Dialog } from "electron";
import {
  AgentTeamPackageExportResultSchema,
  AgentTeamPackageInstallResultSchema,
  AGENT_TEAM_PROFILE_NAME_MAX_LENGTH,
  AgentTeamProfileTargetInputSchema,
  type AgentTeamPackageExportResult,
  type AgentTeamPackageInstallResult,
  type AgentTeamProfileTargetInput
} from "@deepwrite/contracts";
import type { AgentTeamConfigStore } from "./agent-team-config-store";
import {
  AGENT_TEAM_PACKAGE_MAX_BYTES,
  createAgentTeamPackage,
  readAgentTeamPackage
} from "./agent-team-package-archive";
import {
  AGENT_TEAM_CONFIG_MAX_BYTES,
  createAgentTeamPackageJson,
  readAgentTeamPackageJson
} from "./agent-team-package-json";

type PackageDialog = Pick<Dialog, "showOpenDialog" | "showSaveDialog">;

function safePackageFileName(name: string): string {
  const sanitized = name
    .replaceAll(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replaceAll(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);
  return `${sanitized || "智能体团队"}.deepwrite-team.json`;
}

export async function downloadAgentTeamPackage(
  window: BrowserWindow,
  dialog: PackageDialog,
  store: AgentTeamConfigStore,
  rawInput: AgentTeamProfileTargetInput,
  defaultDirectory: string
): Promise<AgentTeamPackageExportResult> {
  const input = AgentTeamProfileTargetInputSchema.parse(rawInput);
  const team = await store.exportProfile(input);
  const selection = await dialog.showSaveDialog(window, {
    title: nativeMessages().downloadTeam(team.name),
    buttonLabel: nativeText("downloadTeam"),
    defaultPath: join(defaultDirectory, safePackageFileName(team.name)),
    filters: [
      { name: nativeText("agentTeamJson"), extensions: ["json"] },
      { name: nativeText("agentTeamArchive"), extensions: ["zip"] }
    ]
  });
  if (selection.canceled || !selection.filePath) {
    return AgentTeamPackageExportResultSchema.parse({ status: "canceled" });
  }
  const data =
    extname(selection.filePath).toLowerCase() === ".zip"
      ? createAgentTeamPackage(team)
      : createAgentTeamPackageJson(team);
  await writeFile(selection.filePath, data, {
    flag: "w"
  });
  return AgentTeamPackageExportResultSchema.parse({
    status: "saved",
    filePath: selection.filePath
  });
}

export async function installAgentTeamPackage(
  window: BrowserWindow,
  dialog: PackageDialog,
  store: AgentTeamConfigStore,
  defaultDirectory: string
): Promise<AgentTeamPackageInstallResult> {
  const selection = await dialog.showOpenDialog(window, {
    title: nativeText("installAgentTeam"),
    buttonLabel: nativeText("installTeam"),
    defaultPath: defaultDirectory,
    filters: [
      { name: nativeText("agentTeamFile"), extensions: ["json", "zip"] },
      { name: nativeText("agentTeamJson"), extensions: ["json"] },
      { name: nativeText("agentTeamArchive"), extensions: ["zip"] }
    ],
    properties: ["openFile"]
  });
  const sourcePath = selection.filePaths[0];
  if (selection.canceled || !sourcePath) {
    return AgentTeamPackageInstallResultSchema.parse({ status: "canceled" });
  }
  const extension = extname(sourcePath).toLowerCase();
  if (extension !== ".json" && extension !== ".zip") {
    throw new Error(nativeText("agentTeamFileUnsupported"));
  }
  const metadata = await stat(sourcePath);
  if (!metadata.isFile()) {
    throw new Error(nativeText("agentTeamFileInvalid"));
  }
  const maximumBytes =
    extension === ".json"
      ? AGENT_TEAM_CONFIG_MAX_BYTES
      : AGENT_TEAM_PACKAGE_MAX_BYTES;
  if (metadata.size === 0 || metadata.size > maximumBytes) {
    throw new Error(
      nativeText(
        extension === ".json"
          ? "agentTeamConfigTooLarge"
          : "agentTeamArchiveTooLarge"
      )
    );
  }
  const data = await readFile(sourcePath);
  const fileName = basename(sourcePath, extname(sourcePath))
    .replace(/\.deepwrite-team$/i, "")
    .trim()
    .slice(0, AGENT_TEAM_PROFILE_NAME_MAX_LENGTH);
  const profile =
    extension === ".json"
      ? readAgentTeamPackageJson(data, fileName || undefined)
      : readAgentTeamPackage(data);
  const installed = await store.installProfile(profile);
  return AgentTeamPackageInstallResultSchema.parse({
    status: "installed",
    teamId: installed.team.id,
    teamName: installed.team.name,
    catalog: installed.catalog
  });
}
