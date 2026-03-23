import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { readRawConfig, writeRawConfig } from '../config/loader.js';
import { getConfigPath, getEnvPath } from './paths.js';

// ── Helpers ──

export function deepGet(obj: any, dotPath: string): any {
  return dotPath.split('.').reduce((o, k) => o?.[k], obj);
}

export function deepSet(obj: any, dotPath: string, value: any): void {
  const keys = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  // Auto-convert booleans and numbers
  if (value === 'true') value = true;
  else if (value === 'false') value = false;
  else if (/^\d+$/.test(value)) value = parseInt(value, 10);

  cur[keys[keys.length - 1]] = value;
}

export function maskSecret(value: string): string {
  if (!value || value.length < 8) return '***';
  if (value.startsWith('${')) return value; // env var ref
  return value.slice(0, 3) + '***' + value.slice(-3);
}

export function maskSecrets(obj: any, secretKeys = ['apiKey', 'clientSecret', 'appSecret']): any {
  if (typeof obj !== 'object' || obj == null) return obj;
  const out: any = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (secretKeys.includes(k) && typeof v === 'string') {
      out[k] = maskSecret(v);
    } else if (typeof v === 'object' && v != null) {
      out[k] = maskSecrets(v, secretKeys);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/** If value is ${VAR} format, ensure the var name is in .env file. */
export function ensureEnvVar(envPath: string, value: string): string | null {
  const match = value.match(/^\$\{(.+)\}$/);
  if (!match) return null;
  const varName = match[1];

  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  if (!content.includes(`${varName}=`)) {
    const line = `${varName}=\n`;
    fs.appendFileSync(envPath, content.endsWith('\n') || !content ? line : `\n${line}`, 'utf-8');
  }

  return varName;
}

/**
 * Write a raw API key value to .env under an auto-generated variable name.
 * Returns the variable name (e.g. "DEEPSEEK_API_KEY").
 */
export function writeApiKeyToEnv(envPath: string, providerName: string, apiKey: string): string {
  const varName = `${providerName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;

  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  // Replace existing or append
  const regex = new RegExp(`^${varName}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${varName}=${apiKey}`);
  } else {
    const line = `${varName}=${apiKey}\n`;
    content += content.endsWith('\n') || !content ? line : `\n${line}`;
  }

  fs.writeFileSync(envPath, content, 'utf-8');
  return varName;
}

// ── Commands ──

export function configShow(): void {
  const raw = readRawConfig(getConfigPath());
  const masked = maskSecrets(raw);
  console.log(JSON.stringify(masked, null, 2));
}

export function configSet(key: string, value: string): void {
  const configPath = getConfigPath();
  const raw = readRawConfig(configPath);
  deepSet(raw, key, value);
  writeRawConfig(configPath, raw);
  console.log(`✓ 已设置 ${key} = ${value}`);
  console.log(`  配置文件: ${configPath}`);
}

export function configModelList(): void {
  const raw = readRawConfig(getConfigPath());
  const providers = raw.llm?.providers ?? {};
  const defaultProvider = raw.llm?.provider ?? 'zhipuai';

  if (Object.keys(providers).length === 0) {
    console.log('未配置任何模型提供商。使用 miniclaw config model add 添加。');
    return;
  }

  for (const [name, cfg] of Object.entries(providers) as [string, any][]) {
    const isDefault = name === defaultProvider ? ' (默认)' : '';
    const model = cfg.model ?? name;
    const key = cfg.apiKey ? maskSecret(cfg.apiKey) : '未设置';
    console.log(`${name}${isDefault}: model=${model}, apiKey=${key}, baseUrl=${cfg.baseUrl ?? '默认'}`);
  }
}

export async function configModelAdd(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const envPath = getEnvPath();
  const configPath = getConfigPath();

  try {
    const name = (await prompt(rl, '? 提供商名称: ')).trim();
    if (!name) { console.log('已取消'); return; }

    const baseUrl = (await prompt(rl, '? API Base URL: ')).trim();
    const model = (await prompt(rl, '? 模型 ID: ')).trim();
    const apiKey = (await prompt(rl, '? API Key (直接输入或 ${ENV_VAR} 引用): ')).trim();
    const endpointId = (await prompt(rl, '? Endpoint ID (可选，按回车跳过): ')).trim();

    const raw = readRawConfig(configPath);
    if (!raw.llm) raw.llm = {};
    if (!raw.llm.providers) raw.llm.providers = {};

    const provider: any = { apiKey, baseUrl };
    if (model) provider.model = model;
    if (endpointId) provider.endpointId = endpointId;

    raw.llm.providers[name] = provider;
    writeRawConfig(configPath, raw);

    console.log(`\n✓ 已添加提供商 ${name}`);
    console.log(`  配置文件: ${configPath}`);

    const envVars: string[] = [];
    const v1 = ensureEnvVar(envPath, apiKey);
    if (v1) envVars.push(v1);
    if (endpointId) {
      const v2 = ensureEnvVar(envPath, endpointId);
      if (v2) envVars.push(v2);
    }
    if (envVars.length > 0) {
      console.log(`  提示: 如使用环境变量，请在 ${envPath} 中设置 ${envVars.join(', ')}`);
    }
  } finally {
    rl.close();
  }
}

export function configModelRemove(name: string): void {
  const configPath = getConfigPath();
  const raw = readRawConfig(configPath);

  if (!raw.llm?.providers?.[name]) {
    console.error(`提供商 "${name}" 不存在`);
    process.exit(1);
  }

  delete raw.llm.providers[name];
  writeRawConfig(configPath, raw);
  console.log(`✓ 已删除提供商 ${name}`);
}

export function configModelDefault(name: string): void {
  const configPath = getConfigPath();
  const raw = readRawConfig(configPath);
  if (!raw.llm) raw.llm = {};
  raw.llm.provider = name;
  writeRawConfig(configPath, raw);
  console.log(`✓ 已设置默认提供商为 ${name}`);
}

export function configChatList(): void {
  const raw = readRawConfig(getConfigPath());
  const adapters = raw.chat?.adapters ?? {};

  const platforms: [string, string, boolean][] = [
    ['dingtalk', '钉钉', adapters.dingtalk?.enabled ?? false],
    ['feishu', '飞书', adapters.feishu?.enabled ?? false],
  ];

  for (const [, label, enabled] of platforms) {
    const status = enabled ? '✓ 已启用' : '✗ 未启用';
    console.log(`${label}: ${status}`);
  }
}

export async function configChatSetup(platform: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const envPath = getEnvPath();
  const configPath = getConfigPath();

  try {
    const raw = readRawConfig(configPath);
    if (!raw.chat) raw.chat = {};
    if (!raw.chat.adapters) raw.chat.adapters = {};

    const envVars: string[] = [];

    if (platform === 'dingtalk') {
      const clientId = (await prompt(rl, '? Client ID (直接输入或 ${ENV_VAR} 引用): ')).trim();
      const clientSecret = (await prompt(rl, '? Client Secret (直接输入或 ${ENV_VAR} 引用): ')).trim();
      const enable = (await prompt(rl, '? 是否立即启用? (Y/n): ')).trim().toLowerCase();

      raw.chat.adapters.dingtalk = {
        enabled: enable !== 'n',
        clientId,
        clientSecret,
      };

      const v1 = ensureEnvVar(envPath, clientId);
      const v2 = ensureEnvVar(envPath, clientSecret);
      if (v1) envVars.push(v1);
      if (v2) envVars.push(v2);

      writeRawConfig(configPath, raw);
      console.log(`\n✓ 已配置钉钉适配器`);
    } else if (platform === 'feishu') {
      const appId = (await prompt(rl, '? App ID (直接输入或 ${ENV_VAR} 引用): ')).trim();
      const appSecret = (await prompt(rl, '? App Secret (直接输入或 ${ENV_VAR} 引用): ')).trim();
      const enable = (await prompt(rl, '? 是否立即启用? (Y/n): ')).trim().toLowerCase();

      raw.chat.adapters.feishu = {
        enabled: enable !== 'n',
        appId,
        appSecret,
      };

      const v1 = ensureEnvVar(envPath, appId);
      const v2 = ensureEnvVar(envPath, appSecret);
      if (v1) envVars.push(v1);
      if (v2) envVars.push(v2);

      writeRawConfig(configPath, raw);
      console.log(`\n✓ 已配置飞书适配器`);
    } else {
      console.error(`未知平台: ${platform}。支持: dingtalk, feishu`);
      process.exit(1);
    }

    console.log(`  配置文件: ${configPath}`);
    if (envVars.length > 0) {
      console.log(`  提示: 如使用环境变量，请在 ${envPath} 中设置 ${envVars.join(', ')}`);
    }
    console.log(`  注意: 配置修改后需 miniclaw restart 生效`);
  } finally {
    rl.close();
  }
}

export function configChatEnable(platform: string): void {
  const configPath = getConfigPath();
  const raw = readRawConfig(configPath);
  if (!raw.chat?.adapters?.[platform]) {
    console.error(`平台 "${platform}" 未配置。请先运行: miniclaw config chat setup ${platform}`);
    process.exit(1);
  }
  raw.chat.adapters[platform].enabled = true;
  writeRawConfig(configPath, raw);
  console.log(`✓ 已启用 ${platform}`);
}

export function configChatDisable(platform: string): void {
  const configPath = getConfigPath();
  const raw = readRawConfig(configPath);
  if (!raw.chat?.adapters?.[platform]) {
    console.error(`平台 "${platform}" 未配置`);
    process.exit(1);
  }
  raw.chat.adapters[platform].enabled = false;
  writeRawConfig(configPath, raw);
  console.log(`✓ 已禁用 ${platform}`);
}
