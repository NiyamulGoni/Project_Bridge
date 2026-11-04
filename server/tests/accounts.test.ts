/**
 * AT01: account access (FR01 / UC01). Each `it` is one acceptance check from the
 * proposal's acceptance register.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  app,
  createUser,
  googleAccounts,
  mailer,
  PASSWORD,
  prisma,
  request,
  resetDb,
  signedInAgent,
  tokenFromLastResetMail,
} from './helpers.js';

beforeEach(resetDb);

describe('AT01.1 Registration', () => {
  it('creates an UPLOADER and signs them in immediately', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/register')
      .send({ name: 'Riyad', email: 'Riyad@Example.com ', password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'riyad@example.com', role: 'UPLOADER', hasPassword: true });
    expect(String(res.headers['set-cookie'])).toContain('pb_session=');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect(mailer.outbox).toHaveLength(0);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'riyad@example.com' } });
    expect(stored.passwordHash).not.toContain(PASSWORD);
  });

  it('ignores a self-assigned role: no one can register as ADMIN or PROFESSIONAL', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Mallory', email: 'mallory@example.com', password: PASSWORD, role: 'ADMIN', status: 'ACTIVE' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('UPLOADER');
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'mallory@example.com' } });
    expect(stored.role).toBe('UPLOADER');
  });

  it('returns field-specific errors for invalid input', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'A', email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['email', 'name', 'password']);
  });

  it('rejects a duplicate email', async () => {
    await createUser({ email: 'taken@example.com' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Someone', email: 'TAKEN@example.com', password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });
});

describe('AT01.2 Sign in / sign out', () => {
  it('signs in with an httpOnly session cookie, exposes /me, and signs out', async () => {
    const user = await createUser();
    const agent = request.agent(app);

    const login = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toContain('pb_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: user.id, role: 'UPLOADER' });
    expect(me.body.user.passwordHash).toBeUndefined();

    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('gives the same generic message for a wrong password and an unknown email', async () => {
    const user = await createUser();
    const wrong = await request(app).post('/api/auth/login').send({ email: user.email, password: 'WrongPass1' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'WrongPass1' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } })).toBe(2);
  });

  it('rate-limits repeated failed sign-ins (NFR-S1)', async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'WrongPass1' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('rejects requests with a forged session cookie', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'pb_session=forged-token-value');
    expect(res.status).toBe(401);
  });
});

describe('AT01.3 Sign in with Google', () => {
  const identity = { sub: 'google-123', email: 'student@cs.du.ac.bd', emailVerified: true, name: 'DU Student' };

  it('creates a new UPLOADER without a password and signs them in', async () => {
    googleAccounts.set('new', identity);
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/google').send({ credential: 'google:new'.padEnd(30, 'x') });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: identity.email, role: 'UPLOADER', hasPassword: false, googleLinked: true });
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.user.count()).toBe(1);
  });

  it('links Google to an existing password account with the same email', async () => {
    const existing = await createUser({ email: identity.email, role: 'PROFESSIONAL' });
    googleAccounts.set('link', identity);
    const res = await request(app).post('/api/auth/google').send({ credential: 'google:link'.padEnd(30, 'x') });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: existing.id, role: 'PROFESSIONAL', hasPassword: true, googleLinked: true });
    expect(await prisma.user.count()).toBe(1);
  });

  it('refuses a banned account even through Google', async () => {
    await createUser({ email: identity.email, status: 'BANNED' });
    googleAccounts.set('banned', identity);
    const res = await request(app).post('/api/auth/google').send({ credential: 'google:banned'.padEnd(30, 'x') });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('refuses a Google account whose email is not verified', async () => {
    googleAccounts.set('unverified', { ...identity, emailVerified: false });
    const res = await request(app).post('/api/auth/google').send({ credential: 'google:unverified'.padEnd(30, 'x') });
    expect(res.status).toBe(403);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects an invalid Google token', async () => {
    const res = await request(app).post('/api/auth/google').send({ credential: 'google:forged'.padEnd(30, 'x') });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_GOOGLE_TOKEN');
  });

  it('a Google-only account cannot sign in with a password', async () => {
    googleAccounts.set('only', identity);
    await request(app).post('/api/auth/google').send({ credential: 'google:only'.padEnd(30, 'x') });
    const res = await request(app).post('/api/auth/login').send({ email: identity.email, password: 'anything123' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('AT01.4 Password reset', () => {
  it('resets the password, revokes old sessions and refuses reuse of the link', async () => {
    const user = await createUser();
    const oldSession = await signedInAgent(user.email);

    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    expect(forgot.status).toBe(200);
    const token = tokenFromLastResetMail();

    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'BrandNewPass7' });
    expect(reset.status).toBe(200);

    expect((await oldSession.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: 'BrandNewPass7' })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'Another1Pass' })).status).toBe(400);
  });

  it('does not reveal whether an email is registered', async () => {
    await createUser({ email: 'real@example.com' });
    const known = await request(app).post('/api/auth/forgot-password').send({ email: 'real@example.com' });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(mailer.outbox).toHaveLength(1);
  });

  it('rejects an expired reset link', async () => {
    const user = await createUser();
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const token = tokenFromLastResetMail();
    await prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'BrandNewPass7' })).status).toBe(400);
  });
});

describe('AT01.5 Disabled accounts', () => {
  it.each(['BANNED', 'SUSPENDED'])('refuses sign-in for a %s account with clear feedback', async (status) => {
    const user = await createUser({ status, role: 'PROFESSIONAL' });
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(res.body.error.message).toContain(status.toLowerCase());
  });

  it('invalidates an existing session on the next request after a ban (NFR-S3)', async () => {
    const user = await createUser({ role: 'PROFESSIONAL' });
    const agent = await signedInAgent(user.email);
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { status: 'BANNED' } });

    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('AT01.6 Permission checks', () => {
  it('denies the Admin area to signed-out visitors (401)', async () => {
    const res = await request(app).get('/api/admin/ping');
    expect(res.status).toBe(401);
  });

  it.each(['UPLOADER', 'PROFESSIONAL'])('denies the Admin area to a %s (403)', async (role) => {
    const user = await createUser({ role });
    const agent = await signedInAgent(user.email);
    const res = await agent.get('/api/admin/ping');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows the Admin area to an Admin (200)', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    const agent = await signedInAgent(admin.email);
    expect((await agent.get('/api/admin/ping')).status).toBe(200);
  });
});
