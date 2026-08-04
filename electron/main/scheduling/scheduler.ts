import schedule from 'node-schedule';

export type ScheduledTask = () => void | Promise<void>;

export interface CancellableJob {
  cancel(): void;
}

// Timer backend seam — production uses node-schedule; tests inject a fake that
// fires jobs on demand.
export interface SchedulerBackend {
  schedule(runAt: Date, cb: () => void): CancellableJob | null;
}

export const nodeScheduleBackend: SchedulerBackend = {
  schedule(runAt, cb) {
    return schedule.scheduleJob(runAt, cb);
  },
};

/**
 * Keyed time-based scheduling for posts. Scheduling the same id again replaces
 * the prior job, so reschedules are idempotent.
 */
export class Scheduler {
  private readonly jobs = new Map<string, CancellableJob>();

  constructor(
    private readonly backend: SchedulerBackend = nodeScheduleBackend,
  ) {}

  schedule(id: string, runAt: Date, task: ScheduledTask): boolean {
    this.cancel(id);
    const job = this.backend.schedule(runAt, () => {
      this.jobs.delete(id);
      void task();
    });
    if (!job) return false; // runAt is in the past
    this.jobs.set(id, job);
    return true;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.cancel();
    this.jobs.delete(id);
    return true;
  }

  has(id: string): boolean {
    return this.jobs.has(id);
  }

  get count(): number {
    return this.jobs.size;
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) job.cancel();
    this.jobs.clear();
  }
}
