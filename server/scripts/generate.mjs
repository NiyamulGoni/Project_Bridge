// Builds the Prisma client from prisma/schema.prisma. It runs by itself on `npm install`,
// `npm run dev`, `npm start` and `npm test` (from the project root or from server/), so nobody
// has to run `npx prisma generate` by hand. The data itself lives in Supabase; this only builds code.
//
// On Windows a running server keeps the Prisma engine file open, so rebuilding fails. If a client
// already exists, that is not fatal: the existing one is used and a warning says so.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(serverDir, 'package.json'));

let cli;
try {
  cli = require.resolve('prisma/build/index.js');
} catch {
  console.error('\n[prisma] The prisma package is not installed. Run `npm install` in the project folder first.\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, [cli, 'generate'], { cwd: serverDir, stdio: 'inherit' });
if (result.status === 0) process.exit(0);

const existing = [join(serverDir, 'node_modules/.prisma/client/index.js'), join(serverDir, '../node_modules/.prisma/client/index.js')].some(existsSync);
if (existing) {
  console.warn(
    '\n[prisma] Could not rebuild the Prisma client, probably because another server is using it (common on Windows).' +
      '\n[prisma] Carrying on with the existing client. If the schema changed, stop all running servers and start again.\n',
  );
  process.exit(0);
}
console.error('\n[prisma] Could not build the Prisma client. Stop any running servers and run `npm install` again.\n');
process.exit(1);
