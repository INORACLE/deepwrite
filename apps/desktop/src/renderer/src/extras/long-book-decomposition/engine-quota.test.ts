import { afterEach, expect, it, vi } from "vitest";
import { createSSRApp, shallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import type { LongBookDecompositionJob } from "@deepwrite/contracts/renderer";
import { runEvent } from "../agent-runtime/extrasAgent.test-support";
import { decompositionEngineFixture as fixture } from "./engine.test-support";
import { createScopedTranslator } from "../../i18n";
import DecompositionProgress from "./DecompositionProgress.vue";
import type { LongBookDecompositionController } from "./useLongBookDecomposition";

const t = createScopedTranslator("extras.longBookDecomposition");
afterEach(() => vi.restoreAllMocks());

function fail(f: ReturnType<typeof fixture>, child = false) {
  f.extras.run.mockImplementation(async (request) => {
    const unit = f.stored().units["chunk:1"]!;
    f.stored().status = "running";
    f.stored().activeAttemptId = "attempt_ui";
    Object.assign(unit, { status: "running", attemptId: "attempt_ui" });
    const runtime = { provider: "test", model: "test", mode: "provider" };
    setTimeout(() => {
      if (child) {
        const base = {
          parentToolCallId: "call_reader",
          subagentRunId: "run_reader",
          subagentId: "reader",
          name: "通读员",
          runtime
        };
        f.engine.handleEvent(
          runEvent("subagent.started", request, { ...base, task: "chunk:1" })
        );
        f.engine.handleEvent(
          runEvent("subagent.completed", request, {
            ...base,
            status: "error",
            summary: "子智能体执行失败：用户额度已用尽",
            errorMessage: "用户额度已用尽"
          })
        );
      } else {
        f.engine.handleEvent(
          runEvent("agent.error", request, {
            code: "pi_agent.error",
            message: "429 insufficient_quota"
          })
        );
      }
    }, 0);
    return {
      sessionId: request.sessionId,
      runId: `${request.sessionId}-run`,
      acceptedAt: new Date().toISOString(),
      runtime: { ...runtime, mode: "provider" as const }
    };
  });
}

it("额度耗尽不等待卡住的任务读取，显示继续且丢弃迟到的运行快照", async () => {
  const f = fixture();
  fail(f);
  let resolve!: (job: LongBookDecompositionJob) => void;
  let claimed!: LongBookDecompositionJob;
  f.getJob.mockImplementationOnce(() => {
    claimed = structuredClone(f.stored());
    return new Promise((done) => (resolve = done));
  });
  const run = f.engine.run();
  try {
    await vi.waitFor(() => expect(f.engine.isBusy.value).toBe(false));
    await run;
    expect(f.extras.run).toHaveBeenCalledTimes(1);
    expect(f.control.mock.calls.map(([input]) => input.action)).toEqual([
      "resume",
      "stop"
    ]);
    expect(f.engine.job.value).toMatchObject({
      status: "stopped",
      lastError: expect.stringContaining("insufficient_quota")
    });
    expect(f.stored().units["chunk:1"]).toMatchObject({
      status: "pending",
      attempts: 0
    });
    expect(f.engine.error.value).toContain("insufficient_quota");
    const html = await renderToString(
      createSSRApp(DecompositionProgress, {
        controller: {
          ...f.engine,
          registry: shallowRef(null)
        } as unknown as LongBookDecompositionController,
        disabled: false
      })
    );
    expect(html).toMatch(
      new RegExp(
        `<button(?![^>]*disabled)[^>]*>\\s*${t("resume")}\\s*</button>`,
        "u"
      )
    );
    expect(html).toContain(t("quotaPaused"));
    expect(html).not.toContain(t("stop"));
    resolve(claimed);
    await Promise.resolve();
    expect(f.engine.job.value?.status).toBe("stopped");
  } finally {
    f.engine.dispose();
  }
});

it("子智能体额度耗尽时中止整包，不等主控回复，补充额度后继续原任务", async () => {
  const f = fixture();
  const completed = structuredClone({
    ...f.stored().units["chunk:1"]!,
    status: "done" as const
  });
  f.stored().units["chunk:saved"] = completed;
  fail(f, true);
  try {
    await f.engine.run();
    expect(f.api.session.abort).toHaveBeenCalledTimes(1);
    expect(f.engine.isBusy.value).toBe(false);
    expect(f.engine.job.value?.status).toBe("stopped");
    expect(f.engine.error.value).toContain("用户额度已用尽");
    expect(f.engine.subtasks.packages.value[0]).toMatchObject({
      outcome: "stopped"
    });
    expect(f.extras.run).toHaveBeenCalledTimes(1);
    expect(f.stored().units["chunk:saved"]).toEqual(completed);
    f.accept();
    await f.engine.run();
    expect(f.extras.run).toHaveBeenCalledTimes(2);
    expect(f.engine.job.value?.phase).toBe("registry_review");
    expect(f.engine.error.value).toBeNull();
    expect(f.stored().units["chunk:saved"]).toEqual(completed);
  } finally {
    f.engine.dispose();
  }
});

it("启动拒绝和运行错误保留结构化额度错误码，不进入并发等待或普通重试", async () => {
  for (const beforeAcceptance of [true, false]) {
    const f = fixture();
    if (beforeAcceptance)
      f.extras.run.mockRejectedValue({
        code: "insufficient_quota",
        message: "合成请求失败"
      });
    else {
      fail(f);
      const original = f.engine.handleEvent;
      f.engine.handleEvent = (event) =>
        original(
          event.type === "agent.error"
            ? {
                ...event,
                payload: {
                  ...event.payload,
                  code: "insufficient_quota",
                  message: "合成请求失败"
                }
              }
            : event
        );
    }
    try {
      await f.engine.run();
      expect(f.extras.run).toHaveBeenCalledTimes(1);
      expect(f.engine.waitingForSlot.value).toBe(false);
      expect(f.engine.job.value?.status).toBe("stopped");
      expect(f.engine.error.value).toContain("合成请求失败");
      expect(f.engine.error.value).toBe(
        t("quotaError", { reason: "合成请求失败" })
      );
    } finally {
      f.engine.dispose();
    }
  }
});
