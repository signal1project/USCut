import type { Request, Response, NextFunction } from 'express';
import type { Settings } from '../settings/settings';
import { currentLicenseStatus, isPremiumUnlocked } from './index';
import type { LicenseStatus } from './entitlement';

/**
 * Thrown by `assertLicensed`. Message is the fixed string 'LICENSE_REQUIRED'
 * so every surface (ipcMain.handle rejection, the aicuts `{ error }` return
 * convention, and the Express 402 body below) can be told apart from an
 * ordinary failure the same way in the renderer.
 */
export class LicenseRequiredError extends Error {
  readonly status: LicenseStatus;
  constructor(status: LicenseStatus) {
    super('LICENSE_REQUIRED');
    this.name = 'LicenseRequiredError';
    this.status = status;
  }
}

/** Throws `LicenseRequiredError` unless the license is active/grace. */
export function assertLicensed(settings: Settings): LicenseStatus {
  const status = currentLicenseStatus(settings);
  if (!isPremiumUnlocked(status)) throw new LicenseRequiredError(status);
  return status;
}

/** Express middleware form of `assertLicensed` for the MAS API routers. */
export function requireLicenseRoute(settings: Settings) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const status = currentLicenseStatus(settings);
    if (!isPremiumUnlocked(status)) {
      res.status(402).json({ error: 'LICENSE_REQUIRED', status });
      return;
    }
    next();
  };
}
