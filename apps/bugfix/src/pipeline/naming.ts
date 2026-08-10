import { branchName, branchPattern } from "@ai-auto/pipeline-core";

/** Branch naming convention: bugfix/<TICKET-ID>-<short-slug>. */
export function bugfixBranchName(issueKey: string, summary: string): string {
  return branchName("bugfix", issueKey, summary);
}

/** Remote glob matching every bugfix branch for a ticket (idempotency check). */
export function bugfixBranchPattern(issueKey: string): string {
  return branchPattern("bugfix", issueKey);
}

export { slugify } from "@ai-auto/pipeline-core";
