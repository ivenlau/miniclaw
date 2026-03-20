import fs from 'node:fs';
import { createLogger } from '../utils/logger.js';
import { initHome, getHome, getConfigPath, getEnvPath, getDataDir, getPidPath, getIpcPath } from './paths.js';
import { loadConfigWithHome } from '../config/loader.js';
import { initDb, closeDb } from '../utils/db.js';
import { initLLMProviders } from '../llm/registry.js';
import { initCLITools } from '../cli/registry.js';
import { registerAdapter, startAllAdapters, stopAllAdapters } from '../chat/registry.js';
import { DingtalkAdapter } from '../chat/adapters/dingtalk.js';
import { FeishuAdapter } from '../chat/adapters/feishu.js';
import { initScheduler, stopScheduler } from '../scheduler/manager.js';
import { handleMessage } from '../agent/orchestrator.js';

const log = createLogger('lifecycle');

let ipcServer: import('node:net').Server | null = null;

export interface StartOptions {
  home?: string;
  foreground?: boolean;
  enableIpc?: boolean;
}

export async function startService(options?: StartOptions) {
  const home = initHome(options?.home ?? process.env.MINICLAW_HOME);
  log.info({ home }, 'MiniClaw starting...');

  // 1. Load config with home-aware path resolution
  const config = loadConfigWithHome(home);
  log.info({ provider: config.llm.provider }, 'Config loaded');

  // 2. Init database
  const dataDir = getDataDir();
  initDb(dataDir);

  // 3. Init LLM providers
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

  // 8. Start IPC server (for TUI connections)
  const enableIpc = options?.enableIpc ?? true;
  if (enableIpc) {
    const { startIpcServer } = await import('./ipc.js');
    ipcServer = startIpcServer(getIpcPath());
  }

  // 9. Write PID file
  const pidPath = getPidPath();
  fs.writeFileSync(pidPath, `${process.pid}\n${Date.now()}`, 'utf-8');

  // 10. Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down...');
    await stopService();
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

  log.info('MiniClaw is ready!');
}

export async function stopService() {
  stopScheduler();
  await stopAllAdapters();

  // Close IPC server
  if (ipcServer) {
    ipcServer.close();
    ipcServer = null;
  }

  closeDb();

  // Remove PID file
  try {
    const pidPath = getPidPath();
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
  } catch {
    // ignore
  }
}
