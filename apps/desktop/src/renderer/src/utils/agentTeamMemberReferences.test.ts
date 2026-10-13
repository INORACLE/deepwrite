import { describe, expect, it } from "vitest";
import {
  AgentTeamCatalogSnapshotSchema,
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  DEFAULT_AGENT_TEAM_SETTINGS,
  type AgentTeamCatalogSnapshot
} from "@deepwrite/contracts";
import { agentTeamMemberReferences } from "./agentTeamMemberReferences";

const members = [
  {
    id: "style_polisher",
    name: "文风润色师",
    description: "统一文风。\n  只润色，不改情节。",
    systemPrompt: "按作者文风润色。",
    enabled: true,
    agentMode: "standard" as const,
    modelMode: "inherit" as const
  },
  {
    id: "retired",
    name: "停用成员",
    description: "不应出现。",
    systemPrompt: "不要运行。",
    enabled: false,
    agentMode: "standard" as const,
    modelMode: "inherit" as const
  }
];

function shortCatalog(enabled: boolean): AgentTeamCatalogSnapshot {
  const settings = structuredClone(DEFAULT_AGENT_TEAM_SETTINGS);
  settings.teams[0]!.subagents = members;
  return AgentTeamCatalogSnapshotSchema.parse({
    enabledTeamIds: enabled ? { short: "team-short" } : {},
    teams: [
      { id: "team-short", name: "短篇团队", workspaceType: "short", settings }
    ]
  });
}

describe("agent team member references", () => {
  it("lists the enabled members of the bound team with one-line details", () => {
    expect(
      agentTeamMemberReferences(shortCatalog(true), "short", "short")
    ).toEqual([
      {
        id: "style_polisher",
        label: "文风润色师",
        detail: "统一文风。 只润色，不改情节。"
      }
    ]);
  });

  it("is empty without a bound team, for another parent agent, or without a catalog", () => {
    expect(
      agentTeamMemberReferences(shortCatalog(false), "short", "short")
    ).toEqual([]);
    expect(
      agentTeamMemberReferences(shortCatalog(true), "short", "other")
    ).toEqual([]);
    expect(
      agentTeamMemberReferences(shortCatalog(true), "long", "short")
    ).toEqual([]);
    expect(agentTeamMemberReferences(null, "short", "short")).toEqual([]);
  });

  it("reads long teams through the same lookup", () => {
    const settings = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
    const parentAgentId = settings.teams[0]!.parentAgentId;
    settings.teams[0]!.subagents = members;
    const catalog = AgentTeamCatalogSnapshotSchema.parse({
      enabledTeamIds: { long: "team-long" },
      teams: [
        { id: "team-long", name: "长篇团队", workspaceType: "long", settings }
      ]
    });
    expect(
      agentTeamMemberReferences(catalog, "long", parentAgentId).map(
        (option) => option.id
      )
    ).toEqual(["style_polisher"]);
  });
});
