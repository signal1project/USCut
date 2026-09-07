export interface ReadinessCheck {
  id: string;
  label: string;
  status: 'ready' | 'configured' | 'attention';
  detail: string;
}
export interface ReadinessReport {
  checkedAt: string;
  checks: ReadinessCheck[];
}
