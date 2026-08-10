import type { BugTask } from "../providers/types.js";
import type { JiraWebhookPayload } from "../schemas/webhook.js";

export function toBugTask(payload: JiraWebhookPayload, reviewerNotes?: string): BugTask {
  return {
    issueKey: payload.issueKey,
    summary: payload.summary,
    description: payload.description,
    priority: payload.priority,
    reporter: payload.reporter,
    assignee: payload.assignee,
    components: payload.components,
    labels: payload.labels,
    attachments: payload.attachments,
    reproductionSteps: payload.reproductionSteps,
    ...(reviewerNotes ? { reviewerNotes } : {}),
  };
}
