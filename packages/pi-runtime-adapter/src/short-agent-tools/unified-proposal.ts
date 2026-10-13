import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { appendWritingContentCounts } from "../writing-content-counts";
import { AUTO_APPROVE_PROPOSAL_SUBMITTED } from "../write-approval";
import {
  recordUpdatedReadEvidence,
  type ShortUnifiedReadState
} from "./unified-read-tool";
import {
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolDetails,
  type ShortWorkspaceToolSharedState
} from "./shared";
import {
  updateShortUnifiedTarget,
  type ShortUnifiedTarget
} from "./unified-target";

/** Agent-facing tool result; the card keeps the plain change summary. */
export function shortProposalSummary(
  input: BuildWritingWorkspaceToolsInput,
  summary: string
): string {
  if (input.writeApprovalMode !== "auto-approve") return summary;
  return summary.includes("等待用户审阅")
    ? summary.replace(
        /，?等待用户审阅。?/u,
        `，${AUTO_APPROVE_PROPOSAL_SUBMITTED}`
      )
    : `${summary.replace(/[。；]$/u, "")}；${AUTO_APPROVE_PROPOSAL_SUBMITTED}`;
}

export function formShortContentProposal(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState,
  target: ShortUnifiedTarget,
  content: string,
  rawSummary: string
): AgentToolResult<ShortWorkspaceToolDetails> {
  const summary = rawSummary.trim();
  const baseRevision = target.revision;
  const revision = updateShortUnifiedTarget(sharedState, target, content);
  recordUpdatedReadEvidence(readState, target, content, revision);
  const message = appendWritingContentCounts(
    shortProposalSummary(input, summary),
    [{ title: target.title, id: target.documentId, content }]
  );
  if (target.kind === "character_overview" || target.kind === "plot_stage") {
    return textResult(message, {
      kind: "workspace-editor-mutation",
      workspaceId: input.workspace.id,
      stageId: target.stageId,
      text: content,
      baseRevision,
      summary
    });
  }
  if (target.kind === "character") {
    return textResult(message, {
      kind: "workspace-character-file-mutation",
      workspaceId: input.workspace.id,
      stageId: "character_design",
      documentId: target.documentId,
      ...(target.itemId ? { itemId: target.itemId } : {}),
      text: content,
      baseRevision,
      summary
    });
  }
  return textResult(message, {
    kind: "workspace-expert-draft-file-mutation",
    workspaceId: input.workspace.id,
    stageId: "draft",
    documentId: target.documentId,
    sectionId: target.sectionId!,
    fileKind: target.fileKind!,
    text: content,
    baseRevision,
    summary
  });
}
