/**
 * Webview bridge — lets users log in to social platforms via an Electron
 * BrowserWindow that persists session cookies, and posts through the real
 * web composer. No developer app registration required — this is how
 * consumer social schedulers (Buffer, CapCut, etc.) work.
 *
 * Posting pipeline per platform (all best-effort with graceful manual
 * fallback — the compose window simply stays open for the user to finish):
 *   1. open the composer with the persisted session
 *   2. PRE script surfaces the composer / file input where needed
 *   3. media attaches via CDP DOM.setFileInputFiles (walks iframes too —
 *      TikTok's uploader lives in one)
 *   4. FILL script types the caption; the caption is also on the clipboard
 *   5. SUBMIT script polls for an enabled post button and clicks it
 */

import { BrowserWindow, ipcMain, session, clipboard } from 'electron';
import { logger } from '../../global/log';

interface PlatformMeta {
  label: string;
  loginUrl: string;
  composeUrl: string;
  sessionDomain: string;
  authCookieHints: string[]; // cookie names that indicate a logged-in session
  /** Attempt to click the post button automatically. */
  autoSubmit: boolean;
}

export const WEBVIEW_PLATFORMS: Record<string, PlatformMeta> = {
  twitter: {
    label: 'X / Twitter',
    loginUrl: 'https://x.com/i/flow/login',
    composeUrl: 'https://x.com/compose/tweet',
    sessionDomain: '.x.com',
    authCookieHints: ['auth_token', 'ct0'],
    autoSubmit: true,
  },
  facebook: {
    label: 'Facebook',
    loginUrl: 'https://www.facebook.com/',
    composeUrl: 'https://www.facebook.com/',
    sessionDomain: '.facebook.com',
    authCookieHints: ['c_user', 'xs'],
    autoSubmit: false, // composer markup shifts too often — attach+fill, user clicks Post
  },
  instagram: {
    label: 'Instagram',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    composeUrl: 'https://www.instagram.com/',
    sessionDomain: '.instagram.com',
    authCookieHints: ['sessionid', 'csrftoken'],
    autoSubmit: false, // multi-step create flow; we open + attach, user reviews
  },
  linkedin: {
    label: 'LinkedIn',
    loginUrl: 'https://www.linkedin.com/login',
    composeUrl: 'https://www.linkedin.com/feed/',
    sessionDomain: '.linkedin.com',
    authCookieHints: ['li_at', 'JSESSIONID'],
    autoSubmit: true,
  },
  threads: {
    label: 'Threads',
    loginUrl: 'https://www.threads.net/',
    composeUrl: 'https://www.threads.net/',
    sessionDomain: '.threads.net',
    authCookieHints: ['sessionid'],
    autoSubmit: false,
  },
  pinterest: {
    label: 'Pinterest',
    loginUrl: 'https://www.pinterest.com/login/',
    composeUrl: 'https://www.pinterest.com/pin-builder/',
    sessionDomain: '.pinterest.com',
    authCookieHints: ['_pinterest_sess', '_auth'],
    autoSubmit: false, // needs a board choice
  },
  youtube: {
    label: 'YouTube',
    loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube',
    composeUrl: 'https://studio.youtube.com/',
    sessionDomain: '.google.com',
    authCookieHints: ['SAPISID', 'SID'],
    autoSubmit: false, // Studio's multi-page wizard — we open + attach
  },
  tiktok: {
    label: 'TikTok',
    loginUrl: 'https://www.tiktok.com/login',
    composeUrl: 'https://www.tiktok.com/tiktokstudio/upload',
    sessionDomain: '.tiktok.com',
    authCookieHints: ['sessionid', 'sid_guard'],
    autoSubmit: false, // upload processing gate; we attach + fill caption
  },
};

// ── Composer scripts ─────────────────────────────────────────────────────────

/** Click something that surfaces the file input / composer. */
const PRE_SCRIPTS: Partial<Record<string, string>> = {
  instagram: `(async () => {
    for (let i = 0; i < 15; i++) {
      const create = document.querySelector('svg[aria-label="New post"], svg[aria-label="Create"]');
      if (create) { create.closest('a,button,div[role="button"]')?.click(); return; }
      await new Promise(r => setTimeout(r, 400));
    }
  })();`,
  facebook: `(async () => {
    for (let i = 0; i < 15; i++) {
      const btn = [...document.querySelectorAll('div[role="button"], span')]
        .find(el => /photo\\/video/i.test(el.textContent || '') || /photo/i.test(el.getAttribute('aria-label') || ''));
      if (btn) { btn.click(); return; }
      await new Promise(r => setTimeout(r, 400));
    }
  })();`,
  threads: `(async () => {
    for (let i = 0; i < 15; i++) {
      const create = document.querySelector('svg[aria-label="Create"], svg[aria-label="New thread"]');
      if (create) { create.closest('a,button,div[role="button"]')?.click(); return; }
      await new Promise(r => setTimeout(r, 400));
    }
  })();`,
  linkedin: `(async () => {
    for (let i = 0; i < 15; i++) {
      const trigger = document.querySelector('[data-control-name="share.sharebox_focus"], .share-box-feed-entry__trigger')
        || [...document.querySelectorAll('button')].find(b => /start a post/i.test(b.textContent || ''));
      if (trigger) { trigger.click(); return; }
      await new Promise(r => setTimeout(r, 400));
    }
  })();`,
};

function insertTextScript(selectorExpr: string, body: string): string {
  return `(async () => {
    for (let i = 0; i < 30; i++) {
      const el = ${selectorExpr};
      if (el) {
        el.focus();
        document.execCommand('insertText', false, ${JSON.stringify(body)});
        return true;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  })();`;
}

const FILL_SCRIPTS: Partial<Record<string, (body: string) => string>> = {
  twitter: (body) =>
    insertTextScript(
      `document.querySelector('[data-testid="tweetTextarea_0"]')`,
      body,
    ),
  linkedin: (body) =>
    insertTextScript(
      `document.querySelector('.ql-editor') || document.querySelector('[data-placeholder][role="textbox"]')`,
      body,
    ),
  facebook: (body) =>
    insertTextScript(
      `[...document.querySelectorAll('div[contenteditable="true"][role="textbox"]')].at(-1)`,
      body,
    ),
  threads: (body) =>
    insertTextScript(
      `[...document.querySelectorAll('div[contenteditable="true"]')].at(-1)`,
      body,
    ),
  tiktok: (body) =>
    insertTextScript(
      `document.querySelector('.public-DraftEditor-content') || [...document.querySelectorAll('div[contenteditable="true"]')].at(-1)`,
      body,
    ),
  pinterest: (body) =>
    insertTextScript(
      `document.querySelector('[data-test-id="pin-draft-title"] textarea, textarea[placeholder*="title" i]')`,
      body,
    ),
};

/** Poll for an ENABLED submit button and click it. Returns true when clicked. */
const SUBMIT_SCRIPTS: Partial<Record<string, string>> = {
  twitter: `(async () => {
    for (let i = 0; i < 150; i++) {
      const btn = document.querySelector('[data-testid="tweetButton"]');
      if (btn && btn.getAttribute('aria-disabled') !== 'true' && !btn.disabled) { btn.click(); return true; }
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  })();`,
  linkedin: `(async () => {
    for (let i = 0; i < 150; i++) {
      const btn = document.querySelector('.share-actions__primary-action')
        || [...document.querySelectorAll('button')].find(b => /^post$/i.test((b.textContent || '').trim()));
      if (btn && !btn.disabled) { btn.click(); return true; }
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  })();`,
};

// ── CDP media attachment ─────────────────────────────────────────────────────

interface CdpNode {
  nodeId: number;
  nodeName?: string;
  attributes?: string[];
  children?: CdpNode[];
  contentDocument?: CdpNode;
  shadowRoots?: CdpNode[];
}

function collectFileInputs(node: CdpNode, out: number[]): void {
  if (node.nodeName === 'INPUT') {
    const attrs = node.attributes ?? [];
    for (let i = 0; i < attrs.length - 1; i += 2) {
      if (attrs[i] === 'type' && attrs[i + 1].toLowerCase() === 'file') {
        out.push(node.nodeId);
      }
    }
  }
  for (const child of node.children ?? []) collectFileInputs(child, out);
  if (node.contentDocument) collectFileInputs(node.contentDocument, out);
  for (const sr of node.shadowRoots ?? []) collectFileInputs(sr, out);
}

/**
 * Attach a local file to the page's file input via the DevTools protocol.
 * Walks the FULL tree (pierce: true) so inputs inside iframes and shadow DOM
 * (TikTok, YouTube Studio) are found. Retries while the page builds its UI.
 */
export async function attachMediaViaCdp(
  win: BrowserWindow,
  mediaPath: string,
  timeoutMs = 25_000,
): Promise<boolean> {
  const dbg = win.webContents.debugger;
  try {
    dbg.attach('1.3');
  } catch {
    // already attached
  }
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (win.isDestroyed()) return false;
      try {
        const { root } = (await dbg.sendCommand('DOM.getDocument', {
          depth: -1,
          pierce: true,
        })) as { root: CdpNode };
        const inputs: number[] = [];
        collectFileInputs(root, inputs);
        if (inputs.length > 0) {
          await dbg.sendCommand('DOM.setFileInputFiles', {
            nodeId: inputs[0],
            files: [mediaPath],
          });
          return true;
        }
      } catch (err) {
        logger.log('[AICut] CDP file-input scan retry', err);
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    return false;
  } finally {
    try {
      dbg.detach();
    } catch {
      /* already detached */
    }
  }
}

// ── Shared Meta identity ─────────────────────────────────────────────────────
// Facebook, Instagram, and Threads are all the same Meta account in real life
// (BLK INK Lead Machine got this for free by running in the user's real
// browser, which shares one cookie jar across meta.com properties). AICut's
// webview windows don't share cookies by default, so we deliberately route
// all three through ONE Electron session partition instead of three isolated
// ones — signing into Facebook puts the same identity cookies in front of
// instagram.com and threads.net too.

const META_GROUP = new Set(['facebook', 'instagram', 'threads']);
const META_PARTITION = 'persist:social-meta';

function partitionFor(platform: string): string {
  return META_GROUP.has(platform)
    ? META_PARTITION
    : `persist:social-${platform}`;
}

/**
 * Threads has no login of its own — it rides entirely on the Instagram
 * identity. Confirmed against a real live session (2026-08-11): threads.net
 * only ever sets `ig_did` (a device-ID cookie), never a sessionid, even
 * while genuinely signed in. So "is Threads logged in" is really "is
 * Instagram logged in" — check Instagram's cookie instead of looking for
 * something that structurally doesn't exist on threads.net.
 */
const AUTH_CHECK_PLATFORM: Record<string, string> = { threads: 'instagram' };

async function isLoggedIn(platform: string): Promise<boolean> {
  const checkPlatform = AUTH_CHECK_PLATFORM[platform] ?? platform;
  const meta = WEBVIEW_PLATFORMS[checkPlatform];
  if (!meta) return false;
  const ses = session.fromPartition(partitionFor(platform), { cache: true });
  const cookies = await ses.cookies.get({ domain: meta.sessionDomain });
  const loggedIn = meta.authCookieHints.some((hint) =>
    cookies.some((c) => c.name === hint && c.value.length > 0),
  );
  // Diagnostic: when a platform we expect to be logged in still reads as
  // logged out, dump every cookie NAME present for its domain (never
  // values) so a mismatched authCookieHint is visible in the log instead
  // of guessing blind. Cheap enough to always run.
  if (!loggedIn && cookies.length > 0) {
    logger.log(
      '[AICut] isLoggedIn(false) but cookies present for',
      platform,
      meta.sessionDomain,
      '— names:',
      [...new Set(cookies.map((c) => c.name))],
    );
  }
  return loggedIn;
}

/**
 * Best-effort click on a Meta cross-app identity prompt — "Continue as
 * [name]", "Log in with Instagram", an account-chip row, etc. Threads in
 * particular bridges off the Instagram identity rather than Facebook's, so
 * this needs to catch Instagram-flavored prompts too, not just Facebook's.
 */
const CONTINUE_AS_SCRIPT = `(() => {
  const patterns = [
    /continue as/i,
    /log ?in with instagram/i,
    /use instagram to log ?in/i,
    /switch to profile/i,
  ];
  const candidates = [
    ...document.querySelectorAll('button, div[role="button"], a, [role="link"]'),
  ];
  for (const re of patterns) {
    const btn = candidates.find((el) => re.test(el.textContent || ''));
    if (btn) { btn.click(); return { clicked: true, matched: re.source }; }
  }
  return { clicked: false, sample: document.title };
})();`;

/**
 * After a successful sign-in to one Meta property, visit the sibling
 * properties in the SAME shared session — VISIBLE (not hidden), because
 * Meta's SSO/bot-detection can behave differently for invisible automated
 * windows, and because a real page needs to actually paint for its
 * lazy-hydrated "Continue as" prompt to appear at all. Meta's own cross-app
 * identity bridge (Accounts Center) will often complete the login with zero
 * clicks, or show a one-click prompt this auto-clicks. Best-effort: a
 * property that truly needs its own separate password is left for the user
 * to sign into normally via its own Sign In button — nothing here can force
 * that, and each attempt is logged so mismatches are diagnosable.
 */
async function attemptMetaCrossLogin(
  mainWindow: BrowserWindow,
  signedInPlatform: string,
): Promise<void> {
  if (!META_GROUP.has(signedInPlatform)) return;
  const ses = session.fromPartition(META_PARTITION, { cache: true });

  for (const platform of META_GROUP) {
    if (platform === signedInPlatform) continue;
    if (await isLoggedIn(platform)) continue;
    const meta = WEBVIEW_PLATFORMS[platform];
    const win = new BrowserWindow({
      width: 480,
      height: 640,
      show: true,
      title: `Connecting ${meta.label} via your Meta login…`,
      parent: mainWindow,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    win.setMenuBarVisibility(false);
    try {
      await win.loadURL(meta.loginUrl);
      await new Promise((r) => setTimeout(r, 2800));
      if (!win.isDestroyed()) {
        const result = await win.webContents
          .executeJavaScript(CONTINUE_AS_SCRIPT)
          .catch((err) => {
            logger.log('[AICut] Meta cross-login script failed', platform, err);
            return null;
          });
        logger.log('[AICut] Meta cross-login attempt', platform, result);
        await new Promise((r) => setTimeout(r, 2200));
      }
      const success = await isLoggedIn(platform);
      logger.log('[AICut] Meta cross-login result', platform, { success });
    } catch (err) {
      logger.log('[AICut] Meta cross-login attempt failed', platform, err);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }
}

// ── Facebook Page detection ──────────────────────────────────────────────────
// Auto-detect which Pages the signed-in Meta identity manages, so business
// profiles can be built without Dale typing Page IDs by hand. Best-effort DOM
// scraping — same posture as the compose PRE/FILL scripts above: Facebook's
// Pages-list markup shifts over time, so this needs iterating against
// whatever's live when it starts missing pages.

export interface DetectedPage {
  id: string;
  name: string;
  url: string;
}

const DETECT_PAGES_SCRIPT = `(() => {
  const IGNORE = new Set(['pages','settings','help','bookmarks','groups','watch','marketplace','gaming','friends','notifications','messages','events','saved','memories','ads','business']);
  const seen = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/^(?:https:\\/\\/www\\.facebook\\.com)?\\/(profile\\.php\\?id=(\\d+)|([A-Za-z0-9.\\-]{2,}))\\/?(?:[?#].*)?$/);
    if (!m) continue;
    const id = m[2] || m[3];
    if (!id || IGNORE.has(id.toLowerCase())) continue;
    const container = a.closest('div[role="listitem"], li, div[data-visualcompletion]') || a.parentElement;
    const img = container ? container.querySelector('img') : null;
    const nameEl = container ? container.querySelector('span, strong') : null;
    const name = (nameEl && nameEl.textContent && nameEl.textContent.trim())
      || (img && img.getAttribute('alt'))
      || (a.textContent && a.textContent.trim());
    if (!name || name.length < 2) continue;
    if (!seen.has(id)) seen.set(id, { id, name, url: 'https://www.facebook.com/' + id });
  }
  return [...seen.values()];
})();`;

/** Opens a scan window against Facebook's Pages list in the shared Meta session. */
export async function detectFacebookPages(
  mainWindow: BrowserWindow,
): Promise<DetectedPage[]> {
  if (!(await isLoggedIn('facebook'))) {
    throw new Error('Sign in to Facebook first.');
  }
  const ses = session.fromPartition(META_PARTITION, { cache: true });
  const win = new BrowserWindow({
    width: 480,
    height: 640,
    title: 'Detecting your Facebook Pages…',
    parent: mainWindow,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.setMenuBarVisibility(false);
  try {
    await win.loadURL('https://www.facebook.com/pages/?category=your_pages');
    await new Promise((r) => setTimeout(r, 3000));
    if (win.isDestroyed()) return [];
    const pages = (await win.webContents
      .executeJavaScript(DETECT_PAGES_SCRIPT)
      .catch((err) => {
        logger.log('[AICut] Facebook Pages scan failed', err);
        return [];
      })) as DetectedPage[];
    return pages;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

export function registerWebviewBridge(mainWindow: BrowserWindow): void {
  /** Open platform login window. Returns when window is closed. */
  ipcMain.handle('mas:social:open-login', async (_e, platform: string) => {
    const meta = WEBVIEW_PLATFORMS[platform];
    if (!meta) throw new Error(`Unknown platform: ${platform}`);

    const ses = session.fromPartition(partitionFor(platform), {
      cache: true,
    });
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      title: `Sign in to ${meta.label}`,
      parent: mainWindow,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.setMenuBarVisibility(false);
    await win.loadURL(meta.loginUrl);

    return new Promise<{ loggedIn: boolean }>((resolve) => {
      win.on('closed', () => {
        void (async () => {
          if (await isLoggedIn(platform)) {
            await attemptMetaCrossLogin(mainWindow, platform);
          }
        })().finally(() => resolve({ loggedIn: true }));
      });
    });
  });

  /** Check if platform has an active persisted session. */
  ipcMain.handle('mas:social:session-status', async (_e, platform: string) => {
    if (!WEBVIEW_PLATFORMS[platform]) return { loggedIn: false };
    return { loggedIn: await isLoggedIn(platform) };
  });

  /** Session status for every webview platform at once (Share dialog). */
  ipcMain.handle('mas:social:session-status-all', async () => {
    const out: Record<string, boolean> = {};
    for (const platform of Object.keys(WEBVIEW_PLATFORMS)) {
      out[platform] = await isLoggedIn(platform);
    }
    return out;
  });

  /**
   * Clear a platform's session (log out). Facebook/Instagram/Threads share
   * one identity, so logging out of any one of them logs out of all three —
   * matches the fact that they were never separate sessions to begin with.
   */
  ipcMain.handle('mas:social:logout', async (_e, platform: string) => {
    const ses = session.fromPartition(partitionFor(platform), {
      cache: true,
    });
    await ses.clearStorageData();
    return { ok: true, alsoLoggedOut: META_GROUP.has(platform) };
  });

  /**
   * Post through the platform's real web composer: attach media (CDP),
   * fill the caption, and — where reliable — click Post automatically.
   * Falls back to leaving the window open for the user to finish.
   */
  ipcMain.handle(
    'mas:social:post-webview',
    async (
      _e,
      {
        platform,
        body,
        mediaPath,
        pageId,
      }: {
        platform: string;
        body: string;
        mediaPath?: string;
        /** Facebook Page ID — post to that Page's own timeline (as the Page)
         * instead of the generic feed (as the personal profile). */
        pageId?: string;
      },
    ) => {
      const meta = WEBVIEW_PLATFORMS[platform];
      if (!meta) throw new Error(`Unknown platform: ${platform}`);

      // Caption always lands on the clipboard as a safety net.
      if (body) clipboard.writeText(body);

      const ses = session.fromPartition(partitionFor(platform), {
        cache: true,
      });
      const composeUrl =
        platform === 'facebook' && pageId
          ? `https://www.facebook.com/${pageId}`
          : meta.composeUrl;
      const win = new BrowserWindow({
        width: 720,
        height: 860,
        title:
          platform === 'facebook' && pageId
            ? `Post to ${meta.label} Page`
            : `Post to ${meta.label}`,
        parent: mainWindow,
        webPreferences: {
          session: ses,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      win.setMenuBarVisibility(false);
      await win.loadURL(composeUrl);
      await new Promise((r) => setTimeout(r, 1200));

      const pre = PRE_SCRIPTS[platform];
      if (pre && !win.isDestroyed()) {
        await win.webContents.executeJavaScript(pre).catch(() => {});
        await new Promise((r) => setTimeout(r, 1500));
      }

      let attached = false;
      if (mediaPath && !win.isDestroyed()) {
        attached = await attachMediaViaCdp(win, mediaPath);
        if (attached) await new Promise((r) => setTimeout(r, 1500));
      }

      let filled = false;
      const fillFn = FILL_SCRIPTS[platform];
      if (fillFn && body && !win.isDestroyed()) {
        filled = Boolean(
          await win.webContents
            .executeJavaScript(fillFn(body))
            .catch(() => false),
        );
      }

      if (meta.autoSubmit && !win.isDestroyed()) {
        const submit = SUBMIT_SCRIPTS[platform];
        if (submit) {
          const clicked = Boolean(
            await win.webContents.executeJavaScript(submit).catch(() => false),
          );
          if (clicked) {
            // Give the platform a moment to fire the request, then close.
            await new Promise((r) => setTimeout(r, 5000));
            if (!win.isDestroyed()) win.destroy();
            return { posted: true, attached, filled, manual: false };
          }
        }
      }

      // Manual finish: window stays open until the user closes it.
      return new Promise<{
        posted: boolean;
        attached: boolean;
        filled: boolean;
        manual: boolean;
      }>((resolve) => {
        win.on('closed', () =>
          resolve({ posted: false, attached, filled, manual: true }),
        );
      });
    },
  );
}
