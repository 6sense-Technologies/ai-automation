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

/** Build `<prefix>/<TICKET-ID>-<short-slug>` branch names. */
export function branchName(prefix: string, issueKey: string, summary: string): string {
  return `${prefix}/${issueKey}-${slugify(summary)}`;
}

/** Remote glob matching every branch for a ticket under a prefix. */
export function branchPattern(prefix: string, issueKey: string): string {
  return `refs/heads/${prefix}/${issueKey}-*`;
}
