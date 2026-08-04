import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiApp, type ApiAppOptions, type FeatureRoute } from './app';

export { createApiApp } from './app';
export type { ApiAppOptions, FeatureRoute } from './app';
export {
  asyncHandler,
  bearerAuth,
  validateBody,
  errorHandler,
} from './middleware';

export interface RunningApiServer {
  server: Server;
  port: number;
  url: string;
  token: string;
  close: () => Promise<void>;
}

export function generateApiToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Start the embedded API server bound to loopback only. Port 0 picks a free
 * port; the resolved port/token are returned for the MCP server to consume.
 */
export function startApiServer(
  options: { port?: number; token?: string; routes?: FeatureRoute[] } = {},
): Promise<RunningApiServer> {
  const token = options.token ?? generateApiToken();
  const appOptions: ApiAppOptions = { apiToken: token, routes: options.routes };
  const app = createApiApp(appOptions);

  return new Promise((resolve, reject) => {
    const server = app.listen(options.port ?? 0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        token,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}
