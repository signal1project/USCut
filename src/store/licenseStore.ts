import { create } from 'zustand';
import { ipc, hasIpc } from '@/lib/ipc';

export type LicenseState =
  | 'unlicensed'
  | 'active'
  | 'grace'
  | 'expired'
  | 'invalid';

export interface LicenseStatus {
  state: LicenseState;
  plan: string | null;
  email: string | null;
  expiresAt: string | null;
  graceUntil: string | null;
  detail: string;
}

const UNLICENSED: LicenseStatus = {
  state: 'unlicensed',
  plan: null,
  email: null,
  expiresAt: null,
  graceUntil: null,
  detail: 'No subscription connected.',
};

export function isPremiumUnlocked(status: LicenseStatus): boolean {
  return status.state === 'active' || status.state === 'grace';
}

interface LicenseStoreState {
  status: LicenseStatus;
  loaded: boolean;
  load: () => Promise<void>;
  activate: (token: string) => Promise<LicenseStatus>;
  deactivate: () => Promise<void>;
}

/**
 * Global license/subscription status — one source of truth shared by the
 * Settings subscription card and every AI/publish feature that gates on it,
 * so activating a key unlocks gated buttons everywhere without a reload.
 */
export const useLicenseStore = create<LicenseStoreState>((set) => ({
  status: UNLICENSED,
  loaded: false,

  load: async () => {
    if (!hasIpc()) {
      set({ loaded: true });
      return;
    }
    const status = (await ipc.invoke('license:status')) as
      | LicenseStatus
      | undefined;
    set({ status: status ?? UNLICENSED, loaded: true });
  },

  activate: async (token: string) => {
    const status = (await ipc.invoke(
      'license:activate',
      token,
    )) as LicenseStatus;
    set({ status, loaded: true });
    return status;
  },

  deactivate: async () => {
    const status = (await ipc.invoke('license:deactivate')) as LicenseStatus;
    set({ status, loaded: true });
  },
}));
