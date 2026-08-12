import { branchName as sharedBranchName, slugify } from "@ai-auto/pipeline-core";

export { slugify };

/** Branch for security / dependency remediation work. */
export function securityBranchName(jobId: string, packageHint: string): string {
  return sharedBranchName("security", jobId, packageHint || "deps");
}
