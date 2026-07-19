import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export const SESSION_COOKIE_NAME = 'session';
const SESSION_COOKIE_VALUE = 'ok';

/**
 * Constant-time password check (README §5): both sides are hashed to SHA-256 first so
 * `timingSafeEqual` compares equal-length buffers regardless of the submitted string's
 * length (it throws on a length mismatch).
 */
export function verifyPassword(submitted: string, expectedHash: Buffer): boolean {
  const submittedHash = createHash('sha256').update(submitted).digest();
  return submittedHash.length === expectedHash.length && timingSafeEqual(submittedHash, expectedHash);
}

/** True if the request carries a validly signed session cookie. */
export function isAuthenticated(request: FastifyRequest): boolean {
  const raw = request.cookies[SESSION_COOKIE_NAME];
  if (raw === undefined) return false;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value === SESSION_COOKIE_VALUE;
}

export function sessionCookieValue(): string {
  return SESSION_COOKIE_VALUE;
}
