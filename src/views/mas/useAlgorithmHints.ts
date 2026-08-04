import { useEffect, useState } from 'react';
import type { Platform } from '@mas/types';
import type { AlgorithmHints, MasApiClient } from '@mas/ui';

export interface UseAlgorithmHintsResult {
  hints: AlgorithmHints[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetch algorithm playbook hints for the given platforms from the embedded API.
 * Re-fetches whenever `platforms` changes.
 */
export function useAlgorithmHints(
  api: MasApiClient | null,
  platforms: Platform[],
): UseAlgorithmHintsResult {
  const [hints, setHints] = useState<AlgorithmHints[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platformKey = platforms.slice().sort().join(',');

  useEffect(() => {
    if (!api || platforms.length === 0) {
      setHints([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getAlgorithmHints(platforms)
      .then((result) => {
        if (!cancelled) {
          setHints(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load algorithm hints',
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, platformKey]);

  return { hints, loading, error };
}
