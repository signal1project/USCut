import Anthropic from '@anthropic-ai/sdk';
import type { TimelineClip } from './ffmpegOps';

const client = new Anthropic();

export interface AutoEditInput {
  clips: Array<{
    id: string;
    name: string;
    duration: number;
    src: string;
  }>;
  prompt: string;
  targetDuration?: number;
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

const SYSTEM = `You are AICut's AI editor. You receive a list of video clips and a user instruction.
Return a JSON object with:
- decisions: array of edit decisions, each with clipId, trimStart (seconds), trimEnd (seconds), startTime (position on timeline), and reason
- summary: one sentence describing what you did

Rules:
- trimStart and trimEnd must be >= 0 and their sum < clip duration
- startTime positions clips sequentially on the timeline (no gaps unless intentional)
- If the user wants a target duration, trim clips to fit
- You may exclude clips by not including them in decisions
- Respond ONLY with valid JSON, no markdown fences`;

export async function autoEdit(input: AutoEditInput): Promise<AutoEditResult> {
  const clipsInfo = input.clips.map((c) => ({
    id: c.id,
    name: c.name,
    durationSeconds: Math.round(c.duration * 10) / 10,
  }));

  const userMessage = [
    `Clips: ${JSON.stringify(clipsInfo)}`,
    `Instruction: ${input.prompt}`,
    input.targetDuration
      ? `Target duration: ${input.targetDuration} seconds`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '{}';

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
): Promise<Array<{ startTime: number; endTime: number; text: string }>> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: `You are a caption generator. Given a transcript and video clip timeline, return a JSON array of caption segments.
Each segment: { startTime: number, endTime: number, text: string }
Times are in seconds. Keep each segment under 10 words. Respond ONLY with valid JSON array.`,
    messages: [
      {
        role: 'user',
        content: `Transcript: ${transcript}\n\nTotal duration: ${clips.reduce((max, c) => Math.max(max, c.startTime + c.duration - c.trimStart - c.trimEnd), 0).toFixed(1)}s`,
      },
    ],
  });

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '[]';
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}
