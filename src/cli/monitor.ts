import { eventBus } from '../utils/events.js';
import { getConfig } from '../config/loader.js';
import { formatProgressMessage } from '../chat/formatter.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('cli:monitor');

interface TaskProgress {
  sessionId: string;
  output: string;
  startTime: number;
  lastReportTime: number;
  reportCallback: (message: string) => void;
  timer?: ReturnType<typeof setInterval>;
}

const activeTasks = new Map<string, TaskProgress>();

export function startMonitoring(
  sessionId: string,
  reportCallback: (message: string) => void,
) {
  const config = getConfig();
  const { progressInterval, longTaskThreshold } = config.reporting;

  const task: TaskProgress = {
    sessionId,
    output: '',
    startTime: Date.now(),
    lastReportTime: Date.now(),
    reportCallback,
  };

  activeTasks.set(sessionId, task);

  // Start periodic progress reporting after longTaskThreshold
  task.timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - task.startTime) / 1000);
    if (elapsed >= longTaskThreshold) {
      const msg = formatProgressMessage(task.output, elapsed);
      task.reportCallback(msg);
      task.lastReportTime = Date.now();
    }
  }, progressInterval * 1000);

  log.debug({ sessionId }, 'Monitoring started');
}

export function stopMonitoring(sessionId: string) {
  const task = activeTasks.get(sessionId);
  if (task?.timer) {
    clearInterval(task.timer);
  }
  activeTasks.delete(sessionId);
  log.debug({ sessionId }, 'Monitoring stopped');
}

// Listen to CLI progress events
eventBus.on('cli:progress', ({ sessionId, output }) => {
  const task = activeTasks.get(sessionId);
  if (task) {
    task.output += output;
  }
});

eventBus.on('cli:complete', ({ sessionId }) => {
  stopMonitoring(sessionId);
});

eventBus.on('cli:error', ({ sessionId }) => {
  stopMonitoring(sessionId);
});
