import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck } from 'lucide-react';
import { useLicenseStore, isPremiumUnlocked, type LicenseState } from '@/store/licenseStore';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui';

const TONE: Record<LicenseState, string> = {
  active: 'bg-[#22c55e]',
  grace: 'bg-[#e0a93a]',
  expired: 'bg-[#f0556a]',
  invalid: 'bg-[#f0556a]',
  unlicensed: 'bg-[#6b7280]',
};

export function SubscriptionCard() {
  const status = useLicenseStore((s) => s.status);
  const loaded = useLicenseStore((s) => s.loaded);
  const load = useLicenseStore((s) => s.load);
  const activateKey = useLicenseStore((s) => s.activate);
  const deactivateKey = useLicenseStore((s) => s.deactivate);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const activate = async () => {
    setBusy(true);
    try {
      const next = await activateKey(token.trim());
      setToken('');
      toast.success(
        isPremiumUnlocked(next)
          ? 'Subscription activated'
          : `Licence saved (${next.state})`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not activate');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      await deactivateKey();
      toast.success('Licence removed from this device');
    } catch {
      toast.error('Could not remove the licence');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BadgeCheck size={16} className="text-[#4d7cff]" /> Subscription
          {loaded && (
            <Badge className={`${TONE[status.state]} text-white capitalize`}>
              {status.state}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {loaded ? status.detail : 'Checking your USCut subscription…'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.email && (
          <p className="text-xs text-ink-muted">
            {status.email}
            {status.plan ? ` · ${status.plan}` : ''}
            {status.expiresAt
              ? ` · paid through ${status.expiresAt.slice(0, 10)}`
              : ''}
          </p>
        )}
        <textarea
          aria-label="USCut licence key"
          className="w-full rounded border border-border bg-surface-1 p-2 text-xs text-ink-base font-mono"
          rows={3}
          placeholder="Paste your USCut licence key"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !token.trim()} onClick={activate}>
            Activate
          </Button>
          {status.state !== 'unlicensed' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={deactivate}
            >
              Remove from this device
            </Button>
          )}
        </div>
        <p className="text-[11px] text-ink-muted">
          You get your licence key by email after subscribing. It is verified on
          this device and keeps working briefly offline while USCut re-checks
          it.
        </p>
      </CardContent>
    </Card>
  );
}
