import type { FastifyInstance } from 'fastify';
import { getAllSessions } from '../../session/manager.js';
import { getAllAdapters } from '../../chat/registry.js';
import { listProviders, getActiveProviderName, setActiveProvider } from '../../llm/registry.js';

export async function statusRoutes(app: FastifyInstance) {
  // GET /api/status — 服务状态
  app.get('/api/status', async () => {
    return {
      running: true,
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  });

  // GET /api/status/sessions — 活跃会话列表
  app.get('/api/status/sessions', async () => {
    const sessions = getAllSessions();
    return sessions.map((s) => ({
      id: s.id,
      platform: s.platform,
      chatId: s.chatId,
      userId: s.userId,
      workspace: s.workspace,
      cliTool: s.cliTool,
      messageCount: s.history.length,
      resourceCount: s.resources.length,
      hasActiveAgent: !!s.agent,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    }));
  });

  // GET /api/status/adapters — 已注册适配器列表
  app.get('/api/status/adapters', async () => {
    const adapters = getAllAdapters();
    return adapters.map((a) => ({
      name: a.name,
    }));
  });

  // GET /api/status/llm — LLM 提供商列表
  app.get('/api/status/llm', async () => {
    const providers = listProviders();
    const active = getActiveProviderName();
    return { providers, active };
  });

  // PUT /api/status/llm/active — 切换激活提供商
  app.put<{ Body: { name: string } }>('/api/status/llm/active', async (req) => {
    const { name } = req.body;
    if (!name) return { error: 'name is required' };

    try {
      setActiveProvider(name);
      return { ok: true, active: name };
    } catch (err: any) {
      return { error: err.message };
    }
  });
}
