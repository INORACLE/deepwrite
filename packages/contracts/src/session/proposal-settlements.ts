import { z } from "zod";

/** Upper bounds for the settlement digest carried by one `session.prompt`. */
export const PROPOSAL_SETTLEMENT_MAX_ITEMS = 40;
export const PROPOSAL_SETTLEMENT_TITLE_MAX_LENGTH = 240;
export const PROPOSAL_SETTLEMENT_TEXT_MAX_LENGTH = 300;

/**
 * Final client-side outcome of one agent write proposal. `reverted` means the
 * proposal was saved and the user later restored the previous content.
 */
export const ProposalSettlementStatusSchema = z.enum([
  "saved",
  "rejected",
  "conflict",
  "failed",
  "reverted"
]);
export type ProposalSettlementStatus = z.infer<
  typeof ProposalSettlementStatusSchema
>;

export const ProposalSettlementSchema = z
  .object({
    title: z.string().trim().min(1).max(PROPOSAL_SETTLEMENT_TITLE_MAX_LENGTH),
    summary: z.string().max(PROPOSAL_SETTLEMENT_TEXT_MAX_LENGTH).optional(),
    status: ProposalSettlementStatusSchema,
    /** Client-reported reason for a conflict or failure. */
    detail: z.string().max(PROPOSAL_SETTLEMENT_TEXT_MAX_LENGTH).optional()
  })
  .strict();
export type ProposalSettlement = z.infer<typeof ProposalSettlementSchema>;

/**
 * Proposals settled since the previous user turn. The agent cannot observe
 * approval cards, so the client reports their outcomes with the next turn.
 */
export const ProposalSettlementsSchema = z
  .object({
    items: z
      .array(ProposalSettlementSchema)
      .min(1)
      .max(PROPOSAL_SETTLEMENT_MAX_ITEMS),
    /** Settlements beyond `items` that were not listed. */
    omittedCount: z.number().int().positive().optional()
  })
  .strict();
export type ProposalSettlements = z.infer<typeof ProposalSettlementsSchema>;
