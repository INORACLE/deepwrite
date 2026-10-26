import type { LongWorkspaceProposalItem } from "../useLongWorkspaceProposals";
import { formatError, getErrorDetail } from "../../i18n/errors";

export function longProposalErrorMessage(
  error: unknown,
  fallback: string
): string {
  const headline = formatError(error, fallback);
  const detail = getErrorDetail(error);
  return headline === fallback && detail && detail !== headline
    ? `${headline} ${detail}`
    : headline;
}

/** Keep failed predecessors visible even when each proposal has its own card. */
export function withLongProposalBlockers(
  items: LongWorkspaceProposalItem[]
): LongWorkspaceProposalItem[] {
  const failedContinuityRuns = new Set(
    items
      .filter(
        (item) =>
          item.event.type === "long.continuity_file_proposal" &&
          item.status === "error"
      )
      .map(
        (item) => `${item.event.payload.sessionId}\0${item.event.payload.runId}`
      )
  );
  const predecessors = new Map<string, LongWorkspaceProposalItem>();
  return items.map((item) => {
    const key = `${item.event.payload.sessionId}\0${item.event.payload.runId}`;
    const predecessor = predecessors.get(key);
    const blockedByError =
      item.status === "waiting" &&
      (item.event.type === "long.ledger_commit_proposal"
        ? failedContinuityRuns.has(key)
        : predecessor?.status === "error");
    if (
      !predecessor &&
      item.event.type !== "long.ledger_commit_proposal" &&
      item.status !== "accepted"
    ) {
      predecessors.set(key, item);
    }
    return Boolean(item.blockedByError) === blockedByError
      ? item
      : { ...item, blockedByError };
  });
}
