// Dev harness (not part of the build): runs the REAL Express routes on :3000 against the in-memory fake database,
// seeded like prisma/seed.ts plus a second agent and 28 demo tickets in every status, so the dashboard can be
// tried without a database.
//   npx tsx tests/serve-fake.ts        (every seed user has the password ChangeMe123!)
// Route logic only: it is NOT a substitute for `npm test` against a real database.
import bcrypt from 'bcryptjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createFakePrisma, seedFake } from './support/fakePrisma';

process.env.JWT_SECRET ??= 'dev-secret';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
const uploadDir = path.join(os.tmpdir(), 'task-fake-uploads');
process.env.UPLOAD_DIR = uploadDir;
fs.mkdirSync(uploadDir, { recursive: true });
fs.writeFileSync(path.join(uploadDir, 'file-uuid-1'), 'Captura de error: VPN timeout 809\n');

const { prisma, db } = createFakePrisma();
const hash = bcrypt.hashSync('ChangeMe123!', 4);
seedFake(db, hash); // users 1 admin, 2 agent, 3 manager, 4 employee; categories 1 Hardware, 2 Software, 3 Network, ...
db.users.push({ id: 5, email: 'agent2@task.local', fullName: 'Second Agent', role: 'AGENT', passwordHash: hash, isActive: true, failedLoginCount: 0, lockedUntil: null, createdAt: new Date() });
db.seq.users = 5;

const ago = (min: number) => new Date(Date.now() - min * 60000);
let auditId = 0;
const mk = (id: string, title: string, status: string, extra: Record<string, unknown> = {}) => {
  db.tickets.push({
    id, title, description: `Descripción de ${title}. Esto es suficientemente largo.`, status, priority: 'MEDIUM', origin: 'MANUAL',
    categoryId: 1, requesterId: 4, assignedAgentId: null, affectedDevice: 'Laptop', location: 'Oficina', resolutionNotes: null,
    satisfactionRating: null, createdAt: ago(600), assignedAt: null, resolvedAt: null, closedAt: null, ...extra,
  });
  db.auditLogs.push({ id: ++auditId, ticketId: id, actorType: 'HUMAN', actorId: 4, action: 'TICKET_CREATED', oldValue: null, newValue: { status: 'OPEN' }, createdAt: ago(600) });
};
mk('TCK-A001', 'VPN no conecta desde casa', 'OPEN', { priority: 'HIGH' });
mk('TCK-A002', 'Pantalla parpadea sin categoría', 'OPEN', { categoryId: null });
mk('TCK-A003', 'Impresora del piso 2', 'ASSIGNED', { assignedAgentId: 2, assignedAt: ago(300) });
mk('TCK-A004', 'Correo no sincroniza', 'IN_PROGRESS', { assignedAgentId: 5, categoryId: 2 });
mk('TCK-A005', 'Licencia de Office vencida', 'RESOLVED', { assignedAgentId: 2, resolutionNotes: 'Se reactivó la licencia con el administrador de dominio y se reinició Office.', resolvedAt: ago(100) });
mk('TCK-A006', 'Teclado defectuoso', 'CLOSED', { assignedAgentId: 2, resolutionNotes: 'Reemplazo de teclado entregado y firmado por el usuario final.', satisfactionRating: 4, closedAt: ago(50) });
mk('TCK-A007', 'Wifi lento en sala 3', 'REOPENED', { assignedAgentId: 5, categoryId: 3 });
for (let i = 1; i <= 21; i++) mk(`TCK-B${String(i).padStart(3, '0')}`, `Solicitud genérica número ${i}`, 'OPEN', { createdAt: ago(i) });
db.attachments.push({ id: 1, ticketId: 'TCK-A001', fileName: 'vpn-error.txt', mimeType: 'text/plain', sizeBytes: 36, storagePath: 'file-uuid-1', uploadedBy: 4, createdAt: new Date() });
db.seq.auditLogs = auditId;
db.seq.attachments = 1;

// route code does `import { prisma } from '../prisma'`: hand it the fake before the app loads
const prismaModule = require.resolve('../src/prisma');
require.cache[prismaModule] = { id: prismaModule, filename: prismaModule, loaded: true, exports: { prisma } } as never;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('../src/app');
app.get('/__state', (_req: unknown, res: { json: (v: unknown) => void }) =>
  res.json({ audit: db.auditLogs, notifications: db.notifications, articles: db.kbArticles, tickets: db.tickets }));
app.listen(3000, '127.0.0.1', () => console.log('fake backend on 3000'));
