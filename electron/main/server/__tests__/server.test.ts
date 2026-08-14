import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { z } from 'zod';
import { startApiServer, type RunningApiServer } from '../index';
import { asyncHandler, validateBody } from '../middleware';

// A sample feature router exercising validation, async handlers, and errors.
function makeTestRouter() {
  const r = express.Router();
  r.post(
    '/echo',
    validateBody(z.object({ name: z.string().min(1) })),
    (req, res) => {
      res.json({ hello: req.body.name });
    },
  );
  r.get(
    '/boom',
    asyncHandler(async () => {
      throw new Error('kaboom');
    }),
  );
  return r;
}

let api: RunningApiServer;

beforeAll(async () => {
  api = await startApiServer({
    token: 'secret-token',
    routes: [{ path: '/test', router: makeTestRouter() }],
  });
});
afterAll(async () => {
  await api.close();
});

const auth = {
  Authorization: 'Bearer secret-token',
  'Content-Type': 'application/json',
};

describe('embedded API server', () => {
  it('serves /health without auth', async () => {
    const res = await fetch(`${api.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('rejects /api routes without a valid bearer token', async () => {
    const res = await fetch(`${api.url}/api/test/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong bearer token', async () => {
    const res = await fetch(`${api.url}/api/test/echo`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer nope',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('runs a mounted feature route with valid auth', async () => {
    const res = await fetch(`${api.url}/api/test/echo`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Dale' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: 'Dale' });
  });

  it('returns 400 on validation failure', async () => {
    const res = await fetch(`${api.url}/api/test/echo`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation_failed' });
  });

  it('maps thrown errors to 500 via the error handler', async () => {
    const res = await fetch(`${api.url}/api/test/boom`, { headers: auth });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: 'internal_error',
      message: 'kaboom',
    });
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${api.url}/api/nope`, { headers: auth });
    expect(res.status).toBe(404);
  });

  // The renderer sends an Authorization header on every request, which forces
  // browsers to preflight with OPTIONS before the real call. bearerAuth would
  // 401 that preflight (browsers never attach Authorization to it), and with
  // no CORS headers the browser blocks the real request too — this is the
  // literal "Failed to fetch" Dale saw in the running app on 2026-08-14 while
  // curl against the same endpoint got a real response, since curl ignores CORS.
  it('answers a CORS preflight with 2xx and no auth required', async () => {
    const res = await fetch(`${api.url}/api/test/echo`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
    expect(res.headers.get('access-control-allow-headers')).toMatch(
      /authorization/i,
    );
  });

  it('includes CORS headers on a real authed response', async () => {
    const res = await fetch(`${api.url}/api/test/echo`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Dale' }),
    });
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });
});
