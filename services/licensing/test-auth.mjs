import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { createAuthenticator } from './auth.mjs';

test('activation accepts only a signed, current identity with verified email', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const authenticate = createAuthenticator({
    issuer: 'https://identity.example',
    audience: 'uscut',
    key: publicKey,
  });
  const token = async (over = {}, audience = 'uscut', expiration = '5m') =>
    new SignJWT({ email: 'Buyer@example.com', email_verified: true, ...over })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject('user_1')
      .setIssuer('https://identity.example')
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiration)
      .sign(privateKey);
  assert.equal(
    (await authenticate(`Bearer ${await token()}`)).email,
    'buyer@example.com',
  );
  for (const value of [
    undefined,
    'buyer@example.com',
    `Bearer ${await token({ email_verified: false })}`,
    `Bearer ${await token({}, 'wrong')}`,
    `Bearer ${await token({}, 'uscut', '-2m')}`,
    `Bearer ${(await token()).slice(0, -12)}invalid`,
  ])
    await assert.rejects(authenticate(value));
});
