import type { FastifyInstance } from 'fastify';
import type { RestoreSummary } from '@suivi/shared';
import type { Queries } from '../db/index.ts';
import { BackupValidationError, buildBackupDump, restoreBackupDump, validateBackupDump } from '../backup.ts';

type ErrorReply = { error: string; message?: string };

export function registerBackupRoutes(fastify: FastifyInstance, queries: Queries): void {
  fastify.get('/api/backup', async (_request, reply) => {
    const dump = buildBackupDump(queries);
    const filename = `suivi-anime-${new Date().toISOString().slice(0, 10)}.json`;
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.type('application/json');
    return dump;
  });

  fastify.post<{ Reply: RestoreSummary | ErrorReply }>('/api/backup/restore', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: 'missing_file' });
    }

    const raw = (await file.toBuffer()).toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply.code(400).send({ error: 'invalid_json' });
    }

    let dump;
    try {
      dump = validateBackupDump(parsed);
    } catch (err) {
      if (err instanceof BackupValidationError) {
        return reply.code(400).send({ error: 'invalid_backup', message: err.message });
      }
      throw err;
    }

    try {
      const restored = restoreBackupDump(queries, dump);
      return { restored };
    } catch (err) {
      request.log.error({ err }, 'backup restore failed, transaction rolled back');
      return reply.code(400).send({ error: 'restore_failed' });
    }
  });
}
