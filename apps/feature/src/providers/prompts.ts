import type { FeaturePlan } from "../schemas/plan.js";
import { PLAN_REPORT_PATH, IMPLEMENT_REPORT_PATH, type FeatureTask } from "./types.js";

function ticketBlock(task: FeatureTask): string {
  const lines = [
    `Ticket: ${task.issueKey}`,
    `Summary: ${task.summary}`,
    `Priority: ${task.priority || "unspecified"}`,
    `Reporter: ${task.reporter || "unspecified"}`,
    `Components: ${task.components.join(", ") || "none"}`,
    `Labels: ${task.labels.join(", ") || "none"}`,
    "",
    "Description:",
    task.description || "(no description provided)",
  ];
  if (task.acceptanceCriteria) {
    lines.push("", "Acceptance criteria:", task.acceptanceCriteria);
  }
  if (task.attachments.length > 0) {
    lines.push(
      "",
      "Attachments (URLs, may require Jira auth to fetch):",
      ...task.attachments.map((a) => `- ${a.filename}: ${a.url}`),
    );
  }
  return lines.join("\n");
}

const PLAN_JSON_SHAPE = `{
  "schemaVersion": 1,
  "ticketId": "<issue key>",
  "status": "ok" | "cannot_plan" | "needs_more_info",
  "featureUnderstanding": {
    "restatement": "<the enhancement in your own words>",
    "goal": "<what success looks like>",
    "acceptanceCriteria": ["<criterion>"],
    "outOfScope": ["<explicit non-goals>"],
    "priorityAssessment": "critical" | "high" | "medium" | "low"
  },
  "proposedDesign": {
    "approach": "<what to build and why>",
    "filesToTouch": ["<repo-relative paths>"],
    "locations": [
      { "file": "<path>", "symbol": "<symbol>", "lines": "<range>", "citation": "<excerpt>" }
    ],
    "riskLevel": "low" | "medium" | "high",
    "riskNotes": "<regression risk, blast radius>",
    "testPlan": [ { "file": "<test file>", "action": "add" | "modify", "covers": "<behavior>" } ]
  },
  "confidence": <0.0 to 1.0>,
  "blockers": "<only when status is not ok>"
}`;

export function buildPlanPrompt(task: FeatureTask): string {
  return `You are a senior software engineer writing a READ-ONLY implementation plan for a feature/enhancement ticket. You are working inside a clean checkout of the affected repository.

${ticketBlock(task)}

STRICT RULES:
1. This phase is READ-ONLY. Do NOT modify, create, or delete any source file except the report file below. Do not run formatters, do not install dependencies, do not commit.
2. Investigate the codebase, locate the right extension points, and propose a minimal, targeted design. Cite real files/symbols.
3. Prefer the smallest change that satisfies acceptance criteria. Call out out-of-scope clearly.
4. If the ticket lacks enough information to plan safely, set status to "needs_more_info" or "cannot_plan" and explain in blockers.

OUTPUT:
Write your plan as JSON to ${PLAN_REPORT_PATH} (create the directory if needed). It must match exactly:

${PLAN_JSON_SHAPE}

When status is not "ok", "proposedDesign" may be omitted. The report file is the deliverable; write it as your final action.`;
}

const IMPLEMENT_JSON_SHAPE = `{
  "schemaVersion": 1,
  "ticketId": "<issue key>",
  "summary": "<one-paragraph description of the change you made>",
  "verification": "<how you verified acceptance criteria>",
  "newTests": ["<test names or files>"],
  "deviations": ["<departures from the approved plan, empty if none>"]
}`;

export function buildImplementPrompt(task: FeatureTask, approved: FeaturePlan): string {
  const reviewerNotes = task.reviewerNotes
    ? `\nREVIEWER NOTES (from the human who approved the plan - treat as instructions):\n${task.reviewerNotes}\n`
    : "";

  return `You are a senior software engineer implementing an APPROVED feature plan. You are on a dedicated feature branch; a human reviewed and approved the plan below. Follow it.

${ticketBlock(task)}

APPROVED PLAN (JSON):
${JSON.stringify(approved, null, 2)}
${reviewerNotes}
STRICT RULES:
1. Implement the approved design with minimal, targeted changes. No unrelated refactors.
2. Add or update tests per the approved test plan.
3. Run the project's test suite (command: \`__TEST_COMMAND__\`) and fix regressions you introduced.
4. Record honest deviations if the plan was incomplete.
5. Commit with messages prefixed by the ticket key (e.g. "${task.issueKey}: <what changed>"). Do NOT push, branch, or open PRs.
6. Do not touch ${PLAN_REPORT_PATH}.

OUTPUT:
When done, write a completion report as JSON to ${IMPLEMENT_REPORT_PATH} matching exactly:

${IMPLEMENT_JSON_SHAPE}

The report file is required; write it as your final action.`;
}
