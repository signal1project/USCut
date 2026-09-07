import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { JobExecution, ProductionJob } from '@mas/types';

/** Serial local jobs. A restart records interruption; it never repeats paid work. */
export class JobManager<Input, Result> {
  private jobs = new Map<
    string,
    ProductionJob<Result> & { inputHash: string }
  >();
  private pending = new Map<string, Input>();
  private active: { id: string; controller: AbortController } | null = null;
  private saveRetries = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; attempts: number }
  >();

  constructor(
    private readonly directory: string,
    private readonly run: (
      input: Input,
      context: JobExecution,
    ) => Promise<Result>,
  ) {
    fs.mkdirSync(directory, { recursive: true });
    const names = new Set(
      fs
        .readdirSync(directory)
        .filter((name) => /^[a-zA-Z0-9-]{1,80}\.json(?:\.tmp)?$/.test(name))
        .map((name) => name.replace(/\.tmp$/, '')),
    );
    for (const name of names) {
      try {
        // A Windows file lock may leave a newer valid temporary record.
        const candidates = [name + '.tmp', name]
          .flatMap((file) => {
            try {
              const value = JSON.parse(
                fs.readFileSync(path.join(directory, file), 'utf8'),
              );
              return value.id + '.json' === name &&
                typeof value.inputHash === 'string'
                ? [value]
                : [];
            } catch {
              return [];
            }
          })
          .sort((a, b) =>
            (b.updatedAt ?? b.createdAt ?? '').localeCompare(
              a.updatedAt ?? a.createdAt ?? '',
            ),
          );
        const job = candidates[0];
        if (!job) continue;
        if (
          job.id + '.json' !== name ||
          typeof job.inputHash !== 'string' ||
          typeof job.createdAt !== 'string'
        )
          continue;
        if (['queued', 'running', 'cancelling'].includes(job.status)) {
          job.status = 'interrupted';
          job.stage = 'App closed before completion';
          job.error =
            'This job was interrupted. Review it before starting a new job; previous provider usage may have been charged.';
          job.updatedAt = new Date().toISOString();
          this.save(job);
        }
        this.jobs.set(job.id, job);
      } catch {
        /* A corrupt record must not prevent access to other jobs. */
      }
    }
  }

  private save(job: ProductionJob<Result> & { inputHash: string }): void {
    const file = path.join(this.directory, `${job.id}.json`);
    fs.writeFileSync(file + '.tmp', JSON.stringify(job));
    try {
      fs.renameSync(file + '.tmp', file);
      const pending = this.saveRetries.get(job.id);
      if (pending) clearTimeout(pending.timer);
      this.saveRetries.delete(job.id);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw err;
      const previous = this.saveRetries.get(job.id);
      if (previous) clearTimeout(previous.timer);
      const attempts = (previous?.attempts ?? 0) + 1;
      if (attempts > 10) {
        this.saveRetries.delete(job.id);
        console.error(
          'Production job state remains in its recovery file because the destination is locked.',
        );
        return;
      }
      const timer = setTimeout(() => {
        try {
          this.save(this.jobs.get(job.id) ?? job);
        } catch (error) {
          console.error('Could not retry production job persistence.', error);
        }
      }, 25 * attempts);
      this.saveRetries.set(job.id, { timer, attempts });
    }
  }

  get(id: string): ProductionJob<Result> | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const { inputHash: _hash, ...view } = job;
    return structuredClone(view);
  }

  list(): ProductionJob<Result>[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((j) => this.get(j.id)!);
  }

  submit(id: string, label: string, input: Input): ProductionJob<Result> {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id))
      throw new Error('Invalid job identifier.');
    const inputHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    const existing = this.jobs.get(id);
    if (existing) {
      if (existing.inputHash !== inputHash)
        throw new Error('This job identifier belongs to a different request.');
      return this.get(id)!;
    }
    if (this.pending.size >= 5)
      throw new Error('The job queue is full. Wait for a job to finish.');
    const now = new Date().toISOString();
    const job = {
      id,
      label,
      inputHash,
      status: 'queued' as const,
      stage: 'Waiting to start',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.save(job);
    this.jobs.set(id, job);
    this.pending.set(id, input);
    this.pump();
    return this.get(id)!;
  }

  cancel(id: string): ProductionJob<Result> | undefined {
    const job = this.jobs.get(id);
    if (!job || !['queued', 'running', 'cancelling'].includes(job.status))
      return this.get(id);
    job.status = this.active?.id === id ? 'cancelling' : 'cancelled';
    job.stage =
      job.status === 'cancelling'
        ? 'Cancellation requested; waiting for current operation to stop'
        : 'Cancelled';
    job.updatedAt = new Date().toISOString();
    this.pending.delete(id);
    if (this.active?.id === id) this.active.controller.abort();
    this.save(job);
    return this.get(id);
  }

  private pump(): void {
    if (this.active) return;
    const next = this.pending.entries().next().value;
    if (!next) return;
    const [id, input] = next;
    this.pending.delete(id);
    const controller = new AbortController();
    this.active = { id, controller };
    const job = this.jobs.get(id)!;
    void (async () => {
      try {
        job.status = 'running';
        job.stage = 'Starting';
        this.save(job);
        const result = await this.run(input, {
          signal: controller.signal,
          report: (stage, progress) => {
            controller.signal.throwIfAborted();
            job.stage = stage;
            job.progress = Math.max(
              job.progress,
              Math.min(99, Math.max(0, progress)),
            );
            job.updatedAt = new Date().toISOString();
            this.save(job);
          },
        });
        controller.signal.throwIfAborted();
        job.result = result;
        job.status = 'completed';
        job.stage = 'Complete';
        job.progress = 100;
      } catch (err) {
        job.status = controller.signal.aborted ? 'cancelled' : 'failed';
        job.stage = controller.signal.aborted ? 'Cancelled' : 'Failed';
        if (!controller.signal.aborted)
          job.error = err instanceof Error ? err.message : 'Job failed.';
      } finally {
        job.updatedAt = new Date().toISOString();
        try {
          this.save(job);
        } catch (error) {
          console.error(
            'Could not persist the final production job state.',
            error,
          );
        }
        this.active = null;
        this.pump();
      }
    })();
  }
}
