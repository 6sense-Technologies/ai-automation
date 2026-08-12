import {
  bulletList,
  code,
  codeBlock,
  doc,
  field,
  heading,
  paragraph,
  strong,
  text,
  type AdfNode,
} from "@ai-auto/jira";
import type { FeaturePlan } from "../schemas/plan.js";
import type { ImplementReport } from "../schemas/implement.js";

export const LABELS = {
  planReady: "ai-feature-ready",
  delivered: "ai-feature-delivered",
  failed: "ai-feature-failed",
} as const;

export function renderPlanComment(report: FeaturePlan): AdfNode {
  const blocks: AdfNode[] = [
    heading(2, "AI Feature Plan (Phase A)"),
    field("Status", report.status),
    field("Priority", report.featureUnderstanding.priorityAssessment),
    field("Confidence", report.confidence.toFixed(2)),
    heading(3, "Understanding"),
    paragraph(text(report.featureUnderstanding.restatement)),
    field("Goal", report.featureUnderstanding.goal),
  ];

  if (report.featureUnderstanding.acceptanceCriteria.length > 0) {
    blocks.push(
      paragraph(strong("Acceptance criteria:")),
      bulletList(...report.featureUnderstanding.acceptanceCriteria.map((c) => [text(c)])),
    );
  }
  if (report.featureUnderstanding.outOfScope.length > 0) {
    blocks.push(
      paragraph(strong("Out of scope:")),
      bulletList(...report.featureUnderstanding.outOfScope.map((c) => [text(c)])),
    );
  }

  if (report.proposedDesign) {
    blocks.push(
      heading(3, "Proposed design"),
      paragraph(text(report.proposedDesign.approach)),
      field(
        "Risk",
        `${report.proposedDesign.riskLevel}${report.proposedDesign.riskNotes ? ` — ${report.proposedDesign.riskNotes}` : ""}`,
      ),
      field("Files to touch", report.proposedDesign.filesToTouch.join(", ")),
    );
    if (report.proposedDesign.testPlan.length > 0) {
      blocks.push(
        paragraph(strong("Test plan:")),
        bulletList(
          ...report.proposedDesign.testPlan.map((entry) => [
            text(`${entry.action} `),
            code(entry.file),
            text(` — ${entry.covers}`),
          ]),
        ),
      );
    }
  }

  if (report.status !== "ok") {
    blocks.push(heading(3, "Blockers"), paragraph(text(report.blockers || "unspecified")));
  } else {
    blocks.push(
      paragraph(
        strong("Next step: "),
        text("review this plan, then approve implementation via "),
        code(`POST /api/tickets/${report.ticketId}/approve`),
      ),
    );
  }

  return doc(...blocks);
}

export function renderImplementComment(report: ImplementReport): AdfNode {
  const blocks: AdfNode[] = [
    heading(2, "AI Feature Implementation (Phase B)"),
    field("Status", report.status),
    field("Branch", report.branchName),
    heading(3, "Changes"),
  ];

  if (report.diffSummary.filesChanged.length > 0) {
    blocks.push(
      bulletList(
        ...report.diffSummary.filesChanged.map((change) => [
          code(change.file),
          text(` +${change.additions} / -${change.deletions}`),
        ]),
      ),
    );
  } else {
    blocks.push(paragraph(text("No file changes recorded.")));
  }

  if (report.diffSummary.commits.length > 0) {
    blocks.push(paragraph(strong("Commits:")), bulletList(...report.diffSummary.commits.map((c) => [code(c)])));
  }

  blocks.push(
    heading(3, "Test results"),
    field("Command", report.testResults.command),
    field("Passed", report.testResults.passed ? "yes" : "NO"),
  );
  if (report.testResults.newTests.length > 0) {
    blocks.push(paragraph(strong("New/updated tests:")), bulletList(...report.testResults.newTests.map((t) => [code(t)])));
  }
  if (!report.testResults.passed && report.testResults.output) {
    blocks.push(paragraph(strong("Test output (tail):")), codeBlock(report.testResults.output));
  }

  blocks.push(heading(3, "Verification"), paragraph(text(report.verification)));

  if (report.deviations.length > 0) {
    blocks.push(
      heading(3, "Deviations from approved plan"),
      bulletList(...report.deviations.map((d) => [text(d)])),
    );
  }

  if (report.status === "delivered") {
    blocks.push(
      paragraph(
        strong("Next step: "),
        text("branch "),
        code(report.branchName),
        text(" is pushed. Review and merge manually."),
      ),
    );
  }

  return doc(...blocks);
}

export function renderFailureComment(issueKey: string, reason: string, detail: string): AdfNode {
  return doc(
    heading(2, "AI Feature Pipeline: failed"),
    field("Ticket", issueKey),
    field("Reason", reason),
    ...(detail ? [paragraph(strong("Detail:")), codeBlock(detail.slice(0, 4000))] : []),
    paragraph(
      text("The pipeline stopped. Fix the underlying problem and re-trigger by re-sending the webhook "),
      text("(a FAILED ticket resets to RECEIVED on the next trigger)."),
    ),
  );
}
