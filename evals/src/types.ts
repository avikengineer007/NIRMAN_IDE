export type FailureCategory =
  | 'none'
  | 'bad_edits'
  | 'wrong_tool_use'
  | 'context_overflow'
  | 'stuck_loops'
  | 'timeout'
  | 'assertion_failed';

export type TaskCheck =
  | {
      type: 'test';
      description: string;
      command: string;
      expectedExitCode?: number | undefined;
      expectedOutput?: string | undefined;
    }
  | {
      type: 'endpoint';
      description: string;
      startCommand: string;
      port: number;
      path: string;
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined;
      body?: unknown;
      expectedStatus: number;
      expectedBodySubstr?: string | undefined;
    }
  | {
      type: 'ui';
      description: string;
      filePath: string;
      requiredKeywords: readonly string[];
    };

export interface EvalTask {
  id: string;
  title: string;
  category: 'cli' | 'api' | 'ui' | 'algo';
  description: string;
  initialFiles?: Record<string, string> | undefined;
  checks: readonly TaskCheck[];
  timeoutMs?: number | undefined;
}

export interface CheckResult {
  check: string;
  passed: boolean;
  error?: string | undefined;
}

export interface TaskExecutionResult {
  taskId: string;
  title: string;
  category: 'cli' | 'api' | 'ui' | 'algo';
  passed: boolean;
  steps: number;
  tokensUsed: number;
  durationMs: number;
  failureCategory: FailureCategory;
  failureReason?: string | undefined;
  checkResults: readonly CheckResult[];
}

export interface ModelBenchmarkSummary {
  modelName: string;
  provider: string;
  toolMode: 'native' | 'fallback';
  totalTasks: number;
  passedTasks: number;
  passRatePercent: number;
  avgSteps: number;
  avgTokens: number;
  totalDurationMs: number;
  failureBreakdown: Record<FailureCategory, number>;
  taskResults: readonly TaskExecutionResult[];
}

export interface ComparisonReport {
  timestamp: string;
  benchmarks: readonly ModelBenchmarkSummary[];
  nextImprovements: readonly string[];
}
