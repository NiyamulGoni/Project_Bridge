import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

export interface AuditEntry {
  action: string;
  actorId: string | null;
  targetType?: string;
  targetId?: string | null;
  reason?: string;
  oldValue?: string;
  newValue?: string;
}

/**
 * Append-only audit trail; kept even when the target is deleted (FR04). Pass the transaction client
 * to commit the row with the change it records.
 */
export async function audit(entry: AuditEntry, client: Prisma.TransactionClient = prisma): Promise<void> {
  await client.auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      reason: entry.reason ?? null,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
    },
  });
}
