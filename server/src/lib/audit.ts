import { prisma } from './prisma.js';

export interface AuditEntry {
  action: string;
  actorId: string | null;
  targetType?: string;
  targetId?: string | null;
  reason?: string;
}

/** Append-only audit trail; kept even when the target is deleted (FR04). */
export async function audit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      reason: entry.reason ?? null,
    },
  });
}
