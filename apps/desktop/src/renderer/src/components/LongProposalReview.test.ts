import { describe, expect, it } from "vitest";
import conversationItemSource from "./ConversationMessageItem.vue?raw";
import processingItemSource from "./ConversationProcessingItem.vue?raw";
import editProposalSource from "./AgentEditProposalCard.vue?raw";
import editDiffSource from "./AgentEditProposalDiff.vue?raw";
import ledgerFinalizationSource from "./LongLedgerFinalizationCard.vue?raw";
import impactDetailsSource from "./LongProposalImpactDetails.vue?raw";
import viewSource from "./LongProposalReview.vue?raw";
import presentationSource from "./longProposalPresentation.ts?raw";
import fileChangeRowSource from "./ConversationFileChangeRow.vue?raw";

// Titles, statuses and diffs are shared with the conversation's summary rows.
const source = `${viewSource}\n${presentationSource}`;
const conversationSource = `${conversationItemSource}\n${processingItemSource}\n${fileChangeRowSource}`;

describe("LongProposalReview content file cards", () => {
  it("offers target navigation after a proposal is accepted", () => {
    expect(source).toContain("locate: [eventId: string]");
    expect(source).toContain("v-if=\"item.status === 'accepted'\"");
    expect(source).toContain("approval-target-button");
    expect(source).toContain("goToTargetFile");
    expect(source).toContain("emit('locate', item.event.id)");
    expect(conversationSource).toContain(
      "@locate=\"emit('locateLongProposal', $event)\""
    );
    expect(
      conversationSource.match(
        /@locate="emit\('locateLongProposal', \$event\)"/g
      )
    ).toHaveLength(2);
  });

  it("does not expose rollback or discard actions for accepted long proposals", () => {
    expect(source).not.toContain("discardableEventIds");
    expect(source).not.toContain("showDiscardButton");
    expect(source).not.toContain("<ApprovalDiscardButton");
    expect(source).not.toContain("emit('discard'");
  });

  it("supports inline rendering inside its originating conversation turn", () => {
    expect(source).toContain("embedded?: boolean");
    expect(source).toContain("'is-embedded': embedded");
    expect(source).toContain(
      "'has-edit-proposal-surface-items': hasEditProposalSurfaceItems"
    );
    expect(source).toContain(".long-proposal-review.is-embedded");
    // A summary row already shows the title, so its body drops the header.
    expect(source).toContain("rowBody?: boolean");
    expect(source).toContain(
      '<header v-if="!rowBody" class="edit-proposal-header">'
    );
  });

  it("uses the existing text-edit card surface for every Markdown proposal", () => {
    expect(source).toContain("long.worldbuilding_file_proposal");
    expect(source).toContain("long.character_file_proposal");
    expect(source).toContain("buildAgentTextDiff");
    for (const className of [
      "edit-proposal-card",
      "edit-proposal-header",
      "edit-proposal-status",
      "edit-proposal-stats",
      "edit-proposal-diff",
      "edit-diff-content",
      "edit-proposal-footer",
      "edit-proposal-actions",
      "edit-review-button is-reject",
      "edit-review-button is-accept"
    ]) {
      expect(source).toContain(className);
      expect(
        `${conversationSource}\n${editProposalSource}\n${editDiffSource}`
      ).toContain(className);
    }
    expect(source).not.toContain("worldbuilding-file-card");
    expect(source).not.toContain("查看提交内容");
    expect(source).toContain("contentProposalDiffStats(item)");
    expect(source).toContain("automaticallyApprovedAndSavedToLocalMarkdown");
    expect(source).toContain("acceptToApplyToTheCorrespondingMarkdownFilesAnd");
    expect(source).not.toContain("重试接受并保存");
    expect(source).toContain("waitingForPrerequisiteFiles");
    expect(source).toContain(
      "waitingForPrecedingFileOperationsToFinishBeforeResuming"
    );
  });

  it("renders ledger finalization as a durable status card with retry", () => {
    expect(source).toContain("LongLedgerFinalizationCard");
    expect(source).toContain("long.ledger_commit_proposal");
    expect(ledgerFinalizationSource).toContain("continuityLedgerArchive");
    expect(ledgerFinalizationSource).toContain("archiveFailed");
    expect(ledgerFinalizationSource).toContain("retryArchive");
    expect(ledgerFinalizationSource).toContain("closeAndKeepFiles");
    expect(ledgerFinalizationSource).toContain(
      'v-if="item.errorRetryable !== false"'
    );
    expect(ledgerFinalizationSource).toContain("item.error");
  });

  it("keeps structure changes separate from worldbuilding file writes", () => {
    expect(source).toContain('case "long.mutation_proposal":');
    expect(source).toContain("structureChanges");
    expect(source).toContain('case "long.worldbuilding_file_proposal":');
    expect(source).toContain('case "long.character_file_proposal":');
    expect(source).toContain("acceptAndApply");
  });

  it("uses the same approval-card surface for structure proposals", () => {
    expect(source).toContain("function isStructureProposalItem");
    expect(source).toContain("function usesEditProposalSurface");
    expect(source).toContain("function structureProposalStatusMessage");
    expect(source).toContain("function structureProposalAcceptLabel");
    expect(source).toContain('<template v-if="usesEditProposalSurface(item)">');
    expect(source).toContain(": ['edit-proposal-card',");
    expect(source).toContain("structureChangesAppliedAndSavedLocally");
  });

  it("shows exact relationship and ledger effects before approval", () => {
    expect(source).toContain("<LongProposalImpactDetails");
    expect(impactDetailsSource).toContain("preview.relationshipChanges.length");
    expect(impactDetailsSource).toContain("linkChangesMessage");
    expect(impactDetailsSource).toContain(
      "relationshipActionLabel(change.action)"
    );
    expect(impactDetailsSource).toContain(
      "relationshipKindLabels[change.kind]"
    );
    expect(impactDetailsSource).toContain("preview.ledgerRecordEdits.length");
    expect(impactDetailsSource).toContain(
      "continuityLedgerRecordImpactMessage"
    );
    expect(impactDetailsSource).toContain("edit.commitId");
    expect(impactDetailsSource).toContain("edit.recordFile.id");
    expect(impactDetailsSource).toContain("ledgerRecordEditCount(edit)");
    expect(impactDetailsSource).toContain("characterType");
  });

  it("does not present deterministic preview failures as retryable apply failures", () => {
    expect(source).toContain('item.errorPhase === "preview"');
    expect(source).toContain("validationFailed");
    expect(source).toContain("couldNotReadStructuralImpactChangesHaveNotBeen");
    expect(source).toContain("item.errorRetryable === false");
    expect(source).not.toContain("需重新生成提案");
  });

  it("does not render unverified continuity metadata or diffs", () => {
    expect(source).toContain("trustedContinuityIdentity");
    expect(source).toContain(
      "contentFileTitle(item, card.file, workspaceIndex)"
    );
    expect(source).toContain("canDisplayContentFileDiff(item)");
    expect(source).toContain('item.status === "ready"');
    expect(source).toContain('item.status === "submitting"');
    expect(source).toContain('item.status === "accepted"');
    expect(source).toContain(
      "fileIdentityAndSourceContentHaveNotPassedValidation"
    );
    expect(source).not.toContain("{{ card.file.filePath }}");
  });
});
