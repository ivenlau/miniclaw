import { z } from 'zod';

const envVar = z.string().transform((val) => {
  const match = val.match(/^\$\{(.+)\}$/);
  if (match) {
    return process.env[match[1]] ?? '';
  }
  return val;
});

const LLMProviderSchema = z.object({
  apiKey: envVar,
  baseUrl: z.string().url(),
  model: z.string().optional(),
  endpointId: envVar.optional(),
  groupId: envVar.optional(),
});

const CLIToolSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  timeout: z.number().default(600),
});

const PersonaSchema = z.object({
  name: z.string(),
  systemPrompt: z.string(),
  tone: z.enum(['professional', 'friendly', 'humorous']).default('professional'),
  language: z.string().default('zh-CN'),
});

export const ConfigSchema = z.object({
  server: z.object({
    port: z.number().default(3000),
    host: z.string().default('0.0.0.0'),
  }).default(() => ({ port: 3000, host: '0.0.0.0' })),

  workspace: z.object({
    default: z.string().default('~/workspace'),
    autoCreate: z.boolean().default(true),
  }).default(() => ({ default: '~/workspace', autoCreate: true })),

  llm: z.object({
    provider: z.string().default('zhipuai'),
    providers: z.record(z.string(), LLMProviderSchema).default(() => ({})),
  }).default(() => ({ provider: 'zhipuai', providers: {} })),

  chat: z.object({
    adapters: z.object({
      dingtalk: z.object({
        enabled: z.boolean().default(false),
        clientId: envVar.default(''),
        clientSecret: envVar.default(''),
      }).default(() => ({ enabled: false, clientId: '', clientSecret: '' })),
      feishu: z.object({
        enabled: z.boolean().default(false),
        appId: envVar.default(''),
        appSecret: envVar.default(''),
      }).default(() => ({ enabled: false, appId: '', appSecret: '' })),
    }).default(() => ({
      dingtalk: { enabled: false, clientId: '', clientSecret: '' },
      feishu: { enabled: false, appId: '', appSecret: '' },
    })),
  }).default(() => ({
    adapters: {
      dingtalk: { enabled: false, clientId: '', clientSecret: '' },
      feishu: { enabled: false, appId: '', appSecret: '' },
    },
  })),

  persona: z.object({
    default: PersonaSchema.default(() => ({
      name: 'MiniClaw',
      systemPrompt: '你是 MiniClaw，一个资深全栈工程师助手。说话简洁专业。',
      tone: 'professional' as const,
      language: 'zh-CN',
    })),
  }).default(() => ({
    default: {
      name: 'MiniClaw',
      systemPrompt: '你是 MiniClaw，一个资深全栈工程师助手。说话简洁专业。',
      tone: 'professional' as const,
      language: 'zh-CN',
    },
  })),

  cli: z.object({
    defaultTool: z.string().default('claude-code'),
    tools: z.record(z.string(), CLIToolSchema).default(() => ({
      'claude-code': { command: 'claude', args: ['--print'], timeout: 600 },
    })),
  }).default(() => ({
    defaultTool: 'claude-code',
    tools: { 'claude-code': { command: 'claude', args: ['--print'], timeout: 600 } },
  })),

  memory: z.object({
    shortTerm: z.object({
      maxMessages: z.number().default(20),
    }).default(() => ({ maxMessages: 20 })),
    longTerm: z.object({
      coreFile: z.string().default('./data/memory.md'),
      topicDir: z.string().default('./data/memory/'),
      maxCoreLines: z.number().default(200),
      maxTopicFilesPerQuery: z.number().default(3),
    }).default(() => ({
      coreFile: './data/memory.md',
      topicDir: './data/memory/',
      maxCoreLines: 200,
      maxTopicFilesPerQuery: 3,
    })),
  }).default(() => ({
    shortTerm: { maxMessages: 20 },
    longTerm: {
      coreFile: './data/memory.md',
      topicDir: './data/memory/',
      maxCoreLines: 200,
      maxTopicFilesPerQuery: 3,
    },
  })),

  scheduler: z.object({
    enabled: z.boolean().default(true),
  }).default(() => ({ enabled: true })),

  reporting: z.object({
    progressInterval: z.number().default(60),
    longTaskThreshold: z.number().default(120),
    summarizeOutput: z.boolean().default(true),
  }).default(() => ({
    progressInterval: 60,
    longTaskThreshold: 120,
    summarizeOutput: true,
  })),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
export { PersonaSchema, LLMProviderSchema, CLIToolSchema };
