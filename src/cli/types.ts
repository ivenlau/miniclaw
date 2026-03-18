export interface CLIToolConfig {
  command: string;
  args: string[];
  timeout: number;
}

export interface CLITaskRequest {
  tool: string;
  prompt: string;
  workspace: string;
  sessionId: string;
}

export interface CLITool {
  name: string;
  buildCommand(prompt: string): { command: string; args: string[]; stdinPrompt?: string };
}
