import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui';

interface LicenseStatus {
  state: 'unlicensed' | 'active' | 'grace' | 'expired' | 'invalid';
  plan: string | null;
  email: string | null;
  expiresAt: string | null;
  graceUntil: string | null;
  detail: string;
}

const TONE: Record<LicenseStatus['state'], string> = {
  active: 'bg-[#22c55e]',
  grace: 'bg-[#e0a93a]',
  expired: 'bg-[#f0556a]',
  invalid: 'bg-[#f0556a]',
  unlicensed: 'bg-[#6b7280]',
};

export function SubscriptionCard() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    ipc
      .invoke('license:status')
      .then((s) => setStatus(s as LicenseStatus))
      .catch(() => setStatus(null));
  }, []);
  useEffect(refresh, [refresh]);

  const activate = async () => {
    setBusy(true);
    try {
      const next = (await ipc.invoke(
        'license:activate',
        token.trim(),
      )) as LicenseStatus;
      setStatus(next);
      setToken('');
      toast.success(
        next.state === 'active' || next.state === 'grace'
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
      setStatus((await ipc.invoke('license:deactivate')) as LicenseStatus);
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
          {status && (
            <Badge className={`${TONE[status.state]} text-white capitalize`}>
              {status.state}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {status?.detail ?? 'Checking your USCut subscription…'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status && status.email && (
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
          {status && status.state !== 'unlicensed' && (
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
