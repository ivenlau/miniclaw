import { Cron } from 'croner';
import { nanoid } from 'nanoid';
import type { ScheduledTask } from './types.js';
import { executeTask } from './executor.js';
import { getDb } from '../utils/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scheduler');

const activeJobs = new Map<string, Cron>();

export function initScheduler() {
  // Restore tasks from DB on startup
  const tasks = getAllTasks();
  for (const task of tasks) {
    if (task.enabled) {
      scheduleJob(task);
    }
  }
  log.info({ count: tasks.length }, 'Scheduler initialized');
}

export function createTask(
  name: string,
  cronExpression: string,
  command: string,
  options?: { workspace?: string; chatTarget?: string },
): ScheduledTask {
  const id = nanoid(10);
  const db = getDb();

  db.prepare(`
    INSERT INTO scheduled_tasks (id, name, cron_expression, command, workspace, chat_target)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, cronExpression, command, options?.workspace ?? null, options?.chatTarget ?? null);

  const task: ScheduledTask = {
    id,
    name,
    cronExpression,
    command,
    workspace: options?.workspace,
    chatTarget: options?.chatTarget,
    enabled: true,
  };

  scheduleJob(task);
  log.info({ id, name, cron: cronExpression }, 'Task created');
  return task;
}

export function deleteTask(id: string): boolean {
  const job = activeJobs.get(id);
  if (job) {
    job.stop();
    activeJobs.delete(id);
  }

  const db = getDb();
  const result = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

export function toggleTask(id: string, enabled: boolean): boolean {
  const db = getDb();
  db.prepare('UPDATE scheduled_tasks SET enabled = ?, updated_at = unixepoch() WHERE id = ?').run(enabled ? 1 : 0, id);

  if (enabled) {
    const task = getTask(id);
    if (task) scheduleJob(task);
  } else {
    const job = activeJobs.get(id);
    if (job) {
      job.stop();
      activeJobs.delete(id);
    }
  }

  return true;
}

export function getTask(id: string): ScheduledTask | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as any;
  return row ? rowToTask(row) : undefined;
}

export function getAllTasks(): ScheduledTask[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as any[];
  return rows.map(rowToTask);
}

export function stopScheduler() {
  for (const [id, job] of activeJobs) {
    job.stop();
    activeJobs.delete(id);
  }
  log.info('Scheduler stopped');
}

function scheduleJob(task: ScheduledTask) {
  try {
    const job = new Cron(task.cronExpression, () => {
      // Update last_run
      const db = getDb();
      db.prepare('UPDATE scheduled_tasks SET last_run = unixepoch() WHERE id = ?').run(task.id);

      executeTask(task).catch((err) => {
        log.error({ err, taskId: task.id }, 'Task execution error');
      });
    });

    activeJobs.set(task.id, job);

    // Update next_run
    const nextRun = job.nextRun();
    if (nextRun) {
      const db = getDb();
      db.prepare('UPDATE scheduled_tasks SET next_run = ? WHERE id = ?').run(
        Math.floor(nextRun.getTime() / 1000),
        task.id,
      );
    }
  } catch (err) {
    log.error({ err, taskId: task.id, cron: task.cronExpression }, 'Failed to schedule job');
  }
}

function rowToTask(row: any): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    cronExpression: row.cron_expression,
    command: row.command,
    workspace: row.workspace,
    chatTarget: row.chat_target,
    enabled: row.enabled === 1,
    lastRun: row.last_run,
    nextRun: row.next_run,
  };
}
