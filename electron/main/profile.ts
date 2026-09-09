import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// Explicit diagnostic profile isolation, evaluated before stores and databases.
// Never silently fall back to the customer's normal profile for a bad override.
const override = process.env.USCUT_PROFILE_DIR;
if (override) {
  if (!path.isAbsolute(override))
    throw new Error('USCUT_PROFILE_DIR must be an absolute directory');
  fs.mkdirSync(override, { recursive: true });
  app.setPath('userData', override);
  app.setPath('sessionData', override);
}
