/**
 * Dependency remediation state machine (persisted per job in MongoDB).
 *
 * RECEIVED -> AUDITING -> ANALYZING -> UPDATING -> VALIDATING
 *   -> (RETRYING -> UPDATING)* -> PR_READY -> DELIVERED
 * NEEDS_MANUAL / FAILED reachable when no safe version works.
 */
export const JOB_STATES = [
  "RECEIVED",
  "AUDITING",
  "ANALYZING",
  "UPDATING",
  "VALIDATING",
  "RETRYING",
  "PR_READY",
  "DELIVERED",
  "NEEDS_MANUAL",
  "FAILED",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const ALLOWED_TRANSITIONS: Record<JobState, JobState[]> = {
  RECEIVED: ["AUDITING", "ANALYZING", "FAILED"],
  AUDITING: ["ANALYZING", "FAILED", "NEEDS_MANUAL"],
  ANALYZING: ["UPDATING", "FAILED", "NEEDS_MANUAL"],
  UPDATING: ["VALIDATING", "FAILED", "NEEDS_MANUAL"],
  VALIDATING: ["PR_READY", "RETRYING", "FAILED", "NEEDS_MANUAL"],
  RETRYING: ["UPDATING", "NEEDS_MANUAL", "FAILED"],
  PR_READY: ["DELIVERED", "FAILED"],
  DELIVERED: [],
  NEEDS_MANUAL: ["RECEIVED"],
  FAILED: ["RECEIVED"],
};

export const ACTIVE_STATES: JobState[] = [
  "RECEIVED",
  "AUDITING",
  "ANALYZING",
  "UPDATING",
  "VALIDATING",
  "RETRYING",
  "PR_READY",
];

export function canTransition(from: JobState, to: JobState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
