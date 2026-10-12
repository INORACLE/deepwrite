import { expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  DEFAULT_DECOMPOSITION_PROFILE,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { handleDecompositionCommands } from "./commands";
import { decompositionCore } from "./core-bridge";
import type { ExtrasAgentCommandContext } from "../index";
import type { ExtrasAgentConfigStore } from "../config-store";

vi.mock("electron", () => ({ utilityProcess: { fork: vi.fn() } }));
import { UtilityCommandTimeoutError } from "../../../main/supervisor";

function fixture() {
  const confirmation = {
    id: "confirm_timeout_test",
    sourceId: "long_book_analysis_source_timeout_test",
    sourceRevision: 1,
    fingerprint: "a".repeat(64),
    range: { start: 1, end: 1 },
    confirmedAt: new Date().toISOString()
  };
  const accepted = async (
    command: CommandEnvelope
  ): Promise<CommandResult> => ({
    status: "accepted",
    requestId: command.id,
    payload:
      command.type === "longBookAnalysis.coreSource"
        ? {
            confirmation,
            source: {
              id: confirmation.sourceId,
              kind: "txt",
              name: "合成超时样书",
              revision: 1,
              fingerprint: confirmation.fingerprint,
              diagnostics: [],
              chapters: [
                {
                  id: "source_chapter_1",
                  order: 1,
                  title: "第一章",
                  sourceName: "合成超时样书.txt",
                  text: "合成正文。",
                  charCount: 5
                }
              ]
            }
          }
        : command.type === "longBookDecomposition.coreCreate"
          ? command.payload.job
          : {}
  });
  const core = vi.fn(accepted);
  const coreLong = vi.fn(accepted);
  const context = {
    core,
    coreLong,
    getWorkspaceDirectory: async () => "/synthetic-workspace",
    resolveModel: async () => undefined,
    evaluationMode: true
  } as unknown as ExtrasAgentCommandContext;
  const config = {
    resolve: async () => DEFAULT_DECOMPOSITION_PROFILE
  } as unknown as ExtrasAgentConfigStore;
  const command = CommandEnvelopeSchema.parse(
    createEnvelope(
      "longBookDecomposition.createJob",
      {
        confirmation,
        profileId: DEFAULT_DECOMPOSITION_PROFILE.id,
        mode: "continuation",
        targetSelection: { action: "create", kind: "long", title: "合成诊断" },
        models: {
          reading: { modelId: "faux", thinkingLevel: "off" },
          integration: { modelId: "faux", thinkingLevel: "off" }
        },
        autoContinue: false
      },
      { id: "cmd_timeout_test" }
    )
  );
  return { context, config, command, core, coreLong };
}

it("整书目标准备使用长任务通道，来源确认仍使用普通通道", async () => {
  const f = fixture();
  expect(
    await handleDecompositionCommands(f.context, f.config, f.command)
  ).toMatchObject({
    status: "accepted",
    requestId: f.command.id
  });
  expect(f.core.mock.calls.map(([command]) => command.type)).toEqual([
    "longBookAnalysis.coreSource"
  ]);
  expect(f.coreLong.mock.calls.map(([command]) => command.type)).toEqual([
    "longBookDecomposition.coreCreate"
  ]);
});

it("创建超时返回结构化错误和原任务 ID，异步错误不再逃出 IPC", async () => {
  const f = fixture();
  f.coreLong.mockRejectedValueOnce(new UtilityCommandTimeoutError("合成超时"));
  const result = await handleDecompositionCommands(
    f.context,
    f.config,
    f.command
  );
  const sent = f.coreLong.mock.calls[0]![0];
  if (sent.type !== "longBookDecomposition.coreCreate")
    throw new Error("错误命令");
  expect(result).toMatchObject({
    status: "rejected",
    requestId: f.command.id,
    error: {
      code: "decomposition.command_timeout",
      message: expect.stringContaining("点击继续"),
      details: { jobId: sent.payload.job.id }
    }
  });
  expect(f.coreLong).toHaveBeenCalledTimes(1);
});

it("Core 拒绝创建时仍附带任务 ID 和原始错误详情", async () => {
  const f = fixture();
  f.coreLong.mockImplementationOnce(async (command) => ({
    status: "rejected",
    requestId: command.id,
    error: {
      code: "decomposition.command_failed",
      message: "模拟写入失败",
      details: { storageCode: "disk_full" }
    }
  }));
  expect(
    await handleDecompositionCommands(f.context, f.config, f.command)
  ).toMatchObject({
    status: "rejected",
    error: {
      message: "模拟写入失败",
      details: {
        jobId: expect.stringMatching(/^ldjob_/u),
        storageCode: "disk_full"
      }
    }
  });
});

it.each([
  ["get", undefined, true],
  ["save-registry", undefined, true],
  ["control", "resume", true],
  ["control", "advance", true],
  ["control", "stop", false],
  ["control", "finish-package", false],
  ["list", undefined, false]
] as const)("Core %s/%s 选择对应等待期限", async (operation, action, long) => {
  const f = fixture();
  await decompositionCore(f.context, f.command, {
    operation,
    jobId: "ldjob_timeout_test",
    ...(action ? { control: { jobId: "ldjob_timeout_test", action } } : {})
  });
  expect(long ? f.coreLong : f.core).toHaveBeenCalledTimes(1);
  expect(long ? f.core : f.coreLong).not.toHaveBeenCalled();
});

it("继续任务的异步超时也经过统一错误处理", async () => {
  const f = fixture();
  f.coreLong.mockRejectedValueOnce(
    new UtilityCommandTimeoutError("合成恢复超时")
  );
  const command = CommandEnvelopeSchema.parse(
    createEnvelope(
      "longBookDecomposition.control",
      { jobId: "ldjob_timeout_test", action: "resume" },
      { id: "cmd_resume_timeout" }
    )
  );
  expect(
    await handleDecompositionCommands(f.context, f.config, command)
  ).toMatchObject({
    status: "rejected",
    error: { code: "decomposition.command_timeout" }
  });
});

it("未提供长任务通道的调用方仍可创建任务", async () => {
  const f = fixture();
  delete f.context.coreLong;
  expect(
    await handleDecompositionCommands(f.context, f.config, f.command)
  ).toMatchObject({ status: "accepted" });
  expect(f.core).toHaveBeenCalledTimes(2);
});
