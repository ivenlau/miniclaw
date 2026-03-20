import { startService } from './service/lifecycle.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('main');

startService().catch((err) => {
  log.fatal({ err }, 'Failed to start MiniClaw');
  process.exit(1);
});
