import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  uploadTwitterVideo,
  uploadFacebookVideo,
  uploadInstagramReel,
  uploadPinterestVideo,
} from '../videoUpload';
import { isLocalMediaPath } from '../util';

let videoFile: string;

beforeAll(() => {
  videoFile = path.join(os.tmpdir(), `vu-test-${Date.now()}.mp4`);
  fs.writeFileSync(videoFile, Buffer.alloc(1024, 7)); // 1KB fake video
});
afterAll(() => fs.rmSync(videoFile, { force: true }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('isLocalMediaPath', () => {
  it('detects local paths vs URLs', () => {
    expect(isLocalMediaPath('C:\\Users\\Dale\\video.mp4')).toBe(true);
    expect(isLocalMediaPath('/home/user/video.mp4')).toBe(true);
    expect(isLocalMediaPath('https://cdn.example.com/v.mp4')).toBe(false);
    expect(isLocalMediaPath('http://x/v.mp4')).toBe(false);
  });
});

describe('uploadTwitterVideo', () => {
  it('runs INIT → APPEND → FINALIZE and returns the media id', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('command=INIT'))
        return jsonResponse({ data: { id: 'm123' } });
      if (u.includes('command=APPEND'))
        return new Response(null, { status: 204 });
      if (u.includes('command=FINALIZE'))
        return jsonResponse({
          data: { processing_info: { state: 'succeeded' } },
        });
      return jsonResponse({});
    }) as unknown as typeof fetch;

    const id = await uploadTwitterVideo('tok', videoFile, fetcher);
    expect(id).toBe('m123');
    expect(calls[0]).toContain('command=INIT');
    expect(calls[0]).toContain('total_bytes=1024');
    expect(calls[1]).toContain('command=APPEND');
    expect(calls[1]).toContain('media_id=m123');
    expect(calls[2]).toContain('command=FINALIZE');
  });

  it('polls STATUS until processing succeeds', async () => {
    let statusCalls = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('command=INIT'))
        return jsonResponse({ data: { id: 'm9' } });
      if (u.includes('command=APPEND'))
        return new Response(null, { status: 204 });
      if (u.includes('command=FINALIZE'))
        return jsonResponse({
          data: {
            processing_info: { state: 'in_progress', check_after_secs: 0 },
          },
        });
      if (u.includes('command=STATUS')) {
        statusCalls++;
        return jsonResponse({
          data: {
            processing_info: {
              state: statusCalls >= 2 ? 'succeeded' : 'in_progress',
              check_after_secs: 0,
            },
          },
        });
      }
      return jsonResponse({});
    }) as unknown as typeof fetch;

    const id = await uploadTwitterVideo('tok', videoFile, fetcher);
    expect(id).toBe('m9');
    expect(statusCalls).toBe(2);
  }, 15_000);
});

describe('uploadFacebookVideo', () => {
  it('posts multipart to graph-video and returns the id', async () => {
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toContain('graph-video.facebook.com');
        expect(String(url)).toContain('/page42/videos');
        expect(init?.body).toBeInstanceOf(FormData);
        return jsonResponse({ id: 'fbvid1' });
      },
    ) as unknown as typeof fetch;

    const id = await uploadFacebookVideo(
      'ptok',
      'page42',
      videoFile,
      'hello',
      fetcher,
    );
    expect(id).toBe('fbvid1');
  });
});

describe('uploadInstagramReel', () => {
  it('creates container, uploads bytes, polls, publishes', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/media?media_type=REELS'))
        return jsonResponse({ id: 'c1' });
      if (u.includes('rupload')) return jsonResponse({ success: true });
      if (u.includes('fields=status_code'))
        return jsonResponse({ status_code: 'FINISHED' });
      if (u.includes('media_publish')) return jsonResponse({ id: 'ig99' });
      return jsonResponse({});
    }) as unknown as typeof fetch;

    const id = await uploadInstagramReel(
      'tok',
      'iguser',
      videoFile,
      'cap',
      fetcher,
    );
    expect(id).toBe('ig99');
    expect(calls.some((c) => c.includes('upload_type=resumable'))).toBe(true);
    expect(calls.some((c) => c.includes('rupload'))).toBe(true);
    expect(calls[calls.length - 1]).toContain('media_publish');
  });

  it('throws when processing errors', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/media?media_type=REELS'))
        return jsonResponse({ id: 'c1' });
      if (u.includes('rupload')) return jsonResponse({ success: true });
      if (u.includes('fields=status_code'))
        return jsonResponse({ status_code: 'ERROR' });
      return jsonResponse({});
    }) as unknown as typeof fetch;

    await expect(
      uploadInstagramReel('tok', 'iguser', videoFile, 'cap', fetcher),
    ).rejects.toThrow(/processing failed/);
  });
});

describe('uploadPinterestVideo', () => {
  it('registers, uploads with S3 params, polls to success', async () => {
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/v5/media') && init?.method === 'POST') {
          return jsonResponse({
            media_id: 'pin-m1',
            upload_url: 'https://s3.example.com/upload',
            upload_parameters: { key: 'abc' },
          });
        }
        if (u.includes('s3.example.com')) {
          expect(init?.body).toBeInstanceOf(FormData);
          return new Response(null, { status: 204 });
        }
        if (u.includes('/v5/media/pin-m1'))
          return jsonResponse({ status: 'succeeded' });
        return jsonResponse({});
      },
    ) as unknown as typeof fetch;

    const id = await uploadPinterestVideo('tok', videoFile, fetcher);
    expect(id).toBe('pin-m1');
  });
});
