import 'dotenv/config';
import { defineConfig } from 'vitest/config';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is not set in server/.env (tests use a separate schema, e.g. projectbridge_test).');
}

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      // The test schema is used for both runtime and schema push, so real data is never touched.
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testDatabaseUrl,
      MAIL_TRANSPORT: 'memory',
      MEDIA_DRIVER: 'memory',
      APP_URL: 'http://localhost:5173',
      BCRYPT_ROUNDS: '4',
      LOGIN_MAX_ATTEMPTS: '5',
      AUTH_RATE_LIMIT: '1000',
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    },
    globalSetup: ['./tests/globalSetup.ts'],
    // Tests share one database schema, so files run one at a time.
    fileParallelism: false,
    // The database is remote (Supabase), so allow for network latency.
    testTimeout: 30000,
    hookTimeout: 60000,
    reporters: ['verbose'],
  },
});
