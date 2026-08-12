import type { FeatureTask } from "../providers/types.js";
import type { JiraWebhookPayload } from "../schemas/webhook.js";

export function toFeatureTask(payload: JiraWebhookPayload, reviewerNotes?: string): FeatureTask {
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
    acceptanceCriteria: payload.acceptanceCriteria,
    reviewerNotes,
  };
}
