import { describe, expect, it } from "vitest";
import type { ShortAgentSubagentDefinition } from "@deepwrite/contracts";
import {
  agentTeamDraftSignature,
  createCopiedSubagent,
  nextCopiedSubagentName,
  savedWebSearchField
} from "./agentTeamSettingsEditorHelpers";

describe("nextCopiedSubagentName", () => {
  it("appends an incrementing number after the original name", () => {
    expect(nextCopiedSubagentName("写手小弟", ["写手小弟"], 80)).toBe(
      "写手小弟 2"
    );
    expect(
      nextCopiedSubagentName("写手小弟", ["写手小弟", "写手小弟 2"], 80)
    ).toBe("写手小弟 3");
  });

  it("continues from a trailing copy number instead of stacking suffixes", () => {
    expect(
      nextCopiedSubagentName("写手小弟 2", ["写手小弟", "写手小弟 2"], 80)
    ).toBe("写手小弟 3");
  });

  it("skips names that already exist regardless of case", () => {
    expect(
      nextCopiedSubagentName("写手小弟", ["写手小弟", "写手小弟 2"], 80)
    ).toBe("写手小弟 3");
    expect(nextCopiedSubagentName("Alpha", ["Alpha", "alpha 2"], 80)).toBe(
      "Alpha 3"
    );
  });

  it("keeps names within the max length", () => {
    const longName = "写".repeat(78);
    const copied = nextCopiedSubagentName(longName, [longName], 80);
    expect(copied.length).toBeLessThanOrEqual(80);
    expect(copied.endsWith(" 2")).toBe(true);
  });
});

describe("createCopiedSubagent", () => {
  it("copies settings and assigns a new id and numbered name", () => {
    const source = {
      id: "subagent_source",
      name: "写手小弟",
      description: "负责小节写作",
      systemPrompt: "只写指定小节。",
      enabled: true,
      // The mode of the source is part of what a copy keeps.
      agentMode: "pure-bare" as const,
      modelMode: "custom" as const,
      modelId: "model_custom",
      thinkingLevel: "high" as const
    };

    const copied = createCopiedSubagent(source, [source], "subagent_copy", 80);

    expect(copied).toEqual({
      ...source,
      id: "subagent_copy",
      name: "写手小弟 2"
    });
    expect(copied).not.toBe(source);
  });

  it("inserts the copy immediately after the source subagent", () => {
    const first = {
      id: "subagent_first",
      name: "写手小弟",
      description: "负责小节写作",
      systemPrompt: "只写指定小节。",
      enabled: true,
      agentMode: "standard" as const,
      modelMode: "inherit" as const
    };
    const second = {
      ...first,
      id: "subagent_second",
      name: "审阅小弟"
    };
    const subagents: ShortAgentSubagentDefinition[] = [first, second];
    const copied = createCopiedSubagent(first, subagents, "subagent_copy", 80);
    subagents.splice(1, 0, copied);
    expect(subagents.map((item) => item.id)).toEqual([
      "subagent_first",
      "subagent_copy",
      "subagent_second"
    ]);
    expect(subagents[1]?.name).toBe("写手小弟 2");
  });
});

describe("agentTeamDraftSignature", () => {
  const subagent: ShortAgentSubagentDefinition = {
    id: "subagent_a",
    name: "连续性审阅",
    description: "检查前后一致性",
    systemPrompt: "只核对设定。",
    enabled: true,
    agentMode: "standard",
    modelMode: "inherit"
  };
  const sign = (item: ShortAgentSubagentDefinition, parallel = false): string =>
    agentTeamDraftSignature(parallel, [
      { parentAgentId: "short", subagents: [item] }
    ]);

  it("is stable for an unchanged draft", () => {
    expect(sign({ ...subagent })).toBe(sign(subagent));
  });

  it("changes when persisted fields or the team parallel switch change", () => {
    const base = sign(subagent);
    expect(sign({ ...subagent, name: "连续性审阅 2" })).not.toBe(base);
    expect(sign({ ...subagent, enabled: false })).not.toBe(base);
    expect(sign({ ...subagent, agentMode: "pure-read" })).not.toBe(base);
    expect(sign(subagent, true)).not.toBe(base);
  });

  it("treats a missing web search mode and following the main agent alike", () => {
    expect(sign({ ...subagent, webSearchMode: "inherit" })).toBe(
      sign(subagent)
    );
    expect(sign({ ...subagent, webSearchMode: "on" })).not.toBe(sign(subagent));
    expect(sign({ ...subagent, webSearchMode: "off" })).not.toBe(
      sign({ ...subagent, webSearchMode: "on" })
    );
  });

  it("ignores model leftovers that are not persisted for inherited models", () => {
    expect(
      sign({ ...subagent, modelId: "model-a", thinkingLevel: "high" })
    ).toBe(sign(subagent));
  });

  it("only keeps the temperature while reasoning is off", () => {
    const custom: ShortAgentSubagentDefinition = {
      ...subagent,
      modelMode: "custom",
      modelId: "model-a",
      thinkingLevel: "high",
      temperature: 0.7
    };
    expect(sign({ ...custom, temperature: 1 })).toBe(sign(custom));
    expect(sign({ ...custom, thinkingLevel: "off", temperature: 1 })).not.toBe(
      sign({ ...custom, thinkingLevel: "off", temperature: 0.7 })
    );
  });
});

describe("savedWebSearchField", () => {
  it("stores only an explicit choice, so following the main agent leaves no trace", () => {
    expect(savedWebSearchField(undefined)).toEqual({});
    expect(savedWebSearchField("inherit")).toEqual({});
    expect(savedWebSearchField("on")).toEqual({ webSearchMode: "on" });
    expect(savedWebSearchField("off")).toEqual({ webSearchMode: "off" });
  });
});

describe("createCopiedSubagent web search mode", () => {
  it("keeps the web search mode of the member it copies", () => {
    const source: ShortAgentSubagentDefinition = {
      id: "subagent_a",
      name: "查证员",
      description: "查证公开资料",
      systemPrompt: "只做查证。",
      enabled: true,
      agentMode: "pure-read",
      webSearchMode: "on",
      modelMode: "inherit"
    };
    const copied = createCopiedSubagent(source, [source], "subagent_b", 80);
    expect(copied.webSearchMode).toBe("on");
    expect(copied.id).toBe("subagent_b");
  });
});
