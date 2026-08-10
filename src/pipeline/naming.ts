const MAX_SLUG_LENGTH = 40;

/** Derive a branch-safe slug from a ticket summary. */
export function slugify(text: string, maxLength = MAX_SLUG_LENGTH): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= maxLength) return slug || "fix";
  // Cut at a word boundary so branches don't end mid-word.
  const cut = slug.slice(0, maxLength + 1);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut.slice(0, maxLength)).replace(/-+$/, "") || "fix";
}

/** Branch naming convention: bugfix/<TICKET-ID>-<short-slug>. */
export function bugfixBranchName(issueKey: string, summary: string): string {
  return `bugfix/${issueKey}-${slugify(summary)}`;
}

/** Remote glob matching every bugfix branch for a ticket (idempotency check). */
export function bugfixBranchPattern(issueKey: string): string {
  return `refs/heads/bugfix/${issueKey}-*`;
}
