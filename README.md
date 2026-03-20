# MiniClaw

智能 AI Agent 代理工具 — 通过钉钉 / 飞书 / 本地 TUI 对话驱动的编程助手。

## 特性

- **多平台对话** — 钉钉、飞书 WebSocket 实时接入，本地 TUI 终端对话
- **Agent 工具调用** — 基于 pi-agent-core，自动循环调用文件操作、搜索、编码、系统等 20+ 工具
- **CLI 编程工具集成** — 内置 Claude Code / Codex / OpenCode 调度，支持长任务进度汇报
- **记忆系统** — 核心记忆 + 主题记忆，跨会话持久化，自动从对话中提取
- **人设系统** — 内置 3 种预设风格，支持按用户/群组粒度覆盖
- **定时任务** — 自然语言创建 cron 任务，定时执行命令或触发对话
- **服务化部署** — `npm install -g` 安装，`miniclaw start/stop/status` 进程管理

## 快速开始

### 安装

```bash
npm install -g miniclaw
```

### 初始化

```bash
miniclaw init
```

在 `~/.miniclaw/` 生成配置模板：

- `config.yaml` — 主配置文件
- `.env` — 环境变量（API Key 等敏感信息）

### 配置模型

交互式添加 LLM 提供商：

```bash
miniclaw config model add
```

或直接编辑 `~/.miniclaw/config.yaml`：

```yaml
llm:
  provider: deepseek
  providers:
    deepseek:
      apiKey: ${DEEPSEEK_API_KEY}
      baseUrl: https://api.deepseek.com/v1
      model: deepseek-chat
    zhipuai:
      apiKey: ${ZHIPUAI_API_KEY}
      baseUrl: https://open.bigmodel.cn/api/paas/v4
      model: glm-4-flash
```

然后在 `~/.miniclaw/.env` 填入实际 Key：

```env
DEEPSEEK_API_KEY=sk-xxx
ZHIPUAI_API_KEY=xxx.xxx
```

### 配置聊天平台

```bash
miniclaw config chat setup dingtalk   # 交互式配置钉钉
miniclaw config chat setup feishu     # 交互式配置飞书
miniclaw config chat enable dingtalk  # 启用
```

### 启动服务

```bash
miniclaw start
```

### 本地对话（TUI）

```bash
miniclaw tui
```

需服务已启动。输入消息即可与 Agent 对话，`/quit` 退出。

## CLI 命令

| 命令 | 说明 |
|------|------|
| `miniclaw init` | 初始化配置模板 |
| `miniclaw start` | 启动后台服务 |
| `miniclaw stop` | 停止服务 |
| `miniclaw restart` | 重启服务 |
| `miniclaw status` | 查看服务状态 |
| `miniclaw tui` | 启动 TUI 对话 |
| `miniclaw config show` | 查看配置（Key 已遮蔽） |
| `miniclaw config set <key> <value>` | 设置配置项 |
| `miniclaw config model list` | 列出模型提供商 |
| `miniclaw config model add` | 添加模型提供商 |
| `miniclaw config model remove <name>` | 删除模型提供商 |
| `miniclaw config model default <name>` | 设置默认模型 |
| `miniclaw config chat list` | 列出聊天平台状态 |
| `miniclaw config chat setup <platform>` | 配置聊天平台 |
| `miniclaw config chat enable <platform>` | 启用聊天平台 |
| `miniclaw config chat disable <platform>` | 禁用聊天平台 |

全局选项：`--home <path>` 指定配置目录（默认 `~/.miniclaw/`）。

## 配置参考

完整 `config.yaml` 示例：

```yaml
llm:
  provider: zhipuai                    # 默认 LLM 提供商
  providers:
    zhipuai:
      apiKey: ${ZHIPUAI_API_KEY}
      baseUrl: https://open.bigmodel.cn/api/paas/v4
      model: glm-4-flash

chat:
  adapters:
    dingtalk:
      enabled: false
      clientId: ${DINGTALK_CLIENT_ID}
      clientSecret: ${DINGTALK_CLIENT_SECRET}
    feishu:
      enabled: false
      appId: ${FEISHU_APP_ID}
      appSecret: ${FEISHU_APP_SECRET}

workspace:
  default: ~/workspace                 # 默认工作目录
  autoCreate: true

persona:
  default:
    name: MiniClaw
    systemPrompt: 你是 MiniClaw，一个资深全栈工程师助手。
    tone: professional                 # professional | friendly | humorous
    language: zh-CN

cli:
  defaultTool: claude-code
  tools:
    claude-code:
      command: claude
      args: ["--print"]
      timeout: 600

memory:
  shortTerm:
    maxMessages: 20
  longTerm:
    coreFile: ./data/memory.md
    topicDir: ./data/memory/
    maxCoreLines: 200

scheduler:
  enabled: true
```

配置中支持 `${ENV_VAR}` 语法引用环境变量。

## 架构

```
src/
  cli.ts                     # CLI 入口 (commander)
  index.ts                   # 服务入口
  service/
    paths.ts                 # MINICLAW_HOME + 路径常量
    lifecycle.ts             # startService / stopService
    daemon.ts                # PID 文件 + 后台进程管理
    ipc.ts                   # TUI ↔ 服务 IPC 通信
    config-cli.ts            # 交互式配置管理
  agent/
    orchestrator.ts          # 消息处理 + Agent 编排
    tools/                   # 文件操作/搜索/编码/设置等工具
  chat/
    adapters/
      dingtalk.ts            # 钉钉 Stream 适配器
      feishu.ts              # 飞书 WebSocket 适配器
      local.ts               # TUI 本地适配器
    registry.ts              # 适配器注册中心
  tui/
    chat.ts                  # pi-tui 交互式界面
  config/                    # YAML + Zod 配置加载
  llm/                       # pi-ai 模型注册 + prompt 构建
  memory/                    # 核心记忆 + 主题记忆
  persona/                   # 人设管理
  scheduler/                 # cron 定时任务
  session/                   # 会话状态管理
  cli/                       # CLI 工具 (claude-code/codex/opencode) 调度
  utils/                     # DB / 日志 / 事件总线
```

## 开发

```bash
git clone <repo-url> && cd miniclaw
npm install

# 开发模式（热重载）
npm run dev

# 构建
npm run build

# 测试
npm test
```

开发模式下可直接使用 CWD 中的 `config.yaml` 和 `.env`，无需 `miniclaw init`。

## 技术栈

- **Runtime** — Node.js >= 20, TypeScript 5.9, ESM
- **LLM** — pi-ai + pi-agent-core (OpenAI-compatible)
- **数据库** — better-sqlite3 (WAL mode)
- **配置** — YAML + dotenv + Zod v4
- **日志** — pino
- **TUI** — @mariozechner/pi-tui
- **CLI** — commander

## License

MIT
