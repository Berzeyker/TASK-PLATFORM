// B-02: file upload and download security (FR-02, NFR-02): content is verified, not just the declared type;
// size and count limits hold; nothing bad is ever left on disk; authorization happens before any write.
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../app';
import { config } from '../config';
import { prisma } from '../prisma';
import { type Actors, auditFor, auth, loadActors, makeTicket } from './support/factory';

let a: Actors;
beforeAll(async () => {
  a = await loadActors();
});

const files = () => (fs.existsSync(config.uploadDir) ? fs.readdirSync(config.uploadDir).sort() : []);
const attachmentCount = (ticketId: string) => prisma.attachment.count({ where: { ticketId } });
type Part = { name?: string; content: Buffer; filename: string; contentType: string };

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
// The spec's limit (section 11.4), written out here on purpose: reading it from config would let a config change pass unnoticed
const TEN_MIB = 10 * 1024 * 1024;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

function upload(ticketId: string, parts: Part[], who: Parameters<typeof auth>[0] | null = a.employee) {
  let r = request(app).post(`/api/v1/tickets/${ticketId}/attachments`);
  if (who) r = r.set('Authorization', auth(who));
  for (const p of parts) r = r.attach(p.name ?? 'files', p.content, { filename: p.filename, contentType: p.contentType });
  return r;
}

describe('accepted files', () => {
  it.each([
    ['pdf', PDF, 'report.pdf', 'application/pdf'],
    ['png', PNG, 'screenshot.png', 'image/png'],
    ['jpeg', JPEG, 'photo.jpg', 'image/jpeg'],
    ['jpeg (.jpeg extension)', JPEG, 'photo.jpeg', 'image/jpeg'],
    ['plain text', Buffer.from('error log line 1\nerror log line 2\n'), 'log.txt', 'text/plain'],
    ['upper-case extension', PDF, 'REPORT.PDF', 'application/pdf'],
  ])('%s', async (_name, content, filename, contentType) => {
    const t = await makeTicket(a);
    const before = files();
    const res = await upload(t.id, [{ content, filename, contentType }]);
    expect(res.status).toBe(201);
    expect(res.body[0]).toMatchObject({ fileName: filename, mimeType: contentType, sizeBytes: content.length });
    // exactly one new file, stored under a random name with no extension, never the client's filename
    const added = files().filter((f) => !before.includes(f));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect((await auditFor(t.id)).map((l) => l.action)).toContain('ATTACHMENT_ADDED');
  });
});

describe('rejected files (400) leave nothing behind', () => {
  const bad: [string, Part[]][] = [
    ['a fake PDF: text named .pdf and declared application/pdf', [{ content: Buffer.from('this is not a pdf at all'), filename: 'invoice.pdf', contentType: 'application/pdf' }]],
    ['a fake PNG (really a JPEG)', [{ content: JPEG, filename: 'pic.png', contentType: 'image/png' }]],
    ['a fake JPEG (really a PDF)', [{ content: PDF, filename: 'pic.jpg', contentType: 'image/jpeg' }]],
    ['a "text" file containing NUL bytes (binary)', [{ content: Buffer.from([0x68, 0x69, 0x00, 0x00, 0xff]), filename: 'notes.txt', contentType: 'text/plain' }]],
    ['a declared type that does not match the extension', [{ content: PNG, filename: 'pic.png', contentType: 'application/pdf' }]],
    ['an executable', [{ content: Buffer.from('MZ\x90\x00'), filename: 'setup.exe', contentType: 'application/octet-stream' }]],
    ['an executable disguised by a double extension', [{ content: PDF, filename: 'report.pdf.exe', contentType: 'application/pdf' }]],
    ['HTML (stored XSS vector)', [{ content: Buffer.from('<script>alert(1)</script>'), filename: 'x.html', contentType: 'text/html' }]],
    ['an SVG (scriptable image)', [{ content: Buffer.from('<svg onload="alert(1)"/>'), filename: 'x.svg', contentType: 'image/svg+xml' }]],
    ['a file with no extension', [{ content: PDF, filename: 'report', contentType: 'application/pdf' }]],
    ['the wrong form field name', [{ name: 'file', content: PDF, filename: 'a.pdf', contentType: 'application/pdf' }]],
    ['more than 5 files at once', Array.from({ length: 6 }, (_, i) => ({ content: PDF, filename: `f${i}.pdf`, contentType: 'application/pdf' }))],
    ['one bad file among good ones', [
      { content: PDF, filename: 'good.pdf', contentType: 'application/pdf' },
      { content: Buffer.from('nope'), filename: 'bad.pdf', contentType: 'application/pdf' },
    ]],
  ];

  it.each(bad)('%s', async (_name, parts) => {
    const t = await makeTicket(a);
    const before = files();
    const res = await upload(t.id, parts);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid file|no file/i);
    expect(files()).toEqual(before); // no file left on disk, including the good ones in a rejected batch
    expect(await attachmentCount(t.id)).toBe(0);
    expect(await auditFor(t.id)).toHaveLength(0);
  });

  it('a request with no file at all', async () => {
    const t = await makeTicket(a);
    const res = await request(app).post(`/api/v1/tickets/${t.id}/attachments`).set('Authorization', auth(a.employee));
    expect(res.status).toBe(400);
  });

  it('a file over the 10 MB limit, even with a valid signature', async () => {
    const t = await makeTicket(a);
    const before = files();
    const tooBig = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(TEN_MIB)]);
    const res = await upload(t.id, [{ content: tooBig, filename: 'huge.pdf', contentType: 'application/pdf' }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10\s?MB/);
    expect(files()).toEqual(before);
    expect(await attachmentCount(t.id)).toBe(0);
  });

  it('a file just under the limit is accepted', async () => {
    const t = await makeTicket(a);
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(TEN_MIB - 1024)]);
    expect((await upload(t.id, [{ content: big, filename: 'big.pdf', contentType: 'application/pdf' }])).status).toBe(201);
  });
});

describe('file names cannot escape the upload folder', () => {
  it('a traversal in the client file name is reduced to its base name and the file is stored under a random name', async () => {
    const t = await makeTicket(a);
    const res = await upload(t.id, [{ content: Buffer.from('plain text'), filename: '../../../etc/passwd.txt', contentType: 'text/plain' }]);
    expect(res.status).toBe(201);
    expect(res.body[0].fileName).not.toMatch(/[\\/]|\.\./);
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: res.body[0].id } });
    expect(row.storagePath).toMatch(/^[0-9a-f-]{36}$/);
    expect(fs.existsSync(path.join(config.uploadDir, row.storagePath))).toBe(true);
  });

  it('a tampered storagePath cannot make a download read outside the upload folder', async () => {
    const t = await makeTicket(a);
    const att = await prisma.attachment.create({ data: { ticketId: t.id, fileName: 'x.txt', mimeType: 'text/plain', sizeBytes: 1, storagePath: '../../../../etc/passwd', uploadedBy: a.employee.id } });
    const res = await request(app).get(`/api/v1/attachments/${att.id}`).set('Authorization', auth(a.employee));
    expect(res.status).toBe(404); // reduced to ".../uploads/passwd", which does not exist
    expect(res.text).not.toContain('root:');
  });
});

describe('authorization happens before anything is written', () => {
  it.each([
    ['an unauthenticated request (401)', null, 401],
    ['another employee (403)', 'employee2', 403],
  ] as const)('%s', async (_name, who, status) => {
    const t = await makeTicket(a);
    const before = files();
    const res = await upload(t.id, [{ content: PDF, filename: 'a.pdf', contentType: 'application/pdf' }], who ? a[who] : null);
    expect(res.status).toBe(status);
    expect(files()).toEqual(before);
    expect(await attachmentCount(t.id)).toBe(0);
  });

  it('an unknown ticket is a 404 and writes nothing', async () => {
    const before = files();
    const res = await upload('TCK-00000000-FFFFFF', [{ content: PDF, filename: 'a.pdf', contentType: 'application/pdf' }]);
    expect(res.status).toBe(404);
    expect(files()).toEqual(before);
  });
});

describe('internal storage details stay internal', () => {
  const INTERNAL = ['storagePath', 'uploadedBy', 'ticketId'];

  it('the upload response and the ticket detail show file metadata only, never the server-side file name', async () => {
    const t = await makeTicket(a);
    const up = await upload(t.id, [{ content: PDF, filename: 'report.pdf', contentType: 'application/pdf' }]);
    expect(up.status).toBe(201);
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: up.body[0].id } });
    const detail = await request(app).get(`/api/v1/tickets/${t.id}`).set('Authorization', auth(a.agent));
    for (const exposed of [up.body[0], detail.body.attachments[0]]) {
      expect(Object.keys(exposed).sort()).toEqual(['fileName', 'id', 'mimeType', 'sizeBytes']);
      for (const key of INTERNAL) expect(exposed).not.toHaveProperty(key);
    }
    expect(JSON.stringify([up.body, detail.body])).not.toContain(row.storagePath);
  });
});

describe('downloads', () => {
  it('the owner and staff can download; other employees and anonymous users cannot', async () => {
    const t = await makeTicket(a);
    const up = await upload(t.id, [{ content: Buffer.from('evidence'), filename: 'proof.txt', contentType: 'text/plain' }]);
    const url = `/api/v1/attachments/${up.body[0].id}`;

    const owner = await request(app).get(url).set('Authorization', auth(a.employee));
    expect(owner.status).toBe(200);
    expect(owner.body.toString()).toBe('evidence'); // superagent buffers `attachment` responses as binary
    expect(owner.headers['content-disposition']).toMatch(/^attachment;/); // downloaded, never rendered in the page
    expect(owner.headers['x-content-type-options']).toBe('nosniff');

    for (const who of [a.agent, a.manager, a.admin]) expect((await request(app).get(url).set('Authorization', auth(who))).status).toBe(200);
    expect((await request(app).get(url).set('Authorization', auth(a.employee2))).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
  });

  it('rejects a non-numeric id (400) and an unknown id (404)', async () => {
    expect((await request(app).get('/api/v1/attachments/abc').set('Authorization', auth(a.admin))).status).toBe(400);
    expect((await request(app).get('/api/v1/attachments/99999999').set('Authorization', auth(a.admin))).status).toBe(404);
  });
});
