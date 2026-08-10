import { exec } from "node:child_process";

export interface TestRunResult {
  command: string;
  passed: boolean;
  /** Tail of combined stdout+stderr, bounded for storage/Jira. */
  output: string;
}

const OUTPUT_TAIL_CHARS = 6000;

/**
 * Independently run the project's test command in the checkout. The
 * orchestrator never trusts the agent's claim that tests pass.
 */
export function runTests(command: string, cwd: string, timeoutMs: number): Promise<TestRunResult> {
  return new Promise((resolvePromise) => {
    exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: "true" } },
      (error, stdout, stderr) => {
        const combined = `${stdout}\n${stderr}`.trim();
        const output = combined.length > OUTPUT_TAIL_CHARS ? `…${combined.slice(-OUTPUT_TAIL_CHARS)}` : combined;
        if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          resolvePromise({ command, passed: false, output: `${output}\n\n[test run timed out after ${timeoutMs}ms]` });
          return;
        }
        resolvePromise({ command, passed: !error, output });
      },
    );
  });
}
