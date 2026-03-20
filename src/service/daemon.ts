import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { getPidPath, getLogPath, initHome } from './paths.js';

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
  configPath?: string;
  logPath?: string;
}

function readPidFile(home: string): { pid: number; startTime: number } | null {
  initHome(home);
  const pidPath = getPidPath();
  if (!fs.existsSync(pidPath)) return null;
  const content = fs.readFileSync(pidPath, 'utf-8').trim();
  const [pidStr, tsStr] = content.split('\n');
  const pid = parseInt(pidStr, 10);
  const startTime = parseInt(tsStr, 10);
  if (isNaN(pid)) return null;
  return { pid, startTime: isNaN(startTime) ? 0 : startTime };
}

export function isRunning(home: string): boolean {
  const info = readPidFile(home);
  if (!info) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function daemonStatus(home: string): DaemonStatus {
  initHome(home);
  const info = readPidFile(home);
  const running = info ? isRunning(home) : false;

  return {
    running,
    pid: running ? info?.pid : undefined,
    uptime: running && info?.startTime ? Date.now() - info.startTime : undefined,
    configPath: path.join(home, 'config.yaml'),
    logPath: getLogPath(),
  };
}

export function daemonStart(home: string): number {
  initHome(home);

  if (isRunning(home)) {
    const info = readPidFile(home)!;
    throw new Error(`MiniClaw is already running (PID ${info.pid})`);
  }

  const logPath = getLogPath();
  const logFd = fs.openSync(logPath, 'a');

  // Resolve entry point: prefer dist/index.js, fallback to src/index.ts via tsx
  const distEntry = path.resolve('dist', 'index.js');
  const srcEntry = path.resolve('src', 'index.ts');

  let command: string;
  let args: string[];

  if (fs.existsSync(distEntry)) {
    command = process.execPath; // node
    args = [distEntry];
  } else {
    // Dev mode: use tsx
    command = process.execPath;
    args = [path.resolve('node_modules', '.bin', 'tsx'), srcEntry];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, MINICLAW_HOME: home },
  });

  const pid = child.pid!;

  // Write PID file from parent
  const pidPath = getPidPath();
  fs.writeFileSync(pidPath, `${pid}\n${Date.now()}`, 'utf-8');

  child.unref();
  fs.closeSync(logFd);

  return pid;
}

export async function daemonStop(home: string): Promise<void> {
  initHome(home);

  if (!isRunning(home)) {
    throw new Error('MiniClaw is not running');
  }

  const info = readPidFile(home)!;

  // Send SIGTERM
  process.kill(info.pid, 'SIGTERM');

  // Wait up to 5 seconds for process to exit
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(info.pid, 0);
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      // Process exited
      break;
    }
  }

  // Force kill if still alive
  try {
    process.kill(info.pid, 0);
    process.kill(info.pid, 'SIGKILL');
  } catch {
    // already dead
  }

  // Cleanup PID file
  const pidPath = getPidPath();
  if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
}
