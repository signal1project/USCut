import type {
  AgentAdapter,
  AgentArtifact,
  AgentTaskInput,
  AgentTaskResult,
  HermesAgentAdapterConfig,
} from './types';

const DEFAULT_HERMES_ENDPOINT = 'http://127.0.0.1:18790/api/agent-task';
const DEFAULT_HERMES_PROFILE = 'omobono';

export class HermesAgentAdapter implements AgentAdapter {
  readonly id = 'hermes';
  readonly label = 'Hermes Agent / Omobono';
  readonly kind = 'hermes' as const;
  private readonly endpoint: string;
  private readonly profile: string;
  private readonly fetcher: typeof fetch;

  constructor(config: HermesAgentAdapterConfig = {}) {
    this.endpoint =
      config.endpoint ??
      process.env.MAS_HERMES_AGENT_ENDPOINT ??
      DEFAULT_HERMES_ENDPOINT;
    this.profile =
      config.profile ??
      process.env.MAS_HERMES_AGENT_PROFILE ??
      DEFAULT_HERMES_PROFILE;
    this.fetcher = config.fetcher ?? fetch;
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    try {
      const resp = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: this.profile, ...input }),
      });

      if (!resp.ok) {
        return this.blocked(
          input,
          `Hermes adapter received HTTP ${resp.status} from ${this.endpoint}`,
        );
      }

      const body = (await resp.json()) as {
        summary?: string;
        output?: unknown;
        artifacts?: AgentArtifact[];
      };

      return {
        agentId: this.profile,
        kind: this.kind,
        status: 'completed',
        summary: body.summary ?? `Hermes completed ${input.taskType}`,
        output: body.output ?? body,
        artifacts: Array.isArray(body.artifacts) ? body.artifacts : [],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.blocked(
        input,
        `Hermes adapter could not reach ${this.endpoint}: ${message}`,
      );
    }
  }

  private blocked(input: AgentTaskInput, summary: string): AgentTaskResult {
    return {
      agentId: this.profile,
      kind: this.kind,
      status: 'blocked',
      summary,
      output: { taskType: input.taskType, objective: input.objective },
      artifacts: [],
    };
  }
}
