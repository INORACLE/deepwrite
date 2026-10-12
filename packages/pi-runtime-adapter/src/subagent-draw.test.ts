import type { AgentToolResult, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Api,
  type AssistantMessage,
  type Context,
  type TranscriptContext,
  type Model
} from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentUserInputAnswer,
  SubagentDrawSettings
} from "@deepwrite/contracts";
import type { AgentUserInputRequest } from "./runtime-types";
import {
  buildSpawnSubagentTool,
  isSubagentToolProgressDetails,
  type RuntimeSubagentDefinition,
  type SubagentToolDetails,
  type SubagentToolProgress
} from "./subagent-runtime";
import { createConcurrencyLimiter } from "./concurrency-limiter";
import { inspectTranscript } from "./transcript.test-support";

const EVALUATOR_MARK = "【抽卡评估运行边界】";

function drawMember(
  draw: Partial<SubagentDrawSettings> = {},
  agentMode: RuntimeSubagentDefinition["agentMode"] = "pure-bare"
): RuntimeSubagentDefinition {
  return {
    id: "titler",
    name: "标题助手",
    description: "起章节标题。",
    systemPrompt: "只输出标题。",
    enabled: true,
    modelMode: "inherit",
    agentMode,
    draw: {
      enabled: true,
      count: 3,
      selection: "manual",
      evaluator: { modelMode: "inherit" },
      ...draw
    }
  };
}

const follower: RuntimeSubagentDefinition = {
  id: "follower",
  name: "后续成员",
  description: "接着做。",
  systemPrompt: "接着做。",
  enabled: true,
  modelMode: "inherit"
};

type Responder = (context: Context) => AssistantMessage;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Drafts answer `草稿N` in arrival order; the evaluator's turns go to
 * `evaluator`. `gate` holds every request until that many have arrived, which
 * only finishes when the draws really run at the same time.
 */
function harness(options: {
  definitions: RuntimeSubagentDefinition[];
  gate?: number;
  draft?: (arrival: number) => AssistantMessage;
  evaluator?: Responder;
  answer?: (request: AgentUserInputRequest) => AgentUserInputAnswer;
}) {
  const faux = fauxProvider({
    api: `subagent-draw-${Math.random()}`,
    provider: `subagent-draw-${Math.random()}`,
    models: [{ id: "child-model", name: "Child Model", reasoning: true }],
    tokensPerSecond: 0
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const contexts: Context[] = [];
  let drafts = 0;
  const respond = (transcript: TranscriptContext) => {
    const context = inspectTranscript(transcript);
    if (context.systemPrompt?.includes(EVALUATOR_MARK)) {
      return options.evaluator
        ? options.evaluator(context)
        : fauxAssistantMessage("没有评估回应");
    }
    drafts += 1;
    return options.draft?.(drafts) ?? fauxAssistantMessage(`草稿${drafts}`);
  };
  faux.setResponses(Array.from({ length: 40 }, () => respond));
  const model = faux.getModel("child-model") as Model<Api>;
  const source = models.streamSimple.bind(models) as StreamFn;
  const gate = deferred();
  let arrivals = 0;
  const streamFn: StreamFn = async (requestModel, context, streamOptions) => {
    contexts.push(inspectTranscript(context));
    arrivals += 1;
    if (arrivals >= (options.gate ?? 1)) gate.resolve();
    await gate.promise;
    return source(requestModel, context, streamOptions);
  };
  const requests: AgentUserInputRequest[] = [];
  const requestUserInput = vi.fn(async (request: AgentUserInputRequest) => {
    requests.push(request);
    return {
      sessionId: "parent-session",
      runId: "parent-run",
      requestId: `request_${requests.length}`,
      answers: [
        options.answer?.(request) ?? {
          id: "draw",
          selectedOptionIds: ["c2"]
        }
      ]
    };
  });
  let sequence = 0;
  const tool = buildSpawnSubagentTool({
    parentSessionId: "parent-session",
    model,
    thinkingLevel: "medium",
    streamFn,
    definitions: options.definitions,
    buildChildTools: () => [],
    createRunId: () => `subrun_${++sequence}`,
    requestUserInput
  });
  if (!tool) throw new Error("spawn_subagent was not built");
  return { tool, contexts, requests, requestUserInput };
}

async function run(
  tool: NonNullable<ReturnType<typeof buildSpawnSubagentTool>>,
  tasks: unknown[]
) {
  const updates: AgentToolResult<SubagentToolDetails>[] = [];
  const result = await tool.execute(
    "parent-call",
    { tasks } as never,
    undefined,
    (update) => updates.push(update as AgentToolResult<SubagentToolDetails>)
  );
  const progress = updates.flatMap((update) =>
    isSubagentToolProgressDetails(update.details)
      ? [update.details.progress]
      : []
  );
  const text = result.content
    .map((item) => (item.type === "text" ? item.text : ""))
    .join("");
  return { text, progress };
}

function drawUpdates(progress: SubagentToolProgress[]) {
  return progress.filter(
    (item): item is Extract<SubagentToolProgress, { type: "draw_updated" }> =>
      item.type === "draw_updated"
  );
}

describe("draw mode", () => {
  it("runs every draw at once and hands only the user's pick to the parent", async () => {
    // Three arrivals must meet at the gate although the team is serial.
    const { tool, requests } = harness({
      definitions: [drawMember()],
      gate: 3,
      answer: () => ({
        id: "draw",
        selectedOptionIds: ["c2"],
        text: "结尾再短一点"
      })
    });

    const { text, progress } = await run(tool, [
      { subagent_id: "titler", task: "给第三章起标题" }
    ]);

    expect(requests).toHaveLength(1);
    const draw = requests[0]!.draw!;
    expect(requests[0]).toMatchObject({
      source: "subagent_draw",
      toolCallId: "parent-call"
    });
    expect(draw.candidates.map((candidate) => candidate.id)).toEqual([
      "c1",
      "c2",
      "c3"
    ]);
    const picked = draw.candidates[1]!;
    expect(text).toContain("用户选择第 2 份");
    expect(text).toContain("用户附言：结尾再短一点");
    expect(text).toContain(picked.text);
    for (const other of [draw.candidates[0]!, draw.candidates[2]!]) {
      expect(text).not.toContain(other.text);
    }
    const started = progress.filter((item) => item.type === "started");
    expect(started.map((item) => item.draw)).toEqual([
      { role: "candidate", index: 0, count: 3 },
      { role: "candidate", index: 1, count: 3 },
      { role: "candidate", index: 2, count: 3 }
    ]);
    expect(drawUpdates(progress).map((item) => item.phase)).toEqual([
      "selecting",
      "selected"
    ]);
    expect(drawUpdates(progress)[1]).toMatchObject({
      selectedBy: "user",
      selectedIndex: 1,
      selectedSubagentRunId: picked.subagentRunId,
      note: "结尾再短一点"
    });
  });

  it("returns a rejection as an unfinished task and skips its dependents", async () => {
    const { tool } = harness({
      definitions: [drawMember({ count: 2 }), follower],
      answer: () => ({
        id: "draw",
        selectedOptionIds: ["reject"],
        text: "都太长"
      })
    });

    const { text, progress } = await run(tool, [
      { key: "t1", subagent_id: "titler", task: "起标题" },
      { key: "t2", subagent_id: "follower", task: "用标题", depends_on: ["t1"] }
    ]);

    expect(text).toContain("用户没有采用这次抽卡的 2 份候选");
    expect(text).toContain("用户附言：都太长");
    expect(text).toMatch(/【t2｜后续成员｜已跳过】/u);
    expect(drawUpdates(progress).at(-1)).toMatchObject({
      phase: "rejected",
      note: "都太长"
    });
  });

  it("lets the evaluator choose through its select tool", async () => {
    const { tool, requestUserInput, contexts } = harness({
      definitions: [drawMember({ selection: "auto" })],
      evaluator: () =>
        fauxAssistantMessage(
          fauxToolCall("select_candidate", {
            candidate: 3,
            reason: "节奏最好"
          }),
          { stopReason: "toolUse" }
        )
    });

    const { text, progress } = await run(tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);

    expect(requestUserInput).not.toHaveBeenCalled();
    expect(text).toContain("评估助手选择第 3 份");
    expect(text).toContain("理由：节奏最好");
    const evaluatorContext = contexts.find((context) =>
      context.systemPrompt?.includes(EVALUATOR_MARK)
    )!;
    const taskMessage = JSON.stringify(evaluatorContext.messages[0]);
    expect(taskMessage).toMatch(
      /^.{0,40}【评估任务】.*必须调用 select_candidate/u
    );
    expect(evaluatorContext.tools?.map((tool) => tool.name)).toEqual([
      "select_candidate"
    ]);
    expect(drawUpdates(progress).map((item) => item.phase)).toEqual([
      "evaluating",
      "selected"
    ]);
    const evaluatorDone = progress.find(
      (item) => item.type === "completed" && item.draw?.role === "evaluator"
    );
    expect(evaluatorDone).toMatchObject({ status: "completed" });
  });

  it("reminds the evaluator once, then hands the choice to the user", async () => {
    const { tool, requests, contexts } = harness({
      definitions: [drawMember({ selection: "auto", count: 2 })],
      evaluator: () => fauxAssistantMessage("我觉得第二份更好。")
    });

    const { text, progress } = await run(tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);

    const evaluatorTurns = contexts.filter((context) =>
      context.systemPrompt?.includes(EVALUATOR_MARK)
    );
    expect(evaluatorTurns).toHaveLength(2);
    expect(JSON.stringify(evaluatorTurns[1]!.messages.at(-1))).toContain(
      "你还没有调用 select_candidate"
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.draw?.fallbackReason).toContain("没有调用");
    expect(text).toContain("用户选择第 2 份");
    expect(drawUpdates(progress).map((item) => item.phase)).toEqual([
      "evaluating",
      "selecting",
      "selected"
    ]);
  });

  it("adopts the only successful draw and fails when none succeeds", async () => {
    const failing = (arrival: number) =>
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: `invalid_request_error: 草稿${arrival}被拒绝`
      });
    const one = harness({
      definitions: [drawMember()],
      draft: (arrival) =>
        arrival === 2 ? fauxAssistantMessage("唯一成功") : failing(arrival)
    });
    const adopted = await run(one.tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);
    expect(one.requestUserInput).not.toHaveBeenCalled();
    expect(adopted.text).toContain("只有第");
    expect(adopted.text).toContain("唯一成功");

    const none = harness({ definitions: [drawMember()], draft: failing });
    const failed = await run(none.tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);
    expect(failed.text).toContain("抽卡 3 份全部失败");
    expect(drawUpdates(failed.progress).at(-1)).toMatchObject({
      phase: "failed"
    });
  });

  it("never draws for a standard member, whatever its settings say", async () => {
    const { tool, requestUserInput, contexts } = harness({
      definitions: [drawMember({}, "standard")]
    });

    const { text, progress } = await run(tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);

    expect(contexts).toHaveLength(1);
    expect(requestUserInput).not.toHaveBeenCalled();
    expect(text).toBe("草稿1");
    expect(drawUpdates(progress)).toEqual([]);
  });

  it("tells the parent which members draw", () => {
    const { tool } = harness({ definitions: [drawMember({ count: 5 })] });
    expect(tool.description).toContain("［抽卡×5：");
  });
});

describe("createConcurrencyLimiter", () => {
  it("keeps at most `capacity` tasks running", async () => {
    const limiter = createConcurrencyLimiter(2);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());
    const done = gates.map((gate) =>
      limiter.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      })
    );
    for (const gate of gates) {
      await Promise.resolve();
      gate.resolve();
    }
    await Promise.all(done);
    expect(peak).toBe(2);
  });
});
