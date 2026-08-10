import type { Logger } from "@ai-auto/logger";

interface Job {
  name: string;
  run: () => Promise<void>;
}

/**
 * Serial in-process job queue. Agent runs are heavyweight (they occupy the
 * machine's checkout and compute), so one pipeline phase runs at a time.
 * Phase runners handle their own failures; this catches anything that leaks.
 */
export class JobQueue {
  private readonly jobs: Job[] = [];
  private running = false;

  constructor(private readonly logger: Logger) {}

  push(name: string, run: () => Promise<void>): void {
    this.jobs.push({ name, run });
    this.logger.info({ job: name, depth: this.jobs.length }, "job enqueued");
    void this.drain();
  }

  get pending(): number {
    return this.jobs.length + (this.running ? 1 : 0);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
        this.logger.info({ job: job.name }, "job started");
        try {
          await job.run();
          this.logger.info({ job: job.name }, "job finished");
        } catch (err) {
          this.logger.error({ job: job.name, err }, "job crashed (unhandled by phase runner)");
        }
      }
    } finally {
      this.running = false;
    }
  }
}
