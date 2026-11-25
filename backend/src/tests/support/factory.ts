import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import type { Category, Priority, Role, TicketStatus, User } from '@prisma/client';
import { prisma } from '../../prisma';
import { config } from '../../config';
import { newTicketId } from '../../utils/ticketId';

export const uniq = () => randomBytes(4).toString('hex');

/** Valid BR-02 notes: well over 20 letters/digits. */
export const GOOD_NOTES = 'Se reinicio el servicio y se valido la conexion con el usuario final';

/** `Authorization` header value for a user. Signing directly keeps these tests off the login rate limiter. */
export const auth = (u: Pick<User, 'id' | 'role'>) =>
  `Bearer ${jwt.sign({ role: u.role }, config.jwtSecret, { subject: String(u.id), expiresIn: '15m' })}`;

export type Actors = {
  employee: User; employee2: User; agent: User; agent2: User; inactiveAgent: User; manager: User; admin: User;
  hardware: Category; software: Category; retired: Category;
};

async function ensureUser(email: string, fullName: string, role: Role, isActive = true): Promise<User> {
  return (
    (await prisma.user.findUnique({ where: { email } })) ??
    prisma.user.create({ data: { email, fullName, role, isActive, passwordHash: 'not-a-real-hash' } })
  );
}

async function ensureCategory(name: string, isActive = true): Promise<Category> {
  return (await prisma.category.findUnique({ where: { name } })) ?? prisma.category.create({ data: { name, isActive } });
}

/** The seeded users/categories plus the extra actors these tests need (second employee/agent, inactive ones). */
export async function loadActors(): Promise<Actors> {
  const seeded = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) throw new Error(`Seed user ${email} is missing: was the seed run?`);
    return u;
  };
  return {
    employee: await seeded('employee@task.local'),
    agent: await seeded('agent@task.local'),
    manager: await seeded('manager@task.local'),
    admin: await seeded('admin@task.local'),
    employee2: await ensureUser('employee2@task.test', 'Second Employee', 'EMPLOYEE'),
    agent2: await ensureUser('agent2@task.test', 'Second Agent', 'AGENT'),
    inactiveAgent: await ensureUser('inactive-agent@task.test', 'Inactive Agent', 'AGENT', false),
    hardware: await ensureCategory('Hardware'),
    software: await ensureCategory('Software'),
    retired: await ensureCategory('Retired category', false),
  };
}

type TicketSeed = Partial<{
  status: TicketStatus; priority: Priority; categoryId: number | null; requesterId: number; assignedAgentId: number | null;
  resolutionNotes: string | null; title: string;
}>;

/** Inserts a ticket straight into the database, in any state (the API cannot create tickets in mid-workflow states). */
export async function makeTicket(a: Actors, o: TicketSeed = {}) {
  return prisma.ticket.create({
    data: {
      id: newTicketId(),
      title: o.title ?? `Ticket de prueba ${uniq()}`,
      description: 'Descripcion suficientemente larga para la prueba.',
      status: o.status ?? 'OPEN',
      priority: o.priority ?? 'MEDIUM',
      categoryId: o.categoryId === undefined ? a.hardware.id : o.categoryId,
      requesterId: o.requesterId ?? a.employee.id,
      assignedAgentId: o.assignedAgentId ?? null,
      resolutionNotes: o.resolutionNotes ?? null,
    },
  });
}

export const getTicket = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });
export const auditFor = (ticketId: string) => prisma.auditLog.findMany({ where: { ticketId }, orderBy: { id: 'asc' } });
export const notificationsFor = (ticketId: string) => prisma.notification.findMany({ where: { ticketId }, orderBy: { id: 'asc' } });
