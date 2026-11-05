/**
 * Request hardening: HTTPS redirect, HSTS, Origin check, error bodies and cookie settings.
 * Only the "needs the database" block reaches the database; a request carrying no session cookie
 * to a route that does not query never does.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { errorHandler, HttpError } from '../src/lib/errors.js';

const PROD_URL = 'https://app.example.test';
const PROD_ENV = { NODE_ENV: 'production', APP_URL: PROD_URL, TRUST_PROXY: 'loopback' };
const DEV_ENV = { NODE_ENV: 'development', APP_URL: 'http://localhost:5173', TRUST_PROXY: 'loopback' };
const TEST_ENV = { NODE_ENV: 'test', APP_URL: 'http://localhost:5173', TRUST_PROXY: 'loopback' };

/** Runs an import against fresh modules, so config.ts reads the given environment. */
async function withEnv<T>(env: Record<string, string>, load: () => Promise<T>): Promise<T> {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  try {
    return await load();
  } finally {
    vi.unstubAllEnvs();
  }
}

const loadApp = (env: Record<string, string>): Promise<Express> =>
  withEnv(env, async () => (await import('../src/app.js')).createApp());

const loadConfig = (env: Record<string, string>) =>
  withEnv(env, async () => (await import('../src/config.js')).config);

/** A small app with the real error handler. */
function errorApp(routes: (app: Express) => void): Express {
  const app = express();
  routes(app);
  app.use(errorHandler);
  return app;
}

const cookieHeader = (res: request.Response) => String(res.headers['set-cookie'] ?? '');

describe('startup settings', () => {
  it('refuses a production APP_URL that is not https', async () => {
    await expect(loadConfig({ ...PROD_ENV, APP_URL: 'http://app.example.test' })).rejects.toThrow(/APP_URL/);
  });

  it('refuses production without TRUST_PROXY, because the HTTPS redirect could loop forever', async () => {
    await expect(loadConfig({ ...PROD_ENV, TRUST_PROXY: '' })).rejects.toThrow(/TRUST_PROXY/);
  });

  it('accepts a production https APP_URL', async () => {
    expect((await loadConfig(PROD_ENV)).appUrl).toBe(PROD_URL);
  });

  it('reads TRUST_PROXY as a hop count or a value, and defaults to loopback', async () => {
    expect((await loadConfig({ ...TEST_ENV, TRUST_PROXY: '1' })).trustProxy).toBe(1);
    expect((await loadConfig({ ...TEST_ENV, TRUST_PROXY: 'uniquelocal' })).trustProxy).toBe('uniquelocal');
    expect((await loadConfig({ ...TEST_ENV, TRUST_PROXY: '' })).trustProxy).toBe('loopback');
  });
});

describe('HTTPS redirect', () => {
  let prod: Express;
  beforeAll(async () => {
    prod = await loadApp(PROD_ENV);
  });

  it('sends HTTP to APP_URL with a 308, ignoring a hostile Host header', async () => {
    const res = await request(prod)
      .get('/api/projects/feed?page=2')
      .set('Host', 'evil.example')
      .set('X-Forwarded-Host', 'evil.example');
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe(`${PROD_URL}/api/projects/feed?page=2`);
  });

  it('keeps an absolute-form request target from changing the destination', async () => {
    const server = prod.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const location = await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: 'http://evil.example/steal' }, (res) => {
          res.resume();
          resolve(res.headers.location);
        })
        .on('error', reject);
    });
    server.close();
    expect(location).toBe(`${PROD_URL}/`);
  });

  it('runs before body parsing and session loading', async () => {
    const res = await request(prod)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('Cookie', 'pb_session=never-looked-up')
      .send('{not json');
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe(`${PROD_URL}/api/auth/login`);
  });

  it('does not redirect when a trusted proxy reports https', async () => {
    const res = await request(prod).get('/api/nope').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(404);
  });

  it('ignores X-Forwarded-Proto from a proxy that is not trusted', async () => {
    const untrusted = await loadApp({ ...PROD_ENV, TRUST_PROXY: '10.0.0.1' });
    const res = await request(untrusted).get('/api/nope').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(308);
  });

  it('honours a hop count from TRUST_PROXY', async () => {
    const hosted = await loadApp({ ...PROD_ENV, TRUST_PROXY: '1' });
    const res = await request(hosted).get('/api/nope').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(404);
  });

  it('exempts only GET /api/health', async () => {
    const health = await request(prod).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });
    expect((await request(prod).post('/api/health')).status).toBe(308);
  });

  it('does not redirect outside production', async () => {
    for (const env of [TEST_ENV, DEV_ENV]) {
      const res = await request(await loadApp(env)).get('/api/nope');
      expect(res.status).toBe(404);
    }
  });
});

describe('HSTS', () => {
  it('is sent in production', async () => {
    const res = await request(await loadApp(PROD_ENV)).get('/api/health').set('X-Forwarded-Proto', 'https');
    expect(res.headers['strict-transport-security']).toBe('max-age=15552000; includeSubDomains');
  });

  it('is absent otherwise', async () => {
    for (const env of [TEST_ENV, DEV_ENV]) {
      const res = await request(await loadApp(env)).get('/api/health');
      expect(res.headers['strict-transport-security']).toBeUndefined();
    }
  });
});

describe('Origin check', () => {
  let testApp: Express;
  let prod: Express;
  let dev: Express;
  beforeAll(async () => {
    testApp = await loadApp(TEST_ENV);
    prod = await loadApp(PROD_ENV);
    dev = await loadApp(DEV_ENV);
  });

  const EVIL = 'https://evil.example';
  const METHODS = ['post', 'patch', 'put', 'delete'] as const;
  const isRefused = (res: request.Response) => {
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  };
  /** Reaches the API's 404, so the check let it through. */
  const isAllowed = (res: request.Response) => {
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  };

  it.each(METHODS)('refuses %s from another origin', async (method) => {
    isRefused(await request(testApp)[method]('/api/nope').set('Origin', EVIL));
  });

  it('refuses before the body is parsed', async () => {
    const res = await request(testApp)
      .post('/api/nope')
      .set('Origin', EVIL)
      .set('Content-Type', 'application/json')
      .send('{not json');
    isRefused(res);
  });

  it("refuses the origin 'null'", async () => {
    isRefused(await request(testApp).post('/api/nope').set('Origin', 'null'));
  });

  it('passes the correct origin', async () => {
    isAllowed(await request(testApp).post('/api/nope').set('Origin', 'http://localhost:5173'));
    isAllowed(await request(prod).post('/api/nope').set('X-Forwarded-Proto', 'https').set('Origin', PROD_URL));
  });

  it('passes a request with no Origin', async () => {
    isAllowed(await request(testApp).post('/api/nope'));
  });

  it('passes GET from another origin', async () => {
    const res = await request(testApp).get('/api/health').set('Origin', EVIL);
    expect(res.status).toBe(200);
  });

  it('refuses a localhost origin on another port in test and production', async () => {
    isRefused(await request(testApp).post('/api/nope').set('Origin', 'http://localhost:5174'));
    isRefused(await request(testApp).post('/api/nope').set('Origin', 'http://127.0.0.1:5173'));
    isRefused(
      await request(prod).post('/api/nope').set('X-Forwarded-Proto', 'https').set('Origin', 'http://localhost:5174'),
    );
  });

  it('accepts any local port in development, and nothing else extra', async () => {
    isAllowed(await request(dev).post('/api/nope').set('Origin', 'http://localhost:5174'));
    isAllowed(await request(dev).post('/api/nope').set('Origin', 'http://127.0.0.1:3000'));
    for (const origin of [EVIL, 'null', 'https://localhost:5174', 'http://localhost.evil.example:5174', 'http://localhost']) {
      isRefused(await request(dev).post('/api/nope').set('Origin', origin));
    }
  });

  it('gives no local allowance when NODE_ENV is not exactly development', async () => {
    const unset = await loadApp({ ...DEV_ENV, NODE_ENV: '' });
    isRefused(await request(unset).post('/api/nope').set('Origin', 'http://localhost:5174'));
  });
});

describe('error responses', () => {
  const GENERIC = { error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } };
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never sends the text of an unexpected error, but still logs it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const leak = new Error(
      'Invalid `prisma.user.findUnique()` invocation: cannot reach postgresql://admin:hunter2@db.internal:5432/app',
    );
    leak.stack = 'Error: secret-stack-line\n    at /srv/app/src/secret.ts:1:1';
    const app = errorApp((a) => {
      a.get('/boom', () => {
        throw leak;
      });
    });

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual(GENERIC);
    for (const text of ['prisma', 'postgresql', 'hunter2', 'db.internal', 'secret-stack-line', 'secret.ts']) {
      expect(res.text).not.toContain(text);
    }
    expect(logged).toHaveBeenCalledWith(leak);
  });

  it('keeps a generic body for a non-parser error that claims a 4xx status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = errorApp((a) => {
      a.get('/boom', () => {
        throw Object.assign(new Error('secret detail'), { status: 400 });
      });
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual(GENERIC);
  });

  it('still sends an HttpError as written', async () => {
    const app = errorApp((a) => {
      a.get('/gone', () => {
        throw new HttpError(404, 'NOT_FOUND', 'No such thing.');
      });
    });
    const res = await request(app).get('/gone');
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'No such thing.' });
  });

  describe('body parsing', () => {
    const app = errorApp((a) => {
      a.post('/echo', express.json({ limit: '1kb' }), (req, res) => {
        res.json(req.body);
      });
    });
    const post = () => request(app).post('/echo');

    it('gives 413 for an oversized body', async () => {
      const res = await post().send({ text: 'x'.repeat(2048) });
      expect(res.status).toBe(413);
      expect(res.body.error).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' });
    });

    it('gives 400 BAD_JSON for malformed JSON', async () => {
      const res = await post().set('Content-Type', 'application/json').send('{not json');
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({ code: 'BAD_JSON', message: 'Request body is not valid JSON.' });
    });

    it('gives 400 with a fixed message for other parser errors', async () => {
      const res = await post().set('Content-Type', 'application/json; charset=not-a-charset').send('{}');
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({ code: 'BAD_REQUEST', message: 'The request could not be read.' });
    });
  });

  it('gives 400 for malformed percent-encoding', async () => {
    const app = errorApp((a) => {
      a.get('/things/:id', (req, res) => {
        res.json({ id: req.params.id });
      });
    });
    const res = await request(app).get('/things/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: 'BAD_REQUEST', message: 'The request could not be read.' });
  });

  it('hands over to Express once the response has started', () => {
    const err = new Error('late');
    const status = vi.fn();
    const next = vi.fn();
    errorHandler(err, {} as Request, { headersSent: true, status } as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith(err);
    expect(status).not.toHaveBeenCalled();
  });
});

describe('session cookie options', () => {
  async function setCookie(env: Record<string, string>) {
    const { setSessionCookie } = await withEnv(env, () => import('../src/middleware/session.js'));
    const app = express();
    app.get('/', (_req, res) => {
      setSessionCookie(res, 'value');
      res.end();
    });
    return cookieHeader(await request(app).get('/'));
  }

  it('is Secure, HttpOnly and SameSite=Lax in production', async () => {
    const cookie = await setCookie(PROD_ENV);
    expect(cookie).toMatch(/;\s*Secure/);
    expect(cookie).toMatch(/;\s*HttpOnly/);
    expect(cookie).toMatch(/;\s*SameSite=Lax/);
  });

  it('is HttpOnly and SameSite=Lax but not Secure outside production', async () => {
    for (const env of [TEST_ENV, DEV_ENV]) {
      const cookie = await setCookie(env);
      expect(cookie).not.toMatch(/Secure/);
      expect(cookie).toMatch(/;\s*HttpOnly/);
      expect(cookie).toMatch(/;\s*SameSite=Lax/);
    }
  });
});

describe('needs the database', () => {
  let helpers: typeof import('./helpers.js');
  let hashToken: typeof import('../src/lib/tokens.js').hashToken;
  const stamp = Date.now();
  const cookieValue = (res: request.Response, name: string) => {
    const match = cookieHeader(res).match(new RegExp(`${name}=([^;]+)`));
    if (!match) throw new Error(`No ${name} cookie`);
    return match[1];
  };

  beforeAll(async () => {
    vi.resetModules();
    helpers = await import('./helpers.js');
    hashToken = (await import('../src/lib/tokens.js')).hashToken;
  });
  afterAll(async () => {
    await helpers.prisma.$disconnect();
  });

  it('stores a registered password as a bcrypt hash and the session token only as its SHA-256', async () => {
    const email = `hardening-register-${stamp}@example.com`;
    const res = await request(helpers.app)
      .post('/api/auth/register')
      .send({ name: 'Hardening Test', email, password: helpers.PASSWORD });
    expect(res.status).toBe(201);

    const user = await helpers.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(user.passwordHash).not.toContain(helpers.PASSWORD);

    const raw = cookieValue(res, 'pb_session');
    const session = await helpers.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.tokenHash).toBe(hashToken(raw));
    expect(JSON.stringify(session)).not.toContain(raw);
  });

  it('stores the reset token only as its SHA-256', async () => {
    const user = await helpers.createUser({ email: `hardening-reset-${stamp}@example.com` });
    await request(helpers.app).post('/api/auth/forgot-password').send({ email: user.email });

    const raw = helpers.tokenFromLastResetMail();
    const record = await helpers.prisma.emailToken.findFirstOrThrow({ where: { userId: user.id, type: 'RESET' } });
    expect(record.tokenHash).toBe(hashToken(raw));
    expect(JSON.stringify(record)).not.toContain(raw);
  });

  it('stores the guest token only as its SHA-256, and its cookie is Secure on the production app', async () => {
    const prod = await loadApp(PROD_ENV);
    const res = await request(prod).get('/api/projects/feed').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(200);

    const cookie = cookieHeader(res);
    expect(cookie).toMatch(/;\s*Secure/);
    expect(cookie).toMatch(/;\s*HttpOnly/);
    expect(cookie).toMatch(/;\s*SameSite=Lax/);

    const raw = cookieValue(res, 'pb_guest');
    const guest = await helpers.prisma.guestSession.findUniqueOrThrow({ where: { tokenHash: hashToken(raw) } });
    expect(JSON.stringify(guest)).not.toContain(raw);
  });
});
