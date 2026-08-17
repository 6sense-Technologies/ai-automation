import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { RepoAccessError } from "@ai-auto/errors";
import { REPORT_DIR } from "@ai-auto/providers";

export interface FileChange {
  file: string;
  additions: number;
  deletions: number;
}

export interface DiffSummary {
  filesChanged: FileChange[];
  commits: string[];
}

/**
 * Manages local checkouts of target repositories under a work root.
 * One cached clone per repo URL; phases prepare it into the state they need.
 */
export class RepoManager {
  constructor(private readonly workRoot: string) {}

  repoDir(repoUrl: string): string {
    const hash = createHash("sha256").update(repoUrl).digest("hex").slice(0, 12);
    const name = basename(repoUrl.replace(/\.git$/, "")) || "repo";
    return join(this.workRoot, `${name}-${hash}`);
  }

  private git(dir: string): SimpleGit {
    return simpleGit({ baseDir: dir });
  }

  /** Clone the repo if missing, otherwise fetch. Returns the checkout dir. */
  async ensureRepo(repoUrl: string): Promise<string> {
    const dir = this.repoDir(repoUrl);
    try {
      if (!existsSync(join(dir, ".git"))) {
        await mkdir(dir, { recursive: true });
        await simpleGit().clone(repoUrl, dir);
      } else {
        await this.git(dir).fetch(["origin", "--prune"]);
      }
    } catch (err) {
      throw new RepoAccessError(`Cannot clone/fetch ${repoUrl}`, (err as Error).message);
    }
    await this.excludeReportDir(dir);
    return dir;
  }

  /**
   * Put the checkout on a pristine copy of the base branch (discarding any
   * local state). Used before analysis and as the base for new work branches.
   */
  async checkoutCleanBase(dir: string, baseBranch: string): Promise<void> {
    const git = this.git(dir);
    try {
      await git.raw(["checkout", "-B", baseBranch, `origin/${baseBranch}`]);
      await git.raw(["reset", "--hard", `origin/${baseBranch}`]);
      await git.clean("f", ["-d"]);
    } catch (err) {
      throw new RepoAccessError(
        `Cannot check out base branch "${baseBranch}" (does it exist on origin?)`,
        (err as Error).message,
      );
    }
  }

  /**
   * Read-only guard: report any modification the agent made and revert it.
   * Returns the list of dirtied paths (empty when clean).
   */
  async revertIfDirty(dir: string): Promise<string[]> {
    const git = this.git(dir);
    const status = await git.status();
    const dirty = [...status.files.map((f) => f.path)].filter((p) => !p.startsWith(`${REPORT_DIR}/`));
    if (dirty.length > 0) {
      await git.raw(["reset", "--hard", "HEAD"]);
      await git.clean("f", ["-d", "--exclude", REPORT_DIR]);
    }
    return dirty;
  }

  /** Find an existing remote branch matching a pattern (idempotency / resume). */
  async findRemoteBranch(dir: string, pattern: string): Promise<string | null> {
    const out = await this.git(dir).raw(["ls-remote", "--heads", "origin", pattern]);
    const first = out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)[0];
    if (!first) return null;
    const ref = first.split(/\s+/)[1];
    return ref ? ref.replace("refs/heads/", "") : null;
  }

  /** Create (or resume) a work branch. Returns true when resumed from remote. */
  async checkoutFixBranch(dir: string, branch: string, baseBranch: string, remoteExisting: string | null): Promise<boolean> {
    const git = this.git(dir);
    if (remoteExisting) {
      await git.raw(["checkout", "-B", remoteExisting, `origin/${remoteExisting}`]);
      return true;
    }
    await this.checkoutCleanBase(dir, baseBranch);
    await git.raw(["checkout", "-B", branch]);
    return false;
  }

  /** Commit anything the agent left uncommitted. Returns true when a commit was made. */
  async commitLeftovers(dir: string, message: string): Promise<boolean> {
    const git = this.git(dir);
    const status = await git.status();
    // Stage only real work files. Do not `git add .` — if REPORT_DIR is in the
    // target repo's .gitignore (common), git errors with "paths are ignored".
    const paths = status.files
      .map((f) => f.path)
      .filter((p) => p !== REPORT_DIR && !p.startsWith(`${REPORT_DIR}/`));
    if (paths.length === 0) return false;
    await git.add(["--", ...paths]);
    await git.commit(message);
    return true;
  }

  /** True when the branch contains commits beyond the base branch. */
  async hasChangesAgainstBase(dir: string, baseBranch: string): Promise<boolean> {
    const out = await this.git(dir).raw(["rev-list", "--count", `origin/${baseBranch}..HEAD`]);
    return Number.parseInt(out.trim(), 10) > 0;
  }

  async diffSummary(dir: string, baseBranch: string): Promise<DiffSummary> {
    const git = this.git(dir);
    const numstat = await git.raw(["diff", "--numstat", `origin/${baseBranch}...HEAD`]);
    const filesChanged: FileChange[] = numstat
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [additions = "0", deletions = "0", ...fileParts] = line.split(/\s+/);
        return {
          file: fileParts.join(" "),
          additions: Number.parseInt(additions, 10) || 0,
          deletions: Number.parseInt(deletions, 10) || 0,
        };
      })
      .filter((change) => change.file && !change.file.startsWith(`${REPORT_DIR}/`));

    const log = await git.raw(["log", "--format=%h %s", `origin/${baseBranch}..HEAD`]);
    const commits = log
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return { filesChanged, commits };
  }

  /** Push a work branch. This is the only write services make to the remote. */
  async pushBranch(dir: string, branch: string): Promise<void> {
    try {
      await this.git(dir).push(["-u", "origin", branch]);
    } catch (err) {
      throw new RepoAccessError(`Cannot push branch ${branch}`, (err as Error).message);
    }
  }

  /** Keep the agent's report scratch dir out of git status/diffs without touching the repo's .gitignore. */
  private async excludeReportDir(dir: string): Promise<void> {
    const excludePath = join(dir, ".git", "info", "exclude");
    const entry = `${REPORT_DIR}/`;
    try {
      const current = await readFile(excludePath, "utf8");
      if (current.includes(entry)) return;
    } catch {
      // exclude file missing: append below creates it
    }
    await appendFile(excludePath, `\n${entry}\n`);
  }
}
