import { useEffect, useRef, useState } from 'react';
import { ipc } from './ipc';
import type { ProductionJob } from '@mas/types';

const TERMINAL: ProductionJob<unknown>['status'][] = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
];

/**
 * Submit-and-poll against a durable main-process `JobManager` (the same
 * queued/cancellable/restart-safe pattern Auto-Clip and Studio already use)
 * instead of awaiting one long-lived IPC round-trip. Shared by Auto-Edit
 * (Toolbar + MediaPanel) and Auto-Captions (MediaPanel) so the polling/cancel
 * plumbing exists once.
 *
 * `start()` resolves once the job reaches a terminal state, so call sites
 * keep the existing "await, then handle the result" shape; `job`/`busy`
 * update on every poll tick in the meantime for progress/cancel UI.
 */
export function useJobRunner<Input extends object, Result>(channels: {
  start: string;
  list: string;
  cancel: string;
  pollMs?: number;
}) {
  const [job, setJob] = useState<ProductionJob<Result> | null>(null);
  const jobRef = useRef<ProductionJob<Result> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const setBoth = (j: ProductionJob<Result>) => {
    jobRef.current = j;
    setJob(j);
  };

  const pollUntilDone = (id: string): Promise<ProductionJob<Result>> =>
    new Promise((resolve) => {
      const tick = async () => {
        const jobs = (await ipc.invoke(channels.list)) as
          | ProductionJob<Result>[]
          | undefined;
        const current = jobs?.find((j) => j.id === id);
        if (!current) {
          resolve(jobRef.current!);
          return;
        }
        setBoth(current);
        if (TERMINAL.includes(current.status)) {
          resolve(current);
        } else {
          timer.current = setTimeout(
            () => void tick(),
            channels.pollMs ?? 1500,
          );
        }
      };
      void tick();
    });

  const start = async (input: Input): Promise<ProductionJob<Result>> => {
    clearTimeout(timer.current);
    const requestId = crypto.randomUUID();
    const started = (await ipc.invoke(channels.start, {
      requestId,
      ...input,
    })) as ProductionJob<Result>;
    setBoth(started);
    if (TERMINAL.includes(started.status)) return started;
    return pollUntilDone(started.id);
  };

  const cancel = async () => {
    if (!jobRef.current) return;
    const updated = (await ipc.invoke(
      channels.cancel,
      jobRef.current.id,
    )) as ProductionJob<Result> | undefined;
    if (updated) setBoth(updated);
  };

  const busy = !!job && !TERMINAL.includes(job.status);

  return { job, busy, start, cancel };
}
