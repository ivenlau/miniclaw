import type { CLITool } from '../types.js';

export class ClaudeCodeTool implements CLITool {
  readonly name = 'claude-code';
  private command: string;
  private baseArgs: string[];

  constructor(command: string, args: string[]) {
    this.command = command;
    this.baseArgs = args;
  }

  buildCommand(prompt: string) {
    return {
      command: this.command,
      args: [...this.baseArgs, '--dangerously-skip-permissions', '-p', prompt],
    };
  }
}
