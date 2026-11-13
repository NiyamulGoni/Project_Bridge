/**
 * AT01: account access (FR01 / UC01). Each `it` is one acceptance check from the
 * proposal's acceptance register.
 */
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(res.body.user).toMatchObject({ role: 'UPLOADER', hasPassword: true });
    expect(res.body.user.email).toBeUndefined();
    expect(String(res.headers['set-cookie'])).toContain('pb_session=');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('riyad@example.com');
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

  it.each([
    ['digits only', '12345'],
    ['a digit inside', 'Riyad2'],
    ['a symbol', 'Riyad_Hossain'],
    ['two spaces', 'Riyad  Hossain'],
  ])('refuses a name with %s', async (_why, name) => {
    const res = await request(app).post('/api/auth/register').send({ name, email: 'name-check@example.com', password: PASSWORD });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['name']);
    expect(await prisma.user.count()).toBe(0);
  });

  it.each(['Md. Rakibul Hasan', "O'Brien-Smith", 'মোঃ রাকিবুল হাসান'])('accepts the name %s', async (name) => {
    const res = await request(app).post('/api/auth/register').send({ name, email: 'name-ok@example.com', password: PASSWORD });
    expect(res.status).toBe(201);
  });

  it.each(['plain', 'a@b', 'a@b.c', 'a..b@example.com', 'a@exa_mple.com', '.a@example.com'])('refuses the email %s', async (email) => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Riyad', email, password: PASSWORD });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['email']);
  });

  it.each([
    ['no uppercase', 'lowercase1!', 'uppercase'],
    ['no lowercase', 'UPPERCASE1!', 'lowercase'],
    ['no digit', 'NoDigitsHere!', 'digit'],
    ['no symbol', 'NoSymbol123', 'symbol'],
  ])('refuses a new password with %s, on registration and on reset', async (_why, password, word) => {
    const reg = await request(app).post('/api/auth/register').send({ name: 'Riyad', email: 'weak@example.com', password });
    expect(reg.status).toBe(400);
    expect(reg.body.error.fields.password).toContain(word);

    const user = await createUser({ email: 'weak-reset@example.com' });
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const reset = await request(app).post('/api/auth/reset-password').send({ token: tokenFromLastResetMail(), password });
    expect(reset.status).toBe(400);
    expect(reset.body.error.fields.password).toContain(word);
  });

  it('still signs in an older account whose password predates the rules', async () => {
    const user = await prisma.user.create({ data: { name: 'Old Timer', email: 'old@example.com', passwordHash: await bcrypt.hash('oldpassword', 4) } });
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: 'oldpassword' })).status).toBe(200);
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
    expect(res.body.user).toMatchObject({ role: 'UPLOADER', hasPassword: false, googleLinked: true });
    expect(res.body.user.email).toBeUndefined();
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(identity.email);
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
  const ATTACKER_PASSWORD = 'AttackerPass1!';

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
    expect((await request(app).post('/api/auth/reset-password').send({ token: bystanderToken, password: 'BystanderPass7!' })).status).toBe(200);
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
    const reset = await request(app).post('/api/auth/reset-password').send({ token: tokenFromLastResetMail(), password: 'OwnerNewPass7!' });
    expect(reset.status).toBe(200);

    const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: 'OwnerNewPass7!' });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ hasPassword: true, googleLinked: true });
    expect((await request(app).post('/api/auth/login').send({ email: owner.email, password: ATTACKER_PASSWORD })).status).toBe(401);
  });

  it('clears nothing on a later Google sign-in', async () => {
    const { id } = await registerAsAttacker();
    await signInWithGoogle();
    await request(app).post('/api/auth/forgot-password').send({ email: owner.email });
    await request(app).post('/api/auth/reset-password').send({ token: tokenFromLastResetMail(), password: 'OwnerNewPass7!' });
    const passwordSession = await signedInAgent(owner.email, 'OwnerNewPass7!');
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

describe('AT01.3 Sign-ins and resets overtaken by a linking or password change', () => {
  const ATTACKER_PASSWORD = 'AttackerPass1!';
  const FAILED_REASON = 'password changed during sign-in';
  // Longer than untilWaitingOnLock's wait, so a test that goes wrong fails on the lock and not on this timeout.
  const LOCK_HOLD_OPTIONS = { maxWait: 10_000, timeout: 28_000 };

  async function registerAsAttacker(email: string) {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/register').send({ name: 'Attacker', email, password: ATTACKER_PASSWORD });
    expect(res.status).toBe(201);
    return { agent, id: res.body.user.id as string };
  }

  async function ownerSignsIn(email: string) {
    googleAccounts.set('owner', { sub: `google-${email}`, email, emailVerified: true, name: 'Real Owner' });
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/google').send({ credential: 'google:owner'.padEnd(30, 'x') });
    expect(res.status).toBe(200);
    return agent;
  }

  function attemptLogin(email: string, password: string) {
    return request(app).post('/api/auth/login').send({ email, password });
  }

  function attemptReset(token: string, password: string) {
    return request(app).post('/api/auth/reset-password').send({ token, password });
  }

  async function requestResetToken(email: string) {
    expect((await request(app).post('/api/auth/forgot-password').send({ email })).status).toBe(200);
    return tokenFromLastResetMail();
  }

  /** Runs `act`, and holds its next bcrypt call open until `during` has finished, so the overlap is exact. */
  async function whileBcryptRuns<T>(method: 'compare' | 'hash', during: () => Promise<unknown>, act: () => PromiseLike<T>) {
    const target = bcrypt as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const real = target[method];
    let failure: unknown;
    const spy = vi.spyOn(target, method).mockImplementationOnce(async (...args) => {
      await during().catch((err) => {
        failure = err;
      });
      return real(...args);
    });
    try {
      const result = await act();
      expect(spy).toHaveBeenCalledTimes(1);
      if (failure) throw failure;
      return result;
    } finally {
      spy.mockRestore();
    }
  }

  /** Sends a sign-in straight away; supertest only sends once its result is asked for. */
  function startedLogin(email: string, password: string) {
    return Promise.resolve(attemptLogin(email, password));
  }

  function sessionCookies(responses: { headers: Record<string, unknown> }[]) {
    return responses.flatMap((res) => ((res.headers['set-cookie'] ?? []) as string[]).map((cookie) => cookie.split(';')[0]));
  }

  /** Returns once a statement containing `statement` is waiting on a lock; fails if `running` finishes first. */
  async function untilWaitingOnLock(statement: string, running: Promise<unknown>) {
    let finished = false;
    const finish = () => {
      finished = true;
    };
    running.then(finish, finish);
    const deadline = Date.now() + 15_000;
    while (!finished && Date.now() < deadline) {
      const [{ waiting }] = await prisma.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*) AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE ${`%${statement}%`}`;
      if (waiting > 0n) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Expected "${statement}" to wait on a lock, but ${finished ? 'the request finished first' : 'it never did'}`);
  }

  /**
   * Plays linkGoogle's statements in a transaction that pauses before its token delete, starts `act`,
   * and commits only once `act` is really waiting on a lock, so the overlap needs no fixed sleep.
   */
  async function whileLinkHoldsUserRow<T>(id: string, act: () => PromiseLike<T>) {
    let running!: Promise<T>;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { googleId: `google-${id}`, passwordHash: null } });
        await tx.session.deleteMany({ where: { userId: id } });
        running = Promise.resolve(act());
        await untilWaitingOnLock('"projectbridge_test"', running);
        await tx.emailToken.deleteMany({ where: { userId: id, type: 'RESET', usedAt: null } });
      }, LOCK_HOLD_OPTIONS);
    } catch (err) {
      await running?.then(undefined, () => undefined);
      throw err;
    }
    return running;
  }

  it('refuses a correct password when Google linking commits during the sign-in', async () => {
    const email = 'race-login-link@gmail.com';
    const { agent: attacker, id } = await registerAsAttacker(email);
    let owner = request.agent(app);

    const login = await whileBcryptRuns(
      'compare',
      async () => {
        owner = await ownerSignsIn(email);
      },
      () => attemptLogin(email, ATTACKER_PASSWORD),
    );

    const unknown = await attemptLogin('race-ghost@gmail.com', ATTACKER_PASSWORD);
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(login.body.error).toEqual(unknown.body.error);
    expect(login.headers['set-cookie']).toBeUndefined();

    expect(await prisma.session.count({ where: { userId: id } })).toBe(1);
    expect((await owner.get('/api/auth/me')).status).toBe(200);
    expect((await attacker.get('/api/auth/me')).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED', targetId: id, reason: FAILED_REASON } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_SUCCEEDED', targetId: id } })).toBe(0);
  });

  it('refuses the old password when a reset commits during the sign-in', async () => {
    const user = await createUser({ email: 'race-login-reset@example.com' });
    const oldSession = await signedInAgent(user.email);
    const token = await requestResetToken(user.email);

    const login = await whileBcryptRuns(
      'compare',
      async () => expect((await attemptReset(token, 'BrandNewPass7!')).status).toBe(200),
      () => attemptLogin(user.email, PASSWORD),
    );

    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await oldSession.get('/api/auth/me')).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED', targetId: user.id, reason: FAILED_REASON } })).toBe(1);

    expect((await attemptLogin(user.email, 'BrandNewPass7!')).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('refuses a reset when Google linking commits while its password is being hashed', async () => {
    const email = 'race-reset-link@gmail.com';
    const { id } = await registerAsAttacker(email);
    const token = await requestResetToken(email);
    let owner = request.agent(app);

    const reset = await whileBcryptRuns(
      'hash',
      async () => {
        owner = await ownerSignsIn(email);
      },
      () => attemptReset(token, ATTACKER_PASSWORD),
    );

    expect(reset.status).toBe(400);
    expect(reset.body.error.code).toBe('INVALID_TOKEN');
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash).toBeNull();
    expect((await owner.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_RESET', targetId: id } })).toBe(0);
  });

  it('refuses a correct password when the sign-in is waiting on the lock of a linking that then commits', async () => {
    const email = 'race-login-lock@gmail.com';
    const { id } = await registerAsAttacker(email);

    const login = await whileLinkHoldsUserRow(id, () => attemptLogin(email, ATTACKER_PASSWORD));

    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(await prisma.session.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED', targetId: id, reason: FAILED_REASON } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_SUCCEEDED', targetId: id } })).toBe(0);
  });

  it('creates a sign-in’s session while it holds the user row, so a linking that starts then removes it', async () => {
    const email = 'race-login-session@gmail.com';
    const { agent: attacker, id } = await registerAsAttacker(email);
    let signingIn!: ReturnType<typeof startedLogin>;
    let linking!: ReturnType<typeof ownerSignsIn>;

    await prisma.$transaction(async (tx) => {
      // Holds back new session rows, so the sign-in pauses exactly at its session insert.
      await tx.$executeRaw`LOCK TABLE "projectbridge_test"."Session" IN SHARE MODE`;
      signingIn = startedLogin(email, ATTACKER_PASSWORD);
      await untilWaitingOnLock('INSERT INTO "projectbridge_test"."Session"', signingIn);
      linking = ownerSignsIn(email);
      await untilWaitingOnLock('UPDATE "projectbridge_test"."User"', linking);
    }, LOCK_HOLD_OPTIONS);
    const [login, owner] = await Promise.all([signingIn, linking]);

    expect(login.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', sessionCookies([login])[0])).status).toBe(401);
    expect((await attacker.get('/api/auth/me')).status).toBe(401);
    expect((await owner.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: id } })).toBe(1);
  });

  it('removes a registrant’s session when the linking commits right after the registration', async () => {
    const email = 'race-register-link@gmail.com';
    let owner = request.agent(app);
    const registrant = request.agent(app);
    const writeAudit = prisma.auditLog.create.bind(prisma.auditLog);
    // USER_REGISTERED is written straight after the account becomes visible to a linking.
    const auditCreate = vi.spyOn(prisma.auditLog, 'create').mockImplementationOnce((async (args: never) => {
      owner = await ownerSignsIn(email);
      return writeAudit(args);
    }) as never);

    try {
      const res = await registrant.post('/api/auth/register').send({ name: 'Attacker', email, password: ATTACKER_PASSWORD });
      expect(res.status).toBe(201);
      expect(auditCreate).toHaveBeenCalled();
      expect((await registrant.get('/api/auth/me')).status).toBe(401);
      expect((await owner.get('/api/auth/me')).status).toBe(200);
      expect(await prisma.session.count({ where: { userId: res.body.user.id } })).toBe(1);
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).passwordHash).toBeNull();
    } finally {
      auditCreate.mockRestore();
    }
  });

  // An invariant check only: whether a sign-in lands inside the linking's window is down to timing.
  // The deterministic tests above and below are what pin the order of the writes.
  it('leaves no attacker session when sign-ins really do keep running alongside the linking', async () => {
    const email = 'race-login-real@gmail.com';
    const { agent: attacker, id } = await registerAsAttacker(email);

    let linking = true;
    const logins: Awaited<ReturnType<typeof attemptLogin>>[] = [];
    const keepSigningIn = async () => {
      while (linking) logins.push(await attemptLogin(email, ATTACKER_PASSWORD));
    };
    const signedIn = ownerSignsIn(email).finally(() => {
      linking = false;
    });
    const [owner] = await Promise.all([signedIn, keepSigningIn(), keepSigningIn(), keepSigningIn()]);

    for (const login of logins) expect([200, 401, 429]).toContain(login.status);
    for (const cookie of sessionCookies(logins)) {
      expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
    }
    expect((await attacker.get('/api/auth/me')).status).toBe(401);
    expect((await owner.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash).toBeNull();
  });

  it('lets a reset request overlap a linking with an unused link outstanding, without a deadlock', async () => {
    const email = 'race-forgot-link@gmail.com';
    const { id } = await registerAsAttacker(email);
    const earlier = await requestResetToken(email);

    const forgot = await whileLinkHoldsUserRow(id, () => request(app).post('/api/auth/forgot-password').send({ email }));

    expect(forgot.status).toBe(200);
    expect(tokenFromLastResetMail()).not.toBe(earlier);
    expect(await prisma.emailToken.count({ where: { userId: id, usedAt: null } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash).toBeNull();
    expect((await attemptReset(earlier, ATTACKER_PASSWORD)).status).toBe(400);
  });

  // Production allows one connection, where a query on the global client inside a transaction callback
  // waits on the connection that same transaction holds. The tests' larger pool cannot show that, so
  // this one loads a second copy of the app on a single connection.
  it('registers, signs in, resets and links on a single database connection', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('connection_limit', '1');
    vi.stubEnv('DATABASE_URL', url.href);
    vi.resetModules();
    const single = await import('./helpers.js');

    try {
      const email = 'one-connection@gmail.com';
      const account = { email, password: ATTACKER_PASSWORD };
      const registered = await single.request(single.app).post('/api/auth/register').send({ name: 'Someone', ...account });
      expect(registered.status).toBe(201);

      const [login, otherQuery] = await Promise.all([
        single.request(single.app).post('/api/auth/login').send(account),
        single.prisma.user.count({ where: { email } }),
      ]);
      expect(login.status).toBe(200);
      expect(otherQuery).toBe(1);

      expect((await single.request(single.app).post('/api/auth/forgot-password').send({ email })).status).toBe(200);
      const reset = await single
        .request(single.app)
        .post('/api/auth/reset-password')
        .send({ token: single.tokenFromLastResetMail(), password: 'BrandNewPass7!' });
      expect(reset.status).toBe(200);

      single.googleAccounts.set('owner', { sub: `google-${email}`, email, emailVerified: true, name: 'Real Owner' });
      const google = await single.request(single.app).post('/api/auth/google').send({ credential: 'google:owner'.padEnd(30, 'x') });
      expect(google.status).toBe(200);
      expect(await single.prisma.session.count({ where: { user: { email } } })).toBe(1);
    } finally {
      await single.prisma.$disconnect();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('refuses a reset when its link expires while the password is being hashed', async () => {
    const user = await createUser({ email: 'reset-expired-mid@example.com' });
    const session = await signedInAgent(user.email);
    const token = await requestResetToken(user.email);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    const reset = await whileBcryptRuns(
      'hash',
      () => prisma.emailToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } }),
      () => attemptReset(token, 'BrandNewPass7!'),
    );

    expect(reset.status).toBe(400);
    expect(reset.body.error.code).toBe('INVALID_TOKEN');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
    expect((await session.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_RESET', targetId: user.id } })).toBe(0);
  });

  it('ends with no password when a reset really does run alongside the linking', async () => {
    const email = 'race-reset-real@gmail.com';
    const { id } = await registerAsAttacker(email);
    const token = await requestResetToken(email);

    const [reset, owner] = await Promise.all([attemptReset(token, ATTACKER_PASSWORD), ownerSignsIn(email)]);

    expect([200, 400]).toContain(reset.status);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash).toBeNull();
    expect((await owner.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: id } })).toBe(1);
  });

  it('changes nothing when a reset fails to claim its token', async () => {
    const user = await createUser({ email: 'reset-claim-lost@example.com' });
    const session = await signedInAgent(user.email);
    const token = await requestResetToken(user.email);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    const reset = await whileBcryptRuns(
      'hash',
      () => prisma.emailToken.updateMany({ where: { userId: user.id }, data: { usedAt: new Date() } }),
      () => attemptReset(token, 'BrandNewPass7!'),
    );

    expect(reset.status).toBe(400);
    expect(reset.body.error.code).toBe('INVALID_TOKEN');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
    expect((await session.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_RESET', targetId: user.id } })).toBe(0);
  });

  it('lets exactly one of two simultaneous resets use a token', async () => {
    const user = await createUser({ email: 'reset-two-at-once@example.com' });
    const token = await requestResetToken(user.email);
    const passwords = ['FirstNewPass7!', 'SecondNewPass7!'];

    const results = await Promise.all(passwords.map((password) => attemptReset(token, password)));

    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
    const winner = results[0].status === 200 ? 0 : 1;
    expect(results[1 - winner].body.error.code).toBe('INVALID_TOKEN');
    const { passwordHash } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare(passwords[winner], passwordHash!)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_RESET', targetId: user.id } })).toBe(1);
  });

  it('keeps the token usable when a reset fails before it commits', async () => {
    const user = await createUser({ email: 'reset-not-burned@example.com' });
    const token = await requestResetToken(user.email);
    const hash = vi.spyOn(bcrypt, 'hash').mockImplementationOnce(() => Promise.reject(new Error('hashing failed')));
    const logged = vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);

    try {
      expect((await attemptReset(token, 'BrandNewPass7!')).status).toBe(500);
    } finally {
      hash.mockRestore();
      logged.mockRestore();
    }

    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
    expect((await attemptReset(token, 'BrandNewPass7!')).status).toBe(200);
  });

  it.each(['BANNED', 'SUSPENDED'])('uses up the link of a %s account and changes nothing else', async (status) => {
    const user = await createUser({ email: `reset-${status.toLowerCase()}@example.com` });
    await signedInAgent(user.email);
    const token = await requestResetToken(user.email);
    const before = await prisma.user.update({ where: { id: user.id }, data: { status } });

    const reset = await attemptReset(token, 'BrandNewPass7!');

    expect(reset.status).toBe(403);
    expect(reset.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(reset.body.error.message).toContain(status.toLowerCase());
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.emailToken.count({ where: { userId: user.id, usedAt: { not: null } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_RESET', targetId: user.id } })).toBe(0);

    const again = await attemptReset(token, 'BrandNewPass7!');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  it('still gives an ordinary sign-in one working session, and leaves the account row as it was', async () => {
    const user = await createUser({ email: 'ordinary-login@example.com' });

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(user.id);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_SUCCEEDED', targetId: user.id } })).toBe(1);
  });
});

describe('AT01.4 Password reset', () => {
  it('resets the password, revokes old sessions and refuses reuse of the link', async () => {
    const user = await createUser();
    const oldSession = await signedInAgent(user.email);

    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    expect(forgot.status).toBe(200);
    const token = tokenFromLastResetMail();

    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'BrandNewPass7!' });
    expect(reset.status).toBe(200);

    expect((await oldSession.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: 'BrandNewPass7!' })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'Another1Pass!' })).status).toBe(400);
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

    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'BrandNewPass7!' })).status).toBe(400);
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
