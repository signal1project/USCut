export interface EditDecision {
  clipId: string;
  trimStart: number;
  trimEnd: number;
  startTime: number;
  reason: string;
}

export interface AutoEditResult {
  decisions: EditDecision[];
  summary: string;
}

/** Validate before any timeline mutation. AI output is untrusted data. */
export function validateAutoEditResult(
  value: unknown,
  clips: ReadonlyArray<{ id: string; duration: number }>,
): AutoEditResult {
  const invalid = () => {
    throw new Error(
      'The AI returned an invalid edit. Your timeline has not changed. Try again.',
    );
  };
  if (!value || typeof value !== 'object') return invalid();
  const result = value as AutoEditResult;
  if (!Array.isArray(result.decisions) || typeof result.summary !== 'string')
    return invalid();
  const sources = new Map(clips.map((c) => [c.id, c.duration]));
  const seen = new Set<string>();
  for (const d of result.decisions) {
    if (
      !d ||
      typeof d !== 'object' ||
      !sources.has(d.clipId) ||
      seen.has(d.clipId)
    )
      return invalid();
    const duration = sources.get(d.clipId)!;
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      ![d.trimStart, d.trimEnd, d.startTime].every(
        (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0,
      ) ||
      d.trimStart + d.trimEnd >= duration ||
      !Number.isFinite(d.startTime + duration) ||
      typeof d.reason !== 'string'
    )
      return invalid();
    seen.add(d.clipId);
  }
  return {
    summary: result.summary,
    decisions: result.decisions.map(
      ({ clipId, trimStart, trimEnd, startTime, reason }) => ({
        clipId,
        trimStart,
        trimEnd,
        startTime,
        reason,
      }),
    ),
  };
}
