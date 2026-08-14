import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Users, Plus, Trash2, TrendingUp } from 'lucide-react';
import {
  MetricCard,
  PlatformBadge,
  type AnalyticsSnapshot,
  type CompetitorEntry,
} from '@mas/ui';
import type { Platform } from '@mas/types';
import { useMasApi } from './useMasApi';
import { ipc, hasIpc } from '@/lib/ipc';
import { useActiveBrandStore } from '@/store/activeBrandStore';
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

interface ConnectedAccount {
  id: string;
  platform: Platform;
  accountName: string;
  externalId: string;
  brandId?: string | null;
}

/** View captured metric snapshots for an account's posts. */
export default function AnalyticsPage(): React.ReactElement {
  const api = useMasApi();
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const [accountsRaw, setAccountsRaw] = useState<ConnectedAccount[]>([]);
  const {
    activeBrandId,
    brands: activeBrands,
    loaded,
    load: loadActiveBrand,
  } = useActiveBrandStore();
  const { register, handleSubmit } = useForm<FormValues>();

  useEffect(() => {
    if (!loaded) void loadActiveBrand();
    if (!hasIpc()) return;
    void (async () => {
      try {
        const list = (await ipc.invoke(
          'mas:accounts:list',
        )) as ConnectedAccount[];
        setAccountsRaw(list);
      } catch {
        /* account picker is a convenience — raw entry below still works */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accounts = useMemo(
    () =>
      activeBrandId
        ? accountsRaw.filter((a) => a.brandId === activeBrandId)
        : accountsRaw,
    [accountsRaw, activeBrandId],
  );

  const load = async (values: FormValues) => {
    if (!api || !values.accountId) return;
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
        <CardContent className="space-y-2">
          <form onSubmit={handleSubmit(load)} className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="accountId" className="sr-only">
                Account
              </Label>
              {accounts.length > 0 ? (
                <select
                  id="accountId"
                  {...register('accountId', { required: true })}
                  className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-ink-strong focus:outline-none focus:border-accent"
                >
                  <option value="">Choose an account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountName} · {a.platform}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id="accountId"
                  placeholder="Account ID"
                  {...register('accountId', { required: true })}
                />
              )}
            </div>
            <Button type="submit" loading={loading} disabled={!api}>
              Load
            </Button>
          </form>
          {activeBrandId && (
            <p className="text-xs text-ink-muted">
              Showing accounts for{' '}
              {activeBrands.find((b) => b.id === activeBrandId)?.name ??
                'the active company'}{' '}
              — switch companies from Home.
            </p>
          )}
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
  const {
    activeBrandId,
    brands: activeBrands,
    loaded,
    load: loadActiveBrand,
  } = useActiveBrandStore();
  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([]);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('');
  const [handle, setHandle] = useState('');
  const [brandId, setBrandId] = useState('');
  const [followerInput, setFollowerInput] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    if (!loaded) void loadActiveBrand();
  }, [loaded, loadActiveBrand]);

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

  const visibleCompetitors = useMemo(
    () =>
      activeBrandId
        ? competitors.filter((c) => c.brandId === activeBrandId)
        : competitors,
    [competitors, activeBrandId],
  );

  const add = async () => {
    if (!api || !name.trim() || !platform.trim() || !handle.trim()) return;
    try {
      await api.addCompetitor({
        name: name.trim(),
        platform: platform.trim(),
        handle: handle.trim(),
        brandId: brandId || activeBrandId || null,
      });
      setName('');
      setPlatform('');
      setHandle('');
      setBrandId('');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add failed');
    }
  };

  const assignBrand = async (id: string, newBrandId: string) => {
    if (!api) return;
    try {
      await api.assignCompetitorBrand(id, newBrandId || null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Assign failed');
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
          {activeBrands.length > 0 && (
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface-2 px-2 text-xs text-ink-strong focus:outline-none focus:border-accent"
            >
              <option value="">
                {activeBrandId ? 'Active company' : 'No company'}
              </option>
              {activeBrands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <Button
            onClick={() => void add()}
            disabled={!api || !name.trim() || !handle.trim()}
          >
            <Plus size={14} />
            Track
          </Button>
        </div>

        {visibleCompetitors.length === 0 && (
          <p className="text-xs text-ink-subtle">
            {activeBrandId
              ? 'No competitors tracked for this company yet.'
              : 'No competitors tracked yet.'}
          </p>
        )}

        {visibleCompetitors.map((c) => {
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
                  {activeBrands.length > 0 && (
                    <select
                      value={c.brandId ?? ''}
                      onChange={(e) => void assignBrand(c.id, e.target.value)}
                      className="mt-1 h-6 rounded border border-border/60 bg-surface px-1.5 text-[10px] text-ink-muted focus:outline-none focus:border-accent"
                    >
                      <option value="">No company</option>
                      {activeBrands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  )}
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
