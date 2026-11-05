import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Prisma's interactive defaults (2s to get a connection, 5s to finish) are too tight for the remote database.
export const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };
