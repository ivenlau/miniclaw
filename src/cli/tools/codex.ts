import type { CLITool } from '../types.js';

export class CodexTool implements CLITool {
  readonly name = 'codex';
  private command: string;
  private baseArgs: string[];

  constructor(command: string, args: string[]) {
    this.command = command;
    this.baseArgs = args;
  }

  buildCommand(prompt: string) {
    return {
      command: this.command,
      args: [...this.baseArgs],
      stdinPrompt: prompt,
    };
  }
}
