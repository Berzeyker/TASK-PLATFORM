import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'

const { db, fake } = vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  const db = { users: [] as any[], categories: [] as any[], audit: [] as any[] }

  const pick = (row: any, select?: any) => !row ? null : !select ? { ...row } : Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]))
  const match = (row: any, where: any) => Object.entries(where).every(([k, v]: any) =>
    v && typeof v === 'object' && 'not' in v ? row[k] !== v.not : row[k] === v)
  const fake: any = {
    $transaction: async (fn: any) => fn(fake),
    user: {
      findUnique: async ({ where, select }: any) => pick(db.users.find((u) => match(u, where)), select),
      findMany: async () => db.users.map((u) => pick(u)),
      count: async ({ where }: any) => db.users.filter((u) => match(u, where)).length,
      create: async ({ data }: any) => { const u = { id: db.users.length + 100, isActive: true, failedLoginCount: 0, lockedUntil: null, ...data }; db.users.push(u); return u },
      update: async ({ where, data, select }: any) => {
        const u = db.users.find((x) => x.id === where.id)
        for (const [k, v] of Object.entries(data)) if (v !== undefined) u[k] = v
        return pick(u, select)
      },
    },
    category: {
      findUnique: async ({ where }: any) => pick(db.categories.find((c) => match(c, where))),
      findMany: async ({ where }: any) => db.categories.filter((c) => match(c, where)),
      create: async ({ data }: any) => { const c = { id: db.categories.length + 1, isActive: true, ...data }; db.categories.push(c); return c },
      update: async ({ where, data }: any) => { const c = db.categories.find((x) => x.id === where.id); Object.assign(c, data); return { ...c } },
    },
    auditLog: { create: async ({ data }: any) => { db.audit.push(data); return data } },
  }
  return { db, fake }
})

vi.mock('../src/prisma', () => ({ prisma: fake }))

import { app } from '../src/app'

const tok = (id: number, role: string) => 'Bearer ' + jwt.sign({ role }, 'test-secret', { subject: String(id) })
const A1 = tok(1, 'ADMIN'), MGR = tok(3, 'MANAGER'), EMP = tok(4, 'EMPLOYEE')
const row = (id: number, role: string, extra = {}) => ({ id, email: `u${id}@t.l`, fullName: `User ${id}`, role, isActive: true, passwordHash: 'h', ...extra })

beforeEach(() => {
  db.users = [row(1, 'ADMIN'), row(2, 'AGENT'), row(3, 'MANAGER'), row(4, 'EMPLOYEE')]
  db.categories = [{ id: 1, name: 'Hardware', isActive: true }, { id: 2, name: 'Old', isActive: false }]
  db.audit = []
})

describe('PUT /admin/users/:id', () => {
  const put = (id: number, body: object, auth = A1) => request(app).put(`/api/v1/admin/users/${id}`).set('Authorization', auth).send(body)

  it('rbac: manager and employee get 403, no token 401', async () => {
    expect((await put(2, { fullName: 'X Y' }, MGR)).status).toBe(403)
    expect((await put(2, { fullName: 'X Y' }, EMP)).status).toBe(403)
    expect((await request(app).put('/api/v1/admin/users/2').send({ fullName: 'X Y' })).status).toBe(401)
  })
  it('updates name/role/active, never returns passwordHash, writes audit', async () => {
    const r = await put(2, { fullName: 'New Name', role: 'MANAGER', isActive: false })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ id: 2, email: 'u2@t.l', fullName: 'New Name', role: 'MANAGER', isActive: false })
    expect(db.audit).toHaveLength(1)
    expect(db.audit[0]).toMatchObject({ actorId: 1, action: 'USER_UPDATED', oldValue: { userId: 2, role: 'AGENT' }, newValue: { userId: 2, role: 'MANAGER', isActive: false } })
  })
  it('password reset clears lockout, hashes it, never logs the password', async () => {
    db.users[1].failedLoginCount = 5; db.users[1].lockedUntil = new Date(Date.now() + 1e6)
    const r = await put(2, { password: 'a-very-long-pass' })
    expect(r.status).toBe(200)
    expect(db.users[1].passwordHash).not.toBe('h'); expect(db.users[1].passwordHash).not.toContain('a-very-long-pass')
    expect(db.users[1]).toMatchObject({ failedLoginCount: 0, lockedUntil: null })
    expect(JSON.stringify(db.audit)).not.toContain('a-very-long-pass')
    expect(db.audit[0].newValue.passwordReset).toBe(true)
  })
  it('validation: empty body, short password, unknown field, bad role, bad id', async () => {
    expect((await put(2, {})).status).toBe(400)
    expect((await put(2, { password: 'short' })).status).toBe(400)
    expect((await put(2, { email: 'x@y.z' })).status).toBe(400)
    expect((await put(2, { role: 'ROOT' })).status).toBe(400)
    expect((await put(0 as number, { fullName: 'Abc' })).status).toBe(400)
  })
  it('404 for unknown user', async () => { expect((await put(999, { fullName: 'Abc' })).status).toBe(404) })
  it('cannot deactivate self or change own role', async () => {
    db.users.push(row(5, 'ADMIN'))
    expect((await put(1, { isActive: false })).status).toBe(409)
    expect((await put(1, { role: 'AGENT' })).status).toBe(409)
    expect((await put(1, { fullName: 'Renamed Me' })).status).toBe(200) // own name is fine
  })
  it('cannot remove the last active admin', async () => {
    const A9 = tok(9, 'ADMIN')
    db.users.push(row(9, 'ADMIN'))
    expect((await put(1, { isActive: false }, A9)).status).toBe(200)       // 9 remains
    const r = await put(9, { role: 'AGENT' }, tok(1, 'ADMIN'))               // 1 is now inactive -> 9 is last
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/administrator/)
    expect((await put(1, { isActive: true }, A9)).status).toBe(200)
    expect((await put(9, { role: 'AGENT' }, A1)).status).toBe(200)          // 1 active again -> allowed
  })
  it('inactive admin being demoted does not trip the guard', async () => {
    db.users.push(row(7, 'ADMIN', { isActive: false }))
    expect((await put(7, { role: 'AGENT' })).status).toBe(200)
  })
})

describe('categories', () => {
  const get = (q = '', auth = A1) => request(app).get('/api/v1/categories' + q).set('Authorization', auth)
  it('GET hides inactive by default; includeInactive is admin only', async () => {
    expect((await get()).body.map((c: any) => c.name)).toEqual(['Hardware'])
    expect((await get('?includeInactive=true')).body).toHaveLength(2)
    expect((await get('?includeInactive=true', MGR)).status).toBe(403)
    expect((await get('', MGR)).status).toBe(200)
  })
  it('PUT rename / deactivate / reactivate with audit', async () => {
    const put = (id: number, b: object, a = A1) => request(app).put(`/api/v1/categories/${id}`).set('Authorization', a).send(b)
    expect((await put(1, { name: 'Hardware & Devices' })).body.name).toBe('Hardware & Devices')
    expect((await put(1, { isActive: false })).body.isActive).toBe(false)
    expect((await put(2, { isActive: true })).body.isActive).toBe(true)
    expect(db.audit.map((a) => a.action)).toEqual(['CATEGORY_UPDATED', 'CATEGORY_UPDATED', 'CATEGORY_UPDATED'])
    expect((await put(1, { name: 'Old' })).status).toBe(409)
    expect((await put(1, {})).status).toBe(400)
    expect((await put(99, { name: 'Nope' })).status).toBe(404)
    expect((await put(1, { name: 'Zzz' }, MGR)).status).toBe(403)
  })
  it('POST rejects duplicates with 409 instead of 500', async () => {
    const post = (name: string) => request(app).post('/api/v1/categories').set('Authorization', A1).send({ name })
    expect((await post('Network')).status).toBe(201)
    expect((await post('Network')).status).toBe(409)
  })
})

describe('POST /admin/users audit', () => {
  it('logs USER_CREATED without the password', async () => {
    const r = await request(app).post('/api/v1/admin/users').set('Authorization', A1).send({ email: 'new@task.local', fullName: 'New One', role: 'AGENT', password: 'supersecret12' })
    expect(r.status).toBe(201)
    expect(db.audit[0]).toMatchObject({ action: 'USER_CREATED', newValue: { email: 'new@task.local', role: 'AGENT' } })
    expect(JSON.stringify(db.audit)).not.toContain('supersecret12')
  })
})
