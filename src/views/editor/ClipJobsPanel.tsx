import React, { useEffect, useState } from 'react';
import type { MasApiClient, AutoClipResult } from '@mas/ui';
import type { ProductionJob } from '@mas/types';

export function ClipJobsPanel({
  api,
  refreshKey,
  onImport,
}: {
  api: MasApiClient | null;
  refreshKey: number;
  onImport: (result: AutoClipResult) => void;
}) {
  const [jobs, setJobs] = useState<ProductionJob<AutoClipResult>[]>([]);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  useEffect(() => {
    if (!api) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await api.listAutoClipJobs();
        if (!stopped) {
          setJobs(response.jobs);
          setError('');
        }
      } catch {
        if (!stopped)
          setError(
            'Cannot refresh jobs. Reconnecting; running jobs continue in the app.',
          );
      } finally {
        if (!stopped) timer = setTimeout(refresh, 2000);
      }
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, refreshKey]);

  const cancel = async (id: string) => {
    if (!api) return;
    setCancelling(id);
    try {
      const job = await api.cancelAutoClipJob(id);
      setJobs((previous) => previous.map((j) => (j.id === id ? job : j)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel job.');
    } finally {
      setCancelling(null);
    }
  };
  return (
    <div className="mt-3 space-y-2" aria-label="Auto-Clip jobs">
      <p className="text-[11px] font-semibold text-ink-base">Recent jobs</p>
      <p className="text-[10px] text-ink-muted">
        Jobs survive navigation. Closing USCut interrupts unfinished jobs.
        Completed clips can be added to your current project.
      </p>
      {error && (
        <p role="alert" className="text-[10px] text-amber-300">
          {error}
        </p>
      )}
      {jobs.length === 0 && (
        <p className="text-[10px] text-ink-muted">No jobs yet.</p>
      )}
      {jobs.slice(0, 10).map((job) => (
        <div
          key={job.id}
          className="rounded-lg border border-[#303039] p-2 space-y-1"
        >
          <p className="text-[11px] text-ink-base truncate" title={job.label}>
            {job.label}
          </p>
          <p className="text-[10px] text-ink-muted">
            {job.status} · {job.stage}
          </p>
          {['queued', 'running', 'cancelling'].includes(job.status) && (
            <>
              <progress
                aria-label={`Progress for ${job.label}`}
                max={100}
                value={job.progress}
                className="w-full h-1.5"
              />
              <button
                disabled={cancelling === job.id || job.status === 'cancelling'}
                onClick={() => void cancel(job.id)}
                className="text-[11px] text-amber-300 disabled:opacity-50"
              >
                {job.status === 'cancelling' ? 'Stopping…' : 'Cancel job'}
              </button>
            </>
          )}
          {job.error && (
            <p className="text-[10px] text-amber-300">{job.error}</p>
          )}
          {job.status === 'completed' && job.result && (
            <button
              onClick={() => onImport(job.result!)}
              className="text-[11px] text-[#34d399]"
            >
              Add clips to current project
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
