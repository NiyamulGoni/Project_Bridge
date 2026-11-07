import 'dotenv/config';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

/** A number of proxy hops, or a value Express understands such as "loopback". */
function trustProxy(raw: string | undefined): number | string {
  const value = raw?.trim();
  if (!value) return 'loopback';
  return /^\d+$/.test(value) ? Number(value) : value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  /** Set only by an explicit NODE_ENV=development, so a deployment missing NODE_ENV gets no dev allowances. */
  isExplicitDev: process.env.NODE_ENV === 'development',
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  port: int('PORT', 4000),
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  bcryptRounds: int('BCRYPT_ROUNDS', 12),
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  resetTokenTtlMs: 60 * 60 * 1000,
  loginMaxAttempts: int('LOGIN_MAX_ATTEMPTS', 5),
  authRateLimit: int('AUTH_RATE_LIMIT', 20),
  inviteRateLimit: int('INVITE_RATE_LIMIT', 20),
  reportRateLimit: int('REPORT_RATE_LIMIT', 10),
  guestCardLimit: 20,
  feedPageSize: 10,
  /** Screenshots and cover images (FR02): optional, stored in Supabase Storage. */
  media: {
    /** "supabase" (default) or "memory" (tests). */
    driver: process.env.MEDIA_DRIVER ?? 'supabase',
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    /** Private: screenshots are shown only to tiers allowed to see demo material. */
    bucket: process.env.MEDIA_BUCKET ?? 'project-media',
    /** Public: the cover is the card thumbnail every tier sees. */
    coverBucket: process.env.COVER_BUCKET ?? 'project-covers',
    maxFiles: 5,
    maxBytes: 2 * 1024 * 1024,
    /** A signed URL stays valid after its project is hidden or deleted, so it is kept short. */
    signedUrlTtlSeconds: 15 * 60,
  },
  /** OAuth client ID for "Sign in with Google"; empty disables it. */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  mail: {
    /** "smtp" (default) or "memory" (tests). */
    transport: process.env.MAIL_TRANSPORT ?? 'smtp',
    from: process.env.MAIL_FROM ?? 'ProjectBridge <no-reply@projectbridge.test>',
    host: process.env.SMTP_HOST ?? '',
    port: int('SMTP_PORT', 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
};

// The HTTPS redirect, Secure cookies and the Origin check all rely on this URL.
if (config.isProd && !config.appUrl.startsWith('https://')) {
  throw new Error('APP_URL must start with https:// when NODE_ENV is production.');
}

// Behind a proxy this decides whether a request counts as HTTPS. If it is wrong, every request looks
// like HTTP and the redirect loops forever, while the exempt health check still reports a healthy deploy.
if (config.isProd && !process.env.TRUST_PROXY?.trim()) {
  throw new Error('TRUST_PROXY must be set when NODE_ENV is production: a number of proxy hops (most hosting platforms need 1), or loopback for a proxy on this machine.');
}
