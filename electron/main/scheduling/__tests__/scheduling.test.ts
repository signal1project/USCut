import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimitedQueues } from '../rateLimitedQueues';
import {
  Scheduler,
  type SchedulerBackend,
  type CancellableJob,
} from '../scheduler';

describe('RateLimitedQueues', () => {
  it('runs tasks and propagates results', async () => {
    const q = new RateLimitedQueues();
    const result = await q.run('facebook', async () => 42);
    expect(result).toBe(42);
  });

  it('runs tasks across multiple platforms independently', async () => {
    const q = new RateLimitedQueues();
    const [a, b] = await Promise.all([
      q.run('twitter', async () => 'tw'),
      q.run('pinterest', async () => 'pin'),
    ]);
    expect(a).toBe('tw');
    expect(b).toBe('pin');
  });

  it('propagates task errors to the caller', async () => {
    const q = new RateLimitedQueues();
    await expect(
      q.run('threads', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('preserves FIFO order within a single platform', async () => {
    const q = new RateLimitedQueues(1);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        q.run('instagram', async () => {
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
    await q.onIdle();
  });
});

// Fake backend: captures jobs so the test fires them deterministically.
class FakeBackend implements SchedulerBackend {
  jobs: Array<{ runAt: Date; cb: () => void; cancelled: boolean }> = [];
  allowPast = false;
  schedule(runAt: Date, cb: () => void): CancellableJob | null {
    if (!this.allowPast && runAt.getTime() < Date.now()) return null;
    const entry = { runAt, cb, cancelled: false };
    this.jobs.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  }
  fireLast() {
    this.jobs[this.jobs.length - 1].cb();
  }
}

describe('Scheduler', () => {
  let backend: FakeBackend;
  let scheduler: Scheduler;
  const future = () => new Date(Date.now() + 60_000);

  beforeEach(() => {
    backend = new FakeBackend();
    scheduler = new Scheduler(backend);
  });

  it('schedules a future job and tracks it', () => {
    expect(scheduler.schedule('p1', future(), () => {})).toBe(true);
    expect(scheduler.has('p1')).toBe(true);
    expect(scheduler.count).toBe(1);
  });

  it('returns false for a past runAt and does not track', () => {
    expect(
      scheduler.schedule('p1', new Date(Date.now() - 1000), () => {}),
    ).toBe(false);
    expect(scheduler.has('p1')).toBe(false);
  });

  it('replaces an existing job when rescheduling the same id', () => {
    scheduler.schedule('p1', future(), () => {});
    scheduler.schedule('p1', future(), () => {});
    expect(scheduler.count).toBe(1);
    expect(backend.jobs[0].cancelled).toBe(true); // first job cancelled
  });

  it('runs the task and forgets the job once fired', async () => {
    let ran = false;
    scheduler.schedule('p1', future(), () => {
      ran = true;
    });
    backend.fireLast();
    expect(ran).toBe(true);
    expect(scheduler.has('p1')).toBe(false);
  });

  it('cancels a scheduled job', () => {
    scheduler.schedule('p1', future(), () => {});
    expect(scheduler.cancel('p1')).toBe(true);
    expect(scheduler.has('p1')).toBe(false);
    expect(scheduler.cancel('p1')).toBe(false);
  });

  it('cancelAll clears everything', () => {
    scheduler.schedule('a', future(), () => {});
    scheduler.schedule('b', future(), () => {});
    scheduler.cancelAll();
    expect(scheduler.count).toBe(0);
  });
});
