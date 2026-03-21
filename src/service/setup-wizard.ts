import fs from 'node:fs';
import readline from 'node:readline';
import { readRawConfig, writeRawConfig } from '../config/loader.js';
import { getConfigPath, getEnvPath } from './paths.js';
import { ensureEnvVar, writeApiKeyToEnv } from './config-cli.js';

// ── Preset providers ──

const PRESETS: Record<string, { label: string; baseUrl: string; model: string }> = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  doubao: { label: '豆包/火山引擎', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-0-code-preview-260215' },
  kimi: { label: 'Kimi (月之暗面)', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.5' },
  minimax: { label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-M2.7' },
  qwen: { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-coder-plus' },
  zhipuai: { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'GLM-5' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};

const PRESET_KEYS = Object.keys(PRESETS);

const CHAT_PLATFORMS = [
  { key: 'dingtalk', label: '钉钉 (DingTalk)' },
  { key: 'feishu', label: '飞书 (Feishu)' },
];

// ── Helpers ──

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function maskKey(value: string): string {
  if (!value || value.length < 8) return '***';
  if (value.startsWith('${')) return value;
  return value.slice(0, 3) + '***' + value.slice(-3);
}

// ── Main wizard ──

export async function runSetupWizard(home: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const configPath = getConfigPath();
  const envPath = getEnvPath();

  try {
    // Check existing config
    const configExists = fs.existsSync(configPath);
    if (configExists) {
      const ans = (await ask(rl, '\n  配置文件已存在，是否重新配置? (y/N): ')).trim().toLowerCase();
      if (ans !== 'y') {
        console.log('  已取消。使用 miniclaw config 修改现有配置。');
        return;
      }
    }

    const raw: Record<string, any> = configExists ? readRawConfig(configPath) : {};

    console.log(`
  🐾 欢迎使用 MiniClaw!
  配置目录: ${home}/
`);

    // ── Step 1: LLM Model ──
    console.log('  ── 步骤 1/3: 配置 LLM 模型 ──\n');
    console.log('  选择模型提供商 (输入序号):');
    PRESET_KEYS.forEach((key, i) => {
      console.log(`    ${i + 1}. ${key} (${PRESETS[key].label})`);
    });
    console.log(`    ${PRESET_KEYS.length + 1}. 自定义`);
    console.log();

    const providerChoice = (await ask(rl, '  > ')).trim();
    const choiceNum = parseInt(providerChoice, 10);

    let providerName: string;
    let baseUrl: string;
    let model: string;
    let apiKey: string;
    let endpointId: string | undefined;

    if (choiceNum >= 1 && choiceNum <= PRESET_KEYS.length) {
      // Preset provider
      providerName = PRESET_KEYS[choiceNum - 1];
      const preset = PRESETS[providerName];
      baseUrl = preset.baseUrl;
      model = preset.model;

      console.log();
      apiKey = (await ask(rl, '  ? API Key: ')).trim();
      if (!apiKey) {
        console.log('  ✗ API Key 不能为空，已取消');
        return;
      }

      const modelOverride = (await ask(rl, `  ? 模型 ID (回车使用默认 ${model}): `)).trim();
      if (modelOverride) model = modelOverride;

      // doubao needs endpoint ID
      if (providerName === 'doubao') {
        endpointId = (await ask(rl, '  ? Endpoint ID: ')).trim() || undefined;
      }
    } else if (choiceNum === PRESET_KEYS.length + 1) {
      // Custom provider
      console.log();
      providerName = (await ask(rl, '  ? 提供商名称: ')).trim();
      if (!providerName) { console.log('  已取消'); return; }
      baseUrl = (await ask(rl, '  ? API Base URL: ')).trim();
      if (!baseUrl) { console.log('  ✗ Base URL 不能为空，已取消'); return; }
      model = (await ask(rl, '  ? 模型 ID: ')).trim();
      if (!model) { console.log('  ✗ 模型 ID 不能为空，已取消'); return; }
      apiKey = (await ask(rl, '  ? API Key: ')).trim();
      if (!apiKey) { console.log('  ✗ API Key 不能为空，已取消'); return; }
      endpointId = (await ask(rl, '  ? Endpoint ID (可选，回车跳过): ')).trim() || undefined;
    } else {
      console.log('  ✗ 无效的选择，已取消');
      return;
    }

    // Write API key to .env and use ${VAR} reference in config
    let apiKeyRef: string;
    if (apiKey.startsWith('${')) {
      apiKeyRef = apiKey;
      ensureEnvVar(envPath, apiKey);
    } else {
      const varName = writeApiKeyToEnv(envPath, providerName, apiKey);
      apiKeyRef = `\${${varName}}`;
    }

    // Build provider config
    if (!raw.llm) raw.llm = {};
    if (!raw.llm.providers) raw.llm.providers = {};

    const providerCfg: Record<string, any> = {
      apiKey: apiKeyRef,
      baseUrl,
      model,
    };
    if (endpointId) {
      if (endpointId.startsWith('${')) {
        providerCfg.endpointId = endpointId;
        ensureEnvVar(envPath, endpointId);
      } else {
        const epVarName = `${providerName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_ENDPOINT_ID`;
        writeEnvValue(envPath, epVarName, endpointId);
        providerCfg.endpointId = `\${${epVarName}}`;
      }
    }

    raw.llm.providers[providerName] = providerCfg;
    raw.llm.provider = providerName;

    console.log('  ✓ 模型配置完成\n');

    // ── Step 2: Chat Platform ──
    console.log('  ── 步骤 2/3: 配置聊天平台 ──\n');
    console.log('  选择要启用的平台 (输入序号，多选用逗号分隔，回车跳过):');
    CHAT_PLATFORMS.forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.label}`);
    });
    console.log();

    const chatChoice = (await ask(rl, '  > ')).trim();

    if (!raw.chat) raw.chat = {};
    if (!raw.chat.adapters) raw.chat.adapters = {};

    const enabledPlatforms: string[] = [];

    if (chatChoice) {
      const indices = chatChoice.split(',').map(s => parseInt(s.trim(), 10));

      for (const idx of indices) {
        if (idx < 1 || idx > CHAT_PLATFORMS.length) continue;
        const platform = CHAT_PLATFORMS[idx - 1];
        console.log();

        if (platform.key === 'dingtalk') {
          const clientId = (await ask(rl, '  ? 钉钉 Client ID: ')).trim();
          const clientSecret = (await ask(rl, '  ? 钉钉 Client Secret: ')).trim();

          if (!clientId || !clientSecret) {
            console.log('  ✗ 钉钉凭证不完整，已跳过');
            continue;
          }

          let clientIdRef: string;
          let clientSecretRef: string;

          if (clientId.startsWith('${')) {
            clientIdRef = clientId;
            ensureEnvVar(envPath, clientId);
          } else {
            clientIdRef = `\${DINGTALK_CLIENT_ID}`;
            writeEnvValue(envPath, 'DINGTALK_CLIENT_ID', clientId);
          }

          if (clientSecret.startsWith('${')) {
            clientSecretRef = clientSecret;
            ensureEnvVar(envPath, clientSecret);
          } else {
            clientSecretRef = `\${DINGTALK_CLIENT_SECRET}`;
            writeEnvValue(envPath, 'DINGTALK_CLIENT_SECRET', clientSecret);
          }

          raw.chat.adapters.dingtalk = {
            enabled: true,
            clientId: clientIdRef,
            clientSecret: clientSecretRef,
          };
          enabledPlatforms.push('钉钉');
          console.log('  ✓ 钉钉配置完成');

        } else if (platform.key === 'feishu') {
          const appId = (await ask(rl, '  ? 飞书 App ID: ')).trim();
          const appSecret = (await ask(rl, '  ? 飞书 App Secret: ')).trim();

          if (!appId || !appSecret) {
            console.log('  ✗ 飞书凭证不完整，已跳过');
            continue;
          }

          let appIdRef: string;
          let appSecretRef: string;

          if (appId.startsWith('${')) {
            appIdRef = appId;
            ensureEnvVar(envPath, appId);
          } else {
            appIdRef = `\${FEISHU_APP_ID}`;
            writeEnvValue(envPath, 'FEISHU_APP_ID', appId);
          }

          if (appSecret.startsWith('${')) {
            appSecretRef = appSecret;
            ensureEnvVar(envPath, appSecret);
          } else {
            appSecretRef = `\${FEISHU_APP_SECRET}`;
            writeEnvValue(envPath, 'FEISHU_APP_SECRET', appSecret);
          }

          raw.chat.adapters.feishu = {
            enabled: true,
            appId: appIdRef,
            appSecret: appSecretRef,
          };
          enabledPlatforms.push('飞书');
          console.log('  ✓ 飞书配置完成');
        }
      }
    }

    if (enabledPlatforms.length === 0) {
      console.log('  跳过聊天平台配置');
    }

    console.log();

    // ── Step 3: Summary & Write ──
    console.log('  ── 步骤 3/3: 确认 ──\n');

    const dingtalkStatus = raw.chat?.adapters?.dingtalk?.enabled ? '✓' : '✗';
    const feishuStatus = raw.chat?.adapters?.feishu?.enabled ? '✓' : '✗';

    console.log('  配置摘要:');
    console.log(`    模型: ${providerName} / ${model}`);
    console.log(`    API Key: ${maskKey(apiKey)}`);
    console.log(`    聊天: 钉钉 ${dingtalkStatus} | 飞书 ${feishuStatus}`);
    console.log(`    配置文件: ${configPath}`);
    console.log();

    // Ensure scheduler default
    if (!raw.scheduler) raw.scheduler = { enabled: true };

    writeRawConfig(configPath, raw);

    console.log('  ✓ 初始化完成!\n');
    console.log('  下一步:');
    console.log('    miniclaw start     启动服务');
    console.log('    miniclaw tui       本地对话 (需先启动服务)');
    console.log('    miniclaw config    修改配置');
    console.log();

  } finally {
    rl.close();
  }
}

/** Write a specific env variable value to .env file. */
function writeEnvValue(envPath: string, varName: string, value: string): void {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  const regex = new RegExp(`^${varName}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${varName}=${value}`);
  } else {
    const line = `${varName}=${value}\n`;
    content += content.endsWith('\n') || !content ? line : `\n${line}`;
  }

  fs.writeFileSync(envPath, content, 'utf-8');
}
