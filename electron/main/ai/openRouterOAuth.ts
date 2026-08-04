import { BrowserWindow, shell } from 'electron';
import {
  challengeFromVerifier,
  generateCodeVerifier,
  generateState,
} from '../oauth/pkce';

export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_KEY_EXCHANGE_URL = 'https://openrouter.ai/auth/keys';

/**
 * Synthetic callback URL — Electron intercepts navigation before any real
 * request is made, so this never needs to be a running server.
 */
const CALLBACK_URL = 'https://social-manager-ai.local/openrouter-callback';

export interface OpenRouterAuthPending {
  /** Auth URL — open this in the auth browser window. */
  url: string;
  /** Stored by the caller; replayed during code exchange. */
  codeVerifier: string;
  /** Anti-CSRF state value. */
  state: string;
}

/**
 * Build the OpenRouter authorize URL (PKCE-like, no client_id).
 * The returned `codeVerifier` and `state` must be persisted until the
 * callback fires.
 */
export function buildOpenRouterAuthUrl(): OpenRouterAuthPending {
  const codeVerifier = generateCodeVerifier();
  const challenge = challengeFromVerifier(codeVerifier);
  const state = generateState();

  const params = new URLSearchParams({
    callback_url: CALLBACK_URL,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  return {
    url: `${OPENROUTER_AUTH_URL}?${params.toString()}`,
    codeVerifier,
    state,
  };
}

/**
 * Exchange the authorization code for an OpenRouter API key.
 * Inject `fetcher` in tests to avoid real HTTP calls.
 */
export async function exchangeOpenRouterCode(
  code: string,
  codeVerifier: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const resp = await fetcher(OPENROUTER_KEY_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.status.toString());
    throw new Error(`OpenRouter key exchange failed (${resp.status}): ${text}`);
  }
  const json = (await resp.json()) as { key?: string };
  if (!json.key) throw new Error('OpenRouter did not return an API key.');
  return json.key;
}

/**
 * Open the OpenRouter OAuth flow in a dedicated child BrowserWindow.
 * Returns the exchanged API key on success; rejects if the user closes the
 * window or if an error occurs.
 *
 * Flow:
 *  1. Build PKCE-style auth URL.
 *  2. Show a chromeless BrowserWindow.
 *  3. Watch will-redirect / will-navigate for our synthetic callback URL.
 *  4. Extract `code`; close the window.
 *  5. POST to /auth/keys with code + verifier → return the API key.
 */
export async function runOpenRouterOAuthFlow(
  parent: BrowserWindow,
): Promise<string> {
  const pending = buildOpenRouterAuthUrl();

  return new Promise<string>((resolve, reject) => {
    const authWin = new BrowserWindow({
      parent,
      modal: false,
      width: 560,
      height: 700,
      title: 'Connect to OpenRouter',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    authWin.setMenu(null);
    authWin.loadURL(pending.url);

    const handleNav = async (url: string) => {
      if (!url.startsWith(CALLBACK_URL)) return;
      authWin.destroy();

      try {
        const parsed = new URL(url);
        const error = parsed.searchParams.get('error');
        if (error) {
          reject(new Error(`OpenRouter auth error: ${error}`));
          return;
        }
        const returnedState = parsed.searchParams.get('state');
        if (returnedState && returnedState !== pending.state) {
          reject(new Error('OpenRouter auth state mismatch — possible CSRF.'));
          return;
        }
        const code = parsed.searchParams.get('code');
        if (!code) {
          reject(new Error('OpenRouter callback missing authorization code.'));
          return;
        }
        const key = await exchangeOpenRouterCode(code, pending.codeVerifier);
        resolve(key);
      } catch (err) {
        reject(err);
      }
    };

    authWin.webContents.on('will-redirect', (_e, url) => void handleNav(url));
    authWin.webContents.on('will-navigate', (_e, url) => void handleNav(url));

    authWin.on('closed', () => {
      reject(
        new Error('OpenRouter auth window was closed without completing.'),
      );
    });
  });
}

/**
 * Open the Ollama install/docs page — used by the "Set up Ollama" button in
 * onboarding when the local daemon is not detected.
 */
export function openOllamaInstallPage(): void {
  shell.openExternal('https://ollama.com/download');
}
