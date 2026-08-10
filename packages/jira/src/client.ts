import type { Logger } from "@ai-auto/logger";
import type { AdfNode } from "./adf.js";

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
