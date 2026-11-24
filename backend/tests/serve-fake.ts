// Dev harness (not part of the build): runs the REAL Express routes on :3000 against an in-memory fake of Prisma,
// seeded with 5 users and 28 tickets in every status, so the dashboard can be tried without a database.
//   npx tsx tests/serve-fake.ts        (all seed users use the password ChangeMe123!)
// It stubs src/prisma, so it exercises route logic only: it is NOT a substitute for tests against a real database.
import bcrypt from 'bcryptjs'
import fs from 'fs'
import os from 'os'
import path from 'path'
process.env.JWT_SECRET ??= 'dev-secret'
process.env.CORS_ORIGIN ??= 'http://localhost:5173'
const uploadDir = path.join(os.tmpdir(), 'task-fake-uploads')
process.env.UPLOAD_DIR = uploadDir
fs.mkdirSync(uploadDir, { recursive: true })
fs.writeFileSync(path.join(uploadDir, 'file-uuid-1'), 'Captura de error: VPN timeout 809\n')

const hash = bcrypt.hashSync('ChangeMe123!', 4)
const u = (id: number, email: string, fullName: string, role: string) => ({ id, email, fullName, role, isActive: true, passwordHash: hash, failedLoginCount: 0, lockedUntil: null })
const ago = (min: number) => new Date(Date.now() - min * 60000)
const db: any = {
  users: [u(1, 'admin@task.local', 'Admin User', 'ADMIN'), u(2, 'agent@task.local', 'Agent User', 'AGENT'), u(3, 'manager@task.local', 'Manager User', 'MANAGER'),
          u(4, 'employee@task.local', 'Employee User', 'EMPLOYEE'), u(5, 'agent2@task.local', 'Second Agent', 'AGENT')],
  categories: [{ id: 1, name: 'Hardware', isActive: true }, { id: 2, name: 'Software', isActive: true }, { id: 3, name: 'Network', isActive: true }],
  tickets: [] as any[], audit: [] as any[], notifications: [] as any[], articles: [] as any[],
  attachments: [{ id: 1, ticketId: 'TCK-A001', fileName: 'vpn-error.txt', mimeType: 'text/plain', sizeBytes: 36, storagePath: 'file-uuid-1' }],
}
let auditId = 1
const mk = (id: string, title: string, status: string, extra: any = {}) => {
  const t = { id, title, description: `Descripción de ${title}. Esto es suficientemente largo.`, status, priority: 'MEDIUM', origin: 'MANUAL', categoryId: 1, requesterId: 4,
    assignedAgentId: null, affectedDevice: 'Laptop', location: 'Oficina', resolutionNotes: null, satisfactionRating: null, createdAt: ago(600), assignedAt: null, resolvedAt: null, closedAt: null, ...extra }
  db.tickets.push(t); db.audit.push({ id: auditId++, ticketId: id, actorType: 'HUMAN', actorId: 4, action: 'TICKET_CREATED', oldValue: null, newValue: { status: 'OPEN' }, createdAt: ago(600) })
  return t
}
mk('TCK-A001', 'VPN no conecta desde casa', 'OPEN', { priority: 'HIGH' })
mk('TCK-A002', 'Pantalla parpadea sin categoría', 'OPEN', { categoryId: null })
mk('TCK-A003', 'Impresora del piso 2', 'ASSIGNED', { assignedAgentId: 2, assignedAt: ago(300) })
mk('TCK-A004', 'Correo no sincroniza', 'IN_PROGRESS', { assignedAgentId: 5, categoryId: 2 })
mk('TCK-A005', 'Licencia de Office vencida', 'RESOLVED', { assignedAgentId: 2, resolutionNotes: 'Se reactivó la licencia con el administrador de dominio y se reinició Office.', resolvedAt: ago(100) })
mk('TCK-A006', 'Teclado defectuoso', 'CLOSED', { assignedAgentId: 2, resolutionNotes: 'Reemplazo de teclado entregado y firmado por el usuario final.', satisfactionRating: 4, closedAt: ago(50) })
mk('TCK-A007', 'Wifi lento en sala 3', 'REOPENED', { assignedAgentId: 5, categoryId: 3 })
for (let i = 1; i <= 21; i++) mk(`TCK-B${String(i).padStart(3, '0')}`, `Solicitud genérica número ${i}`, 'OPEN', { createdAt: ago(i) })

const sel = (r: any, s?: any) => !r ? null : !s ? { ...r } : Object.fromEntries(Object.keys(s).map((k) => [k, r[k]]))
const match = (r: any, w: any = {}) => Object.entries(w).every(([k, v]: any) => v === undefined ? true :
  v && typeof v === 'object' && 'not' in v ? r[k] !== v.not : v && typeof v === 'object' && 'in' in v ? v.in.includes(r[k]) : r[k] === v)
const person = (id: number | null, s: any) => id == null ? null : sel(db.users.find((x: any) => x.id === id), s)
const hydrate = (t: any, inc: any = {}) => {
  const o: any = { ...t }
  if (inc.category) o.category = t.categoryId ? sel(db.categories.find((c: any) => c.id === t.categoryId), inc.category.select) : null
  if (inc.requester) o.requester = person(t.requesterId, inc.requester.select)
  if (inc.assignedAgent) o.assignedAgent = person(t.assignedAgentId, inc.assignedAgent.select)
  if (inc.attachments) o.attachments = db.attachments.filter((a: any) => a.ticketId === t.id)
  if (inc.auditLogs) o.auditLogs = db.audit.filter((a: any) => a.ticketId === t.id).sort((a: any, b: any) => +a.createdAt - +b.createdAt)
  return o
}
const fake: any = {
  $transaction: async (fn: any) => fn(fake),
  user: {
    findUnique: async ({ where, select }: any) => sel(db.users.find((x: any) => match(x, where)), select),
    findFirst: async ({ where }: any) => sel(db.users.find((x: any) => match(x, where))),
    findMany: async ({ where, select }: any) => db.users.filter((x: any) => match(x, where)).map((x: any) => sel(x, select)),
    count: async ({ where }: any) => db.users.filter((x: any) => match(x, where)).length,
    create: async ({ data }: any) => { const x = { id: db.users.length + 1, isActive: true, failedLoginCount: 0, lockedUntil: null, ...data }; db.users.push(x); return x },
    update: async ({ where, data, select }: any) => { const x = db.users.find((y: any) => y.id === where.id); for (const [k, v] of Object.entries(data)) if (v !== undefined) x[k] = v; return sel(x, select) },
  },
  category: {
    findUnique: async ({ where }: any) => sel(db.categories.find((c: any) => match(c, where))),
    findFirst: async ({ where }: any) => sel(db.categories.find((c: any) => match(c, where))),
    findMany: async ({ where }: any) => db.categories.filter((c: any) => match(c, where)),
    create: async ({ data }: any) => { const c = { id: db.categories.length + 1, isActive: true, ...data }; db.categories.push(c); return c },
    update: async ({ where, data }: any) => { const c = db.categories.find((x: any) => x.id === where.id); Object.assign(c, data); return { ...c } },
  },
  ticket: {
    findMany: async ({ where, include, skip = 0, take = 20 }: any) =>
      db.tickets.filter((t: any) => match(t, where)).sort((a: any, b: any) => +b.createdAt - +a.createdAt).slice(skip, skip + take).map((t: any) => hydrate(t, include)),
    count: async ({ where }: any) => db.tickets.filter((t: any) => match(t, where)).length,
    findUnique: async ({ where, include }: any) => { const t = db.tickets.find((x: any) => x.id === where.id); return t ? hydrate(t, include) : null },
    update: async ({ where, data }: any) => { const t = db.tickets.find((x: any) => x.id === where.id); Object.assign(t, data); return { ...t } },
  },
  attachment: {
    findUnique: async ({ where }: any) => {
      const a = db.attachments.find((x: any) => x.id === where.id)
      if (!a) return null
      return { ...a, ticket: { requesterId: db.tickets.find((t: any) => t.id === a.ticketId).requesterId } }
    },
  },
  auditLog: { create: async ({ data }: any) => { const r = { id: auditId++, actorType: 'HUMAN', createdAt: new Date(), oldValue: null, newValue: null, ...data }; db.audit.push(r); return r } },
  notification: { create: async ({ data }: any) => { db.notifications.push(data); return data } },
  kbArticle: {
    findFirst: async ({ where }: any) => db.articles.find((a: any) => match(a, where)) ?? null,
    create: async ({ data }: any) => { const a = { id: db.articles.length + 1, ...data }; db.articles.push(a); return a },
  },
}
const p = require.resolve('../src/prisma')
require.cache[p] = { id: p, filename: p, loaded: true, exports: { prisma: fake } } as any
const { app } = require('../src/app')
app.get('/__state', (_q: any, r: any) => r.json({ audit: db.audit, notifications: db.notifications, articles: db.articles, tickets: db.tickets }))
app.listen(3000, '127.0.0.1', () => console.log('fake backend on 3000'))
