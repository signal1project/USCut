import {
  PLATFORM_CONFIG,
  tokenBundleSchema,
  type Platform,
  type TokenBundle,
} from '@mas/types';
import { Injectable } from '../core/decorators';
import { CredentialManager } from '../credentials/credentialManager';
import {
  challengeFromVerifier,
  generateCodeVerifier,
  generateState,
} from './pkce';

export interface OAuthClientConfig {
  clientId: string;
  /** Omitted for public (PKCE) clients. */
  clientSecret?: string;
  redirectUri: string;
}

export interface TokenEndpointResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  [k: string]: unknown;
}

// HTTP seam — production posts via axios; tests inject a fake.
export interface HttpPoster {
  postForm(
    url: string,
    body: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<TokenEndpointResponse>;
}

export interface AuthorizeRequest {
  url: string;
  state: string;
  /** Present only for PKCE platforms; must be replayed during code exchange. */
  codeVerifier?: string;
}

// Refresh when the access token expires within this window.
const EXPIRY_SKEW_MS = 60_000;

@Injectable()
export class OAuthService {
  constructor(
    private readonly http: HttpPoster,
    private readonly credentials: CredentialManager,
  ) {}

  /** Build the platform authorize URL plus the state/verifier to retain for the callback. */
  buildAuthorizeUrl(
    platform: Platform,
    config: OAuthClientConfig,
  ): AuthorizeRequest {
    const { oauth } = PLATFORM_CONFIG[platform];
    const state = generateState();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: oauth.scopes.join(' '),
      state,
    });

    let codeVerifier: string | undefined;
    if (oauth.usesPkce) {
      codeVerifier = generateCodeVerifier();
      params.set('code_challenge', challengeFromVerifier(codeVerifier));
      params.set('code_challenge_method', 'S256');
    }

    const sep = oauth.authorizeUrl.includes('?') ? '&' : '?';
    return {
      url: `${oauth.authorizeUrl}${sep}${params.toString()}`,
      state,
      codeVerifier,
    };
  }

  /** Extract the authorization code from a redirect URL, enforcing state match. */
  parseCallback(redirectUrl: string, expectedState: string): { code: string } {
    const url = new URL(redirectUrl);
    const error = url.searchParams.get('error');
    if (error) {
      const desc = url.searchParams.get('error_description');
      throw new Error(
        `OAuth callback error: ${error}${desc ? ` — ${desc}` : ''}`,
      );
    }
    const state = url.searchParams.get('state');
    if (!state || state !== expectedState) {
      throw new Error('OAuth state mismatch — possible CSRF, aborting.');
    }
    const code = url.searchParams.get('code');
    if (!code) throw new Error('OAuth callback missing authorization code.');
    return { code };
  }

  /** Exchange an authorization code for tokens. */
  async exchangeCode(
    platform: Platform,
    config: OAuthClientConfig,
    args: { code: string; codeVerifier?: string },
  ): Promise<TokenBundle> {
    const { oauth } = PLATFORM_CONFIG[platform];
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
    };
    if (config.clientSecret) body.client_secret = config.clientSecret;
    if (oauth.usesPkce && args.codeVerifier)
      body.code_verifier = args.codeVerifier;

    const resp = await this.http.postForm(oauth.tokenUrl, body);
    return this.toBundle(resp);
  }

  /** Obtain a fresh access token from a refresh token. */
  async refresh(
    platform: Platform,
    config: OAuthClientConfig,
    refreshToken: string,
  ): Promise<TokenBundle> {
    const { oauth } = PLATFORM_CONFIG[platform];
    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
    };
    if (config.clientSecret) body.client_secret = config.clientSecret;

    const resp = await this.http.postForm(oauth.tokenUrl, body);
    // Some providers omit a rotated refresh_token; keep the prior one.
    return this.toBundle(resp, refreshToken);
  }

  /**
   * Return a valid token for a stored account, refreshing in place when the
   * access token is expired or within the skew window. Persists rotations.
   */
  async ensureFresh(
    platform: Platform,
    credentialRef: string,
    config: OAuthClientConfig,
    now: Date = new Date(),
  ): Promise<TokenBundle> {
    const bundle = this.credentials.retrieve(credentialRef);
    if (!bundle)
      throw new Error(`No stored credentials for ref "${credentialRef}".`);

    const needsRefresh =
      bundle.expiresAt !== null &&
      bundle.expiresAt.getTime() - now.getTime() <= EXPIRY_SKEW_MS;

    if (!needsRefresh) return bundle;
    if (!bundle.refreshToken) {
      throw new Error(
        `Token for "${credentialRef}" expired and no refresh token is available.`,
      );
    }

    const refreshed = await this.refresh(platform, config, bundle.refreshToken);
    this.credentials.save(credentialRef, refreshed);
    return refreshed;
  }

  private toBundle(
    resp: TokenEndpointResponse,
    fallbackRefresh?: string,
  ): TokenBundle {
    const obtainedAt = new Date();
    const expiresAt =
      typeof resp.expires_in === 'number'
        ? new Date(obtainedAt.getTime() + resp.expires_in * 1000)
        : null;
    return tokenBundleSchema.parse({
      accessToken: resp.access_token,
      refreshToken: resp.refresh_token ?? fallbackRefresh,
      tokenType: resp.token_type ?? 'Bearer',
      scope: resp.scope,
      expiresAt,
      obtainedAt,
      meta: {},
    });
  }
}
