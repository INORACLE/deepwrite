import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  LongCommitChapterInputSchema,
  type LongContinuityFileRole,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { defineTool, textResult } from "./shared";
import { stableIdParameter, strictObject } from "./schemas";
import type { LongToolContext } from "./context";
import { AUTO_APPROVE_PROPOSAL_SUBMITTED } from "../write-approval";

const ROLE_TITLES: Record<LongContinuityFileRole, string> = {
  foreshadowing_changes: "伏笔变化",
  world_reveals: "世界观揭露",
  character_current_state: "人物当前状态",
  character_history: "人物历史轨迹",
  chapter_end_state: "章末状态",
  handoff: "接续包"
};

export function chapterForeshadowingCandidates(
  index: LongWorkspaceIndexSnapshot,
  chapterCardIds: string | readonly string[]
) {
  const chapterIds = new Set(
    Array.isArray(chapterCardIds) ? chapterCardIds : [chapterCardIds]
  );
  const placementById = new Map(
    index.plot.narrativePlacements.map((placement) => [placement.id, placement])
  );
  return index.plot.foreshadowing.flatMap((thread) =>
    thread.beats.flatMap((beat) => {
      const placement =
        beat.placementId === null
          ? undefined
          : placementById.get(beat.placementId);
      if (
        !chapterIds.has(beat.chapterCardId ?? placement?.chapterCardId ?? "")
      ) {
        return [];
      }
      return [{ thread, beat }];
    })
  );
}

export function buildLedgerCommitTool(ctx: LongToolContext): AgentTool {
  const {
    input,
    workspace,
    profile,
    loadActiveChapterMutationContext,
    readWholeDocument
  } = ctx;
  return defineTool({
    name: "propose_continuity_commit",
    label: "保存连续性记录",
    description:
      "将同一本书中按叙事顺序连续、已有正文且尚未记录的一批章节登记为一个连续性批次。chapter_card_ids 按顺序传入；仅一章时也可用 chapter_card_id 或当前章。批次只读取全部正文作为证据，并只绑定末章的章末状态、接续包、人物状态/历史、世界观揭露与整批伏笔变化。必须逐项提交整批伏笔总览候选触点的结果和正文证据；没有候选时传空数组。",
    parameters: strictObject({
      chapter_card_id: Type.Optional(stableIdParameter("chapter")),
      chapter_card_ids: Type.Optional(
        Type.Array(stableIdParameter("chapter"), {
          minItems: 1,
          maxItems: 100_000
        })
      ),
      summary: Type.String({ minLength: 1, maxLength: 1_000 }),
      foreshadowing_touchpoint_decisions: Type.Array(
        strictObject({
          foreshadowing_id: stableIdParameter("foreshadow"),
          beat_id: stableIdParameter("beat"),
          status: StringEnum(["committed", "missed"] as const),
          evidence: Type.String({ minLength: 1, maxLength: 4_000 })
        }),
        { maxItems: 100_000 }
      )
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      if (params.chapter_card_id && params.chapter_card_ids) {
        throw new Error(
          "chapter_card_id 与 chapter_card_ids 只能选择一种传入。"
        );
      }
      const requestedCheckpoint =
        params.chapter_card_ids?.at(-1) ?? params.chapter_card_id;
      const { index, activeChapterCardId, chapter } =
        await loadActiveChapterMutationContext(signal, requestedCheckpoint);
      const chapterCardIds = params.chapter_card_ids ?? [activeChapterCardId];
      const chapterById = new Map(
        index.chapters.map((entry) => [entry.chapterCardId, entry])
      );
      const volumeOrder = new Map(
        index.plot.volumes.map((volume) => [volume.id, volume.order])
      );
      const orderedChapterIds = [...index.plot.chapterCards]
        .sort(
          (left, right) =>
            (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
              (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
            left.narrativeOrder - right.narrativeOrder
        )
        .map(({ id }) => id);
      const firstPosition = orderedChapterIds.indexOf(chapterCardIds[0]!);
      const expectedChapterIds = orderedChapterIds.slice(
        firstPosition,
        firstPosition + chapterCardIds.length
      );
      if (
        firstPosition < 0 ||
        expectedChapterIds.length !== chapterCardIds.length ||
        expectedChapterIds.some((id, index) => id !== chapterCardIds[index])
      ) {
        throw new Error("批量连续性记录只支持按叙事顺序排列的连续章节。");
      }
      const chapters = chapterCardIds.map((chapterCardId) => {
        const entry = chapterById.get(chapterCardId);
        if (
          !entry ||
          entry.commitId !== null ||
          entry.bodyStatus !== "written"
        ) {
          throw new Error(
            `批次章节不存在、正文未完成或已经有连续性记录：${chapterCardId}`
          );
        }
        return entry;
      });
      const summary = params.summary.trim();
      if (!summary) {
        throw new Error("Continuity commit summary must be non-empty.");
      }

      const candidates = chapterForeshadowingCandidates(index, chapterCardIds);
      const candidateByBeatId = new Map(
        candidates.map((candidate) => [candidate.beat.id, candidate])
      );
      const receivedBeatIds = new Set<string>();
      for (const decision of params.foreshadowing_touchpoint_decisions) {
        if (receivedBeatIds.has(decision.beat_id)) {
          throw new Error(`伏笔触点 ${decision.beat_id} 不能重复提交决策。`);
        }
        receivedBeatIds.add(decision.beat_id);
        const candidate = candidateByBeatId.get(decision.beat_id);
        if (!candidate) {
          throw new Error(
            `伏笔触点 ${decision.beat_id} 不属于当前批次的既有候选。`
          );
        }
        if (candidate.thread.id !== decision.foreshadowing_id) {
          throw new Error(
            `伏笔触点 ${decision.beat_id} 不属于伏笔线 ${decision.foreshadowing_id}。`
          );
        }
      }
      if (receivedBeatIds.size !== candidateByBeatId.size) {
        throw new Error(
          "伏笔触点决策必须完整覆盖整批章节在伏笔总览中的既有候选，且不能包含其他触点。"
        );
      }

      const bodies = await Promise.all(
        chapters.map(
          async (entry) => await readWholeDocument(entry.body, signal)
        )
      );
      const targets: Array<{
        role: LongContinuityFileRole;
        characterId: string | null;
        file: LongWorkspaceFileReference;
      }> = [
        {
          role: "chapter_end_state",
          characterId: null,
          file: chapter.characterState
        },
        { role: "handoff", characterId: null, file: chapter.handoff },
        ...(candidates.length > 0
          ? [
              {
                role: "foreshadowing_changes" as const,
                characterId: null,
                file: chapter.foreshadowingChanges
              }
            ]
          : []),
        ...(chapter.worldReveals
          ? [
              {
                role: "world_reveals" as const,
                characterId: null,
                file: chapter.worldReveals
              }
            ]
          : [])
      ];
      for (const entry of [...chapter.characterContinuity].sort((left, right) =>
        left.characterId.localeCompare(right.characterId)
      )) {
        targets.push(
          {
            role: "character_current_state",
            characterId: entry.characterId,
            file: entry.currentState
          },
          {
            role: "character_history",
            characterId: entry.characterId,
            file: entry.history
          }
        );
      }

      const continuityFiles: Array<{
        role: LongContinuityFileRole;
        characterId: string | null;
        content: string;
        file: LongWorkspaceFileReference;
      }> = [];
      for (const target of targets) {
        const live = await readWholeDocument(target.file, signal);
        continuityFiles.push({
          role: target.role,
          characterId: target.characterId,
          content: live.content,
          file: live.file
        });
      }

      const missing = [
        ...bodies.flatMap((body, index) =>
          body.content.trim() ? [] : [`${chapterCardIds[index]} / 正文`]
        ),
        ...continuityFiles.flatMap((file) =>
          file.content.trim()
            ? []
            : [
                file.characterId
                  ? `${file.characterId} / ${ROLE_TITLES[file.role]}`
                  : ROLE_TITLES[file.role]
              ]
        )
      ];
      if (missing.length > 0) {
        return textResult(
          `未登记归档：以下文本尚为空：${missing.join("、")}。`
        );
      }

      const commitInput = LongCommitChapterInputSchema.parse({
        mode: "text_files_batch",
        bookId: workspace.bookId,
        chapterCardIds,
        checkpointChapterCardId: activeChapterCardId,
        foreshadowingBeatDecisions: Object.fromEntries(
          params.foreshadowing_touchpoint_decisions.map((decision) => [
            decision.beat_id,
            { status: decision.status, note: decision.evidence.trim() }
          ])
        ),
        commitMessage: summary
      });
      const titleById = new Map(
        index.plot.chapterCards.map((card) => [card.id, card.title])
      );
      const firstTitle =
        titleById.get(chapterCardIds[0]!) ?? chapterCardIds[0]!;
      const lastTitle =
        titleById.get(activeChapterCardId) ?? activeChapterCardId;
      const rangeTitle =
        chapterCardIds.length === 1
          ? `《${lastTitle}》`
          : `《${firstTitle}》至《${lastTitle}》共 ${chapterCardIds.length} 章`;
      const request = `${rangeTitle}的批量连续性记录请求（末章 ${continuityFiles.length} 份连续性文件）`;
      return textResult(
        input.writeApprovalMode === "auto-approve"
          ? `已提交${request}；客户端会在本批文件卡自动保存后登记记录。${AUTO_APPROVE_PROPOSAL_SUBMITTED}`
          : `仅已登记${request}，当前尚未保存。客户端将在文件卡全部获批后尝试保存记录。`,
        {
          kind: "long-ledger-commit-proposal",
          bookId: workspace.bookId,
          agentId: profile.id,
          input: commitInput,
          summary
        }
      );
    }
  });
}
