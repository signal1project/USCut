import express from 'express';
import type { Server } from 'node:http';
import { createListingsRouter } from './router';
import type { ListingStore } from './listingStore';
import type { PropertyListingSummary } from './types';

export interface CaptureServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

const DEFAULT_CAPTURE_PORT = 7474;

export interface CaptureServerOptions {
  port?: number;
  /** Fired after the extension successfully captures a listing. */
  onCaptured?: (listing: PropertyListingSummary) => void;
}

/**
 * Fixed-port loopback listener for the Listing Scraper Chrome extension.
 *
 * The main MAS API rotates its port and bearer token every launch, which the
 * extension cannot discover — so listing capture gets its own stable port
 * (AICUT_CAPTURE_PORT, default 7474, inherited from the retired BLK INK
 * Scraper so existing extension installs keep working). Trust model is
 * loopback-only + CORS, same as the original tool: it exposes ONLY the
 * listings routes, never the publish/content/OAuth surface.
 */
export function startListingCaptureServer(
  store: ListingStore,
  options: CaptureServerOptions = {},
): Promise<CaptureServer> {
  const port =
    options.port ??
    (Number(process.env.AICUT_CAPTURE_PORT) || DEFAULT_CAPTURE_PORT);
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // The extension's content scripts POST from listing-site origins.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, app: 'aicut-listing-scraper', port });
  });

  // Same paths the extension has always used: /api/listings/capture
  app.use(
    '/api/listings',
    createListingsRouter(store, { onCaptured: options.onCaptured }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return new Promise((resolve, reject) => {
    const server: Server = app.listen(port, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}
