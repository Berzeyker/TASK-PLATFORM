import { Prisma } from '@prisma/client';

type AuditEntry = {
  actorId?: number | null;
  action: string;
  ticketId?: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
};

// Writes one AuditLog row inside the caller's transaction (NFR-12).
// AuditLog.ticketId is optional, so non-ticket events (users, categories, KB, logins) reuse the model:
// put the subject id (userId, categoryId, articleId...) inside oldValue/newValue.
// Never put passwords or tokens in these values.
export const audit = (tx: Prisma.TransactionClient, e: AuditEntry) =>
  tx.auditLog.create({
    data: { actorId: e.actorId ?? null, action: e.action, ticketId: e.ticketId, oldValue: e.oldValue, newValue: e.newValue },
  });
