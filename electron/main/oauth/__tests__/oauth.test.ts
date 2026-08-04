import { describe, it, expect, beforeEach } from 'vitest';
import type { TokenBundle } from '@mas/types';
import {
  CredentialManager,
  type CredentialStore,
  type SecureEncryptor,
} from '../../credentials/credentialManager';
import {
  OAuthService,
  type HttpPoster,
  type OAuthClientConfig,
  type TokenEndpointResponse,
} from '../oauthService';
import {
  challengeFromVerifier,
  generateCodeVerifier,
  generateState,
} from '../pkce';

describe('PKCE helpers', () => {
  it('produces url-safe verifiers and S256 challenges', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
    const c = challengeFromVerifier(v);
    expect(c).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(c).not.toContain('=');
    // Deterministic for a known input (RFC 7636 appendix B vector).
    expect(
      challengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    ).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generates distinct states', () => {
    expect(generateState()).not.toBe(generateState());
  });
});

function makeFakeEncryptor(): SecureEncryptor {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (p) => Buffer.from('E' + p, 'utf8'),
    decryptString: (e) => e.toString('utf8').slice(1),
  };
}
function makeMapStore(): CredentialStore {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k),
    set: (k, v) => void m.set(k, v),
    delete: (k) => void m.delete(k),
    has: (k) => m.has(k),
  };
}

class FakePoster implements HttpPoster {
  lastUrl?: string;
  lastBody?: Record<string, string>;
  constructor(private response: TokenEndpointResponse) {}
  setResponse(r: TokenEndpointResponse) {
    this.response = r;
  }
  async postForm(
    url: string,
    body: Record<string, string>,
  ): Promise<TokenEndpointResponse> {
    this.lastUrl = url;
    this.lastBody = body;
    return this.response;
  }
}

const fbConfig: OAuthClientConfig = {
  clientId: 'fb-id',
  clientSecret: 'fb-secret',
  redirectUri: 'http://127.0.0.1:9999/cb',
};
const twConfig: OAuthClientConfig = {
  clientId: 'tw-id',
  redirectUri: 'http://127.0.0.1:9999/cb',
};

let poster: FakePoster;
let creds: CredentialManager;
let svc: OAuthService;

beforeEach(() => {
  poster = new FakePoster({
    access_token: 'AT',
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'RT',
    scope: 'a b',
  });
  creds = new CredentialManager(makeFakeEncryptor(), makeMapStore());
  svc = new OAuthService(poster, creds);
});

describe('OAuthService.buildAuthorizeUrl', () => {
  it('omits PKCE for non-PKCE platforms (facebook)', () => {
    const req = svc.buildAuthorizeUrl('facebook', fbConfig);
    const u = new URL(req.url);
    expect(u.origin + u.pathname).toBe(
      'https://www.facebook.com/v21.0/dialog/oauth',
    );
    expect(u.searchParams.get('client_id')).toBe('fb-id');
    expect(u.searchParams.get('state')).toBe(req.state);
    expect(u.searchParams.get('scope')).toContain('pages_manage_posts');
    expect(u.searchParams.get('code_challenge')).toBeNull();
    expect(req.codeVerifier).toBeUndefined();
  });

  it('adds S256 PKCE params for PKCE platforms (twitter)', () => {
    const req = svc.buildAuthorizeUrl('twitter', twConfig);
    const u = new URL(req.url);
    expect(req.codeVerifier).toBeDefined();
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(
      challengeFromVerifier(req.codeVerifier!),
    );
  });
});

describe('OAuthService.parseCallback', () => {
  it('returns the code when state matches', () => {
    expect(svc.parseCallback('http://cb/?code=abc&state=s1', 's1')).toEqual({
      code: 'abc',
    });
  });
  it('throws on state mismatch', () => {
    expect(() =>
      svc.parseCallback('http://cb/?code=abc&state=bad', 's1'),
    ).toThrow(/state mismatch/);
  });
  it('throws on provider error', () => {
    expect(() =>
      svc.parseCallback('http://cb/?error=access_denied&state=s1', 's1'),
    ).toThrow(/access_denied/);
  });
  it('throws when code is absent', () => {
    expect(() => svc.parseCallback('http://cb/?state=s1', 's1')).toThrow(
      /missing authorization code/,
    );
  });
});

describe('OAuthService.exchangeCode', () => {
  it('maps the token response and computes expiry', async () => {
    const before = Date.now();
    const bundle = await svc.exchangeCode('facebook', fbConfig, { code: 'C' });
    expect(bundle.accessToken).toBe('AT');
    expect(bundle.refreshToken).toBe('RT');
    expect(poster.lastUrl).toBe(
      'https://graph.facebook.com/v21.0/oauth/access_token',
    );
    expect(poster.lastBody).toMatchObject({
      grant_type: 'authorization_code',
      code: 'C',
      client_secret: 'fb-secret',
    });
    expect(bundle.expiresAt!.getTime()).toBeGreaterThanOrEqual(
      before + 3600_000 - 50,
    );
  });

  it('includes code_verifier for PKCE platforms', async () => {
    await svc.exchangeCode('twitter', twConfig, {
      code: 'C',
      codeVerifier: 'VER',
    });
    expect(poster.lastBody).toMatchObject({ code_verifier: 'VER' });
    expect(poster.lastBody).not.toHaveProperty('client_secret');
  });
});

describe('OAuthService.refresh', () => {
  it('retains the prior refresh token when the response omits one', async () => {
    poster.setResponse({ access_token: 'AT2', expires_in: 100 });
    const bundle = await svc.refresh('facebook', fbConfig, 'OLD_RT');
    expect(bundle.accessToken).toBe('AT2');
    expect(bundle.refreshToken).toBe('OLD_RT');
  });
});

describe('OAuthService.ensureFresh', () => {
  const ref = 'facebook:acc-1';
  const base: TokenBundle = {
    accessToken: 'AT',
    refreshToken: 'RT',
    tokenType: 'Bearer',
    expiresAt: null,
    obtainedAt: new Date(),
    meta: {},
  };

  it('returns the stored token when it is still valid', async () => {
    creds.save(ref, { ...base, expiresAt: new Date(Date.now() + 3600_000) });
    const got = await svc.ensureFresh('facebook', ref, fbConfig);
    expect(got.accessToken).toBe('AT');
    expect(poster.lastUrl).toBeUndefined(); // no network call
  });

  it('refreshes and persists when the token is within the skew window', async () => {
    creds.save(ref, { ...base, expiresAt: new Date(Date.now() + 5_000) });
    poster.setResponse({ access_token: 'AT_NEW', expires_in: 3600 });
    const got = await svc.ensureFresh('facebook', ref, fbConfig);
    expect(got.accessToken).toBe('AT_NEW');
    expect(creds.retrieve(ref)!.accessToken).toBe('AT_NEW'); // persisted
  });

  it('throws when expired with no refresh token', async () => {
    creds.save(ref, {
      ...base,
      refreshToken: undefined,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(svc.ensureFresh('facebook', ref, fbConfig)).rejects.toThrow(
      /no refresh token/,
    );
  });

  it('throws when there are no stored credentials', async () => {
    await expect(
      svc.ensureFresh('facebook', 'missing', fbConfig),
    ).rejects.toThrow(/No stored credentials/);
  });
});
