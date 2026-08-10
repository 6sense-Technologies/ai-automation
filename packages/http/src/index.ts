import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison for webhook secrets and API keys. */
export function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
