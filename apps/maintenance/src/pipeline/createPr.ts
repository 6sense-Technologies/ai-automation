import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Create a GitHub PR using `gh` CLI when available, else GitHub REST API with GITHUB_TOKEN. */
export async function createPullRequest(options: {
  workdir: string;
  title: string;
  body: string;
  head: string;
  base: string;
  githubToken?: string;
}): Promise<string | undefined> {
  const { workdir, title, body, head, base, githubToken } = options;

  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "create", "--title", title, "--body", body, "--head", head, "--base", base],
      {
        cwd: workdir,
        env: {
          ...process.env,
          ...(githubToken ? { GH_TOKEN: githubToken, GITHUB_TOKEN: githubToken } : {}),
        },
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const url = stdout.trim().split("\n").filter(Boolean).pop();
    if (url?.startsWith("http")) return url;
  } catch {
    // fall through to REST
  }

  if (!githubToken) return undefined;

  // Derive owner/repo from git remote
  try {
    const { stdout: remote } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: workdir });
    const match = remote.trim().match(/[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (!match) return undefined;
    const owner = match[1]!;
    const repo = match[2]!;

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title, body, head, base }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub PR create failed (${res.status}): ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as { html_url?: string };
    return data.html_url;
  } catch {
    return undefined;
  }
}
