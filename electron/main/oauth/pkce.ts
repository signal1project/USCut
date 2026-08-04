import { createHash, randomBytes } from 'node:crypto';

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** RFC 7636 code_verifier: 43–128 chars of unreserved characters. */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** S256 code_challenge derived from a verifier. */
export function challengeFromVerifier(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** Opaque anti-CSRF state value. */
export function generateState(): string {
  return base64url(randomBytes(16));
}
