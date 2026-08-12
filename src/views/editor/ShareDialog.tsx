import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Send,
  Loader2,
  Globe,
  MonitorPlay,
  Building2,
  Users,
  CalendarClock,
} from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { ipc } from '@/lib/ipc';
import { useMasApi } from '@/views/mas/useMasApi';
import { useActiveBrandStore } from '@/store/activeBrandStore';
import type { ConnectedAccountSummary } from '@mas/ui';

// Facebook/Instagram/Threads share one login (posts as *you*) — Pages are
// the company-scoped mechanism for Meta, so those three platform toggles
// stay unfiltered by company. Everything else has a per-platform company
// assignment in Connect Accounts.
const META_GROUP = ['facebook', 'instagram', 'threads'];

const WEBVIEW_LABELS: Record<string, string> = {
  twitter: 'X / Twitter',
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  pinterest: 'Pinterest',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

const ASPECTS = ['16:9', '9:16', '1:1', '4:5'] as const;

interface Props {
  onClose: () => void;
}

/** Export the timeline and push it out — webview sessions and/or API accounts. */
const ShareDialog: React.FC<Props> = ({ onClose }) => {
  const masApi = useMasApi();
  const {
    activeBrandId,
    brands: activeBrands,
    loaded: brandsLoaded,
    load: loadActiveBrand,
  } = useActiveBrandStore();
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>('9:16');
  const [webviewSessions, setWebviewSessions] = useState<
    Record<string, boolean>
  >({});
  const [platformBrands, setPlatformBrands] = useState<Record<string, string>>(
    {},
  );
  const [accountsRaw, setAccountsRaw] = useState<ConnectedAccountSummary[]>([]);
  const [pagesRaw, setPagesRaw] = useState<ConnectedAccountSummary[]>([]);
  const [instagramRaw, setInstagramRaw] = useState<ConnectedAccountSummary[]>(
    [],
  );
  const [selWebview, setSelWebview] = useState<Set<string>>(new Set());
  const [selAccounts, setSelAccounts] = useState<Set<string>>(new Set());
  const [selPages, setSelPages] = useState<Set<string>>(new Set());
  const [selInstagram, setSelInstagram] = useState<Set<string>>(new Set());
  const [scheduleAt, setScheduleAt] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    void ipc
      .invoke('mas:social:session-status-all')
      .then((r) => setWebviewSessions((r as Record<string, boolean>) ?? {}))
      .catch(() => {});
    void ipc
      .invoke('mas:accounts:list')
      .then((r) => {
        const list = (r as ConnectedAccountSummary[]) ?? [];
        // Webview-detected Facebook Pages have no OAuth token — they can't
        // go through the API publish path, but they DO post via the same
        // webview composer as the platform toggles below, targeted at the
        // Page's own timeline (mas:social:post-webview + pageId).
        setAccountsRaw(list.filter((a) => a.source !== 'webview'));
        setPagesRaw(
          list.filter(
            (a) => a.platform === 'facebook' && a.source === 'webview',
          ),
        );
        setInstagramRaw(
          list.filter(
            (a) => a.platform === 'instagram' && a.source === 'webview',
          ),
        );
      })
      .catch(() => {});
    void ipc
      .invoke('mas:brands:platform-assignments')
      .then((r) => setPlatformBrands((r as Record<string, string>) ?? {}))
      .catch(() => {});
    if (!brandsLoaded) void loadActiveBrand();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scope to the active company (Home's switcher) when one is set — Pages
  // and API accounts unassigned to it stay hidden, same rule as Publish.
  const accounts = useMemo(
    () =>
      activeBrandId
        ? accountsRaw.filter((a) => a.brandId === activeBrandId)
        : accountsRaw,
    [accountsRaw, activeBrandId],
  );
  const pages = useMemo(
    () =>
      activeBrandId
        ? pagesRaw.filter((a) => a.brandId === activeBrandId)
        : pagesRaw,
    [pagesRaw, activeBrandId],
  );
  const instagramAccounts = useMemo(
    () =>
      activeBrandId
        ? instagramRaw.filter((a) => a.brandId === activeBrandId)
        : instagramRaw,
    [instagramRaw, activeBrandId],
  );

  const connectedWebview = useMemo(
    () =>
      Object.entries(webviewSessions)
        .filter(([, ok]) => ok)
        .map(([p]) => p)
        .filter(
          (p) =>
            !activeBrandId ||
            META_GROUP.includes(p) ||
            platformBrands[p] === activeBrandId,
        ),
    [webviewSessions, activeBrandId, platformBrands],
  );

  const toggle = (
    set: Set<string>,
    id: string,
    update: (s: Set<string>) => void,
  ) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const appendLog = (line: string) => setLog((l) => [...l, line]);

  const handleShare = async () => {
    const state = useEditorStore.getState();
    let videoTrackCounter = 0;
    const clips = state.tracks.flatMap((t) => {
      const trackIndex = t.type === 'video' ? videoTrackCounter++ : 0;
      return t.clips.map((c) => ({ ...c, trackIndex, trackMuted: !!t.muted }));
    });
    if (clips.length === 0) {
      appendLog('Timeline is empty — nothing to share.');
      return;
    }
    if (
      selWebview.size === 0 &&
      selAccounts.size === 0 &&
      selPages.size === 0 &&
      selInstagram.size === 0
    ) {
      appendLog('Pick at least one destination.');
      return;
    }

    setLog([]);
    setBusy('Exporting video…');
    const exported = (await ipc.invoke('aicuts:export-for-share', clips, {
      resolution: '1080p',
      aspect,
      format: 'mp4',
      fps: 30,
    })) as
      | { success?: boolean; outputPath?: string; error?: string }
      | undefined;

    if (!exported?.success || !exported.outputPath) {
      setBusy(null);
      appendLog(`Export failed: ${exported?.error ?? 'unknown error'}`);
      return;
    }
    appendLog(`✓ Exported ${aspect} video`);

    const fullText = [caption.trim(), hashtags.trim()]
      .filter(Boolean)
      .join('\n\n');

    // API accounts — publish or schedule through the engine.
    if (selAccounts.size > 0 && masApi) {
      try {
        setBusy(
          scheduleAt
            ? 'Scheduling via connected accounts…'
            : 'Publishing via connected accounts…',
        );
        const result = await masApi.publish({
          accountIds: [...selAccounts],
          pubType: 'video' as never,
          body: caption.trim(),
          hashtags: hashtags.split(/\s+/).filter(Boolean),
          mediaRefs: [exported.outputPath],
          ...(scheduleAt
            ? { runAt: new Date(scheduleAt).toISOString() as never }
            : {}),
        });
        if ('scheduled' in result && result.scheduled) {
          appendLog(`✓ Scheduled for ${new Date(scheduleAt).toLocaleString()}`);
        } else if ('results' in result) {
          for (const r of result.results) {
            appendLog(
              r.status === 'published'
                ? `✓ Published via account ${r.accountId.slice(0, 8)}`
                : `✗ Account ${r.accountId.slice(0, 8)}: ${r.error ?? r.status}`,
            );
          }
        }
      } catch (err) {
        appendLog(
          `✗ API publish: ${err instanceof Error ? err.message : 'failed'}`,
        );
      }
    }

    // Facebook Pages — posts as the Page's own timeline, same Meta login.
    for (const pageId of selPages) {
      const page = pages.find((a) => a.id === pageId);
      if (!page) continue;
      setBusy(`Posting to ${page.accountName}…`);
      try {
        const r = (await ipc.invoke('mas:social:post-webview', {
          platform: 'facebook',
          body: fullText,
          mediaPath: exported.outputPath,
          pageId: page.externalId,
        })) as
          | { posted?: boolean; attached?: boolean; manual?: boolean }
          | undefined;
        if (r?.posted) appendLog(`✓ Posted to ${page.accountName}`);
        else if (r?.manual)
          appendLog(
            `◐ ${page.accountName}: ${r.attached ? 'video attached, ' : ''}finished in the window (caption is on your clipboard)`,
          );
      } catch (err) {
        appendLog(
          `✗ ${page.accountName}: ${err instanceof Error ? err.message : 'failed'}`,
        );
      }
    }

    // Instagram accounts — switches the session's active account to this one
    // before posting, so a single Instagram login can post as any linked
    // account (see webviewBridge.ts's post-webview handler + detectInstagramAccounts).
    for (const accountId of selInstagram) {
      const account = instagramAccounts.find((a) => a.id === accountId);
      if (!account) continue;
      setBusy(`Switching to @${account.accountName}…`);
      try {
        const r = (await ipc.invoke('mas:social:post-webview', {
          platform: 'instagram',
          body: fullText,
          mediaPath: exported.outputPath,
          accountId: account.externalId,
        })) as
          | { posted?: boolean; attached?: boolean; manual?: boolean }
          | undefined;
        if (r?.posted) appendLog(`✓ Posted to @${account.accountName}`);
        else if (r?.manual)
          appendLog(
            `◐ @${account.accountName}: ${r.attached ? 'video attached, ' : ''}finished in the window (caption is on your clipboard)`,
          );
      } catch (err) {
        appendLog(
          `✗ @${account.accountName}: ${err instanceof Error ? err.message : 'failed'}`,
        );
      }
    }

    // Webview sessions — sequential so windows don't stack.
    for (const platform of selWebview) {
      setBusy(`Posting to ${WEBVIEW_LABELS[platform] ?? platform}…`);
      try {
        const r = (await ipc.invoke('mas:social:post-webview', {
          platform,
          body: fullText,
          mediaPath: exported.outputPath,
        })) as
          | { posted?: boolean; attached?: boolean; manual?: boolean }
          | undefined;
        if (r?.posted) appendLog(`✓ Posted to ${WEBVIEW_LABELS[platform]}`);
        else if (r?.manual)
          appendLog(
            `◐ ${WEBVIEW_LABELS[platform]}: ${r.attached ? 'video attached, ' : ''}finished in the window (caption is on your clipboard)`,
          );
      } catch (err) {
        appendLog(
          `✗ ${WEBVIEW_LABELS[platform]}: ${err instanceof Error ? err.message : 'failed'}`,
        );
      }
    }

    setBusy(null);
    appendLog('Done.');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-[520px] max-h-[85vh] overflow-y-auto rounded-2xl bg-[#16161a] border border-[#26262d] shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-strong">
            <Send size={15} className="text-[#22c55e]" /> Share to social
          </h2>
          <button
            onClick={onClose}
            className="text-[#71717f] hover:text-ink-base"
          >
            <X size={16} />
          </button>
        </div>

        {activeBrandId && (
          <p className="text-[10px] text-[#7ba0ff] bg-[#151927] border border-[#2a3560] rounded-md px-2.5 py-1.5 mb-3">
            Showing accounts for{' '}
            {activeBrands.find((b) => b.id === activeBrandId)?.name ??
              'the active company'}{' '}
            — switch companies from Home.
          </p>
        )}

        {/* Caption */}
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write your caption…"
          className="w-full bg-[#0c0c0f] text-xs text-ink-base rounded-lg p-2.5 h-20 resize-none border border-[#303039] focus:outline-none focus:border-[#4d7cff] placeholder:text-[#4a4a55]"
        />
        <input
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          placeholder="#hashtags #space #separated"
          className="mt-2 w-full bg-[#0c0c0f] text-xs text-ink-base rounded-lg px-2.5 py-2 border border-[#303039] focus:outline-none focus:border-[#4d7cff] placeholder:text-[#4a4a55]"
        />

        {/* Aspect */}
        <p className="text-[10px] text-[#71717f] uppercase tracking-wider mt-4 mb-1.5">
          Format
        </p>
        <div className="flex gap-1.5">
          {ASPECTS.map((a) => (
            <button
              key={a}
              onClick={() => setAspect(a)}
              className={`text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors ${
                aspect === a
                  ? 'bg-[#4d7cff] text-white'
                  : 'bg-[#26262d] text-[#9a9aa6] hover:bg-[#303039]'
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        {/* Webview destinations */}
        <p className="flex items-center gap-1.5 text-[10px] text-[#71717f] uppercase tracking-wider mt-4 mb-1.5">
          <MonitorPlay size={11} /> Signed-in platforms (posts via the site)
        </p>
        {connectedWebview.length === 0 ? (
          <p className="text-[11px] text-[#5a5a66]">
            None signed in — use the Accounts button in the editor to sign in to
            platforms.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {connectedWebview.map((p) => (
              <button
                key={p}
                onClick={() => toggle(selWebview, p, setSelWebview)}
                className={`text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors ${
                  selWebview.has(p)
                    ? 'bg-[#12352a] text-[#22c55e] ring-1 ring-[#22c55e]/50'
                    : 'bg-[#26262d] text-[#9a9aa6] hover:bg-[#303039]'
                }`}
              >
                {WEBVIEW_LABELS[p] ?? p}
              </button>
            ))}
          </div>
        )}

        {/* Facebook Pages — posts as the Page, same Meta login */}
        {pages.length > 0 && (
          <>
            <p className="flex items-center gap-1.5 text-[10px] text-[#71717f] uppercase tracking-wider mt-4 mb-1.5">
              <Building2 size={11} /> Facebook Pages (posts as the Page)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {pages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => toggle(selPages, page.id, setSelPages)}
                  className={`text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors ${
                    selPages.has(page.id)
                      ? 'bg-[#151927] text-[#7ba0ff] ring-1 ring-[#4d7cff]/50'
                      : 'bg-[#26262d] text-[#9a9aa6] hover:bg-[#303039]'
                  }`}
                >
                  {page.accountName}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Instagram accounts — switches the session's active account first */}
        {instagramAccounts.length > 0 && (
          <>
            <p className="flex items-center gap-1.5 text-[10px] text-[#71717f] uppercase tracking-wider mt-4 mb-1.5">
              <Users size={11} /> Instagram accounts (switches account first)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {instagramAccounts.map((account) => (
                <button
                  key={account.id}
                  onClick={() =>
                    toggle(selInstagram, account.id, setSelInstagram)
                  }
                  className={`text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors ${
                    selInstagram.has(account.id)
                      ? 'bg-[#2a1d40] text-[#c78aff] ring-1 ring-[#c78aff]/50'
                      : 'bg-[#26262d] text-[#9a9aa6] hover:bg-[#303039]'
                  }`}
                >
                  @{account.accountName}
                </button>
              ))}
            </div>
          </>
        )}

        {/* API accounts */}
        <p className="flex items-center gap-1.5 text-[10px] text-[#71717f] uppercase tracking-wider mt-4 mb-1.5">
          <Globe size={11} /> API accounts (developer-app connections)
        </p>
        {accounts.length === 0 ? (
          <p className="text-[11px] text-[#5a5a66]">
            No API accounts connected.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => toggle(selAccounts, a.id, setSelAccounts)}
                className={`text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors ${
                  selAccounts.has(a.id)
                    ? 'bg-[#1d2540] text-[#7ba0ff] ring-1 ring-[#4d7cff]/50'
                    : 'bg-[#26262d] text-[#9a9aa6] hover:bg-[#303039]'
                }`}
              >
                {a.platform}: {a.accountName}
              </button>
            ))}
          </div>
        )}

        {/* Schedule (API accounts only) */}
        {selAccounts.size > 0 && (
          <div className="mt-4">
            <p className="flex items-center gap-1.5 text-[10px] text-[#71717f] uppercase tracking-wider mb-1.5">
              <CalendarClock size={11} /> Schedule (optional — API accounts
              only)
            </p>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="w-full bg-[#0c0c0f] text-xs text-ink-base rounded-lg px-2.5 py-2 border border-[#303039] focus:outline-none focus:border-[#4d7cff]"
            />
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div className="mt-4 rounded-lg bg-[#0c0c0f] border border-[#26262d] p-2.5 space-y-1">
            {log.map((line, i) => (
              <p key={i} className="text-[10px] text-[#a1a1ab] font-mono">
                {line}
              </p>
            ))}
          </div>
        )}

        <button
          onClick={() => void handleShare()}
          disabled={!!busy}
          className="mt-4 w-full flex items-center justify-center gap-2 bg-[#22c55e] hover:bg-[#1faa52] disabled:opacity-60 text-[#06210f] text-xs font-semibold rounded-lg py-2.5 transition-colors"
        >
          {busy ? (
            <>
              <Loader2 size={13} className="animate-spin" /> {busy}
            </>
          ) : (
            <>
              <Send size={13} /> Export & Share
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default ShareDialog;
