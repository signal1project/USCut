import { ipcMain } from 'electron';
import type { Settings } from '../settings/settings';
import { verifyEntitlement } from '../../../commont/entitlement';
import {
  LICENSE_PUBLIC_KEY_PEM,
  resolveLicenseStatus,
  isPremiumUnlocked,
  type LicenseStatus,
} from './entitlement';

export function currentLicenseStatus(settings: Settings): LicenseStatus {
  return resolveLicenseStatus(
    settings.getLicenseToken(),
    settings.getLicenseLastVerified(),
  );
}

export function registerLicenseHandlers(settings: Settings) {
  ipcMain.handle('license:status', () => currentLicenseStatus(settings));

  ipcMain.handle('license:activate', (_, token: unknown) => {
    if (typeof token !== 'string' || !token.trim())
      throw new Error('Paste your USCut licence key.');
    const check = verifyEntitlement(token.trim(), LICENSE_PUBLIC_KEY_PEM);
    if (!check.valid && check.reason !== 'expired')
      throw new Error(
        check.reason === 'bad signature'
          ? 'That licence key is not valid for USCut.'
          : `Licence key rejected: ${check.reason}.`,
      );
    settings.setLicenseToken(token.trim());
    return currentLicenseStatus(settings);
  });

  ipcMain.handle('license:deactivate', () => {
    settings.clearLicense();
    return currentLicenseStatus(settings);
  });
}

export { isPremiumUnlocked };
