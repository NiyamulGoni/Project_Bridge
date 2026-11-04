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
    expect(res.body.user).toMatchObject({ id: existing.id, role: 'PROFESSIONAL', hasPassword: false, googleLinked: true });
    expect(await prisma.user.count()).toBe(1);
  });

  it('keeps the role and a RESTRICTED status when linking', async () => {
    const existing = await createUser({ email: identity.email, role: 'PROFESSIONAL', status: 'RESTRICTED' });
    googleAccounts.set('link', identity);
    const res = await request(app).post('/api/auth/google').send({ credential: 'google:link'.padEnd(30, 'x') });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: existing.id, role: 'PROFESSIONAL', status: 'RESTRICTED', hasPassword: false });
  });

  it.each(['BANNED', 'SUSPENDED'])('refuses a %s account even through Google, and writes nothing to it', async (status) => {
    const user = await createUser({ email: identity.email });
    await signedInAgent(user.email);
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const before = await prisma.user.update({ where: { id: user.id }, data: { status } });

    googleAccounts.set('blocked', identity);
    const res = await request(app).post('/api/auth/google').send({ credential: 'google:blocked'.padEnd(30, 'x') });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.googleId).toBeNull();
    expect(after.passwordHash).toBe(user.passwordHash);
    expect(after).toEqual(before);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.emailToken.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_BLOCKED', targetId: user.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'GOOGLE_LINKED' } })).toBe(0);
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

describe('AT01.3 Google linking shuts out whoever registered the address first', () => {
  const owner = { sub: 'google-owner', email: 'victim@gmail.com', emailVerified: true, name: 'Real Owner' };
  const ATTACKER_PASSWORD = 'AttackerPass1';

  async function registerAsAttacker() {
    const attacker = request.agent(app);
    const res = await attacker.post('/api/auth/register').send({ name: 'Attacker', email: owner.email, password: ATTACKER_PASSWORD });
    expect(res.status).toBe(201);
    expect((await attacker.get('/api/auth/me')).status).toBe(200);
    return { attacker, id: res.body.user.id as string };
  }

  async function signInWithGoogle() {
    googleAccounts.set('owner', owner);
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/google').send({ credential: 'google:owner'.padEnd(30, 'x') });
    expect(res.status).toBe(200);
    return { agent, res };
  }

  it('ends the attacker’s session and password, and only the owner gets in', async () => {
    const { attacker, id } = await registerAsAttacker();
    const { agent, res } = await signInWithGoogle();

    expect(res.body.user).toMatchObject({ id, role: 'UPLOADER', status: 'ACTIVE', hasPassword: false, googleLinked: true });
    expect((await attacker.get('/api/auth/me')).status).toBe(401);

    const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: ATTACKER_PASSWORD });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: ATTACKER_PASSWORD });
    expect(login.status).toBe(401);
    expect(login.body.error).toEqual(unknown.body.error);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(id);
    expect(await prisma.session.count({ where: { userId: id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'GOOGLE_LINKED', targetId: id } })).toBe(1);
  });

  it('ends every session on that account, and leaves other accounts alone', async () => {
    const { attacker, id } = await registerAsAttacker();
    const secondDevice = await signedInAgent(owner.email, ATTACKER_PASSWORD);
    const bystander = await createUser();
    const bystanderSession = await signedInAgent(bystander.email);
    await request(app).post('/api/auth/forgot-password').send({ email: bystander.email });
    const bystanderToken = tokenFromLastResetMail();

    await signInWithGoogle();

    expect((await attacker.get('/api/auth/me')).status).toBe(401);
    expect((await secondDevice.get('/api/auth/me')).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: id } })).toBe(1);

    expect(await prisma.user.findUniqueOrThrow({ where: { id: bystander.id } })).toEqual(bystander);
    expect((await bystanderSession.get('/api/auth/me')).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({ token: bystanderToken, password: 'BystanderPass7' })).status).toBe(200);
  });

  it('cancels an unused reset link from before the linking', async () => {
    const { id } = await registerAsAttacker();
    await request(app).post('/api/auth/forgot-password').send({ email: owner.email });
    const token = tokenFromLastResetMail();
    const used = await prisma.emailToken.create({
      data: { userId: id, type: 'RESET', tokenHash: 'an-already-used-token', expiresAt: new Date(Date.now() + 60000), usedAt: new Date() },
    });

    const { agent } = await signInWithGoogle();

    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: ATTACKER_PASSWORD });
    expect(reset.status).toBe(400);
    expect(reset.body.error.code).toBe('INVALID_TOKEN');
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash).toBeNull();
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await prisma.emailToken.findMany({ where: { userId: id } })).map((t) => t.id)).toEqual([used.id]);
  });

  it('lets the owner set a password through forgot-password, then sign in with it', async () => {
    await registerAsAttacker();
    await signInWithGoogle();

    expect((await request(app).post('/api/auth/forgot-password').send({ email: owner.email })).status).toBe(200);
    const reset = await request(app).post('/api/auth/reset-password').send({ token: tokenFromLastResetMail(), password: 'OwnerNewPass7' });
    expect(reset.status).toBe(200);

    const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: 'OwnerNewPass7' });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ hasPassword: true, googleLinked: true });
    expect((await request(app).post('/api/auth/login').send({ email: owner.email, password: ATTACKER_PASSWORD })).status).toBe(401);
  });

  it('clears nothing on a later Google sign-in', async () => {
    const { id } = await registerAsAttacker();
    await signInWithGoogle();
    await request(app).post('/api/auth/forgot-password').send({ email: owner.email });
    await request(app).post('/api/auth/reset-password').send({ token: tokenFromLastResetMail(), password: 'OwnerNewPass7' });
    const passwordSession = await signedInAgent(owner.email, 'OwnerNewPass7');
    await request(app).post('/api/auth/forgot-password').send({ email: owner.email });
    const before = await prisma.user.findUniqueOrThrow({ where: { id } });

    const { res } = await signInWithGoogle();

    expect(res.body.user).toMatchObject({ id, hasPassword: true, googleLinked: true });
    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toEqual(before);
    expect((await passwordSession.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.emailToken.count({ where: { userId: id, usedAt: null } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'GOOGLE_LINKED', targetId: id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_GOOGLE', targetId: id } })).toBe(1);
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
