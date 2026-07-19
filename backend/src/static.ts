import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/**
 * Default static root: `<repo>/frontend/dist`, computed relative to this file so it
 * resolves correctly whether running from `backend/src` (ts-directly, dev) or
 * `backend/dist` (compiled) — both sit two levels under the repo root, same as the
 * Docker image layout (README §10) will.
 */
export function defaultStaticRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
}

/**
 * Serves the built SPA from `root` and installs the SPA fallback: any unmatched route
 * outside `/api` gets `index.html` (client-side routing); unmatched `/api/*` routes get
 * a plain 404 JSON body instead (README §9).
 */
export async function registerStatic(fastify: FastifyInstance, root: string): Promise<void> {
  await fastify.register(fastifyStatic, { root, wildcard: false });

  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });
}
