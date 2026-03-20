import { createLogger } from './utils/logger.js';
import { loadConfig } from './config/loader.js';
import { initDb, closeDb } from './utils/db.js';
import { initLLMProviders } from './llm/registry.js';
import { initCLITools } from './cli/registry.js';
import { registerAdapter, startAllAdapters, stopAllAdapters } from './chat/registry.js';
import { DingtalkAdapter } from './chat/adapters/dingtalk.js';
import { FeishuAdapter } from './chat/adapters/feishu.js';
import { initScheduler, stopScheduler } from './scheduler/manager.js';
import { handleMessage } from './agent/orchestrator.js';
import path from 'node:path';

const log = createLogger('main');

async function main() {
  log.info('🤖 MiniClaw starting...');

  // 1. Load config
  const config = loadConfig();
  log.info({ provider: config.llm.provider }, 'Config loaded');

  // 2. Init database
  const dataDir = path.resolve('./data');
  initDb(dataDir);

  // 3. Init LLM providers (now using pi-ai models)
  initLLMProviders(config);

  // 4. Init CLI tools
  initCLITools(config);

  // 5. Init chat adapters
  const chatConfig = config.chat.adapters;

  if (chatConfig.dingtalk.enabled && chatConfig.dingtalk.clientId) {
    const adapter = new DingtalkAdapter(chatConfig.dingtalk.clientId, chatConfig.dingtalk.clientSecret);
    adapter.onMessage((msg) => handleMessage(msg, adapter));
    registerAdapter(adapter);
  }

  if (chatConfig.feishu.enabled && chatConfig.feishu.appId) {
    const adapter = new FeishuAdapter(chatConfig.feishu.appId, chatConfig.feishu.appSecret);
    adapter.onMessage((msg) => handleMessage(msg, adapter));
    registerAdapter(adapter);
  }

  // 6. Start chat adapters
  await startAllAdapters();

  // 7. Init scheduler
  if (config.scheduler.enabled) {
    initScheduler();
  }

  log.info('🤖 MiniClaw is ready!');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down...');

    stopScheduler();
    await stopAllAdapters();
    closeDb();

    log.info('Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'Unhandled rejection');
  });
}

main().catch((err) => {
  log.fatal({ err }, 'Failed to start MiniClaw');
  process.exit(1);
});
