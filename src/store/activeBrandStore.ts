import { create } from 'zustand';
import { ipc, hasIpc } from '@/lib/ipc';

export interface BrandProfileSummary {
  id: string;
  name: string;
}

interface ActiveBrandState {
  brands: BrandProfileSummary[];
  /** null = "All companies" — no filtering, original single-company behavior. */
  activeBrandId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
}

/**
 * Global "working as" company scope. One store shared across every page so
 * switching companies on Home immediately filters accounts/Pages shown on
 * Publish, Share, and Scheduler, and changes which company's brand voice gets
 * injected into AI-generated content — without each page re-fetching or
 * re-implementing the switch itself.
 */
export const useActiveBrandStore = create<ActiveBrandState>((set) => ({
  brands: [],
  activeBrandId: null,
  loaded: false,

  load: async () => {
    if (!hasIpc()) {
      set({ loaded: true });
      return;
    }
    const [brands, activeBrandId] = await Promise.all([
      ipc.invoke('mas:brands:list') as Promise<BrandProfileSummary[]>,
      ipc.invoke('mas:brands:get-active') as Promise<string | null>,
    ]);
    set({
      brands: brands ?? [],
      activeBrandId: activeBrandId ?? null,
      loaded: true,
    });
  },

  setActive: async (id: string | null) => {
    set({ activeBrandId: id });
    if (hasIpc()) await ipc.invoke('mas:brands:set-active', id);
  },
}));
