/**
 * Feature pipeline state machine, persisted per ticket in MongoDB.
 *
 * RECEIVED -> PLANNING -> AWAITING_APPROVAL -> IMPLEMENTING -> TESTING -> DELIVERED
 * FAILED is reachable from any active state; a FAILED ticket may be
 * re-triggered from Jira, which resets it to RECEIVED.
 */
export const TICKET_STATES = [
  "RECEIVED",
  "PLANNING",
  "AWAITING_APPROVAL",
  "IMPLEMENTING",
  "TESTING",
  "DELIVERED",
  "FAILED",
] as const;

export type TicketState = (typeof TICKET_STATES)[number];

export const ALLOWED_TRANSITIONS: Record<TicketState, TicketState[]> = {
  RECEIVED: ["PLANNING", "FAILED"],
  PLANNING: ["AWAITING_APPROVAL", "FAILED"],
  AWAITING_APPROVAL: ["IMPLEMENTING", "FAILED"],
  IMPLEMENTING: ["TESTING", "FAILED"],
  TESTING: ["DELIVERED", "FAILED"],
  DELIVERED: [],
  FAILED: ["RECEIVED"],
};

/** States in which a phase is currently running or pending work exists. */
export const ACTIVE_STATES: TicketState[] = ["RECEIVED", "PLANNING", "IMPLEMENTING", "TESTING"];

export function canTransition(from: TicketState, to: TicketState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
