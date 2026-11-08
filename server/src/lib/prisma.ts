import { Prisma, PrismaClient } from '@prisma/client';

/**
 * The Supabase pooler sometimes leaves a query hanging for about 20 seconds before closing the
 * connection. A socket timeout makes such a query fail after a few seconds instead, and plain reads
 * are then retried, up to three attempts in all. Writes are never retried, so nothing happens twice.
 */
const SOCKET_TIMEOUT_SECONDS = 5;
const READ_ATTEMPTS = 3;
const RETRYABLE = new Set(['P1001', 'P1008', 'P1017', 'P2024']);
const READS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);

function withSocketTimeout(url: string | undefined): string | undefined {
  if (!url || url.includes('socket_timeout=')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}socket_timeout=${SOCKET_TIMEOUT_SECONDS}`;
}

const retryable = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE.has(err.code);

// The cast keeps the plain client type, so transaction clients stay Prisma.TransactionClient everywhere.
export const prisma = new PrismaClient({ datasourceUrl: withSocketTimeout(process.env.DATABASE_URL) }).$extends({
  query: {
    async $allOperations({ operation, args, query }) {
      if (!READS.has(operation)) return query(args);
      for (let attempt = 1; ; attempt++) {
        try {
          return await query(args);
        } catch (err) {
          if (!retryable(err) || attempt >= READ_ATTEMPTS) throw err;
        }
      }
    },
  },
}) as unknown as PrismaClient;

// Prisma's interactive defaults (2s to get a connection, 5s to finish) are too tight for the remote database.
export const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };
