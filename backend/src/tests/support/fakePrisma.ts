/* eslint-disable @typescript-eslint/no-explicit-any */
// Minimal in-memory stand-in for the parts of PrismaClient the routes use. It lets the suite (and the
// serve-fake dev harness) run with no database. It checks route logic, NOT Postgres behaviour:
// constraints, transactions and serialization are only exercised by `npm test` against a real database.

export type Row = Record<string, any>;
export type FakeDb = {
  users: Row[]; categories: Row[]; tickets: Row[]; attachments: Row[];
  auditLogs: Row[]; notifications: Row[]; kbArticles: Row[]; seq: Record<string, number>;
};

export const emptyDb = (): FakeDb => ({
  users: [], categories: [], tickets: [], attachments: [], auditLogs: [], notifications: [], kbArticles: [], seq: {},
});

const isPlainObject = (v: unknown): v is Row => !!v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (isPlainObject(cond)) {
      if ('in' in cond) return cond.in.includes(row[key]);
      if ('not' in cond) return row[key] !== cond.not;
      if ('gte' in cond && !(row[key] >= cond.gte)) return false;
      if ('lte' in cond && !(row[key] <= cond.lte)) return false;
      if ('gt' in cond && !(row[key] > cond.gt)) return false;
      if ('lt' in cond && !(row[key] < cond.lt)) return false;
      return true;
    }
    return row[key] === cond;
  });
}

const pick = (row: Row | null | undefined, select?: Row) =>
  !row ? null : !select ? { ...row } : Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));

function sortRows(rows: Row[], orderBy?: Row | Row[]): Row[] {
  const first = Array.isArray(orderBy) ? orderBy[0] : orderBy;
  if (!first) return rows;
  const [field, dir] = Object.entries(first)[0] as [string, 'asc' | 'desc'];
  return [...rows].sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
}

export function createFakePrisma(db: FakeDb = emptyDb()) {
  const nextId = (name: string) => (db.seq[name] = (db.seq[name] ?? 0) + 1);

  const applyUpdate = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      row[k] = isPlainObject(v) && 'increment' in v ? (row[k] ?? 0) + v.increment : v;
    }
  };

  // include/select handlers per model (only what the routes ask for)
  const hydrate: Record<string, (row: Row, include: Row) => Row> = {
    tickets: (t, inc) => {
      const o: Row = { ...t };
      const user = (id: number | null, s?: Row) => (id == null ? null : pick(db.users.find((u) => u.id === id), s));
      if (inc.category) o.category = t.categoryId == null ? null : pick(db.categories.find((c) => c.id === t.categoryId), inc.category.select);
      if (inc.requester) o.requester = user(t.requesterId, inc.requester.select);
      if (inc.assignedAgent) o.assignedAgent = user(t.assignedAgentId, inc.assignedAgent.select);
      if (inc.attachments) o.attachments = db.attachments.filter((a) => a.ticketId === t.id);
      if (inc.auditLogs) o.auditLogs = sortRows(db.auditLogs.filter((a) => a.ticketId === t.id), inc.auditLogs.orderBy);
      return o;
    },
    attachments: (a, inc) => {
      const o: Row = { ...a };
      if (inc.ticket) o.ticket = pick(db.tickets.find((t) => t.id === a.ticketId), inc.ticket.select);
      return o;
    },
  };

  function model(name: keyof FakeDb, defaults: () => Row) {
    const rows = () => db[name] as Row[];
    const out = (row: Row | undefined | null, args: Row) => {
      if (!row) return null;
      const withRelations = args.include && hydrate[name as string] ? hydrate[name as string](row, args.include) : row;
      return pick(withRelations, args.select);
    };
    return {
      create: async ({ data, ...args }: Row) => {
        const row: Row = { ...defaults() };
        for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v;
        if (row.id === undefined) row.id = nextId(name);
        rows().push(row);
        return out(row, args);
      },
      findUnique: async ({ where, ...args }: Row) => out(rows().find((r) => matches(r, where)), args),
      findUniqueOrThrow: async ({ where, ...args }: Row) => {
        const found = out(rows().find((r) => matches(r, where)), args);
        if (!found) throw new Error(`fake prisma: ${String(name)} not found`);
        return found;
      },
      findFirst: async ({ where, ...args }: Row = {}) => out(rows().find((r) => matches(r, where)), args),
      findMany: async ({ where, orderBy, skip = 0, take, ...args }: Row = {}) => {
        const found = sortRows(rows().filter((r) => matches(r, where)), orderBy);
        return found.slice(skip, take === undefined ? undefined : skip + take).map((r) => out(r, args));
      },
      count: async ({ where }: Row = {}) => rows().filter((r) => matches(r, where)).length,
      update: async ({ where, data, ...args }: Row) => {
        const row = rows().find((r) => matches(r, where));
        if (!row) throw new Error(`fake prisma: ${String(name)} not found`);
        applyUpdate(row, data);
        return out(row, args);
      },
      deleteMany: async ({ where }: Row = {}) => {
        const keep = rows().filter((r) => !matches(r, where));
        const removed = rows().length - keep.length;
        (db[name] as Row[]).splice(0, rows().length, ...keep);
        return { count: removed };
      },
    };
  }

  const now = () => new Date();
  const prisma: Row = {
    user: model('users', () => ({ isActive: true, failedLoginCount: 0, lockedUntil: null, createdAt: now() })),
    category: model('categories', () => ({ isActive: true })),
    ticket: model('tickets', () => ({
      status: 'OPEN', priority: 'MEDIUM', origin: 'MANUAL', categoryId: null, assignedAgentId: null, affectedDevice: null,
      location: null, resolutionNotes: null, satisfactionRating: null, createdAt: now(), assignedAt: null, resolvedAt: null, closedAt: null,
    })),
    attachment: model('attachments', () => ({ createdAt: now() })),
    auditLog: model('auditLogs', () => ({ actorType: 'HUMAN', actorId: null, ticketId: null, oldValue: null, newValue: null, createdAt: now() })),
    notification: model('notifications', () => ({ isRead: false, channel: 'in_app', ticketId: null, createdAt: now() })),
    kbArticle: model('kbArticles', () => ({ status: 'DRAFT', version: 1, createdAt: now() })),
  };
  // routes only use the callback form of $transaction
  prisma.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg));
  return { prisma, db };
}

/** Same data as prisma/seed.ts. `passwordHash` is a placeholder unless a real bcrypt hash is passed. */
export function seedFake(db: FakeDb, passwordHash = 'x'): void {
  const users: [string, string, string][] = [
    ['admin@task.local', 'Admin User', 'ADMIN'], ['agent@task.local', 'Agent User', 'AGENT'],
    ['manager@task.local', 'Manager User', 'MANAGER'], ['employee@task.local', 'Employee User', 'EMPLOYEE'],
  ];
  for (const [email, fullName, role] of users) {
    db.users.push({ id: (db.seq.users = (db.seq.users ?? 0) + 1), email, fullName, role, passwordHash, isActive: true, failedLoginCount: 0, lockedUntil: null, createdAt: new Date() });
  }
  for (const name of ['Hardware', 'Software', 'Network', 'Account & Access', 'Email', 'Other']) {
    db.categories.push({ id: (db.seq.categories = (db.seq.categories ?? 0) + 1), name, isActive: true });
  }
}
