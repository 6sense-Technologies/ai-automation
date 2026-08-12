import { z } from "zod";

export const ISSUE_KEY_REGEX = /^[A-Z][A-Z0-9_]*-\d+$/;

const stringOrList = z
  .union([z.array(z.string()), z.string()])
  .transform((v) =>
    Array.isArray(v)
      ? v.map((s) => s.trim()).filter(Boolean)
      : v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
  );

export const attachmentSchema = z.union([
  z.string().transform((url) => ({ filename: url.split("/").pop() ?? url, url })),
  z.object({ filename: z.string(), url: z.string() }),
]);

/**
 * Payload the Jira Automation "Send web request" action must deliver for
 * tickets labeled feature-improvement.
 */
export const jiraWebhookPayloadSchema = z.object({
  phase: z.literal("plan").default("plan"),
  issueKey: z.string().regex(ISSUE_KEY_REGEX, "expected a Jira issue key like PROJ-123"),
  summary: z.string().min(1),
  description: z.string().default(""),
  issueType: z.string().default("Task"),
  priority: z.string().default(""),
  reporter: z.string().default(""),
  assignee: z.string().default(""),
  components: stringOrList.default([]),
  labels: stringOrList.default([]),
  attachments: z.array(attachmentSchema).default([]),
  acceptanceCriteria: z.string().default(""),
});

export type JiraWebhookPayload = z.infer<typeof jiraWebhookPayloadSchema>;

export const approveBodySchema = z
  .object({
    notes: z.string().max(10_000).default(""),
  })
  .default({ notes: "" });

export type ApproveBody = z.infer<typeof approveBodySchema>;
