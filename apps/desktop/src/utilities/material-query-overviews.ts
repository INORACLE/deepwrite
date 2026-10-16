import { materialPreview } from "@deepwrite/contracts";
import type { MaterialCandidate } from "./material-query-scope";

/** Library introductions are separately readable, never copied into body entries. */
export function materialOverviewCandidates(
  candidates: readonly MaterialCandidate[]
): MaterialCandidate[] {
  const libraries = new Map(
    candidates.map((candidate) => [candidate.libraryId, candidate])
  );
  return [...libraries.values()].map((candidate) => ({
    ...candidate,
    id: `material-library:${candidate.libraryId}:overview`,
    entryId: "overview",
    entryTitle: "库说明",
    title: materialPreview(`${candidate.libraryTitle} · 库说明`, 240),
    overview: true
  }));
}
