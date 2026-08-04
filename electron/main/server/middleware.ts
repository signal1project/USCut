import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ZodError, type ZodSchema } from 'zod';

/** Wrap an async handler so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Require `Authorization: Bearer <token>` matching the local API token. */
export function bearerAuth(token: string): RequestHandler {
  return (req, res, next) => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match || !safeEqual(match[1], token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

/** Validate and replace req.body with the parsed result. */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res
        .status(400)
        .json({ error: 'validation_failed', details: result.error.flatten() });
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Terminal error handler — maps Zod errors to 400, everything else to 500. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res
      .status(400)
      .json({ error: 'validation_failed', details: err.flatten() });
    return;
  }
  const message = err instanceof Error ? err.message : 'internal_error';
  res.status(500).json({ error: 'internal_error', message });
}
