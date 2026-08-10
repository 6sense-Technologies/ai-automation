/**
 * Pipeline state machine, persisted per ticket in MongoDB.
 *
 * RECEIVED -> ANALYZING -> AWAITING_APPROVAL -> FIXING -> TESTING -> DELIVERED
 * FAILED is reachable from any active state; a FAILED ticket may be
 * re-triggered from Jira, which resets it to RECEIVED.
 */
export const TICKET_STATES = [
  "RECEIVED",
  "ANALYZING",
  "AWAITING_APPROVAL",
  "FIXING",
  "TESTING",
  "DELIVERED",
  "FAILED",
] as const;

export type TicketState = (typeof TICKET_STATES)[number];

export const ALLOWED_TRANSITIONS: Record<TicketState, TicketState[]> = {
  RECEIVED: ["ANALYZING", "FAILED"],
  ANALYZING: ["AWAITING_APPROVAL", "FAILED"],
  AWAITING_APPROVAL: ["FIXING", "FAILED"],
  FIXING: ["TESTING", "FAILED"],
  TESTING: ["DELIVERED", "FAILED"],
  DELIVERED: [],
  FAILED: ["RECEIVED"],
};

/** States in which a phase is currently running or pending work exists. */
export const ACTIVE_STATES: TicketState[] = ["RECEIVED", "ANALYZING", "FIXING", "TESTING"];

export function canTransition(from: TicketState, to: TicketState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
