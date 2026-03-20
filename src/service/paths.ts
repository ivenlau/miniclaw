import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

let home: string | null = null;

/**
 * Resolve MINICLAW_HOME and ensure it exists.
 * Priority: explicit arg > MINICLAW_HOME env > ~/.miniclaw/
 */
export function initHome(explicitHome?: string): string {
  home = explicitHome
    ?? process.env.MINICLAW_HOME
    ?? path.join(os.homedir(), '.miniclaw');

  fs.mkdirSync(home, { recursive: true });
  return home;
}

export function getHome(): string {
  if (!home) throw new Error('Home not initialized. Call initHome() first.');
  return home;
}

export function getConfigPath(): string {
  return path.join(getHome(), 'config.yaml');
}

export function getEnvPath(): string {
  return path.join(getHome(), '.env');
}

export function getDataDir(): string {
  return path.join(getHome(), 'data');
}

export function getPidPath(): string {
  return path.join(getHome(), 'miniclaw.pid');
}

export function getLogPath(): string {
  return path.join(getHome(), 'miniclaw.log');
}

export function getIpcPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\miniclaw';
  }
  return path.join(getHome(), 'miniclaw.sock');
}
