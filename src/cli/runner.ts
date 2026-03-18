import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { getCLITool } from './registry.js';
import { getConfig } from '../config/loader.js';
import { cleanOutput } from '../chat/formatter.js';
import { eventBus } from '../utils/events.js';
import { createLogger } from '../utils/logger.js';
import type { CLITaskRequest } from './types.js';

const log = createLogger('cli:runner');

const activeProcesses = new Map<string, ChildProcess>();

export async function runCLITask(request: CLITaskRequest): Promise<string> {
  const tool = getCLITool(request.tool);
  const config = getConfig();
  const toolConfig = config.cli.tools[request.tool];
  const timeout = (toolConfig?.timeout ?? 600) * 1000;

  const { command, args } = tool.buildCommand(request.prompt);

  // Resolve ~ and normalize path
  const rawCwd = request.workspace.startsWith('~')
    ? request.workspace.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? '.')
    : request.workspace;
  const cwd = path.resolve(rawCwd);

  log.info({ tool: request.tool, command, cwd }, 'Starting CLI task');

  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    activeProcesses.set(request.sessionId, child);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      eventBus.emit('cli:progress', {
        sessionId: request.sessionId,
        output: text,
      });
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI task timed out after ${timeout / 1000}s`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      activeProcesses.delete(request.sessionId);

      const output = cleanOutput(stdout || stderr);
      log.info({ exitCode: code, outputLen: output.length }, 'CLI task finished');

      if (code === 0) {
        eventBus.emit('cli:complete', {
          sessionId: request.sessionId,
          output,
          exitCode: code ?? 0,
        });
        resolve(output);
      } else {
        const error = `Exit code ${code}: ${output}`;
        eventBus.emit('cli:error', {
          sessionId: request.sessionId,
          error,
        });
        reject(new Error(error));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      activeProcesses.delete(request.sessionId);
      log.error({ err }, 'CLI process error');
      eventBus.emit('cli:error', {
        sessionId: request.sessionId,
        error: err.message,
      });
      reject(err);
    });
  });
}

export function stopCLITask(sessionId: string): boolean {
  const child = activeProcesses.get(sessionId);
  if (child) {
    child.kill('SIGTERM');
    activeProcesses.delete(sessionId);
    log.info({ sessionId }, 'CLI task stopped');
    return true;
  }
  return false;
}

export function hasActiveTask(sessionId: string): boolean {
  return activeProcesses.has(sessionId);
}
