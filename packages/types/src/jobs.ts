export type ProductionJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export interface ProductionJob<T = unknown> {
  id: string;
  label: string;
  status: ProductionJobStatus;
  stage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  result?: T;
  error?: string;
}
export interface JobExecution {
  signal: AbortSignal;
  report: (stage: string, progress: number) => void;
}
