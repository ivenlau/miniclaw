import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import dotenv from 'dotenv';
import { ConfigSchema, type AppConfig } from './schema.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('config');

let config: AppConfig | null = null;

export function loadConfig(configPath?: string, envPath?: string): AppConfig {
  // Load .env — prefer explicit path, fallback to CWD
  dotenv.config({ path: envPath ?? '.env' });

  const filePath = configPath ?? findConfigFile();
  if (filePath && fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = YAML.parse(raw);
    config = ConfigSchema.parse(parsed);
    log.info({ path: filePath }, 'Config loaded');
  } else {
    config = ConfigSchema.parse({});
    log.info('No config file found, using defaults');
  }

  return config;
}

/**
 * Load config and resolve relative paths against a home directory.
 */
export function loadConfigWithHome(home: string, configPath?: string, envPath?: string): AppConfig {
  const cfg = loadConfig(
    configPath ?? findConfigFileInHome(home) ?? undefined,
    envPath ?? path.join(home, '.env'),
  );
  return resolveConfigPaths(cfg, home);
}

export function getConfig(): AppConfig {
  if (!config) throw new Error('Config not loaded. Call loadConfig() first.');
  return config;
}

/**
 * Search for config file. Priority: home dir > CWD.
 */
function findConfigFile(): string | null {
  const candidates = ['config.yaml', 'config.yml'];
  for (const name of candidates) {
    const full = path.resolve(name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function findConfigFileInHome(home: string): string | null {
  const candidates = ['config.yaml', 'config.yml'];
  // Search home dir first
  for (const name of candidates) {
    const full = path.join(home, name);
    if (fs.existsSync(full)) return full;
  }
  // Fallback to CWD (dev mode compat)
  return findConfigFile();
}

/**
 * Resolve relative memory paths to absolute, based on home.
 */
function resolveConfigPaths(cfg: AppConfig, home: string): AppConfig {
  const lt = cfg.memory.longTerm;
  if (!path.isAbsolute(lt.coreFile)) {
    (lt as any).coreFile = path.resolve(home, lt.coreFile);
  }
  if (!path.isAbsolute(lt.topicDir)) {
    (lt as any).topicDir = path.resolve(home, lt.topicDir);
  }
  return cfg;
}

// ── Raw YAML read/write (for `miniclaw config` commands) ──

/** Read raw YAML as plain object (no schema validation, preserves ${ENV} refs). */
export function readRawConfig(configPath: string): Record<string, any> {
  if (!fs.existsSync(configPath)) return {};
  const raw = fs.readFileSync(configPath, 'utf-8');
  return YAML.parse(raw) ?? {};
}

/** Write plain object back as YAML. */
export function writeRawConfig(configPath: string, data: Record<string, any>): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const yaml = YAML.stringify(data, { indent: 2 });
  fs.writeFileSync(configPath, yaml, 'utf-8');
}
