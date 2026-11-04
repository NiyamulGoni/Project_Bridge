import { createApp } from './app.js';
import { config } from './config.js';

// Express 5 reports listen errors (e.g. port already in use) through this callback.
createApp().listen(config.port, (error?: Error) => {
  if (error) {
    console.error(`Could not start the API on port ${config.port}: ${error.message}`);
    process.exit(1);
  }
  console.log(`ProjectBridge API listening on http://localhost:${config.port}`);
});
