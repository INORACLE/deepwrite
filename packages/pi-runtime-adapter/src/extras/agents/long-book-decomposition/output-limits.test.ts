import { describe, expect, it, vi } from "vitest";
import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  DEFAULT_DECOMPOSITION_PROFILE,
  DecompositionResolvedInputSchema,
  type DecompositionSubmitInput,
  type ExtrasAgentResolvedTaskOf
} from "@deepwrite/contracts";
import { toolNamed } from "../../extras.test-support";
import { longBookDecompositionAgent } from "./definition";
import { decompositionRoleDefinitions } from "./roles";
import { decompositionSubmissionTools } from "./submissions";

function setup(
  unitIds: string[],
  model: { maxTokens: number; thinkingLevel: string } = {
    maxTokens: 32_000,
    thinkingLevel: "off"
  }
) {
  const task: ExtrasAgentResolvedTaskOf<"long-book-decomposition"> = {
    agentId: "long-book-decomposition",
    profile: DEFAULT_DECOMPOSITION_PROFILE,
    input: DecompositionResolvedInputSchema.parse({
      jobId: "job_test",
      phase: unitIds[0]!.startsWith("registry") ? "registry" : "integrate",
      unitIds,
      outputVersion: 1,
      attemptId: "attempt_test",
      mode: "materials",
      modelId: "model_test",
      inputBudget: 16_000,
      contextWindow: 200_000,
      ...model,
      units: Object.fromEntries(
        unitIds.map((id) => [
          id,
          {
            phase: "integrate",
            status: "running",
            attempts: 0,
            inputRevision: "revision_1",
            dependencies: [],
            updatedAt: "2026-10-05T00:00:00.000Z"
          }
        ])
      )
    })
  };
  const submit = vi.fn(async (input: DecompositionSubmitInput) => ({
    id: "receipt_test",
    jobId: input.jobId,
    outputVersion: input.outputVersion,
    unitId: input.unitId,
    inputRevision: input.inputRevision,
    refs: [],
    savedAt: "2026-10-05T00:00:00.000Z",
    ...(input.data.kind === "asset-part" ? { staged: 2 } : {})
  }));
  const services = {
    runId: "run_test",
    sessionId: "session_test",
    decompositionSubmit: submit,
    decompositionQuery: vi.fn(async () => ({
      content: "【材料】",
      nextCursor: null,
      totalCharacters: 4
    }))
  };
  return { task, submit, services };
}

/** The path a model's call takes in PI: repair, whole-call check, execute. */
function callAsModel(tool: AgentTool, args: Record<string, unknown>) {
  return tool.execute(
    "write",
    validateToolArguments(tool, {
      type: "toolCall",
      id: "write",
      name: tool.name,
      arguments: (tool.prepareArguments?.(args) ?? args) as JsonObject
    })
  );
}

describe("decomposition output limits", () => {
  it("stages a list batch marked more and finishes the unit with the last one", async () => {
    const { task, services, submit } = setup(["world:items"]);
    const writer = toolNamed(
      decompositionSubmissionTools(task, services, "world_archivist"),
      "write_world_category"
    );
    const item = (title: string) => ({ title, content: `${title}的来历。` });
    const staged = await callAsModel(writer, {
      items: [
        {
          unitId: "world:items",
          data: {
            asset: { categoryId: "items", items: [item("铜铃"), item("木剑")] }
          },
          more: true
        }
      ]
    });
    expect(JSON.stringify(staged.content)).toContain("本批已暂存（累计 2 条）");
    expect(submit.mock.calls[0]![0].data).toEqual({
      kind: "asset-part",
      asset: {
        kind: "world",
        categoryId: "items",
        items: [item("铜铃"), item("木剑")]
      }
    });
    expect(task.input.units["world:items"]!.status).toBe("running");
    await callAsModel(writer, {
      items: [
        {
          unitId: "world:items",
          data: {
            asset: {
              categoryId: "items",
              overview: "器物。",
              items: [item("铁甲")]
            }
          }
        }
      ]
    });
    expect(submit.mock.calls[1]![0].data).toMatchObject({
      kind: "asset",
      asset: { kind: "world", overview: "器物。", items: [item("铁甲")] }
    });
    expect(task.input.units["world:items"]!.status).toBe("done");
  });

  it("submits a registrar's numbered decisions as a plan", async () => {
    const { task, services, submit } = setup(["registry:part:2"]);
    const registrar = toolNamed(
      decompositionSubmissionTools(task, services, "registrar"),
      "submit_registry_part"
    );
    await callAsModel(registrar, {
      items: [
        {
          unitId: "registry:part:2",
          data: {
            plan: { groups: [{ refs: ["c7", "c9"], tier: "protagonist" }] }
          }
        }
      ]
    });
    expect(submit.mock.calls[0]![0].data).toEqual({
      kind: "registry-plan",
      plan: {
        groups: [{ refs: ["c7", "c9"], tier: "protagonist" }],
        ignored: []
      }
    });
  });

  it("gives each registrar child exactly one registry unit", async () => {
    const { task, services } = setup(["registry:part:1", "registry:part:2"]);
    const definition = decompositionRoleDefinitions().find(
      ({ id }) => id === "registrar"
    )!;
    await expect(
      longBookDecompositionAgent.orchestration!(task, services).prepareChild(
        definition,
        undefined,
        undefined,
        {
          index: 0,
          key: "t1",
          definition,
          task: "整理 registry:part:1、registry:part:2",
          dependsOn: []
        }
      )
    ).rejects.toThrow("每个名册子任务只能处理一个名册单元。");
  });

  it("tells each child limits that follow the phase model's configuration", async () => {
    const limits = async (model: {
      maxTokens: number;
      thinkingLevel: string;
    }) => {
      const { task, services } = setup(["world:items"], model);
      const definition = decompositionRoleDefinitions().find(
        ({ id }) => id === "world_archivist"
      )!;
      const child = await longBookDecompositionAgent.orchestration!(
        task,
        services
      ).prepareChild(definition, undefined, undefined, {
        index: 0,
        key: "t1",
        definition,
        task: "整理 world:items",
        dependsOn: []
      });
      return /【本次输出上限】(.+)/u.exec(child.task ?? "")![1]!;
    };
    const roomy = await limits({ maxTokens: 32_000, thinkingLevel: "off" });
    const tight = await limits({ maxTokens: 4096, thinkingLevel: "high" });
    expect(roomy).toContain("可见输出约 16000 token");
    expect(roomy).toContain("设定条目每批最多 34 条");
    expect(tight).toContain("可见输出约 1638 token");
    expect(tight).toContain("设定条目每批最多 3 条");
  });
});
