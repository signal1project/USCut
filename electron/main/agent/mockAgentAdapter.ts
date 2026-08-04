import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from './types';

export class MockAgentAdapter implements AgentAdapter {
  readonly label: string;
  readonly kind = 'mock' as const;

  constructor(
    readonly id = 'mock',
    label?: string,
  ) {
    this.label = label ?? `Mock Agent (${id})`;
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    return {
      agentId: this.id,
      kind: this.kind,
      status: 'completed',
      summary: `${this.label} completed ${input.taskType}: ${input.objective}`,
      output: {
        taskType: input.taskType,
        objective: input.objective,
        contextKeys: Object.keys(input.context ?? {}),
        constraints: input.constraints ?? [],
      },
      artifacts: [
        {
          kind: 'agent_note',
          title: `${input.taskType} note`,
          data: {
            objective: input.objective,
            recommendation: 'Review and approve before publishing.',
          },
        },
      ],
    };
  }
}
