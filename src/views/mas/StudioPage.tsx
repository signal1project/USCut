import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProductionJob } from '@mas/types';
import { ipc } from '@/lib/ipc';
import { saveCurrentProject, openProject } from '@/lib/projectPersistence';
import type { ProjectSnapshot } from '@/store/editorStore';
import {
  studioAssetSchema,
  studioDraftSchema,
  type StudioDraft,
  type StudioScene,
  type StudioAssetInsight,
} from '../../../commont/studio';

type Result =
  | { kind: 'plan'; draft: StudioDraft; insights: StudioAssetInsight[] }
  | { kind: 'revise'; draft: StudioDraft; sceneIndex: number }
  | { kind: 'build'; project: ProjectSnapshot };
const empty: StudioDraft = {
  title: 'My production',
  brief: '',
  assets: [],
  scenes: [],
};
const storageKey = 'uscut-studio-draft-v1';
const field =
  'w-full rounded border border-border bg-surface-1 p-2 text-ink-base';
const button =
  'rounded border border-border px-3 py-2 hover:bg-surface-2 disabled:opacity-40';

export default function StudioPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<StudioDraft>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      return studioDraftSchema
        .extend({
          assets: studioDraftSchema.shape.assets.min(0),
          scenes: studioDraftSchema.shape.scenes.min(0),
        })
        .parse(saved) as StudioDraft;
    } catch {
      return empty;
    }
  });
  const [narration, setNarration] = useState(false);
  const [jobs, setJobs] = useState<ProductionJob<Result>[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviseText, setReviseText] = useState<Record<number, string>>({});
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      setError(
        'Draft could not be saved locally. Keep this page open until you build your project.',
      );
    }
  }, [draft]);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const result = await ipc.invoke('aicuts:studio-jobs');
        if (!disposed && Array.isArray(result)) setJobs(result);
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const scenePatch = (index: number, patch: Partial<StudioScene>) =>
    setDraft((d) => ({
      ...d,
      scenes: d.scenes.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  const start = (kind: 'plan' | 'build') =>
    act(async () => {
      await ipc.invoke('aicuts:studio-start', {
        requestId: crypto.randomUUID(),
        kind,
        ...draft,
        draft,
        narration,
      });
      setJobs(
        (await ipc.invoke('aicuts:studio-jobs')) as ProductionJob<Result>[],
      );
    });
  const reviseScene = (index: number) =>
    act(async () => {
      const instruction = (reviseText[index] ?? '').trim();
      if (!instruction) throw new Error('Describe the change you want first');
      await ipc.invoke('aicuts:studio-start', {
        requestId: crypto.randomUUID(),
        kind: 'revise',
        draft,
        sceneIndex: index,
        instruction,
      });
      setReviseText((t) => ({ ...t, [index]: '' }));
      setJobs(
        (await ipc.invoke('aicuts:studio-jobs')) as ProductionJob<Result>[],
      );
    });
  return (
    <main className="p-6 max-w-5xl mx-auto space-y-5 overflow-y-auto h-full">
      <div>
        <h1 className="text-2xl font-semibold">Production Studio</h1>
        <p className="text-ink-muted mt-1">
          Turn your brief and media into an editable video. Review the
          storyboard, build your project, then finish and export in the editor.
        </p>
      </div>
      {error && (
        <div
          role="alert"
          className="p-3 rounded border border-red-500 text-red-400"
        >
          {error}
        </div>
      )}
      <label className="block">
        Production title
        <input
          aria-label="Production title"
          className={field}
          value={draft.title}
          maxLength={150}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </label>
      <label className="block">
        Creative brief
        <textarea
          aria-label="Creative brief"
          className={field}
          rows={3}
          maxLength={12000}
          value={draft.brief}
          placeholder="Audience, message, tone, target length, and call to action"
          onChange={(e) => setDraft({ ...draft, brief: e.target.value })}
        />
      </label>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Supplied media · {draft.assets.length}
        </h2>
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const items = await ipc.invoke('aicuts:import-video');
              if (!Array.isArray(items)) return;
              const imported = items
                .filter(
                  (item) => item.type === 'video' || item.type === 'image',
                )
                .map((item) =>
                  studioAssetSchema.parse({ ...item, id: crypto.randomUUID() }),
                );
              setDraft((d) => ({
                ...d,
                assets: [
                  ...d.assets,
                  ...imported.filter(
                    (a) => !d.assets.some((old) => old.src === a.src),
                  ),
                ].slice(0, 100),
              }));
            })
          }
        >
          Add videos or images
        </button>
        <p className="text-sm text-ink-muted">
          When a vision-capable AI provider is connected, the storyboard step
          reviews sampled frames from each clip; otherwise it uses your brief
          and filenames only. Keep original files in place.
        </p>
        {draft.assets.map((a) => (
          <div key={a.id} className="flex gap-3 items-center text-sm">
            <span className="flex-1 truncate">
              {a.name} ·{' '}
              {a.type === 'video' ? `${a.duration.toFixed(1)}s` : 'image'}
            </span>
            <button
              className={button}
              disabled={draft.scenes.some((s) => s.assetId === a.id)}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  assets: d.assets.filter((old) => old.id !== a.id),
                }))
              }
            >
              Remove
            </button>
          </div>
        ))}
      </section>
      <div className="flex flex-wrap gap-3">
        <button
          className={button}
          disabled={busy || !draft.assets.length || !draft.brief.trim()}
          onClick={() => void start('plan')}
        >
          Generate AI storyboard
        </button>
        <button
          className={button}
          disabled={!draft.assets.length || draft.scenes.length >= 60}
          onClick={() =>
            setDraft((d) => ({
              ...d,
              scenes: [
                ...d.scenes,
                {
                  assetId: d.assets[0].id,
                  duration: Math.min(5, d.assets[0].duration),
                  sourceStart: 0,
                  narration: '',
                  headline: '',
                },
              ],
            }))
          }
        >
          Add scene manually
        </button>
      </div>
      <p className="text-sm text-ink-muted">
        AI storyboards use the provider selected in Settings and may incur its
        normal text usage charges. Generated footage is not included.
      </p>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Storyboard · {draft.scenes.length} scenes
        </h2>
        {draft.scenes.map((s, i) => (
          <article
            key={i}
            className="rounded border border-border p-4 space-y-3"
          >
            <div className="flex gap-2 items-center">
              <strong className="flex-1">Scene {i + 1}</strong>
              <button
                className={button}
                disabled={i === 0}
                onClick={() =>
                  setDraft((d) => {
                    const scenes = [...d.scenes];
                    [scenes[i - 1], scenes[i]] = [scenes[i], scenes[i - 1]];
                    return { ...d, scenes };
                  })
                }
              >
                Move up
              </button>
              <button
                className={button}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    scenes: d.scenes.filter((_, n) => n !== i),
                  }))
                }
              >
                Delete
              </button>
            </div>
            <label className="block">
              Media
              <select
                className={field}
                value={s.assetId}
                onChange={(e) =>
                  scenePatch(i, {
                    assetId: e.target.value,
                    sourceStart: 0,
                    duration: Math.min(
                      s.duration,
                      draft.assets.find((a) => a.id === e.target.value)!
                        .duration,
                    ),
                  })
                }
              >
                {draft.assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-3">
              <label className="flex-1">
                Duration (seconds)
                <input
                  className={field}
                  type="number"
                  min={0.5}
                  max={120}
                  step={0.1}
                  value={s.duration}
                  onChange={(e) =>
                    scenePatch(i, { duration: Number(e.target.value) })
                  }
                />
              </label>
              <label className="flex-1">
                Source start (seconds)
                <input
                  className={field}
                  type="number"
                  min={0}
                  step={0.1}
                  value={s.sourceStart}
                  onChange={(e) =>
                    scenePatch(i, { sourceStart: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label className="block">
              On-screen headline
              <input
                className={field}
                maxLength={180}
                value={s.headline}
                onChange={(e) => scenePatch(i, { headline: e.target.value })}
              />
            </label>
            <label className="block">
              Narration script
              <textarea
                className={field}
                rows={2}
                maxLength={2000}
                value={s.narration}
                onChange={(e) => scenePatch(i, { narration: e.target.value })}
              />
            </label>
            <div className="flex gap-2">
              <input
                className={field}
                placeholder="Revise this scene with AI (e.g. punchier headline, trim to 3s)"
                maxLength={2000}
                value={reviseText[i] ?? ''}
                onChange={(e) =>
                  setReviseText((t) => ({ ...t, [i]: e.target.value }))
                }
              />
              <button
                className={button}
                disabled={busy || !(reviseText[i] ?? '').trim()}
                onClick={() => void reviseScene(i)}
              >
                Revise with AI
              </button>
            </div>
          </article>
        ))}
      </section>
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={narration}
          onChange={(e) => setNarration(e.target.checked)}
        />
        Generate local Windows narration from scene scripts
      </label>
      <p className="text-sm text-ink-muted">
        Narrated scenes mute source audio. Images extend to fit narration; video
        scenes require enough source footage. Headlines remain editable on a
        separate track.
      </p>
      <button
        className={button}
        disabled={busy || !draft.scenes.length}
        onClick={() => void start('build')}
      >
        Build editable video
      </button>
      <section className="space-y-3 pb-8">
        <h2 className="text-lg font-semibold">Production jobs</h2>
        <p className="text-sm text-ink-muted">
          Results are saved across restarts. Load a storyboard explicitly to
          replace the current draft. Cancellation waits for an active AI or
          speech request to finish.
        </p>
        {jobs.slice(0, 10).map((job) => (
          <article
            key={job.id}
            className="rounded border border-border p-3 space-y-2"
          >
            <div>
              {job.label} · {job.status} · {Math.round(job.progress)}%
            </div>
            <div className="text-sm text-ink-muted">{job.stage}</div>
            {job.error && (
              <div role="alert" className="text-red-400">
                {job.error}
              </div>
            )}
            {['queued', 'running'].includes(job.status) && (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await ipc.invoke('aicuts:studio-cancel', job.id);
                  })
                }
              >
                Cancel
              </button>
            )}
            {job.status === 'completed' && job.result?.kind === 'plan' && (
              <div className="space-y-2">
                {!!(job.result as Extract<Result, { kind: 'plan' }>).insights
                  ?.length && (
                  <details className="text-sm text-ink-muted">
                    <summary>What the AI saw in your media</summary>
                    <ul className="list-disc pl-5 pt-1">
                      {(
                        job.result as Extract<Result, { kind: 'plan' }>
                      ).insights.map((insight) => (
                        <li key={insight.assetId}>
                          {draft.assets.find((a) => a.id === insight.assetId)
                            ?.name ?? insight.assetId}
                          : {insight.description}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <button
                  className={button}
                  onClick={() =>
                    setDraft(
                      (job.result as Extract<Result, { kind: 'plan' }>).draft,
                    )
                  }
                >
                  Use storyboard (replaces draft)
                </button>
              </div>
            )}
            {job.status === 'completed' && job.result?.kind === 'revise' && (
              <button
                className={button}
                onClick={() =>
                  setDraft(
                    (job.result as Extract<Result, { kind: 'revise' }>).draft,
                  )
                }
              >
                Apply revised storyboard (replaces draft)
              </button>
            )}
            {job.status === 'completed' && job.result?.kind === 'build' && (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    if (!(await saveCurrentProject()))
                      throw new Error(
                        'Could not save the current editor project. Your production result is still available here.',
                      );
                    const project = (
                      job.result as Extract<Result, { kind: 'build' }>
                    ).project;
                    // Open a fresh copy so returning to a job never overwrites edited work.
                    const copy = { ...project, id: crypto.randomUUID() };
                    const saved = (await ipc.invoke(
                      'aicuts:project-save',
                      copy,
                    )) as { success?: boolean };
                    if (!saved?.success)
                      throw new Error('Could not save production project');
                    const loaded = await openProject(copy.id);
                    if (!loaded.ok) throw new Error(loaded.error);
                    navigate('/editor');
                  })
                }
              >
                Open a copy in editor
              </button>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
