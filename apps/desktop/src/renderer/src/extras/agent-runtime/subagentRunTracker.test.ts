import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createSubagentRunTracker,
  type SubagentTrackerEvent
} from "./subagentRunTracker";

const runtime = { provider: "test", model: "m", mode: "provider" } as const;
let tick = 0;
let frames: Array<() => void> = [];
beforeEach(() => {
  tick = 0;
  frames = [];
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function event(type: string, payload: Record<string, unknown>) {
  tick++;
  return {
    id: `event_${tick}`,
    timestamp: new Date(1_700_000_000_000 + tick * 1_000).toISOString(),
    type,
    payload: {
      sessionId: "s",
      runId: "r",
      parentToolCallId: "call",
      ...payload
    }
  } as unknown as SubagentTrackerEvent;
}
const planned = (
  ...tasks: Array<{ key: string; task: string; dependsOn?: string[] }>
) =>
  event("subagent.planned", {
    tasks: tasks.map(({ key, task, dependsOn }, index) => ({
      index,
      key,
      dependsOn: dependsOn ?? [],
      subagentId: "character_archivist",
      name: "人物档案师",
      task,
      runtime
    }))
  });
const child = (id: string, key?: string) => ({
  subagentRunId: id,
  subagentId: "character_archivist",
  name: "人物档案师",
  runtime,
  ...(key ? { batchTask: { index: 0, key, dependsOn: [] } } : {})
});
const started = (id: string, key: string, task: string) =>
  event("subagent.started", { ...child(id, key), task });
const activity = (id: string, activity: Record<string, unknown>) =>
  event("subagent.activity", { ...child(id), activity });
const runs = (tracker: ReturnType<typeof createSubagentRunTracker>) =>
  tracker.packages.value[0]!.message.subagentRuns!;

it("排定的任务先排队，开始后接管同一张卡，结束时带交接摘要", () => {
  const tracker = createSubagentRunTracker();
  tracker.begin({
    phase: "integrate",
    unitIds: ["character:a", "character:b"]
  });
  tracker.handleEvent(
    planned(
      { key: "a", task: "character:a" },
      { key: "b", task: "character:b", dependsOn: ["a"] }
    )
  );
  expect(runs(tracker).map(({ status }) => status)).toEqual([
    "queued",
    "queued"
  ]);
  tracker.handleEvent(started("sub_a", "a", "character:a"));
  expect(runs(tracker)).toHaveLength(2);
  expect(runs(tracker)[0]).toMatchObject({
    subagentRunId: "sub_a",
    status: "running"
  });
  expect(runs(tracker)[1]!.batchTask?.dependsOn).toEqual(["a"]);
  tracker.handleEvent(
    event("subagent.completed", {
      ...child("sub_a", "a"),
      status: "completed",
      summary: "已保存"
    })
  );
  expect(runs(tracker)[0]).toMatchObject({
    status: "completed",
    summary: "已保存"
  });
});

it("文字碎片每帧只应用一次，工具事件不会越过之前的文字", () => {
  const tracker = createSubagentRunTracker();
  tracker.begin({ phase: "read", unitIds: ["chunk:1"] });
  tracker.handleEvent(started("sub", "t", "chunk:1"));
  for (const delta of ["思", "考", "中"])
    tracker.handleEvent(activity("sub", { type: "thinking_delta", delta }));
  expect(runs(tracker)[0]!.thinking).toBeUndefined();
  tracker.handleEvent(
    activity("sub", {
      type: "tool_requested",
      toolCallId: "tool_1",
      toolName: "read_cards",
      args: {}
    })
  );
  const run = runs(tracker)[0]!;
  expect(run.thinking).toBe("思考中");
  expect(run.processingSteps.map(({ type }) => type)).toEqual([
    "thinking",
    "tool"
  ]);
  tracker.handleEvent(activity("sub", { type: "message_delta", delta: "好" }));
  frames.forEach((frame) => frame());
  expect(run.output).toBe("好");
});

it("模型重试回到本轮开始前的状态", () => {
  const tracker = createSubagentRunTracker();
  tracker.begin({ phase: "read", unitIds: ["chunk:1"] });
  tracker.handleEvent(started("sub", "t", "chunk:1"));
  const turn = { turnId: "turn_1", maxAttempts: 3 };
  tracker.handleEvent(
    activity("sub", { type: "turn_started", attempt: 1, ...turn })
  );
  tracker.handleEvent(
    activity("sub", { type: "thinking_delta", delta: "半截想法" })
  );
  tracker.handleEvent(
    activity("sub", {
      type: "retry_scheduled",
      ...turn,
      failedAttempt: 1,
      nextAttempt: 2,
      delayMs: 1_000,
      retryAt: new Date(1_700_000_100_000).toISOString(),
      reason: "provider"
    })
  );
  const run = runs(tracker)[0]!;
  expect(run.thinking).toBeUndefined();
  expect(run.retry).toMatchObject({ state: "scheduled", attempt: 2 });
});

it("工作包结束时把没有结束事件的子任务收尾，并清掉待分派", () => {
  const tracker = createSubagentRunTracker();
  tracker.begin({
    phase: "integrate",
    unitIds: ["character:a", "character:b"]
  });
  tracker.handleEvent(
    planned(
      { key: "a", task: "character:a" },
      { key: "b", task: "character:b" }
    )
  );
  tracker.handleEvent(started("sub_a", "a", "character:a"));
  tracker.end("stopped");
  const pkg = tracker.packages.value[0]!;
  expect(runs(tracker).map(({ status }) => status)).toEqual([
    "stopped",
    "stopped"
  ]);
  expect(pkg).toMatchObject({ outcome: "stopped" });
  expect(pkg.endedAt).toBeDefined();
  expect(tracker.parent.value).toEqual({ kind: "idle" });

  tracker.begin({ phase: "integrate", unitIds: ["character:a"] });
  tracker.handleEvent(planned({ key: "a", task: "character:a" }));
  tracker.end("failed", "模型不可用");
  expect(runs(tracker)[0]).toMatchObject({
    status: "error",
    errorMessage: "模型不可用"
  });
});

it("没派出子任务就失败的包记下失败原因", () => {
  const tracker = createSubagentRunTracker();
  tracker.begin({ phase: "registry", unitIds: ["registry:merge"] });
  tracker.end("failed", "方案、阶段或目标状态与任务快照不一致。");
  expect(tracker.packages.value[0]).toMatchObject({
    outcome: "failed",
    failureReason: "方案、阶段或目标状态与任务快照不一致。"
  });
  tracker.begin({ phase: "registry", unitIds: ["registry:merge"] });
  tracker.end("completed");
  expect(tracker.packages.value[0]!.failureReason).toBeUndefined();
});

it("只保留最近几个工作包，没派出任何子任务的已结束包不占位", () => {
  const tracker = createSubagentRunTracker({ keepPackages: 2 });
  for (const phase of ["read", "integrate", "review"]) {
    tracker.begin({ phase, unitIds: ["character:a"] });
    tracker.handleEvent(planned({ key: "a", task: "character:a" }));
    tracker.end("completed");
  }
  expect(tracker.packages.value.map(({ phase }) => phase)).toEqual([
    "review",
    "integrate"
  ]);
  tracker.begin({ phase: "read", unitIds: ["chunk:1"] });
  tracker.end("stopped");
  tracker.begin({ phase: "read", unitIds: ["chunk:1"] });
  expect(tracker.packages.value.map(({ phase }) => phase)).toEqual([
    "read",
    "review"
  ]);
});

it("主控活动随回调变化，结束后回到空闲", () => {
  const tracker = createSubagentRunTracker();
  tracker.begin({ phase: "read", unitIds: ["chunk:1"] });
  tracker.parentCallbacks.onToolRequested?.("spawn_subagent");
  expect(tracker.parent.value).toEqual({
    kind: "tool",
    toolName: "spawn_subagent"
  });
  tracker.parentCallbacks.onToolCompleted?.("spawn_subagent", false);
  expect(tracker.parent.value).toEqual({ kind: "thinking" });
  tracker.end("completed");
  expect(tracker.parent.value).toEqual({ kind: "idle" });
});
