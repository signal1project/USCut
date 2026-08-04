import { describe, expect, it } from 'vitest';
import {
  AgentAdapterRegistry,
  MockAgentAdapter,
  HermesAgentAdapter,
  createDefaultAgentRegistry,
} from '../index';

// RED tests for the native white-label agent adapter seam.

describe('AgentAdapterRegistry', () => {
  it('registers a default Hermes-compatible adapter and resolves it by id', () => {
    const registry = createDefaultAgentRegistry();
    const adapter = registry.getDefault();

    expect(adapter.id).toBe('hermes');
    expect(adapter.kind).toBe('hermes');
    expect(registry.list().map((a) => a.id)).toContain('mock');
  });

  it('allows white-label agent adapters to be registered without replacing Hermes', () => {
    const registry = new AgentAdapterRegistry(new MockAgentAdapter('hermes'));
    const custom = new MockAgentAdapter('customer-agent');

    registry.register(custom);

    expect(registry.get('customer-agent')).toBe(custom);
    expect(registry.getDefault().id).toBe('hermes');
  });

  it('throws a useful error for missing adapters', () => {
    const registry = createDefaultAgentRegistry();
    expect(() => registry.get('missing')).toThrow(
      'No agent adapter registered for "missing"',
    );
  });
});

describe('MockAgentAdapter', () => {
  it('returns auditable deterministic task results', async () => {
    const adapter = new MockAgentAdapter('demo-agent');
    const result = await adapter.runTask({
      taskType: 'trend_brief',
      objective: 'Find trend hooks for real estate',
      context: { niche: 'real estate' },
    });

    expect(result.agentId).toBe('demo-agent');
    expect(result.status).toBe('completed');
    expect(result.summary).toContain('trend_brief');
    expect(result.artifacts[0].kind).toBe('agent_note');
  });
});

describe('HermesAgentAdapter', () => {
  it('posts agent tasks to a configurable Hermes HTTP endpoint', async () => {
    const calls: any[] = [];
    const fakeFetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          summary: 'Hermes completed the task',
          output: { ok: true },
          artifacts: [
            { kind: 'brief', title: 'Trend brief', data: { ok: true } },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const adapter = new HermesAgentAdapter({
      endpoint: 'http://127.0.0.1:18790/api/agent-task',
      profile: 'omobono',
      fetcher: fakeFetch as typeof fetch,
    });

    const result = await adapter.runTask({
      taskType: 'campaign_strategy',
      objective: 'Build campaign',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:18790/api/agent-task');
    expect(JSON.parse(String(calls[0].init.body)).profile).toBe('omobono');
    expect(result.status).toBe('completed');
    expect(result.summary).toBe('Hermes completed the task');
  });

  it('returns a blocked result instead of throwing when Hermes is unavailable', async () => {
    const adapter = new HermesAgentAdapter({
      endpoint: 'http://127.0.0.1:18790/api/agent-task',
      profile: 'omobono',
      fetcher: async () => {
        throw new Error('connection refused');
      },
    });

    const result = await adapter.runTask({
      taskType: 'campaign_strategy',
      objective: 'Build campaign',
    });

    expect(result.status).toBe('blocked');
    expect(result.summary).toContain('Hermes adapter could not reach');
  });
});
