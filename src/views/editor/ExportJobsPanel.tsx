import { useEffect, useState } from 'react';
import type { ProductionJob } from '@mas/types';
import { ipc } from '@/lib/ipc';

export default function ExportJobsPanel({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<ProductionJob<{ outputPath: string }>[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await ipc.invoke('aicuts:export-jobs');
        if (!closed && Array.isArray(result)) setJobs(result);
      } catch (e) {
        if (!closed) setError(String(e));
      } finally {
        if (!closed) timer = setTimeout(refresh, 1000);
      }
    };
    void refresh();
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, []);
  const action = async (channel: string, id: string) => {
    try {
      setError('');
      await ipc.invoke(channel, id);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div
      role="dialog"
      aria-label="Export jobs"
      className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-6"
    >
      <section className="bg-[#1d1d22] border border-[#303039] rounded-xl p-5 w-full max-w-xl max-h-[80vh] overflow-y-auto space-y-4 text-ink-base">
        <header className="flex justify-between items-center">
          <h2 className="font-semibold text-lg">Export jobs</h2>
          <button className="px-3 py-2 rounded bg-surface-2" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="text-sm text-ink-muted">
          You can keep editing while exports run. Each export uses the timeline
          as it was when submitted. Closing USCut interrupts unfinished renders;
          completed files remain available.
        </p>
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
        {!jobs.length && <p>No exports yet.</p>}
        {jobs.map((job) => (
          <article
            key={job.id}
            className="border border-border rounded p-3 space-y-2"
          >
            <p className="text-sm break-all">{job.label}</p>
            <p className="text-sm">
              {job.status} · {job.stage} · {Math.round(job.progress)}%
            </p>
            <progress className="w-full" max={100} value={job.progress} />
            {job.error && (
              <p role="alert" className="text-red-400 text-sm">
                {job.error}
              </p>
            )}
            {['queued', 'running'].includes(job.status) && (
              <button
                className="px-3 py-2 rounded bg-surface-2"
                onClick={() => void action('aicuts:export-job-cancel', job.id)}
              >
                Cancel export
              </button>
            )}
            {job.status === 'completed' && (
              <button
                className="px-3 py-2 rounded bg-surface-2"
                onClick={() => void action('aicuts:export-job-reveal', job.id)}
              >
                Show exported file
              </button>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
