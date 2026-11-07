import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setGoogleVerifier, type GoogleIdentity } from '../src/lib/google.js';
import { MemoryMailer, setMailer } from '../src/lib/mailer.js';
import { MemoryStorage, setCoverStorage, setStorage } from '../src/lib/storage.js';
import { prisma } from '../src/lib/prisma.js';

export const app = createApp();
export const mailer = new MemoryMailer();
setMailer(mailer);
export const storage = new MemoryStorage();
setStorage(storage);
export const coverStorage = new MemoryStorage();
setCoverStorage(coverStorage);

/** Stub Google: a token "google:<key>xxx…" (padded to pass length validation) is valid if <key> is registered. */
export const googleAccounts = new Map<string, GoogleIdentity>();
setGoogleVerifier(async (idToken) => googleAccounts.get(idToken.replace(/^google:/, '').replace(/x+$/, '')) ?? null);

export const PASSWORD = 'CorrectHorse9';

export async function resetDb() {
  mailer.outbox.length = 0;
  googleAccounts.clear();
  storage.objects.clear();
  coverStorage.objects.clear();
  await prisma.$transaction([
    prisma.session.deleteMany(),
    prisma.emailToken.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.report.deleteMany(),
    prisma.projectMedia.deleteMany(),
    prisma.projectRevision.deleteMany(),
    prisma.progressEntry.deleteMany(),
    prisma.milestone.deleteMany(),
    prisma.projectMember.deleteMany(),
    prisma.project.deleteMany(),
    prisma.guestSession.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

let counter = 0;

/** Creates an account directly in the database. */
export async function createUser(overrides: { role?: string; status?: string; email?: string } = {}) {
  counter += 1;
  return prisma.user.create({
    data: {
      name: `Test User ${counter}`,
      email: overrides.email ?? `user${counter}@example.com`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: overrides.role ?? 'UPLOADER',
      status: overrides.status ?? 'ACTIVE',
    },
  });
}

/** Returns a cookie-keeping agent already signed in as the given user. */
export async function signedInAgent(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** Pulls the token from the most recent password-reset email. */
export function tokenFromLastResetMail(): string {
  const mail = [...mailer.outbox].reverse().find((m) => m.text.includes('/reset-password'));
  if (!mail) throw new Error('No password reset email');
  const match = mail.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('No token in email');
  return match[1];
}

export { prisma, request };

/** Content that passes the submit/complete checks (FR02). */
export const COMPLETE_PROJECT = {
  title: 'Solar Water Pump Monitor',
  summary: 'Remote monitoring for solar irrigation pumps in rural areas.',
  problem: 'Farmers cannot tell when solar pumps fail until crops are already stressed by missing water.',
  overview:
    'Low-cost sensors report pump output over SMS to a dashboard, and alert the farmer and technician as soon as output drops below the expected level for the weather.',
  tags: ['agriculture', 'iot'],
  stage: 'PROTOTYPE',
  demoUrl: 'https://demo.example.com/solar-pump',
};

/** Inserts a project directly, published and complete unless overridden. */
export async function createProject(ownerId: string, overrides: Record<string, unknown> = {}) {
  counter += 1;
  return prisma.project.create({
    data: {
      ...COMPLETE_PROJECT,
      title: `${COMPLETE_PROJECT.title} ${counter}`,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      ...overrides,
      ownerId,
    } as Parameters<typeof prisma.project.create>[0]['data'],
  });
}

/** Smallest valid PNG (1×1 transparent pixel). */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
