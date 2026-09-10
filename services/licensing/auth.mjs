import { createRemoteJWKSet, jwtVerify } from 'jose';

export function createAuthenticator({ issuer, audience, jwksUrl, key }) {
  if (!issuer || !audience)
    throw new Error('Authentication issuer and audience are required');
  if (!key && new URL(jwksUrl).protocol !== 'https:')
    throw new Error('JWKS must use HTTPS');
  const resolver = key || createRemoteJWKSet(new URL(jwksUrl));
  return async (authorization) => {
    if (
      typeof authorization !== 'string' ||
      authorization.length > 16384 ||
      !authorization.startsWith('Bearer ')
    )
      throw new Error('Sign-in required');
    const { payload } = await jwtVerify(authorization.slice(7), resolver, {
      issuer,
      audience,
      algorithms: ['RS256', 'ES256', 'EdDSA'],
      requiredClaims: ['exp', 'iat', 'sub'],
      maxTokenAge: '1h',
      clockTolerance: 30,
    });
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.email_verified !== true ||
      typeof payload.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+$/.test(payload.email) ||
      payload.email.length > 320
    )
      throw new Error('Verified email required');
    return { subject: payload.sub, email: payload.email.toLowerCase() };
  };
}
