import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApiServer, type RunningApiServer } from '../../server';
import { JobManager } from '../../jobs/jobManager';
import { createClipsRouter } from '../router';
import type {
  AutoClipInput,
  AutoClipResult,
  ClipService,
} from '../clipService';
let api: RunningApiServer | undefined;
let directory: string;
afterEach(async () => {
  await api?.close();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
describe('Auto-Clip job API', () => {
  it('requires auth and exposes accepted, completed, and missing jobs', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uscut-job-api-'));
    const result: AutoClipResult = {
      transcriptSource: 'provided',
      pickedBy: 'heuristic',
      clips: [],
    };
    const service = { autoClip: async () => result } as unknown as ClipService;
    const manager = new JobManager<AutoClipInput, AutoClipResult>(
      directory,
      async () => result,
    );
    api = await startApiServer({
      routes: [{ path: '/clips', router: createClipsRouter(service, manager) }],
    });
    const base = `${api.url}/api/clips/jobs`;
    expect((await fetch(base)).status).toBe(401);
    const headers = {
      Authorization: `Bearer ${api.token}`,
      'Content-Type': 'application/json',
    };
    const requestId = 'abde6347-57ec-4ef9-bd30-e2bde44d990a';
    const response = await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId,
        videoPath: 'source.mp4',
        transcriptSrt: 'fixture',
      }),
    });
    expect(response.status).toBe(202);
    expect((await response.json()).id).toBe(requestId);
    const jobs = await (await fetch(base, { headers })).json();
    expect(jobs.jobs[0]).toMatchObject({ status: 'completed', result });
    expect((await fetch(`${base}/missing`, { headers })).status).toBe(404);
    expect(
      (await fetch(`${base}/${requestId}/cancel`, { method: 'POST', headers }))
        .status,
    ).toBe(200);
    expect(
      (await fetch(`${base}/${requestId}`, { headers }).then((r) => r.json()))
        .status,
    ).toBe('completed');
  });
});
