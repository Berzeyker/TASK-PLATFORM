import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();

async function main() {
  const pw = await bcrypt.hash('ChangeMe123!', 10); // DEV ONLY: change before any real deployment
  const users: [string, string, Role][] = [
    ['admin@task.local', 'Admin User', 'ADMIN'],
    ['agent@task.local', 'Agent User', 'AGENT'],
    ['manager@task.local', 'Manager User', 'MANAGER'],
    ['employee@task.local', 'Employee User', 'EMPLOYEE'],
  ];
  for (const [email, fullName, role] of users)
    await prisma.user.upsert({ where: { email }, update: {}, create: { email, fullName, role, passwordHash: pw } });
  for (const name of ['Hardware', 'Software', 'Network', 'Account & Access', 'Email', 'Other'])
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
}
main().finally(() => prisma.$disconnect());
