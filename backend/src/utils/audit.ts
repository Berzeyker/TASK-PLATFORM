import { ActorType, Prisma } from '@prisma/client';

/**
 * Every audit action in one place, so a typo cannot create a new, unqueryable event name (NFR-12).
 * AuditLog.ticketId is optional: ticket events set it, everything else (KB, logins, admin changes) leaves it null
 * and puts the subject id (articleId, userId, categoryId...) inside oldValue/newValue.
 * The frontend timeline (features/queue/TicketTimeline.tsx) renders the ticket actions by these exact strings.
 */
export const AuditAction = {
  // ticket (ticketId set)
  TICKET_CREATED: 'TICKET_CREATED',
  TICKET_UPDATED: 'TICKET_UPDATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  TICKET_RATED: 'TICKET_RATED',
  CONVERTED_TO_KB: 'CONVERTED_TO_KB',
  // knowledge base (articleId in the values)
  KB_ARTICLE_CREATED: 'KB_ARTICLE_CREATED',
  KB_ARTICLE_UPDATED: 'KB_ARTICLE_UPDATED',
  KB_STATUS_CHANGED: 'KB_STATUS_CHANGED',
  // authentication (the attempted email is stored, never a password)
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  // administration
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_UPDATED: 'CATEGORY_UPDATED',
} as const;
export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction];

type AuditEntry = {
  action: AuditActionName;
  /** The person who did it. Null when nobody is signed in (failed login) or the system acted by itself. */
  actorId?: number | null;
  /** HUMAN (default): a person. SYSTEM: an automatic reaction, e.g. an account lockout. AI: the AI gateway (B-06). */
  actorType?: ActorType;
  ticketId?: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
};

/**
 * Writes one AuditLog row. Call it INSIDE the transaction that makes the change, so the change and its record
 * succeed or fail together: `await audit(tx, {...})`. Accepts the transaction client or the plain Prisma client.
 * Never put passwords, hashes or tokens in oldValue/newValue.
 */
export const audit = (db: Pick<Prisma.TransactionClient, 'auditLog'>, e: AuditEntry) =>
  db.auditLog.create({
    data: {
      action: e.action,
      actorId: e.actorId ?? null,
      actorType: e.actorType ?? 'HUMAN',
      ticketId: e.ticketId,
      oldValue: e.oldValue,
      newValue: e.newValue,
    },
  });
