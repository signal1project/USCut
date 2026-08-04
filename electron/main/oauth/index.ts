import axios from 'axios';
import { getCredentialManager } from '../credentials';
import type { CredentialManager } from '../credentials/credentialManager';
import {
  OAuthService,
  type HttpPoster,
  type TokenEndpointResponse,
} from './oauthService';

export { OAuthService } from './oauthService';
export type {
  OAuthClientConfig,
  HttpPoster,
  AuthorizeRequest,
} from './oauthService';
export * from './pkce';

export const axiosPoster: HttpPoster = {
  async postForm(url, body, headers) {
    const { data } = await axios.post<TokenEndpointResponse>(
      url,
      new URLSearchParams(body).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          ...headers,
        },
      },
    );
    return data;
  },
};

let instance: OAuthService | null = null;

export function getOAuthService(): OAuthService {
  if (!instance) {
    instance = new OAuthService(axiosPoster, getCredentialManager());
  }
  return instance;
}

/** Build an OAuthService bound to a specific credential manager (composition root). */
export function createOAuthService(
  credentials: CredentialManager,
): OAuthService {
  return new OAuthService(axiosPoster, credentials);
}
