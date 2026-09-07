import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobManager } from '../jobManager';

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uscut-job-test-'));
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('durable production jobs', () => {
  it('retries a transient Windows rename lock without losing terminal state', async () => {
    let finish!: () => void;
    const manager = new JobManager(directory, async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return 'done';
    });
    manager.submit('locked', 'source', {});
    const spy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('File locked'), { code: 'EPERM' });
    });
    try {
      finish();
      await vi.waitFor(() =>
        expect(
          JSON.parse(
            fs.readFileSync(path.join(directory, 'locked.json'), 'utf8'),
          ).status,
        ).toBe('completed'),
      );
      expect(manager.get('locked')?.result).toBe('done');
      expect(fs.existsSync(path.join(directory, 'locked.json.tmp'))).toBe(
        false,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('recovers a newer temporary snapshot left by a locked destination', () => {
    const job = {
      id: 'recovery',
      label: 'source',
      inputHash: 'hash',
      createdAt: '2026-09-07T10:00:00Z',
      updatedAt: '2026-09-07T10:00:00Z',
      status: 'cancelling',
    };
    fs.writeFileSync(
      path.join(directory, 'recovery.json'),
      JSON.stringify(job),
    );
    fs.writeFileSync(
      path.join(directory, 'recovery.json.tmp'),
      JSON.stringify({
        ...job,
        status: 'cancelled',
        updatedAt: '2026-09-07T10:00:01Z',
      }),
    );
    expect(
      new JobManager(directory, async () => 1).get('recovery')?.status,
    ).toBe('cancelled');
  });
  it('executes once for duplicate submissions and persists results', async () => {
    const run = vi.fn(async (input: number, context) => {
      context.report('Rendering', 70);
      return input * 2;
    });
    const manager = new JobManager(directory, run);
    manager.submit('same-id', 'source', 3);
    manager.submit('same-id', 'source', 3);
    expect(() => manager.submit('same-id', 'source', 4)).toThrow(
      'different request',
    );
    await vi.waitFor(() =>
      expect(manager.get('same-id')?.status).toBe('completed'),
    );
    expect(run).toHaveBeenCalledTimes(1);
    const restartRun = vi.fn(async () => 0);
    const restarted = new JobManager(directory, restartRun);
    expect(restarted.get('same-id')).toMatchObject({
      status: 'completed',
      progress: 100,
      result: 6,
    });
    expect(restartRun).not.toHaveBeenCalled();
  });
  it('cancels queued work without starting it and waits for active cancellation', async () => {
    let finish!: () => void;
    const run = vi.fn(async (_input: number, context) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      context.signal.throwIfAborted();
      return 1;
    });
    const manager = new JobManager(directory, run);
    manager.submit('first', 'first', 1);
    manager.submit('second', 'second', 2);
    expect(manager.cancel('second')?.status).toBe('cancelled');
    expect(manager.cancel('first')?.status).toBe('cancelling');
    finish();
    await vi.waitFor(() =>
      expect(manager.get('first')?.status).toBe('cancelled'),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(manager.get('first')?.result).toBeUndefined();
  });
  it('marks interrupted records after restart without re-running them', () => {
    for (const status of ['queued', 'running', 'cancelling']) {
      fs.writeFileSync(
        path.join(directory, `${status}.json`),
        JSON.stringify({
          id: status,
          status,
          inputHash: 'hash',
          createdAt: new Date().toISOString(),
          progress: 20,
        }),
      );
    }
    const run = vi.fn(async () => 'unexpected');
    const manager = new JobManager(directory, run);
    expect(manager.list()).toHaveLength(3);
    expect(manager.list().every((j) => j.status === 'interrupted')).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
  it('records failures and continues to the next job serially', async () => {
    const manager = new JobManager(directory, async (input: number) => {
      if (input === 1) throw new Error('provider unavailable');
      return 2;
    });
    manager.submit('failed', 'first', 1);
    manager.submit('next', 'second', 2);
    await vi.waitFor(() =>
      expect(manager.get('next')?.status).toBe('completed'),
    );
    expect(manager.get('failed')).toMatchObject({
      status: 'failed',
      error: 'provider unavailable',
    });
  });
  it('rejects path-like identifiers before writing files', () => {
    const manager = new JobManager(directory, async () => 1);
    expect(() => manager.submit('../outside', 'invalid', {})).toThrow(
      'identifier',
    );
    expect(fs.readdirSync(directory)).toEqual([]);
  });
});
