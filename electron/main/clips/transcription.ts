import fs from 'node:fs';
import path from 'node:path';

export interface TranscriptSegment {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
}

function timeToSeconds(t: string): number {
  const m = t.trim().match(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return NaN;
  return (
    Number(m[1]) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    Number(m[4].padEnd(3, '0')) / 1000
  );
}

/** Parse SRT or WebVTT into transcript segments. Exported for tests. */
export function parseSrtOrVtt(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = raw.replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .filter((l) => l.trim() !== '' && l.trim() !== 'WEBVTT');
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;
    const [startRaw, endRaw] = lines[timeLineIdx].split('-->');
    const start = timeToSeconds(startRaw);
    const end = timeToSeconds(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const text = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .trim();
    if (text) segments.push({ start, end, text });
  }
  return segments;
}

export function toSrt(
  segments: TranscriptSegment[],
  offsetSeconds = 0,
): string {
  const fmt = (s: number): string => {
    const t = Math.max(0, s - offsetSeconds);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = Math.floor(t % 60);
    const ms = Math.round((t % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${seg.text}\n`,
    )
    .join('\n');
}

/**
 * Transcribe an audio/video file with the OpenAI Whisper API
 * (verbose_json gives segment timestamps). ~25MB upload limit applies;
 * larger files should be pre-extracted to audio by the caller.
 */
export async function transcribeViaOpenAI(
  filePath: string,
  apiKey: string,
): Promise<TranscriptSegment[]> {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(filePath));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`whisper_failed_${res.status}`);
  const data = (await res.json()) as {
    segments?: Array<{ start: number; end: number; text: string }>;
    text?: string;
    duration?: number;
  };
  if (data.segments?.length) {
    return data.segments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));
  }
  if (data.text)
    return [{ start: 0, end: data.duration ?? 60, text: data.text.trim() }];
  return [];
}
