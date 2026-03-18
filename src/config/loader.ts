import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import dotenv from 'dotenv';
import { ConfigSchema, type AppConfig } from './schema.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('config');

let config: AppConfig | null = null;

export function loadConfig(configPath?: string): AppConfig {
  // Load .env first
  dotenv.config();

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

export function getConfig(): AppConfig {
  if (!config) throw new Error('Config not loaded. Call loadConfig() first.');
  return config;
}

function findConfigFile(): string | null {
  const candidates = ['config.yaml', 'config.yml'];
  for (const name of candidates) {
    const full = path.resolve(name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}
