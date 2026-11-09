import { Prisma, PrismaClient } from '@prisma/client';

/**
 * The Supabase pooler sometimes leaves a query hanging for about 20 seconds before closing the
 * connection. A socket timeout makes such a query fail sooner instead, and plain reads are then
 * retried, up to three attempts in all. Writes are never retried, so nothing happens twice.
 * On a slow network, opening a connection can take far longer than Prisma's 5-second default, so
 * the connect and pool timeouts are raised too. Any of these already in the URL are kept.
 */
const URL_DEFAULTS: Record<string, string> = { socket_timeout: '15', connect_timeout: '30', pool_timeout: '40' };
const READ_ATTEMPTS = 3;
const RETRYABLE = new Set(['P1001', 'P1008', 'P1017', 'P2024']);
const READS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);

function withTimeouts(url: string | undefined): string | undefined {
  if (!url) return url;
  const extra = Object.entries(URL_DEFAULTS).filter(([key]) => !url.includes(`${key}=`));
  if (!extra.length) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${extra.map(([key, value]) => `${key}=${value}`).join('&')}`;
}

const retryable = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE.has(err.code);

// The cast keeps the plain client type, so transaction clients stay Prisma.TransactionClient everywhere.
export const prisma = new PrismaClient({ datasourceUrl: withTimeouts(process.env.DATABASE_URL) }).$extends({
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
export const TX_OPTIONS = { maxWait: 40_000, timeout: 20_000 };
