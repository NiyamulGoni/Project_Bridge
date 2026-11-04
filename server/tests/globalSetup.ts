import { execSync } from 'node:child_process';

/**
 * Brings the separate test schema (projectbridge_test) up to the current Prisma schema.
 * Non-destructive: tests empty the tables themselves in `resetDb()`.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url?.includes('schema=projectbridge_test')) {
    throw new Error('Refusing to prepare a database that is not the projectbridge_test schema.');
  }
  execSync('npx prisma db push --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
