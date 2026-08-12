/**
 * Pipeline failure taxonomy. Every failure that reaches Jira carries one of
 * these reasons so comments and audit rows are consistent and parseable.
 */
export type FailureReason =
  | "repo_access_error"
  | "agent_startup_error"
  | "agent_run_error"
  | "report_invalid"
  | "cannot_find_root_cause"
  | "needs_more_info"
  | "tests_failed"
  | "fix_failed"
  | "config_error"
  | "internal_error"
  | "no_suitable_version"
  | "needs_manual";

export class PipelineError extends Error {
  constructor(
    public readonly reason: FailureReason,
    message: string,
    public readonly detail: string = "",
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class RepoAccessError extends PipelineError {
  constructor(message: string, detail = "") {
    super("repo_access_error", message, detail, true);
  }
}

export class AgentStartupError extends PipelineError {
  constructor(message: string, detail = "", retryable = false) {
    super("agent_startup_error", message, detail, retryable);
  }
}

export class AgentRunError extends PipelineError {
  constructor(message: string, detail = "") {
    super("agent_run_error", message, detail, true);
  }
}

export class ReportValidationError extends PipelineError {
  constructor(message: string, detail = "") {
    super("report_invalid", message, detail);
  }
}

export class TestsFailedError extends PipelineError {
  constructor(message: string, detail = "") {
    super("tests_failed", message, detail);
  }
}

export function toPipelineError(err: unknown): PipelineError {
  if (err instanceof PipelineError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new PipelineError("internal_error", message);
}
