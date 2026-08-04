import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Zap } from 'lucide-react';
import { PlatformBadge, StatusTag, type EngagementItem } from '@mas/ui';
import { useMasApi } from './useMasApi';
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Textarea,
  Badge,
} from '@/components/ui';

/** Human-in-the-loop queue: review AI-drafted replies, edit, approve, or dismiss. */
export default function EngagementPage(): React.ReactElement {
  const api = useMasApi();
  const [items, setItems] = useState<EngagementItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const { items: pending } = await api.listPendingEngagement();
      setItems(pending);
      setDrafts(Object.fromEntries(pending.map((i) => [i.id, i.draftReply])));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load queue');
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const approve = async (item: EngagementItem) => {
    if (!api) return;
    setBusy(item.id);
    try {
      await api.approveEngagement(item.id, drafts[item.id]);
      toast.success('Reply posted');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (item: EngagementItem) => {
    if (!api) return;
    setBusy(item.id);
    try {
      await api.dismissEngagement(item.id);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-strong">Inbox</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Comments with AI-drafted replies — edit, approve, or dismiss.
            Platform DMs land here once the platform OAuth apps grant messaging
            scopes.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} disabled={!api}>
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-center text-ink-muted py-12 text-sm">
          No pending comments
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center flex-wrap gap-2">
                  <PlatformBadge platform={item.platform} />
                  <span className="text-sm font-medium text-ink-base">
                    @{item.authorHandle}
                  </span>
                  <StatusTag status={item.status} />
                  {item.highConversion && (
                    <Badge variant="warning">
                      <Zap size={10} className="mr-0.5" />
                      High conversion
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-ink-muted italic">
                  &ldquo;{item.commentText}&rdquo;
                </p>

                <Textarea
                  rows={2}
                  value={drafts[item.id] ?? ''}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [item.id]: e.target.value }))
                  }
                  placeholder="AI-drafted reply…"
                />

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={busy === item.id}
                    onClick={() => approve(item)}
                  >
                    Approve &amp; reply
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === item.id}
                    onClick={() => dismiss(item)}
                  >
                    Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
