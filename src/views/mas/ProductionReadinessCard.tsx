import React, { useEffect, useState } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Input,
} from '@/components/ui';
import { ipc } from '@/lib/ipc';
import type { ReadinessReport } from '../../../commont/readiness';

export function ProductionReadinessCard() {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [musicDir, setMusicDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = async () => {
    setBusy(true);
    setMessage('');
    try {
      setReport(
        (await ipc.invoke('mas:settings:readiness')) as ReadinessReport,
      );
    } catch {
      setMessage(
        'Readiness checks could not run. Restart USCut and try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let stopped = false;
    setBusy(true);
    Promise.all([
      ipc.invoke('mas:settings:readiness'),
      ipc.invoke('mas:settings:get-music-dir'),
    ])
      .then(([value, directory]) => {
        if (!stopped) {
          setReport(value as ReadinessReport);
          setMusicDir(directory as string);
        }
      })
      .catch(() => {
        if (!stopped)
          setMessage(
            'Readiness checks could not run. Restart USCut and try again.',
          );
      })
      .finally(() => {
        if (!stopped) setBusy(false);
      });
    return () => {
      stopped = true;
    };
  }, []);
  const saveMusic = async () => {
    setBusy(true);
    try {
      const result = (await ipc.invoke(
        'mas:settings:set-music-dir',
        musicDir,
      )) as { ok: boolean; error?: string };
      if (!result.ok) {
        setMessage(result.error ?? 'Could not save music folder.');
        return;
      }
      setReport(
        (await ipc.invoke('mas:settings:readiness')) as ReadinessReport,
      );
      setMessage('Music folder saved. The next listing reel will use it.');
    } catch {
      setMessage('Could not save the music folder.');
    } finally {
      setBusy(false);
    }
  };
  const browse = async () => {
    try {
      const result = (await ipc.invoke(
        'mas:settings:pick-folder',
        musicDir || undefined,
      )) as { canceled: boolean; path?: string };
      if (!result.canceled && result.path) setMusicDir(result.path);
    } catch {
      setMessage('Could not open the folder picker.');
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Production readiness</CardTitle>
        <CardDescription>
          Check local components and saved configuration. These checks do not
          contact paid providers or prove live account access.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button disabled={busy} onClick={() => void refresh()}>
          {busy ? 'Checking…' : 'Refresh readiness'}
        </Button>
        {report && (
          <div className="space-y-2">
            {report.checks.map((check) => (
              <div key={check.id} className="rounded-lg bg-surface-2 p-3">
                <p className="text-sm font-medium text-ink-strong">
                  {check.label}{' '}
                  <span
                    className={
                      check.status === 'attention'
                        ? 'text-amber-300'
                        : 'text-emerald-400'
                    }
                  >
                    ·{' '}
                    {check.status === 'attention'
                      ? 'Needs attention'
                      : check.status === 'configured'
                        ? 'Configured'
                        : 'Ready'}
                  </span>
                </p>
                <p className="text-xs text-ink-muted break-words">
                  {check.detail}
                </p>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <label
            htmlFor="reel-music-folder"
            className="text-sm font-medium text-ink-strong"
          >
            Listing reel music folder
          </label>
          <p className="text-xs text-ink-muted">
            Choose a folder containing standard and luxury subfolders with your
            MP3, WAV, M4A, or OGG tracks. Each template uses the first track
            alphabetically in its tier. Leave blank to use bundled music.
          </p>
          <Input
            id="reel-music-folder"
            value={musicDir}
            onChange={(e) => setMusicDir(e.target.value)}
            placeholder="Use bundled music"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void browse()}
            >
              Browse music
            </Button>
            <Button disabled={busy} onClick={() => void saveMusic()}>
              Save music folder
            </Button>
          </div>
        </div>
        {message && (
          <p role="status" className="text-sm text-ink-base">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
