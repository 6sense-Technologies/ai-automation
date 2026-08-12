import { branchName, branchPattern } from "@ai-auto/pipeline-core";

export function featureBranchName(issueKey: string, summary: string): string {
  return branchName("feature", issueKey, summary);
}

export function featureBranchPattern(issueKey: string): string {
  return branchPattern("feature", issueKey);
}

export { slugify } from "@ai-auto/pipeline-core";
