import type { FastifyInstance } from 'fastify';
import { readRawConfig, writeRawConfig } from '../../config/loader.js';
import { getConfigPath, getEnvPath } from '../../service/paths.js';
import { deepSet, maskSecrets, writeApiKeyToEnv, ensureEnvVar } from '../../service/config-cli.js';

export async function configRoutes(app: FastifyInstance) {
  // GET /api/config — 获取完整配置（密钥脱敏）
  app.get('/api/config', async () => {
    const raw = readRawConfig(getConfigPath());
    return maskSecrets(raw);
  });

  // PUT /api/config — 设置配置项
  app.put<{ Body: { key: string; value: string } }>('/api/config', async (req) => {
    const { key, value } = req.body;
    if (!key) return { error: 'key is required' };

    const configPath = getConfigPath();
    const raw = readRawConfig(configPath);
    deepSet(raw, key, value);
    writeRawConfig(configPath, raw);
    return { ok: true, key, value };
  });

  // GET /api/config/models — 列出 LLM 提供商
  app.get('/api/config/models', async () => {
    const raw = readRawConfig(getConfigPath());
    const providers = raw.llm?.providers ?? {};
    const defaultProvider = raw.llm?.provider ?? 'zhipuai';
    return { providers, defaultProvider };
  });

  // POST /api/config/models — 添加提供商
  app.post<{ Body: { name: string; baseUrl: string; model?: string; apiKey: string; endpointId?: string } }>(
    '/api/config/models',
    async (req) => {
      const { name, baseUrl, model, apiKey, endpointId } = req.body;
      if (!name || !baseUrl || !apiKey) {
        return { error: 'name, baseUrl, apiKey are required' };
      }

      const configPath = getConfigPath();
      const envPath = getEnvPath();
      const raw = readRawConfig(configPath);
      if (!raw.llm) raw.llm = {};
      if (!raw.llm.providers) raw.llm.providers = {};

      // If apiKey is a raw key (not ${VAR}), store in .env
      let storedApiKey = apiKey;
      if (!apiKey.startsWith('${')) {
        const varName = writeApiKeyToEnv(envPath, name, apiKey);
        storedApiKey = `\${${varName}}`;
      }

      const provider: any = { apiKey: storedApiKey, baseUrl };
      if (model) provider.model = model;
      if (endpointId) {
        provider.endpointId = endpointId;
        ensureEnvVar(envPath, endpointId);
      }

      raw.llm.providers[name] = provider;
      writeRawConfig(configPath, raw);
      return { ok: true, name };
    },
  );

  // DELETE /api/config/models/:name — 删除提供商
  app.delete<{ Params: { name: string } }>('/api/config/models/:name', async (req) => {
    const { name } = req.params;
    const configPath = getConfigPath();
    const raw = readRawConfig(configPath);

    if (!raw.llm?.providers?.[name]) {
      return { error: `Provider "${name}" not found` };
    }

    delete raw.llm.providers[name];
    writeRawConfig(configPath, raw);
    return { ok: true, name };
  });

  // PUT /api/config/models/default — 设置默认提供商
  app.put<{ Body: { name: string } }>('/api/config/models/default', async (req) => {
    const { name } = req.body;
    if (!name) return { error: 'name is required' };

    const configPath = getConfigPath();
    const raw = readRawConfig(configPath);
    if (!raw.llm) raw.llm = {};
    raw.llm.provider = name;
    writeRawConfig(configPath, raw);
    return { ok: true, defaultProvider: name };
  });

  // ── 聊天渠道管理 ──

  // GET /api/config/chat — 列出所有聊天渠道
  app.get('/api/config/chat', async () => {
    const raw = readRawConfig(getConfigPath());
    const adapters = raw.chat?.adapters ?? {};
    return {
      adapters: {
        dingtalk: {
          enabled: adapters.dingtalk?.enabled ?? false,
          clientId: adapters.dingtalk?.clientId ? '已配置' : '未配置',
          clientSecret: adapters.dingtalk?.clientSecret ? '已配置' : '未配置',
        },
        feishu: {
          enabled: adapters.feishu?.enabled ?? false,
          appId: adapters.feishu?.appId ? '已配置' : '未配置',
          appSecret: adapters.feishu?.appSecret ? '已配置' : '未配置',
        },
        web: {
          enabled: adapters.web?.enabled ?? true,
        },
      },
    };
  });

  // PUT /api/config/chat/:platform/toggle — 启用/禁用渠道
  app.put<{ Params: { platform: string }; Body: { enabled: boolean } }>(
    '/api/config/chat/:platform/toggle',
    async (req) => {
      const { platform } = req.params;
      const { enabled } = req.body;
      const configPath = getConfigPath();
      const raw = readRawConfig(configPath);

      if (!raw.chat) raw.chat = {};
      if (!raw.chat.adapters) raw.chat.adapters = {};
      if (!raw.chat.adapters[platform]) raw.chat.adapters[platform] = {};

      raw.chat.adapters[platform].enabled = enabled;
      writeRawConfig(configPath, raw);
      return { ok: true, platform, enabled, needRestart: platform !== 'web' };
    },
  );

  // PUT /api/config/chat/dingtalk — 配置钉钉凭证
  app.put<{ Body: { clientId: string; clientSecret: string; enabled?: boolean } }>(
    '/api/config/chat/dingtalk',
    async (req) => {
      const { clientId, clientSecret, enabled } = req.body;
      if (!clientId || !clientSecret) return { error: 'clientId and clientSecret are required' };

      const configPath = getConfigPath();
      const envPath = getEnvPath();
      const raw = readRawConfig(configPath);
      if (!raw.chat) raw.chat = {};
      if (!raw.chat.adapters) raw.chat.adapters = {};

      // Store secrets in .env if raw values
      let storedId = clientId;
      let storedSecret = clientSecret;
      if (!clientId.startsWith('${')) {
        const varName = 'DINGTALK_CLIENT_ID';
        writeApiKeyToEnv(envPath, 'dingtalk_client', clientId);
        storedId = `\${${varName}}`;
      }
      if (!clientSecret.startsWith('${')) {
        const varName = 'DINGTALK_CLIENT_SECRET';
        writeApiKeyToEnv(envPath, 'dingtalk_client_secret', clientSecret);
        storedSecret = `\${${varName}}`;
      }

      raw.chat.adapters.dingtalk = {
        enabled: enabled ?? true,
        clientId: storedId,
        clientSecret: storedSecret,
      };
      writeRawConfig(configPath, raw);
      return { ok: true, needRestart: true };
    },
  );

  // PUT /api/config/chat/feishu — 配置飞书凭证
  app.put<{ Body: { appId: string; appSecret: string; enabled?: boolean } }>(
    '/api/config/chat/feishu',
    async (req) => {
      const { appId, appSecret, enabled } = req.body;
      if (!appId || !appSecret) return { error: 'appId and appSecret are required' };

      const configPath = getConfigPath();
      const envPath = getEnvPath();
      const raw = readRawConfig(configPath);
      if (!raw.chat) raw.chat = {};
      if (!raw.chat.adapters) raw.chat.adapters = {};

      let storedId = appId;
      let storedSecret = appSecret;
      if (!appId.startsWith('${')) {
        writeApiKeyToEnv(envPath, 'feishu_app', appId);
        storedId = `\${FEISHU_APP_API_KEY}`;
      }
      if (!appSecret.startsWith('${')) {
        writeApiKeyToEnv(envPath, 'feishu_app_secret', appSecret);
        storedSecret = `\${FEISHU_APP_SECRET_API_KEY}`;
      }

      raw.chat.adapters.feishu = {
        enabled: enabled ?? true,
        appId: storedId,
        appSecret: storedSecret,
      };
      writeRawConfig(configPath, raw);
      return { ok: true, needRestart: true };
    },
  );
}
