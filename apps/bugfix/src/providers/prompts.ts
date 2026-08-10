import type { AnalysisReport } from "../schemas/analysis.js";
import { ANALYSIS_REPORT_PATH, FIX_REPORT_PATH, type BugTask } from "./types.js";

function ticketBlock(task: BugTask): string {
  const lines = [
    `Ticket: ${task.issueKey}`,
    `Summary: ${task.summary}`,
    `Priority: ${task.priority || "unspecified"}`,
    `Reporter: ${task.reporter || "unspecified"}`,
    `Components: ${task.components.join(", ") || "none"}`,
    "",
    "Description:",
    task.description || "(no description provided)",
  ];
  if (task.reproductionSteps) {
    lines.push("", "Reproduction steps:", task.reproductionSteps);
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

const ANALYSIS_JSON_SHAPE = `{
  "schemaVersion": 1,
  "ticketId": "<issue key>",
  "status": "ok" | "cannot_find_root_cause" | "needs_more_info",
  "bugUnderstanding": {
    "restatement": "<the bug in your own words>",
    "expectedBehavior": "<what should happen>",
    "actualBehavior": "<what actually happens>",
    "severityAssessment": "critical" | "high" | "medium" | "low"
  },
  "rootCause": {
    "mechanism": "<the exact mechanism causing the bug>",
    "locations": [
      { "file": "<repo-relative path>", "symbol": "<function/class>", "lines": "<e.g. 10-24>", "citation": "<short code excerpt>" }
    ]
  },
  "proposedFix": {
    "approach": "<what needs to change and why>",
    "filesToTouch": ["<repo-relative paths>"],
    "riskLevel": "low" | "medium" | "high",
    "riskNotes": "<regression risk, blast radius>",
    "testPlan": [ { "file": "<test file>", "action": "add" | "modify", "covers": "<behavior covered>" } ]
  },
  "confidence": <0.0 to 1.0>,
  "blockers": "<only when status is not ok: what is missing or unclear>"
}`;

export function buildAnalysisPrompt(task: BugTask): string {
  return `You are a senior software engineer performing a READ-ONLY root cause analysis of a bug reported in Jira. You are working inside a clean checkout of the affected repository.

${ticketBlock(task)}

STRICT RULES:
1. This phase is READ-ONLY. Do NOT modify, create, or delete any source file. Do not run formatters, do not install dependencies, do not commit anything. The only file you are allowed to write is the report described below.
2. Investigate like a senior developer: locate the code paths involved, read them, and identify the exact mechanism of the bug. Cite real code (file paths, symbols, line ranges, short excerpts).
3. Propose a minimal, targeted fix. No refactoring of unrelated code. Identify exactly which files would change and which unit tests would be added or modified.
4. If you cannot determine the root cause, or the ticket lacks information you need, say so honestly via "status" and explain in "blockers". Do not guess.

OUTPUT:
Write your report as JSON to the file ${ANALYSIS_REPORT_PATH} (relative to the repository root, create the directory if needed). It must match exactly this shape:

${ANALYSIS_JSON_SHAPE}

When status is not "ok", "rootCause" and "proposedFix" may be omitted. The report file is the deliverable; write it as your final action.`;
}

const FIX_JSON_SHAPE = `{
  "schemaVersion": 1,
  "ticketId": "<issue key>",
  "summary": "<one-paragraph description of the change you made>",
  "verification": "<how you verified the fix resolves the reported behavior>",
  "newTests": ["<test names or files you added/modified>"],
  "deviations": ["<any departure from the approved analysis, empty if none>"]
}`;

export function buildFixPrompt(task: BugTask, approved: AnalysisReport): string {
  const reviewerNotes = task.reviewerNotes
    ? `\nREVIEWER NOTES (from the human who approved the analysis - treat as instructions):\n${task.reviewerNotes}\n`
    : "";

  return `You are a senior software engineer implementing an APPROVED bug fix. You are on a dedicated bugfix branch of the affected repository; a human has reviewed and approved the analysis below. Follow it.

${ticketBlock(task)}

APPROVED ANALYSIS (JSON):
${JSON.stringify(approved, null, 2)}
${reviewerNotes}
STRICT RULES:
1. Implement the fix following the approved analysis. Make minimal, targeted changes. Never refactor unrelated code, never reformat files you didn't need to touch.
2. Back the fix with tests: add new unit tests (or modify existing ones) that fail without the fix and pass with it, per the approved test plan.
3. Run the project's test suite (command: \`__TEST_COMMAND__\`) and make sure nothing regresses. Fix regressions you introduced; do not silence or delete failing tests.
4. If you must deviate from the approved analysis (it turned out wrong or incomplete), keep the deviation minimal and record it honestly in "deviations".
5. Commit your changes with clear messages prefixed by the ticket key (e.g. "${task.issueKey}: <what changed>"). Do NOT push, do NOT create branches, do NOT open pull requests - the orchestrator handles delivery.
6. Do not touch ${ANALYSIS_REPORT_PATH}.

OUTPUT:
When done, write a completion report as JSON to ${FIX_REPORT_PATH} (relative to the repository root) matching exactly:

${FIX_JSON_SHAPE}

The report file is required; write it as your final action.`;
}
