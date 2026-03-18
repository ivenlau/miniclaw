import type { CLITool } from './types.js';
import type { AppConfig } from '../config/schema.js';
import { ClaudeCodeTool } from './tools/claude-code.js';
import { CodexTool } from './tools/codex.js';
import { OpenCodeTool } from './tools/opencode.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('cli:registry');
const tools = new Map<string, CLITool>();

export function initCLITools(config: AppConfig) {
  const toolConfigs = config.cli.tools;

  if (toolConfigs['claude-code']) {
    const cfg = toolConfigs['claude-code'];
    tools.set('claude-code', new ClaudeCodeTool(cfg.command, cfg.args));
  }
  if (toolConfigs['codex']) {
    const cfg = toolConfigs['codex'];
    tools.set('codex', new CodexTool(cfg.command, cfg.args));
  }
  if (toolConfigs['opencode']) {
    const cfg = toolConfigs['opencode'];
    tools.set('opencode', new OpenCodeTool(cfg.command, cfg.args));
  }

  log.info({ tools: [...tools.keys()] }, 'CLI tools registered');
}

export function getCLITool(name: string): CLITool {
  const tool = tools.get(name);
  if (!tool) throw new Error(`CLI tool "${name}" not found. Available: ${[...tools.keys()].join(', ')}`);
  return tool;
}

export function listCLITools(): string[] {
  return [...tools.keys()];
}
