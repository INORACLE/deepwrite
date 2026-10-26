import type { ContextCompactionRunSettings } from "@deepwrite/contracts";

const FALLBACK_CONTEXT_WINDOW = 128_000;
const FALLBACK_OUTPUT_TOKENS = 16_384;
/** A chapter plus its reasoning routinely needs more than pi's 16k reserve. */
const MAX_OUTPUT_RESERVE = 32_768;
const SAFETY_MARGIN = 8_000;

export interface ContextBudget {
  /** Model window minus output reserve; a request above it may fail. */
  hardLimit: number;
  /** User working budget, never above the hard limit. */
  working: number;
  /** Past this, stale tool output and snapshots are pruned. */
  pruneAt: number;
  /** Past this after pruning, older turns are summarized. */
  summarizeAt: number;
  /** Recent context kept verbatim by a summary. */
  keepRecentTokens: number;
  /** Soft summary length target used in the prompt, not a generation cap. */
  summaryTargetTokens: number;
  /** Budget for source content re-attached after a summary. */
  rehydrateTokens: number;
}

export function resolveContextBudget(
  model: { contextWindow: number; maxTokens: number },
  settings: Pick<ContextCompactionRunSettings, "budgetTokens">
): ContextBudget {
  const window =
    model.contextWindow > 0 ? model.contextWindow : FALLBACK_CONTEXT_WINDOW;
  const maxOutput =
    model.maxTokens > 0 ? model.maxTokens : FALLBACK_OUTPUT_TOKENS;
  const outputReserve = Math.min(
    maxOutput,
    MAX_OUTPUT_RESERVE,
    Math.floor(window * 0.25)
  );
  const margin = Math.min(SAFETY_MARGIN, Math.floor(window * 0.05));
  const hardLimit = Math.max(1, window - outputReserve - margin);
  const working = Math.min(settings.budgetTokens, hardLimit);
  return {
    hardLimit,
    working,
    pruneAt: Math.floor(working * 0.5),
    summarizeAt: Math.floor(working * 0.8),
    keepRecentTokens: Math.max(128, Math.floor(working * 0.25)),
    summaryTargetTokens: Math.max(
      128,
      Math.min(6_144, maxOutput, Math.floor(working * 0.15))
    ),
    rehydrateTokens: Math.min(10_000, Math.floor(working * 0.06))
  };
}
