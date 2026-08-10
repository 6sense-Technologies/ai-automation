import type { Logger } from "../logger.js";
import type { AnalysisReport } from "../schemas/analysis.js";
import type { FixReport } from "../schemas/fix.js";
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
} from "./adf.js";

export const LABELS = {
  analysisReady: "ai-analysis-ready",
  fixDelivered: "ai-fix-delivered",
  fixFailed: "ai-fix-failed",
} as const;

export interface JiraClientOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export class JiraClient {
  private readonly authHeader: string;

  constructor(
    private readonly options: JiraClientOptions,
    private readonly logger: Logger,
  ) {
    this.authHeader = `Basic ${Buffer.from(`${options.email}:${options.apiToken}`).toString("base64")}`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Jira API ${method} ${path} failed with ${response.status}: ${detail.slice(0, 500)}`);
    }
    if (response.status === 204) return undefined;
    return response.json().catch(() => undefined);
  }

  async addComment(issueKey: string, adfDoc: AdfNode): Promise<void> {
    await this.request("POST", `/rest/api/3/issue/${issueKey}/comment`, { body: adfDoc });
  }

  async addLabel(issueKey: string, label: string): Promise<void> {
    await this.request("PUT", `/rest/api/3/issue/${issueKey}`, {
      update: { labels: [{ add: label }] },
    });
  }

  async removeLabel(issueKey: string, label: string): Promise<void> {
    await this.request("PUT", `/rest/api/3/issue/${issueKey}`, {
      update: { labels: [{ remove: label }] },
    });
  }

  /**
   * Best-effort variants: reporting back to Jira must never crash the
   * pipeline (the state store and audit log remain the source of truth).
   */
  async tryAddComment(issueKey: string, adfDoc: AdfNode): Promise<void> {
    try {
      await this.addComment(issueKey, adfDoc);
    } catch (err) {
      this.logger.error({ issueKey, err }, "failed to post Jira comment");
    }
  }

  async tryAddLabel(issueKey: string, label: string): Promise<void> {
    try {
      await this.addLabel(issueKey, label);
    } catch (err) {
      this.logger.error({ issueKey, label, err }, "failed to add Jira label");
    }
  }
}

// ---------------------------------------------------------------------------
// Comment renderers
// ---------------------------------------------------------------------------

export function renderAnalysisComment(report: AnalysisReport): AdfNode {
  const blocks: AdfNode[] = [
    heading(2, "AI Bug Analysis (Phase A)"),
    field("Status", report.status),
    field("Severity", report.bugUnderstanding.severityAssessment),
    field("Confidence", report.confidence.toFixed(2)),
    heading(3, "Bug understanding"),
    paragraph(text(report.bugUnderstanding.restatement)),
    field("Expected", report.bugUnderstanding.expectedBehavior),
    field("Actual", report.bugUnderstanding.actualBehavior),
  ];

  if (report.rootCause) {
    blocks.push(heading(3, "Root cause"), paragraph(text(report.rootCause.mechanism)));
    if (report.rootCause.locations.length > 0) {
      blocks.push(
        bulletList(
          ...report.rootCause.locations.map((loc) => [
            code(loc.file + (loc.lines ? `:${loc.lines}` : "")),
            text(loc.symbol ? ` ${loc.symbol}` : ""),
            text(loc.citation ? ` — ${loc.citation}` : ""),
          ]),
        ),
      );
    }
  }

  if (report.proposedFix) {
    blocks.push(
      heading(3, "Proposed fix"),
      paragraph(text(report.proposedFix.approach)),
      field("Risk", `${report.proposedFix.riskLevel}${report.proposedFix.riskNotes ? ` — ${report.proposedFix.riskNotes}` : ""}`),
      field("Files to touch", report.proposedFix.filesToTouch.join(", ")),
    );
    if (report.proposedFix.testPlan.length > 0) {
      blocks.push(
        paragraph(strong("Test plan:")),
        bulletList(
          ...report.proposedFix.testPlan.map((entry) => [
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
        text("review this analysis, then approve the fix via "),
        code(`POST /api/tickets/${report.ticketId}/approve`),
      ),
    );
  }

  return doc(...blocks);
}

export function renderFixComment(report: FixReport): AdfNode {
  const blocks: AdfNode[] = [
    heading(2, "AI Bug Fix (Phase B)"),
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
        text(" is pushed. Review and merge manually per the promotion chain (bugfix → release → beta → prod → main)."),
      ),
    );
  }

  return doc(...blocks);
}

export function renderFailureComment(issueKey: string, reason: string, detail: string): AdfNode {
  return doc(
    heading(2, "AI Bugfix Pipeline: failed"),
    field("Ticket", issueKey),
    field("Reason", reason),
    ...(detail ? [paragraph(strong("Detail:")), codeBlock(detail.slice(0, 4000))] : []),
    paragraph(
      text("The pipeline stopped. Fix the underlying problem and re-trigger by re-sending the webhook "),
      text("(a FAILED ticket resets to RECEIVED on the next trigger)."),
    ),
  );
}
