import type { AIProvider, Platform } from '@mas/types';
import type { TimelineClip } from './ffmpegOps';
import type { TranscriptSegment } from '../clips/transcription';
import {
  PLATFORM_PLAYBOOKS,
  playbookToPromptHint,
} from '../algorithm/platformPlaybooks';

export interface AutoEditInput {
  clips: Array<{
    id: string;
    name: string;
    duration: number;
    src: string;
  }>;
  prompt: string;
  targetDuration?: number;
  /** What's actually said in each clip (Whisper), keyed by clip id. Optional —
   * grounds edit decisions in real content instead of just names/durations. */
  transcripts?: Record<string, TranscriptSegment[]>;
  /** Detected/explicit target platform — pulls in that platform's reach/algorithm
   * playbook (best formats, hook advice, reward signals) as editing guidance. */
  platform?: Platform;
  /** Current trending topics/keywords, most relevant first. Optional. */
  trending?: string[];
}

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

const SYSTEM = `You are USCut's AI editor, optimizing for organic reach — not just fitting a
duration. You receive video clips (with transcripts when available), a user instruction, and
platform algorithm + trending-topic context. Your job is to find and keep the strongest,
most scroll-stopping moments — the hook, the payoff, the concrete/specific line — and cut
everything that doesn't earn its place, not to mechanically shrink the video to some default
short-form length.

If a transcript is provided, use it: identify the single best hook line (specific, surprising,
or emotionally sharp — generic warmup/rambling should be trimmed even if it comes first) and
open on it. Favor moments that match the platform's reward signals and hook advice below.
Reference trending topics only if the content genuinely connects — never force an unrelated
trend in.

Return a JSON object with:
- decisions: array of edit decisions, each with clipId, trimStart (seconds), trimEnd (seconds), startTime (position on timeline), and reason (why THIS moment earns its place)
- summary: 1-2 sentences — what you kept, why it's the strongest hook, and what you cut

Rules:
- trimStart and trimEnd must be >= 0 and their sum < clip duration
- startTime positions clips sequentially on the timeline (no gaps unless intentional)
- If the user wants a target duration, trim to fit — but the cut must be the strongest
  moment, not just "the first N seconds"
- You may exclude clips by not including them in decisions
- Without a transcript, say so in summary and make best-effort decisions from clip names/instruction
- Respond ONLY with valid JSON, no markdown fences`;

/** Best-effort platform guess from free-text instructions like "make this a facebook reel". */
export function detectPlatform(prompt: string): Platform | undefined {
  const p = prompt.toLowerCase();
  const hits: Array<[RegExp, Platform]> = [
    [/\btiktok\b/, 'tiktok'],
    [/\b(instagram|insta|ig)\b/, 'instagram'],
    [/\bfacebook\b/, 'facebook'],
    [/\b(youtube|shorts)\b/, 'youtube'],
    [/\b(linkedin)\b/, 'linkedin'],
    [/\b(twitter|tweet|\bx\b)\b/, 'twitter'],
    [/\bpinterest\b/, 'pinterest'],
    [/\bthreads\b/, 'threads'],
  ];
  for (const [re, platform] of hits) if (re.test(p)) return platform;
  return undefined;
}

export async function autoEdit(
  input: AutoEditInput,
  provider: AIProvider,
): Promise<AutoEditResult> {
  const clipsInfo = input.clips.map((c) => ({
    id: c.id,
    name: c.name,
    durationSeconds: Math.round(c.duration * 10) / 10,
  }));

  const platform = input.platform ?? detectPlatform(input.prompt);

  const transcriptBlock = input.transcripts
    ? Object.entries(input.transcripts)
        .map(([clipId, segs]) => {
          if (segs.length === 0) return `Clip ${clipId}: (no speech detected)`;
          const lines = segs
            .map(
              (s) => `  [${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`,
            )
            .join('\n');
          return `Clip ${clipId} transcript:\n${lines}`;
        })
        .join('\n\n')
    : null;

  const userMessage = [
    `Clips: ${JSON.stringify(clipsInfo)}`,
    `Instruction: ${input.prompt}`,
    input.targetDuration
      ? `Target duration: ${input.targetDuration} seconds`
      : '',
    platform ? playbookToPromptHint(PLATFORM_PLAYBOOKS[platform]) : '',
    input.trending?.length
      ? `Currently trending topics (use only if genuinely relevant): ${input.trending.slice(0, 10).join(', ')}`
      : '',
    transcriptBlock
      ? `\n${transcriptBlock}`
      : 'No transcript available — edit from clip names/instruction only, and say so in summary.',
  ]
    .filter(Boolean)
    .join('\n');

  const text = await provider.generateText(`${SYSTEM}\n\n${userMessage}`, {
    maxTokens: 1536,
  });

  try {
    return JSON.parse(text) as AutoEditResult;
  } catch {
    // Fallback: use all clips in order with no trimming
    let cursor = 0;
    const decisions: EditDecision[] = input.clips.map((c) => {
      const d: EditDecision = {
        clipId: c.id,
        trimStart: 0,
        trimEnd: 0,
        startTime: cursor,
        reason: 'Fallback: placed in original order',
      };
      cursor += c.duration;
      return d;
    });
    return {
      decisions,
      summary: 'Auto-edit fallback: clips placed in original order.',
    };
  }
}

export async function generateCaptionsFromTranscript(
  transcript: string,
  clips: TimelineClip[],
  provider: AIProvider,
): Promise<Array<{ startTime: number; endTime: number; text: string }>> {
  const system = `You are a caption generator. Given a transcript and video clip timeline, return a JSON array of caption segments.
Each segment: { startTime: number, endTime: number, text: string }
Times are in seconds. Keep each segment under 10 words. Respond ONLY with valid JSON array.`;
  const userMessage = `Transcript: ${transcript}\n\nTotal duration: ${clips.reduce((max, c) => Math.max(max, c.startTime + c.duration - c.trimStart - c.trimEnd), 0).toFixed(1)}s`;

  const text = await provider.generateText(`${system}\n\n${userMessage}`, {
    maxTokens: 2048,
  });
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}
