import { createApp } from './app.js';
import { config } from './config.js';
import { assertEncryptionConfigured } from './lib/crypto.js';

// The HTTPS redirect, Secure cookies and the checks below all depend on this, so a server missing it
// must not start and look healthy without them. .env loads when config.js is imported above.
if (!process.env.NODE_ENV) {
  console.error('Refusing to start the API: NODE_ENV is not set. Use production on a server and development on your own machine.');
  process.exit(1);
}

// Production refuses to start without usable keys rather than failing on the first encrypted write.
if (config.isProd) {
  try {
    assertEncryptionConfigured();
  } catch (error) {
    // These messages never hold key material.
    console.error(`Refusing to start the API: ${(error as Error).message}`);
    process.exit(1);
  }
}

// Express 5 reports listen errors (e.g. port already in use) through this callback.
createApp().listen(config.port, (error?: Error) => {
  if (error) {
    console.error(`Could not start the API on port ${config.port}: ${error.message}`);
    process.exit(1);
  }
  console.log(`ProjectBridge API listening on http://localhost:${config.port}`);
});
