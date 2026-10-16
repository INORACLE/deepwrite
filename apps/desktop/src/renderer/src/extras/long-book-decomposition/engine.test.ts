import { afterEach, expect, it, vi } from "vitest";
import {
  readyDecompositionUnitIds,
  type DeepWriteApi,
  type LongBookDecompositionJob
} from "@deepwrite/contracts/renderer";
import { runEvent } from "../agent-runtime/extrasAgent.test-support";
import {
  decompositionEngineFixture as fixture,
  model
} from "./engine.test-support";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it.each(["pending", "failed"] as const)(
  "收尾单元为 %s 时只推进 Core，不派发模型工作包",
  async (status) => {
    const f = fixture();
    const stored = f.stored();
    stored.phase = "finalize";
    stored.status = "failed";
    stored.units["chunk:1"]!.status = "done";
    stored.units["summary:characters"] = {
      ...structuredClone(stored.units["chunk:1"]!),
      phase: "finalize",
      status
    };
    const completed = structuredClone(stored.units["chunk:1"]!);
    f.engine.job.value = structuredClone(stored);
    f.control.mockImplementation(async ({ action }) => {
      if (action === "resume") stored.status = "idle";
      if (action === "advance") {
        stored.units["summary:characters"]!.status = "done";
        stored.phase = "done";
        stored.status = "completed";
      }
      return structuredClone(stored);
    });
    expect(readyDecompositionUnitIds(stored)).toEqual([]);
    await f.engine.run();
    expect(f.control.mock.calls.map(([input]) => input.action)).toEqual([
      "resume",
      "advance"
    ]);
    expect(f.extras.run).not.toHaveBeenCalled();
    expect(f.engine.job.value).toMatchObject({
      phase: "done",
      status: "completed"
    });
    expect(f.engine.job.value?.units["chunk:1"]).toEqual(completed);
    expect(f.engine.error.value).toBeNull();
    f.engine.dispose();
  }
);

it("收尾再次失败时保留真实错误与检查点，不派发模型任务", async () => {
  const f = fixture();
  f.stored().phase = "finalize";
  f.stored().units["chunk:1"]!.status = "done";
  f.stored().units["summary:characters"] = {
    ...structuredClone(f.stored().units["chunk:1"]!),
    phase: "finalize",
    status: "pending"
  };
  f.engine.job.value = structuredClone(f.stored());
  const control = f.control.getMockImplementation()!;
  f.control.mockImplementation(async (input) => {
    if (input.action === "advance")
      throw { code: "storage.write_failed", message: "人物概览写入失败" };
    return control(input);
  });
  await f.engine.run();
  expect(f.extras.run).not.toHaveBeenCalled();
  expect(f.engine.error.value).toBe("人物概览写入失败");
  expect(f.engine.job.value?.phase).toBe("finalize");
  expect(f.engine.isBusy.value).toBe(false);
  f.engine.dispose();
});

it("名额不足时等待并重试，不增加单元失败次数，名册确认时停下", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.accept();
  f.extras.run.mockRejectedValueOnce({
    code: "agent.extras_capacity_reached",
    message: "名额暂满"
  });
  const run = f.engine.run();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.engine.waitingForSlot.value).toBe(true);
  expect(f.stored().units["chunk:1"]!.attempts).toBe(0);
  await vi.advanceTimersByTimeAsync(5001);
  await run;
  expect(f.extras.run).toHaveBeenCalledTimes(2);
  expect(f.engine.job.value?.phase).toBe("registry_review");
  expect(f.engine.error.value).toBeNull();
  // The refused attempt delegated nothing, so it leaves no empty package.
  expect(f.engine.subtasks.packages.value).toHaveLength(1);
  expect(
    f.control.mock.calls.filter(([input]) => input.action === "finish-package")
  ).toHaveLength(1);
  f.engine.dispose();
});

it("工作包里的子任务事件进入看板，包结束后收尾", async () => {
  const f = fixture();
  f.accept();
  const base = f.extras.run.getMockImplementation()!;
  const at = (n: number) =>
    new Date(1_700_000_000_000 + n * 1_000).toISOString();
  const child = {
    parentToolCallId: "call",
    subagentRunId: "sub_1",
    subagentId: "reader",
    name: "通读员",
    runtime: { provider: "test", model: "test", mode: "provider" }
  };
  f.extras.run.mockImplementation(async (request) => {
    const send = (n: number, type: string, payload: Record<string, unknown>) =>
      f.engine.handleEvent({
        ...runEvent(type, request, payload),
        id: `event_${n}`,
        timestamp: at(n)
      });
    // Registered before the base mock's own completion timer.
    setTimeout(() => {
      send(1, "subagent.planned", {
        parentToolCallId: "call",
        tasks: [
          {
            index: 0,
            key: "t1",
            dependsOn: [],
            subagentId: "reader",
            name: "通读员",
            task: "chunk:1",
            runtime: child.runtime
          }
        ]
      });
      send(2, "subagent.started", {
        ...child,
        task: "chunk:1",
        batchTask: { index: 0, key: "t1", dependsOn: [] }
      });
      send(3, "subagent.completed", {
        ...child,
        status: "completed",
        summary: "已保存",
        batchTask: { index: 0, key: "t1", dependsOn: [] }
      });
    }, 0);
    return base(request);
  });
  await f.engine.run();
  const [pkg] = f.engine.subtasks.packages.value;
  expect(pkg).toMatchObject({ phase: "read", outcome: "completed" });
  expect(pkg!.unitIds).toEqual(["chunk:1"]);
  expect(pkg!.message.subagentRuns).toHaveLength(1);
  expect(pkg!.message.subagentRuns![0]).toMatchObject({
    name: "通读员",
    status: "completed",
    summary: "已保存"
  });
  expect(f.engine.subtasks.parent.value).toEqual({ kind: "idle" });
  // Another task starts with an empty board.
  f.engine.job.value = null;
  await Promise.resolve();
  expect(f.engine.subtasks.packages.value).toHaveLength(0);
  f.engine.dispose();
});

it("工作包被接受后立即显示运行中，不等第一章保存", async () => {
  const f = fixture();
  let accepted: { sessionId: string } | undefined;
  f.extras.run.mockImplementation(async (request) => {
    accepted = request;
    Object.assign(f.stored(), {
      status: "running",
      activeAttemptId: "attempt_ui"
    });
    Object.assign(f.stored().units["chunk:1"]!, {
      status: "running",
      attemptId: "attempt_ui"
    });
    return {
      sessionId: request.sessionId,
      runId: `${request.sessionId}-run`,
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "test", model: "test", mode: "local-faux" }
    };
  });
  const run = f.engine.run();
  await vi.waitFor(() =>
    expect(f.engine.job.value?.units["chunk:1"]?.status).toBe("running")
  );
  expect(f.control.mock.calls.map(([input]) => input.action)).toEqual([
    "resume"
  ]);
  f.engine.handleEvent(
    runEvent("agent.message_completed", accepted!, {
      content: "已保存",
      stopReason: "stop"
    })
  );
  await run;
  expect(f.engine.job.value?.phase).toBe("registry_review");
  f.engine.dispose();
});

it("等待名额期间停止，不派新工作包且保持检查点", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.extras.run.mockRejectedValue({ code: "agent.capacity_reached" });
  const run = f.engine.run();
  await vi.advanceTimersByTimeAsync(0);
  await f.engine.stop();
  await run;
  await vi.advanceTimersByTimeAsync(6000);
  expect(f.extras.run).toHaveBeenCalledTimes(1);
  expect(f.engine.waitingForSlot.value).toBe(false);
  expect(f.stored().units["chunk:1"]!.attempts).toBe(0);
  expect(f.engine.job.value?.status).toBe("stopped");
  f.engine.dispose();
});

it("异步旧任务刷新返回时不能替换后来选中的任务", async () => {
  const f = fixture();
  let resolve!: (job: LongBookDecompositionJob) => void;
  f.getJob.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const refreshing = f.engine.refresh();
  f.engine.job.value = { ...f.stored(), id: "ldjob_new_selection" };
  resolve(f.stored());
  await refreshing;
  expect(f.engine.job.value.id).toBe("ldjob_new_selection");
  f.engine.dispose();
});

it("恢复发现用户修改冲突时，通过既有错误通知机制提示处理选择", async () => {
  const f = fixture();
  f.stored().units["chunk:1"]!.status = "conflict";
  f.stored().units["chunk:1"]!.lastError =
    "生成条目已被编辑，请选择保留内容或重新生成。";
  await f.engine.refresh();
  expect(f.engine.error.value).toBe(f.stored().units["chunk:1"]!.lastError);
  expect(f.extras.run).not.toHaveBeenCalled();
  f.engine.dispose();
});

it("标准模型没有手填窗口时，以运行时目录容量预检并继续拆解", async () => {
  vi.useFakeTimers();
  const { contextWindow: _window, maxTokens: _output, ...standard } = model;
  const f = fixture(standard);
  const resolveCapacity = vi.fn(async (input) => {
    expect(input).not.toHaveProperty("hasApiKey");
    structuredClone(input);
    return { modelId: model.id, contextWindow: 128_000, maxTokens: 8192 };
  });
  f.api.models = { resolveCapacity } as unknown as DeepWriteApi["models"];
  f.accept();
  const run = f.engine.run();
  await vi.advanceTimersByTimeAsync(1);
  await run;
  expect(resolveCapacity).toHaveBeenCalledTimes(1);
  expect(f.extras.run).toHaveBeenCalledTimes(1);
  expect(f.engine.job.value?.phase).toBe("registry_review");
  expect(f.engine.error.value).toBeNull();
  f.engine.dispose();
});

it("查询模型容量期间停止，不派发迟到的工作包", async () => {
  const { contextWindow: _window, maxTokens: _output, ...standard } = model;
  const f = fixture(standard);
  let resolve!: (capacity: {
    modelId: string;
    contextWindow: number;
    maxTokens: number;
  }) => void;
  const resolveCapacity = vi.fn(
    () => new Promise<Parameters<typeof resolve>[0]>((done) => (resolve = done))
  );
  f.api.models = { resolveCapacity } as unknown as DeepWriteApi["models"];
  const run = f.engine.run();
  await vi.waitFor(() => expect(resolveCapacity).toHaveBeenCalledTimes(1));
  await f.engine.stop();
  resolve({ modelId: model.id, contextWindow: 128_000, maxTokens: 8192 });
  await run;
  expect(f.extras.run).not.toHaveBeenCalled();
  expect(f.engine.job.value?.status).toBe("stopped");
  f.engine.dispose();
});

it("模型超时重试三次后保留任务，继续只恢复失败单元", async () => {
  const f = fixture();
  const unit = f.stored().units["chunk:1"]!;
  const completed = structuredClone({ ...unit, status: "done" as const });
  f.stored().units["chunk:completed"] = completed;
  f.control.mockImplementation(async (input) => {
    if (input.action === "resume") {
      if (unit.status === "failed") {
        unit.status = "pending";
        unit.attempts = 0;
        delete unit.lastError;
      }
      f.stored().status = "idle";
    }
    if (input.action === "finish-package") {
      if (input.failed) {
        unit.attempts++;
        unit.status = unit.attempts >= 3 ? "failed" : "pending";
        unit.lastError = input.error;
        f.stored().status = unit.status === "failed" ? "failed" : "idle";
      } else {
        unit.status = "done";
        f.stored().status = "idle";
      }
    }
    if (input.action === "advance") f.stored().phase = "registry_review";
    return structuredClone(f.stored());
  });
  f.extras.run.mockImplementation(async (request) => {
    f.stored().status = "running";
    unit.status = "running";
    unit.attemptId = "attempt_ui";
    setTimeout(
      () =>
        f.engine.handleEvent(
          runEvent("agent.error", request, {
            code: "agent.request_timeout",
            message: "合成模型响应超时"
          })
        ),
      0
    );
    return {
      sessionId: request.sessionId,
      runId: `${request.sessionId}-run`,
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "test", model: "test", mode: "local-faux" }
    };
  });
  await f.engine.run();
  expect(f.extras.run).toHaveBeenCalledTimes(3);
  expect(f.engine.job.value).toMatchObject({
    id: f.stored().id,
    status: "failed"
  });
  expect(f.engine.error.value).toBe("合成模型响应超时");
  expect(f.engine.isBusy.value).toBe(false);
  expect(unit).toMatchObject({ status: "failed", attempts: 3 });
  f.accept();
  await f.engine.run();
  expect(f.extras.run).toHaveBeenCalledTimes(4);
  expect(f.engine.job.value?.phase).toBe("registry_review");
  expect(f.engine.error.value).toBeNull();
  expect(f.stored().units["chunk:completed"]).toEqual(completed);
  f.engine.dispose();
});
