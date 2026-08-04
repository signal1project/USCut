import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Calendar,
  Clock,
  Send,
  RefreshCw,
  Zap,
  Upload,
  Recycle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { PubType, type Platform } from '@mas/types';
import {
  PlatformBadge,
  type BestTimesResult,
  type CalendarEntry,
} from '@mas/ui';
import { useMasApi } from './useMasApi';
import { ipc, hasIpc } from '@/lib/ipc';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { toast } from 'sonner';

interface ConnectedAccount {
  id: string;
  platform: Platform;
  accountName: string;
  externalId: string;
}

/** Prefill payload other pages (e.g. the Listing Video Generator) can hand to the
 * composer via router navigation state — see ListingScraperPage's "Schedule" button. */
export interface SchedulerPrefill {
  pubType: PubType;
  mediaRef: string;
  body?: string;
}

/** Scheduler: pick accounts, write caption, set date/time, queue the post. */
export default function SchedulerPage(): React.ReactElement {
  const api = useMasApi();
  const location = useLocation();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [pubType, setPubType] = useState<PubType>(PubType.IMAGE_TEXT);
  const [body, setBody] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bestTimes, setBestTimes] = useState<BestTimesResult | null>(null);
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [recycling, setRecycling] = useState(false);
  const [importing, setImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Consume a one-shot prefill handed off via navigation state (e.g. "Schedule"
  // on a generated listing reel) and clear it from history so it doesn't
  // reapply on back/forward navigation or a manual reload of this route.
  useEffect(() => {
    const prefill = (location.state as { prefill?: SchedulerPrefill } | null)
      ?.prefill;
    if (!prefill) return;
    setPubType(prefill.pubType);
    setImageUrl(prefill.mediaRef);
    if (prefill.body) setBody(prefill.body);
    toast.info('Reel loaded — pick accounts and a time to schedule it.');
    navigate(location.pathname, { replace: true, state: null });
    // Runs once per navigation-state arrival, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const loadInsights = useCallback(async () => {
    if (!api) return;
    try {
      const [times, cal] = await Promise.all([
        api.getBestTimes(),
        api.getCalendar(),
      ]);
      setBestTimes(times);
      setCalendarEntries(cal.entries);
    } catch {
      /* insights are additive — never block the composer */
    }
  }, [api]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  /** Fill the datetime-local input from an ISO timestamp (local time). */
  const useSlot = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, '0');
    setScheduledAt(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  };

  const recycleTop = async () => {
    if (!api) return;
    setRecycling(true);
    try {
      const outcome = await api.recycleTopPosts({ count: 3, spacingHours: 24 });
      if (outcome.requeued.length === 0) {
        toast.info(
          'Nothing to recycle yet — publish some posts and capture analytics first.',
        );
      } else {
        toast.success(
          `Re-queued ${outcome.requeued.length} top post${outcome.requeued.length === 1 ? '' : 's'}`,
        );
        void loadInsights();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Recycle failed');
    } finally {
      setRecycling(false);
    }
  };

  /** Bulk CSV import: header row `datetime,body,hashtags` (hashtags optional). */
  const importCsv = async (file: File) => {
    if (!api) return;
    if (selectedAccountIds.length === 0) {
      toast.error(
        'Select target accounts first — CSV rows are scheduled to them.',
      );
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const startIdx = /^date/i.test(lines[0] ?? '') ? 1 : 0;
      let ok = 0;
      let failed = 0;
      for (const line of lines.slice(startIdx)) {
        // naive CSV split honoring simple quoted fields
        const cols =
          line
            .match(/("([^"]*)"|[^,]+)(?=,|$)/g)
            ?.map((c) => c.replace(/^"|"$/g, '').trim()) ?? [];
        const [dt, bodyCol, tagsCol] = cols;
        const runAt = new Date(dt ?? '');
        if (!bodyCol || Number.isNaN(runAt.getTime()) || runAt <= new Date()) {
          failed += 1;
          continue;
        }
        try {
          await api.publish({
            accountIds: selectedAccountIds,
            pubType: PubType.IMAGE_TEXT,
            body: bodyCol,
            hashtags: (tagsCol ?? '').split(/\s+/).filter(Boolean),
            mediaRefs: [],
            runAt: runAt.toISOString(),
          });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      toast[failed ? 'warning' : 'success'](
        `CSV import: ${ok} scheduled${failed ? `, ${failed} skipped` : ''}`,
      );
      void loadInsights();
    } finally {
      setImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  };

  const loadAccounts = async () => {
    if (!hasIpc()) return;
    setLoadingAccounts(true);
    try {
      const list = (await ipc.invoke(
        'mas:accounts:list',
      )) as ConnectedAccount[];
      setAccounts(list);
    } catch {
      toast.error('Could not load connected accounts');
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const submit = async () => {
    if (!api) {
      toast.error('API not ready');
      return;
    }
    if (selectedAccountIds.length === 0) {
      toast.error('Select at least one account');
      return;
    }
    if (!scheduledAt) {
      toast.error('Set a date and time');
      return;
    }
    const runAt = new Date(scheduledAt);
    if (runAt <= new Date()) {
      toast.error('Scheduled time must be in the future');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.publish({
        accountIds: selectedAccountIds,
        pubType,
        body,
        hashtags: hashtags.split(/\s+/).filter(Boolean),
        mediaRefs: imageUrl.trim() ? [imageUrl.trim()] : [],
        runAt: runAt.toISOString(),
      });
      if ('scheduled' in result && result.scheduled) {
        toast.success(`Scheduled for ${runAt.toLocaleString()}`);
        setBody('');
        setHashtags('');
        setImageUrl('');
        setScheduledAt('');
        setSelectedAccountIds([]);
      } else {
        toast.success('Published immediately (time was too soon)');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Schedule failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Default to 24 hours from now for the datetime picker
  const minDateTime = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-strong">
          <Calendar size={18} className="text-accent" />
          Schedule a Post
        </h2>
        <p className="text-sm text-ink-muted mt-0.5">
          Compose a post and pick a future date/time — AICut will publish it
          automatically.
        </p>
      </div>

      {!hasIpc() && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Running in browser — scheduling requires the desktop app.
        </div>
      )}

      {/* Account picker */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            Publish to
            <button
              onClick={loadAccounts}
              className="text-ink-muted hover:text-ink-base transition-colors"
              title="Refresh accounts"
            >
              <RefreshCw
                size={13}
                className={loadingAccounts ? 'animate-spin' : ''}
              />
            </button>
          </CardTitle>
          <CardDescription>
            {accounts.length === 0
              ? 'No connected accounts — go to Accounts in the editor to connect.'
              : 'Click to toggle accounts for this post.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {accounts.map((acc) => {
            const selected = selectedAccountIds.includes(acc.id);
            return (
              <button
                key={acc.id}
                onClick={() => toggleAccount(acc.id)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? 'bg-accent/20 text-accent border-accent/40'
                    : 'border-border text-ink-muted hover:border-accent/30'
                }`}
              >
                <PlatformBadge platform={acc.platform} />
                <span>{acc.accountName}</span>
                {selected && <span className="text-accent">✓</span>}
              </button>
            );
          })}
          {accounts.length === 0 && !loadingAccounts && (
            <p className="text-xs text-ink-subtle">No accounts yet</p>
          )}
        </CardContent>
      </Card>

      {/* Post composer */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Post type</Label>
            <Select
              value={pubType}
              onValueChange={(v) => setPubType(v as PubType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PubType.IMAGE_TEXT}>
                  Image + Caption
                </SelectItem>
                <SelectItem value={PubType.VIDEO}>Video</SelectItem>
                <SelectItem value={PubType.ARTICLE}>Article / Link</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(pubType === PubType.IMAGE_TEXT || pubType === PubType.VIDEO) && (
            <div className="space-y-1.5">
              <Label htmlFor="imageUrl">
                {pubType === PubType.VIDEO ? 'Video URL' : 'Image URL'}
                <span className="text-ink-subtle ml-1 font-normal text-xs">
                  (publicly accessible)
                </span>
              </Label>
              <Input
                id="imageUrl"
                placeholder="https://..."
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="body">Caption / Body</Label>
            <Textarea
              id="body"
              rows={4}
              placeholder="Write your post caption here…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hashtags">Hashtags (space-separated)</Label>
            <Input
              id="hashtags"
              placeholder="#realestate #homebuying"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="scheduledAt" className="flex items-center gap-1.5">
              <Clock size={13} />
              Scheduled date &amp; time
            </Label>
            <Input
              id="scheduledAt"
              type="datetime-local"
              min={minDateTime}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            {bestTimes && bestTimes.slots.length > 0 && (
              <div className="pt-1">
                <p className="text-xs text-ink-muted mb-1.5 flex items-center gap-1">
                  <Zap size={11} className="text-accent" />
                  Best times{' '}
                  {bestTimes.basedOn === 'history'
                    ? `(from your ${bestTimes.sampleSize} tracked posts)`
                    : '(engagement-peak defaults — capture analytics to personalize)'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {bestTimes.slots.slice(0, 4).map((slot) => (
                    <button
                      key={`${slot.dayOfWeek}-${slot.hour}`}
                      type="button"
                      // eslint-disable-next-line react-hooks/rules-of-hooks -- useSlot is a plain click handler, not a React hook
                      onClick={() => useSlot(slot.nextOccurrence)}
                      className="rounded-full border border-border px-2.5 py-0.5 text-xs text-ink-muted hover:border-accent/40 hover:text-accent transition-colors"
                      title={
                        slot.sampleSize > 0
                          ? `avg ${slot.avgEngagements} engagements over ${slot.sampleSize} posts`
                          : 'suggested default'
                      }
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Button
            onClick={submit}
            loading={submitting}
            disabled={!api || selectedAccountIds.length === 0 || !scheduledAt}
            className="w-full"
          >
            <Send size={15} />
            Schedule Post
          </Button>
        </CardContent>
      </Card>

      {/* Queue tools: evergreen recycling + bulk CSV import */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={recycleTop}
            loading={recycling}
            disabled={!api}
          >
            <Recycle size={14} />
            Recycle top posts
          </Button>
          <Button
            variant="outline"
            onClick={() => csvInputRef.current?.click()}
            loading={importing}
            disabled={!api}
          >
            <Upload size={14} />
            Import CSV
          </Button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) =>
              e.target.files?.[0] && void importCsv(e.target.files[0])
            }
          />
          <p className="text-xs text-ink-subtle basis-full">
            Recycle re-queues your highest-engagement posts at upcoming
            best-time slots. CSV columns: <code>datetime, body, hashtags</code>{' '}
            — rows schedule to the accounts selected above.
          </p>
        </CardContent>
      </Card>

      {/* Content calendar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Calendar size={14} className="text-accent" />
              {calendarMonth.toLocaleDateString(undefined, {
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <span className="flex items-center gap-1">
              <button
                onClick={() =>
                  setCalendarMonth(
                    (m) => new Date(m.getFullYear(), m.getMonth() - 1, 1),
                  )
                }
                className="p-1 text-ink-muted hover:text-ink-base transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() =>
                  setCalendarMonth(
                    (m) => new Date(m.getFullYear(), m.getMonth() + 1, 1),
                  )
                }
                className="p-1 text-ink-muted hover:text-ink-base transition-colors"
              >
                <ChevronRight size={14} />
              </button>
              <button
                onClick={() => void loadInsights()}
                className="p-1 text-ink-muted hover:text-ink-base transition-colors"
                title="Refresh"
              >
                <RefreshCw size={13} />
              </button>
            </span>
          </CardTitle>
          <CardDescription>Queued posts across all accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div
                key={i}
                className="text-[10px] text-ink-subtle font-medium pb-1"
              >
                {d}
              </div>
            ))}
            {(() => {
              const first = calendarMonth;
              const daysInMonth = new Date(
                first.getFullYear(),
                first.getMonth() + 1,
                0,
              ).getDate();
              const lead = first.getDay();
              const today = new Date();
              const cells: React.ReactNode[] = [];
              for (let i = 0; i < lead; i++)
                cells.push(<div key={`lead-${i}`} />);
              for (let day = 1; day <= daysInMonth; day++) {
                const dayEntries = calendarEntries.filter((e) => {
                  const d = new Date(e.runAt);
                  return (
                    d.getFullYear() === first.getFullYear() &&
                    d.getMonth() === first.getMonth() &&
                    d.getDate() === day
                  );
                });
                const isToday =
                  today.getFullYear() === first.getFullYear() &&
                  today.getMonth() === first.getMonth() &&
                  today.getDate() === day;
                cells.push(
                  <div
                    key={day}
                    title={dayEntries
                      .map(
                        (e) =>
                          `${new Date(e.runAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${e.platform}: ${e.body || '(no preview)'}`,
                      )
                      .join('\n')}
                    className={`min-h-12 rounded-md border p-1 text-left ${
                      isToday
                        ? 'border-accent/50 bg-accent/5'
                        : 'border-border/50'
                    }`}
                  >
                    <span
                      className={`text-[10px] ${isToday ? 'text-accent font-semibold' : 'text-ink-subtle'}`}
                    >
                      {day}
                    </span>
                    {dayEntries.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-0.5">
                        {dayEntries.slice(0, 3).map((e) => (
                          <span
                            key={e.id}
                            className="block w-1.5 h-1.5 rounded-full bg-accent"
                          />
                        ))}
                        {dayEntries.length > 3 && (
                          <span className="text-[9px] text-ink-muted leading-none">
                            +{dayEntries.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>,
                );
              }
              return cells;
            })()}
          </div>
          {calendarEntries.length === 0 && (
            <p className="text-center text-xs text-ink-subtle mt-3">
              No scheduled posts yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
