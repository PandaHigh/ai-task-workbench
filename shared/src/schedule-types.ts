export interface ScheduledJob {
  id: string;
  name: string;
  cronExpr: string;
  goals: string[];
  workingDir: string;
  terminationConditions: string[];
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
  config?: Record<string, unknown>;
}
