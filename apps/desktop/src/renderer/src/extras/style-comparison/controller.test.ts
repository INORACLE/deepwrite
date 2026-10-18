import { describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  type DeepWriteApi,
  type ExtrasAgentRunRequest,
  type ModelConfig,
  type SessionPromptAcceptedPayload,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { createExtrasAgentsFake } from "../agent-runtime/extrasAgent.test-support";
import { createPromptProfile } from "../agent-runtime/promptProfile";
import { createStyleComparisonController } from "./controller";
import { styleComparisonPreview } from "./result";

const model: ModelConfig = {
  id: "test-model",
  label: "测试模型",
  provider: "custom",
  modelId: "test",
  api: "openai-completions",
  baseUrl: "https://provider.example.test/v1",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0, 0.7, 1],
  hasApiKey: false
};
const runtime = {
  provider: "custom",
  model: "test",
  mode: "provider" as const
};
const result = {
  summary: "两段的短句节奏接近，但意象不同。",
  dimensions: ["用词", "节奏", "语气"].map((name) => ({
    name,
    score: 70,
    reason: "A 的“雨停”与 B 的“风停”都很简短。"
  })),
  similarities: ["短句为主。"],
  differences: ["意象不同。"],
  score: 70
};
const defaultProfile = {
  id: "default",
  name: "文风比对",
  description: "测试方法",
  systemPrompt: "默认方法"
};

function setup(
  customRun?: (
    request: ExtrasAgentRunRequest
  ) => Promise<SessionPromptAcceptedPayload>
) {
  let listener: ((event: SystemEventEnvelope) => void) | undefined;
  let counter = 0;
  const fake = createExtrasAgentsFake({ "style-comparison": [defaultProfile] });
  const requests: ExtrasAgentRunRequest[] = [];
  fake.run.mockImplementation(async (request) => {
    requests.push(request);
    counter++;
    return customRun
      ? customRun(request)
      : {
          sessionId: request.sessionId,
          runId: `run-${counter}`,
          acceptedAt: "2026-09-09T00:00:00.000Z",
          runtime
        };
  });
  const unsubscribe = vi.fn();
  const notifyError = vi.fn();
  const abort = vi.fn(async () => ({
    sessionId: requests.at(-1)!.sessionId,
    runId: `run-${counter}`,
    abortedAt: "2026-09-09T00:00:00.000Z"
  }));
  const api = {
    extrasAgents: fake.extrasAgents,
    session: { abort, submitUserInput: vi.fn() },
    events: {
      subscribe: (cb: (event: SystemEventEnvelope) => void) => {
        listener = cb;
        return unsubscribe;
      }
    }
  } as unknown as Pick<DeepWriteApi, "extrasAgents" | "session" | "events">;
  const method = createPromptProfile(() => api, "style-comparison");
  const controller = createStyleComparisonController({
    api: () => api,
    method,
    notifyError
  });
  controller.referenceText.value = "雨停了。街上很静。";
  controller.comparisonText.value = "风停了。屋里没有声音。";
  const emit = (type: string, payload: Record<string, unknown> = {}) =>
    listener?.(
      createEnvelope(
        type,
        {
          sessionId: requests.at(-1)!.sessionId,
          runId: `run-${counter}`,
          messageId: "message",
          runtime,
          ...payload
        },
        { id: "test-event" }
      ) as SystemEventEnvelope
    );
  const emitResult = (value: unknown = result) =>
    emit("extras_agent.output_updated", {
      agentId: "style-comparison",
      jobId: "job",
      output: { kind: "style-comparison-result", result: value }
    });
  const flush = async () => {
    for (let index = 0; index < 5; index++) await Promise.resolve();
  };
  return {
    controller,
    method,
    fake,
    requests,
    abort,
    notifyError,
    emit,
    emitResult,
    flush,
    unsubscribe
  };
}

describe("文风比对运行与结果", () => {
  it("clears samples and output after a run while preserving model and method settings", async () => {
    const ctx = setup();
    await ctx.controller.start(model);
    expect(() => ctx.controller.resetWorkspace()).toThrow();
    expect(ctx.controller.referenceText.value).not.toBe("");
    ctx.emitResult();
    ctx.emit("agent.message_completed", { content: JSON.stringify(result) });
    await ctx.flush();
    ctx.controller.modelId.value = model.id;
    ctx.controller.resetWorkspace();
    expect(ctx.controller.referenceText.value).toBe("");
    expect(ctx.controller.comparisonText.value).toBe("");
    expect(ctx.controller.result.value).toBeNull();
    expect(ctx.controller.entries.value).toEqual([]);
    expect(ctx.controller.status.value).toBe("idle");
    expect(ctx.controller.modelId.value).toBe(model.id);
    expect(ctx.controller.method.value).toBe(defaultProfile.systemPrompt);
    ctx.controller.dispose();
  });
  it("retains the last completed result through failed and stopped reruns until a new result succeeds", async () => {
    const ctx = setup();
    await ctx.controller.start(model);
    ctx.emitResult();
    ctx.emit("agent.message_completed", { content: JSON.stringify(result) });
    await ctx.flush();
    expect(ctx.controller.isStale.value).toBe(false);

    await ctx.controller.start({ ...model, label: "本次模型" });
    expect(ctx.controller.result.value).toEqual(result);
    expect(ctx.controller.isStale.value).toBe(true);
    expect(ctx.controller.resultModel.value).toBe("测试模型");
    ctx.emit("agent.error", { code: "test.failure", message: "本次请求失败" });
    await ctx.flush();
    expect(ctx.controller.result.value).toEqual(result);
    expect(ctx.controller.isStale.value).toBe(true);
    expect(ctx.controller.error.value).toBe("本次请求失败");

    await ctx.controller.start(model);
    expect(ctx.controller.error.value).toBeNull();
    await ctx.controller.stop();
    await ctx.flush();
    expect(ctx.controller.result.value).toEqual(result);
    expect(ctx.controller.isStale.value).toBe(true);

    await ctx.controller.start({ ...model, label: "本次模型" });
    const nextResult = {
      ...result,
      score: 40,
      summary: "本次文风差异更明显。"
    };
    ctx.emitResult(nextResult);
    ctx.emit("agent.message_completed", {
      content: JSON.stringify(nextResult)
    });
    await ctx.flush();
    expect(ctx.controller.result.value).toEqual(nextResult);
    expect(ctx.controller.isStale.value).toBe(false);
    expect(ctx.controller.resultModel.value).toBe("本次模型");
  });
  it("keeps execution events and public output available without storing thinking content", async () => {
    const ctx = setup();
    await ctx.controller.start(model);
    ctx.emit("agent.turn_started", { attempt: 1 });
    ctx.emit("agent.thinking_delta", { delta: "不展示的内部思考" });
    ctx.emit("agent.thinking_delta", { delta: "更多内部思考" });
    ctx.emit("agent.message_delta", { delta: "公开分析说明" });
    expect(ctx.controller.liveOutput.value).toBe("公开分析说明");
    ctx.emit("agent.retry_scheduled", { delayMs: 2_000 });
    expect(ctx.controller.liveOutput.value).toBe("");
    ctx.emit("agent.turn_started", { attempt: 2 });
    ctx.emitResult();
    ctx.emit("agent.message_completed", { content: JSON.stringify(result) });
    await ctx.flush();
    expect(ctx.controller.entries.value.map((entry) => entry.title)).toEqual([
      "开始文风比对",
      "正在阅读两份文本…",
      "正在思考，分析两份文本的文风…",
      "正在整理关键发现与评分…",
      "连接暂时中断，2 秒后重试…",
      "正在重新连接模型…",
      "已收到完整比对结论",
      "比对完成"
    ]);
    expect(JSON.stringify(ctx.controller.entries.value)).not.toContain(
      "内部思考"
    );
    expect(ctx.controller.liveOutput.value).toContain(result.summary);
    expect(ctx.controller.liveOutput.value).not.toContain('"dimensions"');
    await ctx.controller.start(model);
    expect(ctx.controller.entries.value).toHaveLength(1);
  });
  it("updates activity from reading through thinking and findings to completion", async () => {
    const ctx = setup();
    await ctx.controller.start(model);
    expect(ctx.controller.activity.value).toBe("正在连接比对智能体…");
    ctx.emit("agent.turn_started", { attempt: 1 });
    expect(ctx.controller.activity.value).toBe("正在阅读两份文本…");
    ctx.emit("agent.thinking_delta", { delta: "测试思考内容" });
    expect(ctx.controller.activity.value).toBe("正在思考，分析两份文本的文风…");
    expect(ctx.controller.preview.value).toEqual({
      summary: "",
      dimensions: []
    });
    ctx.emit("agent.message_delta", { delta: JSON.stringify(result) });
    expect(ctx.controller.activity.value).toBe("正在整理关键发现与评分…");
    ctx.emitResult();
    ctx.emit("agent.message_completed", {
      role: "assistant",
      content: JSON.stringify(result)
    });
    await ctx.flush();
    expect(ctx.controller.activity.value).toBe("比对完成");
    ctx.emit("agent.thinking_delta", { delta: "迟到的思考事件" });
    expect(ctx.controller.activity.value).toBe("比对完成");
  });
  it("isolates thinking activity by session and run and preserves retry and stop states", async () => {
    const ctx = setup();
    await ctx.controller.start(model);
    ctx.emit("agent.turn_started", { attempt: 1 });
    for (const context of [
      { sessionId: "unrelated-session" },
      { runId: "unrelated-run" }
    ]) {
      ctx.emit("agent.thinking_delta", { ...context, delta: "无关思考" });
      expect(ctx.controller.activity.value).toBe("正在阅读两份文本…");
    }
    ctx.emit("agent.thinking_delta", { delta: "测试思考" });
    ctx.emit("agent.retry_scheduled", {
      delayMs: 1000,
      nextAttempt: 2,
      maxAttempts: 3
    });
    expect(ctx.controller.activity.value).toBe("连接暂时中断，1 秒后重试…");
    ctx.emit("agent.turn_started", { attempt: 2 });
    expect(ctx.controller.activity.value).toBe("正在重新连接模型…");
    ctx.emit("agent.thinking_delta", { delta: "重试中的思考" });
    expect(ctx.controller.activity.value).toBe("正在思考，分析两份文本的文风…");
    const stopping = ctx.controller.stop();
    ctx.emit("agent.thinking_delta", { delta: "停止期间的思考" });
    expect(ctx.controller.activity.value).toBe("正在停止…");
    await stopping;
    await ctx.flush();
    expect(ctx.controller.activity.value).toBe("已停止比对");
  });
  it("sends the selected thinking level, including off and custom levels", async () => {
    const reasoningModel: ModelConfig = {
      ...model,
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["medium", "high", "custom-effort"]
    };
    for (const level of ["high", "off", "custom-effort"]) {
      const ctx = setup();
      ctx.controller.syncThinkingModel(reasoningModel);
      expect(ctx.controller.thinkingLevel.value).toBe("medium");
      ctx.controller.thinkingLevel.value = level;
      await ctx.controller.start(reasoningModel);
      expect(ctx.requests[0]!.thinkingLevel).toBe(level);
    }
  });
  it("preserves a valid selection and resets it for model changes or removed levels", () => {
    const ctx = setup();
    ctx.controller.syncThinkingModel(model);
    ctx.controller.thinkingLevel.value = "high";
    ctx.controller.syncThinkingModel({ ...model });
    expect(ctx.controller.thinkingLevel.value).toBe("high");
    const nextModel: ModelConfig = {
      ...model,
      id: "another-model",
      reasoning: true,
      defaultThinkingLevel: "medium"
    };
    ctx.controller.syncThinkingModel(nextModel);
    expect(ctx.controller.thinkingLevel.value).toBe("medium");
    ctx.controller.thinkingLevel.value = "high";
    ctx.controller.syncThinkingModel({
      ...nextModel,
      thinkingLevelOptions: ["medium"]
    });
    expect(ctx.controller.thinkingLevel.value).toBe("medium");
    ctx.controller.syncThinkingModel(undefined);
    expect(ctx.controller.thinkingLevel.value).toBe("off");
  });
  it("uses the model default when starting directly and keeps the running selection stable", async () => {
    const ctx = setup();
    await ctx.controller.start({
      ...model,
      reasoning: true,
      defaultThinkingLevel: "high"
    });
    expect(ctx.requests[0]!.thinkingLevel).toBe("high");
    ctx.controller.syncThinkingModel({ ...model, id: "other-model" });
    expect(ctx.controller.thinkingLevel.value).toBe("high");
  });
  it("saves the method to its profile, sends only the samples, and requires the structured score", async () => {
    const ctx = setup();
    await ctx.method.load();
    ctx.controller.method.value = "关注短句";
    await ctx.controller.start(model);
    expect(ctx.fake.save).toHaveBeenCalledWith({
      agentId: "style-comparison",
      baseProfiles: [defaultProfile],
      profiles: [{ ...defaultProfile, systemPrompt: "关注短句" }]
    });
    expect(ctx.requests[0]!.task).toMatchObject({
      agentId: "style-comparison",
      profileId: "default",
      input: {
        referenceText: "雨停了。街上很静。",
        comparisonText: "风停了。屋里没有声音。"
      }
    });
    expect(ctx.requests[0]!.task.input).not.toHaveProperty("method");
    ctx.emit("agent.thinking_delta", { delta: "内部思考不会展示" });
    expect(ctx.controller.preview.value.summary).toBe("");
    ctx.emit("agent.message_delta", {
      delta: JSON.stringify(result).slice(0, -1)
    });
    expect(ctx.controller.preview.value.summary).toBe(result.summary);
    expect(ctx.controller.preview.value.dimensions).toEqual(result.dimensions);
    expect(ctx.controller.result.value).toBeNull();
    ctx.emitResult();
    expect(ctx.controller.result.value).toBeNull();
    ctx.emit("agent.message_completed", {
      role: "assistant",
      content: JSON.stringify(result)
    });
    await ctx.flush();
    expect(ctx.controller.result.value?.score).toBe(70);
    expect(ctx.controller.status.value).toBe("completed");
    ctx.controller.referenceText.value += "新的句子。";
    expect(ctx.controller.isStale.value).toBe(true);
  });
  it("rejects empty input and unavailable models without submitting a run", async () => {
    const ctx = setup();
    ctx.controller.comparisonText.value = "  ";
    await ctx.controller.start(model);
    expect(ctx.fake.run).not.toHaveBeenCalled();
    expect(ctx.notifyError).toHaveBeenCalled();
  });
  it("does not manufacture a score without a validated result", async () => {
    for (const finish of [
      (ctx: ReturnType<typeof setup>) =>
        ctx.emit("agent.message_completed", {
          role: "assistant",
          content: "相似度很高"
        }),
      (ctx: ReturnType<typeof setup>) =>
        ctx.emit("agent.error", {
          code: "extras_agent.invalid_output",
          message: "模型未返回完整的比对结论与有效评分，请重新比对。"
        })
    ]) {
      const ctx = setup();
      await ctx.controller.start(model);
      finish(ctx);
      await ctx.flush();
      expect(ctx.controller.result.value).toBeNull();
      expect(ctx.controller.status.value).toBe("error");
      expect(ctx.notifyError).toHaveBeenCalledWith(
        "模型未返回完整的比对结论与有效评分，请重新比对。"
      );
    }
  });
  it("ignores unrelated and late events and clears partial output for retries", async () => {
    const ctx = setup();
    await ctx.controller.start(model);
    ctx.emit("agent.message_delta", {
      sessionId: "another-session",
      delta: JSON.stringify(result)
    });
    expect(ctx.controller.preview.value.summary).toBe("");
    ctx.emit("agent.message_delta", { delta: JSON.stringify(result) });
    ctx.emit("agent.retry_scheduled", {
      delayMs: 1000,
      nextAttempt: 2,
      maxAttempts: 3
    });
    expect(ctx.controller.preview.value.summary).toBe("");
    await ctx.controller.stop();
    ctx.emitResult();
    ctx.emit("agent.message_completed", {
      role: "assistant",
      content: JSON.stringify(result)
    });
    await ctx.flush();
    expect(ctx.controller.result.value).toBeNull();
    expect(ctx.controller.status.value).toBe("stopped");
  });
  it("stops a run requested before acceptance", async () => {
    let accept: (value: SessionPromptAcceptedPayload) => void = () => undefined;
    const ctx = setup(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    await ctx.controller.start(model);
    await ctx.controller.stop();
    expect(ctx.controller.status.value).toBe("stopping");
    const request = ctx.requests[0]!;
    accept({
      sessionId: request.sessionId,
      runId: "delayed-run",
      acceptedAt: "2026-09-09T00:00:00.000Z",
      runtime
    });
    await ctx.flush();
    expect(ctx.abort).toHaveBeenCalledWith({
      sessionId: request.sessionId,
      runId: "delayed-run"
    });
    expect(ctx.controller.status.value).toBe("stopped");
  });
  it("submits nothing when stopped while the method is being saved", async () => {
    const ctx = setup();
    const started = ctx.controller.start(model);
    await ctx.controller.stop();
    await started;
    expect(ctx.fake.run).not.toHaveBeenCalled();
    expect(ctx.controller.status.value).toBe("stopped");
  });
  it("does not return to running when completion precedes acceptance", async () => {
    let accept: (value: SessionPromptAcceptedPayload) => void = () => undefined;
    const ctx = setup(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    await ctx.controller.start(model);
    ctx.emitResult();
    ctx.emit("agent.message_completed", {
      role: "assistant",
      content: JSON.stringify(result)
    });
    accept({
      sessionId: ctx.requests[0]!.sessionId,
      runId: "run-1",
      acceptedAt: "2026-09-09T00:00:00.000Z",
      runtime
    });
    await ctx.flush();
    expect(ctx.controller.status.value).toBe("completed");
    ctx.controller.dispose();
    expect(ctx.unsubscribe).toHaveBeenCalled();
  });
  it("handles quoted evidence in incremental output", () => {
    expect(
      styleComparisonPreview(JSON.stringify(result).slice(0, -1)).dimensions
    ).toEqual(result.dimensions);
  });
});
