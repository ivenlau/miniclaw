#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { initHome, getConfigPath, getEnvPath } from './service/paths.js';
import { daemonStart, daemonStop, daemonStatus, isRunning } from './service/daemon.js';

const program = new Command();

program
  .name('miniclaw')
  .description('MiniClaw — AI Agent 代理工具')
  .version('0.1.0')
  .option('--home <path>', 'MINICLAW_HOME directory');

function resolveHome(): string {
  const opts = program.opts();
  return initHome(opts.home);
}

// ── miniclaw start ──
program
  .command('start')
  .description('启动 MiniClaw 后台服务')
  .action(() => {
    const home = resolveHome();
    try {
      const pid = daemonStart(home);
      console.log(`✓ MiniClaw 已启动 (PID ${pid})`);
      console.log(`  日志: ${path.join(home, 'miniclaw.log')}`);
    } catch (err: any) {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    }
  });

// ── miniclaw stop ──
program
  .command('stop')
  .description('停止 MiniClaw 后台服务')
  .action(async () => {
    const home = resolveHome();
    try {
      await daemonStop(home);
      console.log('✓ MiniClaw 已停止');
    } catch (err: any) {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    }
  });

// ── miniclaw restart ──
program
  .command('restart')
  .description('重启 MiniClaw 后台服务')
  .action(async () => {
    const home = resolveHome();
    if (isRunning(home)) {
      await daemonStop(home);
      console.log('✓ 已停止旧服务');
    }
    const pid = daemonStart(home);
    console.log(`✓ MiniClaw 已重启 (PID ${pid})`);
  });

// ── miniclaw status ──
program
  .command('status')
  .description('查看 MiniClaw 服务状态')
  .action(() => {
    const home = resolveHome();
    const status = daemonStatus(home);
    if (status.running) {
      const uptimeSec = Math.floor((status.uptime ?? 0) / 1000);
      const h = Math.floor(uptimeSec / 3600);
      const m = Math.floor((uptimeSec % 3600) / 60);
      const s = uptimeSec % 60;
      console.log(`✓ MiniClaw 运行中`);
      console.log(`  PID: ${status.pid}`);
      console.log(`  运行时间: ${h}h ${m}m ${s}s`);
      console.log(`  配置: ${status.configPath}`);
      console.log(`  日志: ${status.logPath}`);
    } else {
      console.log('✗ MiniClaw 未运行');
    }
  });

// ── miniclaw init ──
program
  .command('init')
  .description('在 home 目录初始化配置模板')
  .action(() => {
    const home = resolveHome();
    const configPath = getConfigPath();
    const envPath = getEnvPath();

    if (!fs.existsSync(configPath)) {
      const template = `# MiniClaw 配置文件
# 详情参考项目文档

llm:
  provider: zhipuai
  providers:
    zhipuai:
      apiKey: \${ZHIPUAI_API_KEY}
      baseUrl: https://open.bigmodel.cn/api/paas/v4
      model: glm-4-flash

chat:
  adapters:
    dingtalk:
      enabled: false
      clientId: \${DINGTALK_CLIENT_ID}
      clientSecret: \${DINGTALK_CLIENT_SECRET}
    feishu:
      enabled: false
      appId: \${FEISHU_APP_ID}
      appSecret: \${FEISHU_APP_SECRET}

scheduler:
  enabled: true
`;
      fs.writeFileSync(configPath, template, 'utf-8');
      console.log(`✓ 已创建配置文件: ${configPath}`);
    } else {
      console.log(`  配置文件已存在: ${configPath}`);
    }

    if (!fs.existsSync(envPath)) {
      const envTemplate = `# MiniClaw 环境变量
# 在下方填入实际值

ZHIPUAI_API_KEY=
DINGTALK_CLIENT_ID=
DINGTALK_CLIENT_SECRET=
FEISHU_APP_ID=
FEISHU_APP_SECRET=
`;
      fs.writeFileSync(envPath, envTemplate, 'utf-8');
      console.log(`✓ 已创建环境变量文件: ${envPath}`);
    } else {
      console.log(`  环境变量文件已存在: ${envPath}`);
    }

    console.log(`\n下一步: 编辑 ${configPath} 和 ${envPath}，然后运行 miniclaw start`);
  });

// ── miniclaw config ──
const configCmd = program
  .command('config')
  .description('配置管理');

configCmd
  .command('show')
  .description('显示完整配置（API Key/Secret 已遮蔽）')
  .action(async () => {
    resolveHome();
    const { configShow } = await import('./service/config-cli.js');
    configShow();
  });

configCmd
  .command('set <key> <value>')
  .description('设置配置项（点号路径，如 llm.provider）')
  .action(async (key: string, value: string) => {
    resolveHome();
    const { configSet } = await import('./service/config-cli.js');
    configSet(key, value);
  });

// config model subcommands
const modelCmd = configCmd
  .command('model')
  .description('模型提供商管理');

modelCmd
  .command('list')
  .description('列出所有已配置的模型提供商')
  .action(async () => {
    resolveHome();
    const { configModelList } = await import('./service/config-cli.js');
    configModelList();
  });

modelCmd
  .command('add')
  .description('交互式添加新模型提供商')
  .action(async () => {
    resolveHome();
    const { configModelAdd } = await import('./service/config-cli.js');
    await configModelAdd();
  });

modelCmd
  .command('remove <name>')
  .description('删除模型提供商')
  .action(async (name: string) => {
    resolveHome();
    const { configModelRemove } = await import('./service/config-cli.js');
    configModelRemove(name);
  });

modelCmd
  .command('default <name>')
  .description('设置默认模型提供商')
  .action(async (name: string) => {
    resolveHome();
    const { configModelDefault } = await import('./service/config-cli.js');
    configModelDefault(name);
  });

// config chat subcommands
const chatCmd = configCmd
  .command('chat')
  .description('聊天平台管理');

chatCmd
  .command('list')
  .description('列出所有聊天平台及启用状态')
  .action(async () => {
    resolveHome();
    const { configChatList } = await import('./service/config-cli.js');
    configChatList();
  });

chatCmd
  .command('setup <platform>')
  .description('交互式配置聊天平台 (dingtalk / feishu)')
  .action(async (platform: string) => {
    resolveHome();
    const { configChatSetup } = await import('./service/config-cli.js');
    await configChatSetup(platform);
  });

chatCmd
  .command('enable <platform>')
  .description('启用聊天平台')
  .action(async (platform: string) => {
    resolveHome();
    const { configChatEnable } = await import('./service/config-cli.js');
    configChatEnable(platform);
  });

chatCmd
  .command('disable <platform>')
  .description('禁用聊天平台')
  .action(async (platform: string) => {
    resolveHome();
    const { configChatDisable } = await import('./service/config-cli.js');
    configChatDisable(platform);
  });

// ── miniclaw tui ──
program
  .command('tui')
  .description('启动 TUI 交互式对话（需服务已启动）')
  .action(async () => {
    const home = resolveHome();
    const { startTUI } = await import('./tui/chat.js');
    await startTUI(home);
  });

program.parse();
