import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveFfmpegPath } from '../../../util/ffmpegBinary';
import { transcribeViaOpenAI } from '../transcription';

let dir: string;
let source: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uscut-transcription-test-'));
  source = path.join(dir, 'source.wav');
  execFileSync(
    resolveFfmpegPath(),
    ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.5', '-y', source],
    { stdio: 'ignore', windowsHide: true },
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
describe('cloud transcription with real audio extraction and simulated API', () => {
  it('uploads bounded WAVs and restores segment/word timestamps for each chunk', async () => {
    const fetcher = vi.fn(async (_url, options) => {
      const form = options.body as FormData;
      const file = form.get('file') as File;
      expect(file.size).toBeLessThan(24_000_000);
      expect(
        Buffer.from(await file.arrayBuffer())
          .subarray(0, 4)
          .toString(),
      ).toBe('RIFF');
      expect(form.get('model')).toBe('whisper-1');
      return new Response(
        JSON.stringify({
          segments: [{ start: 0.1, end: 0.4, text: 'Hello' }],
          words: [{ start: 0.1, end: 0.4, word: 'Hello' }],
        }),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const progress = vi.fn();
    const result = await transcribeViaOpenAI(source, 'test-key', {
      chunkSeconds: 1,
      onProgress: progress,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.map((s) => s.start)).toEqual([0.1, 1.1, 2.1]);
    expect(result[2].words?.[0].start).toBe(2.1);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
    expect((fetcher.mock.calls[1][1].body as FormData).get('prompt')).toBe(
      'Hello',
    );
  });
  it('stops remaining uploads when cancelled between chunks', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ segments: [] })),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      transcribeViaOpenAI(source, 'test-key', {
        chunkSeconds: 1,
        signal: controller.signal,
        onProgress: (completed) => {
          if (completed === 1) controller.abort();
        },
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('reports API errors without starting more uploads', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      transcribeViaOpenAI(source, 'test-key', { chunkSeconds: 1 }),
    ).rejects.toThrow('whisper_failed_401');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
