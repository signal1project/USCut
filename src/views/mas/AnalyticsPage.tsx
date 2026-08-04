import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Users, Plus, Trash2, TrendingUp } from 'lucide-react';
import {
  MetricCard,
  PlatformBadge,
  type AnalyticsSnapshot,
  type CompetitorEntry,
} from '@mas/ui';
import { useMasApi } from './useMasApi';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Input,
  Label,
} from '@/components/ui';

interface FormValues {
  accountId: string;
}

/** View captured metric snapshots for an account's posts. */
export default function AnalyticsPage(): React.ReactElement {
  const api = useMasApi();
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const { register, handleSubmit } = useForm<FormValues>();

  const load = async (values: FormValues) => {
    if (!api) return;
    setLoading(true);
    try {
      const { snapshots: rows } = await api.getAnalyticsByAccount(
        values.accountId,
      );
      setSnapshots(rows);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load analytics',
      );
    } finally {
      setLoading(false);
    }
  };

  const totals = snapshots.reduce(
    (acc, s) => ({
      reach: acc.reach + s.reach,
      impressions: acc.impressions + s.impressions,
      engagements: acc.engagements + s.engagements,
      clicks: acc.clicks + s.clicks,
    }),
    { reach: 0, impressions: 0, engagements: 0, clicks: 0 },
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Analytics</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(load)} className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="accountId" className="sr-only">
                Account ID
              </Label>
              <Input
                id="accountId"
                placeholder="Account ID"
                {...register('accountId', { required: true })}
              />
            </div>
            <Button type="submit" loading={loading} disabled={!api}>
              Load
            </Button>
          </form>
        </CardContent>
      </Card>

      {snapshots.length > 0 && (
        <>
          {/* Metric totals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard title="Reach" value={totals.reach} />
            <MetricCard title="Impressions" value={totals.impressions} />
            <MetricCard title="Engagements" value={totals.engagements} />
            <MetricCard title="Clicks" value={totals.clicks} />
          </div>

          {/* Data table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {[
                        'Platform',
                        'Post',
                        'Reach',
                        'Impressions',
                        'Engagements',
                        'Clicks',
                        'Captured',
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-medium text-ink-muted"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => (
                      <tr
                        key={s.id}
                        className="border-b border-border/50 hover:bg-surface-2 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <PlatformBadge platform={s.platform} />
                        </td>
                        <td className="px-4 py-3 text-ink-muted truncate max-w-[180px]">
                          {s.externalPostId}
                        </td>
                        <td className="px-4 py-3">
                          {s.reach.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          {s.impressions.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          {s.engagements.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          {s.clicks.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-ink-muted text-xs">
                          {new Date(s.capturedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {snapshots.length === 0 && !loading && (
        <p className="text-center text-ink-muted py-12 text-sm">
          Enter an account ID above and click Load
        </p>
      )}

      <CompetitorTracker />
    </div>
  );
}

/** Manual competitor benchmarking: track handles + periodic follower snapshots. */
function CompetitorTracker(): React.ReactElement {
  const api = useMasApi();
  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([]);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('');
  const [handle, setHandle] = useState('');
  const [followerInput, setFollowerInput] = useState<Record<string, string>>(
    {},
  );

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const { competitors: rows } = await api.listCompetitors();
      setCompetitors(rows);
    } catch {
      /* section is additive */
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!api || !name.trim() || !platform.trim() || !handle.trim()) return;
    try {
      await api.addCompetitor({
        name: name.trim(),
        platform: platform.trim(),
        handle: handle.trim(),
      });
      setName('');
      setPlatform('');
      setHandle('');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add failed');
    }
  };

  const snapshot = async (id: string) => {
    if (!api) return;
    const followers = parseInt(followerInput[id] ?? '', 10);
    if (!Number.isFinite(followers) || followers < 0) {
      toast.error('Enter a follower count');
      return;
    }
    try {
      await api.addCompetitorSnapshot(id, { followers });
      setFollowerInput((prev) => ({ ...prev, [id]: '' }));
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Snapshot failed');
    }
  };

  const remove = async (id: string) => {
    if (!api) return;
    try {
      await api.deleteCompetitor(id);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const growth = (c: CompetitorEntry): string | null => {
    if (c.snapshots.length < 2) return null;
    const first = c.snapshots[0].followers;
    const last = c.snapshots[c.snapshots.length - 1].followers;
    const delta = last - first;
    return `${delta >= 0 ? '+' : ''}${delta.toLocaleString()} since ${new Date(c.snapshots[0].date).toLocaleDateString()}`;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users size={15} className="text-accent" />
          Competitor Benchmarks
        </CardTitle>
        <CardDescription>
          Track competitor accounts and log follower counts over time to
          benchmark your growth.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 min-w-32"
          />
          <Input
            placeholder="Platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-32"
          />
          <Input
            placeholder="@handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            className="w-40"
          />
          <Button
            onClick={() => void add()}
            disabled={!api || !name.trim() || !handle.trim()}
          >
            <Plus size={14} />
            Track
          </Button>
        </div>

        {competitors.length === 0 && (
          <p className="text-xs text-ink-subtle">No competitors tracked yet.</p>
        )}

        {competitors.map((c) => {
          const latest = c.snapshots[c.snapshots.length - 1];
          const g = growth(c);
          return (
            <div
              key={c.id}
              className="rounded-md border border-border/60 bg-surface-2 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-strong">
                    {c.name}{' '}
                    <span className="text-ink-muted font-normal">
                      · {c.platform} · {c.handle}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {latest
                      ? `${latest.followers.toLocaleString()} followers (${new Date(latest.date).toLocaleDateString()})`
                      : 'No snapshots yet'}
                    {g && (
                      <span className="ml-2 text-success inline-flex items-center gap-0.5">
                        <TrendingUp size={10} />
                        {g}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Input
                    placeholder="Followers"
                    value={followerInput[c.id] ?? ''}
                    onChange={(e) =>
                      setFollowerInput((prev) => ({
                        ...prev,
                        [c.id]: e.target.value,
                      }))
                    }
                    className="w-24 h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void snapshot(c.id)}
                  >
                    Log
                  </Button>
                  <button
                    onClick={() => void remove(c.id)}
                    className="text-ink-muted hover:text-error transition-colors p-1"
                    title="Stop tracking"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
