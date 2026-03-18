export interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string;
  command: string;
  workspace?: string;
  chatTarget?: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
}
