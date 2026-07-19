import type { FastifyInstance } from 'fastify';
import type { AuthStatusResponse, LoginRequest } from '@suivi/shared';
import type { Config } from '../config.ts';
import { SESSION_COOKIE_NAME, isAuthenticated, sessionCookieValue, verifyPassword } from '../auth.ts';

/** Login and status: public per README §5, registered in the app's unprotected root scope. */
export function registerPublicAuthRoutes(fastify: FastifyInstance, config: Config): void {
  fastify.post<{ Body: LoginRequest }>(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const password = request.body?.password;
      if (typeof password !== 'string' || !verifyPassword(password, config.appPasswordHash)) {
        return reply.code(401).send();
      }
      reply.setCookie(SESSION_COOKIE_NAME, sessionCookieValue(), {
        httpOnly: true,
        sameSite: 'lax',
        signed: true,
        secure: config.behindHttps,
        path: '/',
      });
      return reply.code(204).send();
    },
  );

  fastify.get<{ Reply: AuthStatusResponse }>(
    '/api/auth/status',
    async (request): Promise<AuthStatusResponse> => ({ authenticated: isAuthenticated(request) }),
  );
}

/** Logout: per README §5 it is *not* one of the public exceptions — register it inside
 * the app's protected scope so it requires a valid session like every other /api route. */
export function registerProtectedAuthRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });
}
