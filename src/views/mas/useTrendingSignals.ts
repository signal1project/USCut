import { useCallback, useEffect, useState } from 'react';
import type { TrendSignal, TrendingResponse, MasApiClient } from '@mas/ui';

export interface UseTrendingSignalsResult {
  signals: TrendSignal[];
  cachedUntil: string | null;
  sources: string[];
  loading: boolean;
  error: string | null;
  refresh(): void;
}

/**
 * Fetch trending signals from the embedded research API.
 * Re-fetches when `niche` changes. Expose `refresh()` for manual re-fetch.
 */
export function useTrendingSignals(
  api: MasApiClient | null,
  params?: {
    niche?: string;
    sources?: string[];
    limit?: number;
  },
): UseTrendingSignalsResult {
  const [signals, setSignals] = useState<TrendSignal[]>([]);
  const [cachedUntil, setCachedUntil] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const sourcesKey = (params?.sources ?? []).join(',');

  useEffect(() => {
    if (!api) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getTrending(params)
      .then((result: TrendingResponse) => {
        if (!cancelled) {
          setSignals(result.signals);
          setCachedUntil(result.cachedUntil);
          setSources(result.sources);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load trending signals',
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the individual params fields (not `params` itself) —
    // callers commonly pass a fresh inline object each render, so depending on the
    // whole object would refetch every render instead of only on real value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, params?.niche, sourcesKey, params?.limit, tick]);

  return { signals, cachedUntil, sources, loading, error, refresh };
}
