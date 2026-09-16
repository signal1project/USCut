import { useEffect } from 'react';
import { toast } from 'sonner';
import { useLicenseStore, isPremiumUnlocked } from '@/store/licenseStore';

/** Whether AI-production and publish/schedule features are unlocked for the
 * current license — reactive, so gated buttons un-grey the moment a key is
 * activated in Settings without a reload. Triggers the (cached, one-shot)
 * status fetch itself, so any gated page works standalone without depending
 * on Settings having been opened first. */
export function usePremiumUnlocked(): boolean {
  const status = useLicenseStore((s) => s.status);
  const loaded = useLicenseStore((s) => s.loaded);
  const load = useLicenseStore((s) => s.load);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  return isPremiumUnlocked(status);
}

/** True when `err` (a thrown Error, an `{ error }` IPC result, or a thrown
 * `MasApiError`) is this app's LICENSE_REQUIRED signal from a gated
 * main-process handler or MAS API route. */
export function isLicenseRequiredError(err: unknown): boolean {
  if (err instanceof Error) return err.message === 'LICENSE_REQUIRED';
  if (err && typeof err === 'object' && 'error' in err) {
    return (err as { error: unknown }).error === 'LICENSE_REQUIRED';
  }
  return false;
}

/** Consistent toast for a gated action that was blocked — call this from a
 * disabled-button's onClick (defense in depth) or a caught LICENSE_REQUIRED. */
export function notifyLicenseRequired(): void {
  toast.error('This feature needs an active USCut subscription.', {
    description: 'Add your license key in Settings to unlock it.',
  });
}
