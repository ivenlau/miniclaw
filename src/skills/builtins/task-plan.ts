import type { Skill, SkillContext, SkillResult } from '../types.js';
import { listSkillMetas, getSkill } from '../registry.js';
import { runCLITask } from '../../cli/runner.js';
import { stripThink } from '../../utils/llm-parse.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('skill:task-plan');

// ---- Types ----

interface PlanStepSkill { type: 'skill'; description: string; skillName: string; params: Record<string, unknown>; }
interface PlanStepCoding { type: 'coding'; description: string; prompt: string; }
interface PlanStepLLM { type: 'llm'; description: string; prompt: string; }
type PlanStep = PlanStepSkill | PlanStepCoding | PlanStepLLM;
interface TaskPlan { goal: string; steps: PlanStep[]; }
interface StepResult { stepIndex: number; description: string; status: 'success' | 'error'; output: string; }

const MAX_STEPS = 8;
const CONTEXT_TRUNCATE = 2000;

// ---- Planning prompt ----

const PLAN_PROMPT = `你是一个任务规划器。将用户的复杂请求分解为有序的执行步骤。

## 可用技能
{SKILL_LIST}

## 步骤类型
1. skill - 调用已有技能，params 须匹配技能参数格式
2. coding - CLI 编程工具执行（代码生成/优化/重构）
3. llm - AI 分析/总结/判断

## 规则
- 每步单一操作，按执行顺序排列
- 后续步骤可引用前序结果
- 步骤 2-8 步
- 只输出 JSON，不要有其他内容

## 输出格式
{"goal":"目标摘要","steps":[{"type":"skill","description":"...","skillName":"...","params":{...}},{"type":"coding","description":"...","prompt":"..."},{"type":"llm","description":"...","prompt":"..."}]}`;

// ---- Helpers ----

function buildAvailableSkillList(): string {
  // Exclude task-plan itself to prevent self-recursion
  return listSkillMetas()
    .filter(s => s.name !== 'task-plan')
    .map(s => {
      const skill = getSkill(s.name);
      const hint = skill?.parameterHint ?? '无参数';
      return `- ${s.name}: ${s.description}\n  参数: ${hint}`;
    })
    .join('\n');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...(截断)' : text;
}

function buildContextBlock(results: StepResult[]): string {
  if (results.length === 0) return '';
  const lines = results.map(r =>
    `[步骤${r.stepIndex + 1} ${r.status === 'success' ? '✅' : '❌'} ${r.description}]\n${truncate(r.output, CONTEXT_TRUNCATE)}`
  );
  return '## 前序步骤结果\n' + lines.join('\n\n');
}

// ---- Plan generation ----

async function generatePlan(ctx: SkillContext, userMessage: string): Promise<TaskPlan> {
  if (!ctx.llm) throw new Error('LLM provider not available');

  const skillList = buildAvailableSkillList();
  const systemPrompt = PLAN_PROMPT.replace('{SKILL_LIST}', skillList);

  const result = await ctx.llm.chat({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0,
    maxTokens: 1500,
  });

  const jsonMatch = result.content.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM 未返回有效 JSON');

  const parsed = JSON.parse(jsonMatch[0]) as TaskPlan;

  if (!parsed.goal || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error('无效的任务计划结构');
  }

  // Enforce step limit
  if (parsed.steps.length > MAX_STEPS) {
    parsed.steps = parsed.steps.slice(0, MAX_STEPS);
  }

  // Validate skill steps
  for (const step of parsed.steps) {
    if (step.type === 'skill') {
      const s = step as PlanStepSkill;
      if (s.skillName === 'task-plan') {
        throw new Error('禁止自递归调用 task-plan');
      }
      if (!getSkill(s.skillName)) {
        throw new Error(`技能 "${s.skillName}" 不存在`);
      }
    }
  }

  return parsed;
}

// ---- Step execution ----

async function executeStep(
  step: PlanStep,
  index: number,
  ctx: SkillContext,
  priorResults: StepResult[],
): Promise<StepResult> {
  const base = { stepIndex: index, description: step.description };

  try {
    let output: string;

    switch (step.type) {
      case 'skill': {
        const s = step as PlanStepSkill;
        const skill = getSkill(s.skillName);
        if (!skill) throw new Error(`技能 "${s.skillName}" 未找到`);

        // Inject prior context into params
        const params = { ...s.params };
        if (priorResults.length > 0) {
          params._context = buildContextBlock(priorResults);
        }

        const result = await skill.execute(params, ctx);
        output = result.reply;
        break;
      }

      case 'coding': {
        const s = step as PlanStepCoding;
        if (!ctx.cliTool || !ctx.sessionId) throw new Error('CLI 工具或会话未配置');

        // Prepend prior context to prompt
        const contextBlock = buildContextBlock(priorResults);
        const prompt = contextBlock ? contextBlock + '\n\n## 当前任务\n' + s.prompt : s.prompt;

        output = await runCLITask({
          tool: ctx.cliTool,
          prompt,
          workspace: ctx.workspace,
          sessionId: ctx.sessionId,
        });
        break;
      }

      case 'llm': {
        const s = step as PlanStepLLM;
        if (!ctx.llm) throw new Error('LLM provider not available');

        const contextBlock = buildContextBlock(priorResults);
        const prompt = contextBlock ? contextBlock + '\n\n## 当前任务\n' + s.prompt : s.prompt;

        const result = await ctx.llm.chat({
          messages: [
            { role: 'system', content: '你是一个专业的技术助手。请根据上下文完成分析任务。' },
            { role: 'user', content: prompt },
          ],
          maxTokens: 2000,
        });
        output = stripThink(result.content);
        break;
      }

      default:
        throw new Error(`未知步骤类型: ${(step as any).type}`);
    }

    return { ...base, status: 'success', output };
  } catch (err: any) {
    log.error({ err, stepIndex: index, stepType: step.type }, 'Step execution failed');
    return { ...base, status: 'error', output: err.message ?? String(err) };
  }
}

// ---- Format output ----

function formatResults(plan: TaskPlan, results: StepResult[]): string {
  const total = results.length;
  const success = results.filter(r => r.status === 'success').length;

  const lines: string[] = [`📋 任务计划: ${plan.goal}`, ''];

  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : '❌';
    lines.push(`${icon} 步骤 ${r.stepIndex + 1}/${total}: ${r.description}`);
    // Show truncated output indented
    const preview = truncate(r.output, 500);
    for (const line of preview.split('\n').slice(0, 8)) {
      lines.push(`  ${line}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`完成: ${success}/${total} 步骤成功`);

  return lines.join('\n');
}

// ---- Skill definition ----

const skill: Skill = {
  name: 'task-plan',
  description: '多步骤任务分解与执行（将复杂请求拆分为多步计划并逐步执行）',
  parameterHint: '{"request":"用户的复杂请求描述"}',

  async execute(params, ctx): Promise<SkillResult> {
    const request = String(params.request ?? '');
    if (!request) {
      return { reply: '❌ 请提供任务描述' };
    }

    try {
      // 1. Generate plan
      log.info({ request: request.slice(0, 100) }, 'Generating task plan');
      const plan = await generatePlan(ctx, request);
      log.info({ goal: plan.goal, stepCount: plan.steps.length }, 'Plan generated');

      // 2. Execute steps sequentially
      const results: StepResult[] = [];
      for (let i = 0; i < plan.steps.length; i++) {
        log.info({ stepIndex: i, type: plan.steps[i].type, desc: plan.steps[i].description }, 'Executing step');
        const result = await executeStep(plan.steps[i], i, ctx, results);
        results.push(result);
      }

      // 3. Format output
      return { reply: formatResults(plan, results) };
    } catch (err: any) {
      log.error({ err }, 'Task plan failed');
      return { reply: `❌ 任务规划失败: ${err.message ?? err}` };
    }
  },
};

export default skill;
