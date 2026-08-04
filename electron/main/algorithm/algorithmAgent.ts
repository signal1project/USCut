import type { Platform } from '@mas/types';
import {
  PLATFORM_PLAYBOOKS,
  playbookToPromptHint,
  type PlatformPlaybook,
} from './platformPlaybooks';

export interface AlgorithmHints {
  platform: Platform;
  /** Short human-readable summary for the UI. */
  summary: string;
  /** Best format for this platform right now. */
  topFormat: string;
  /** Optimal posting time windows. */
  optimalTimes: string[];
  /** Hashtag recommendation. */
  hashtagStrategy: string;
  /** Top 3 engagement signals the algorithm rewards. */
  topRewardSignals: string[];
  /** Hook advice sentence. */
  hookAdvice: string;
  /** Bonus tips list. */
  bonusTips: string[];
  /** Full prompt injection string (for ContentService). */
  promptHint: string;
}

/**
 * PlatformAlgorithmAgent — resolves and formats algorithm playbooks for any
 * supported platform. Used by:
 *   - ContentService: injects promptHint into generation calls
 *   - UI (A.9): surfaces hints in the Composer sidebar and below platform selector
 *   - Hermes MCP (Phase B): exposed as a tool for the AI agent
 */
export class PlatformAlgorithmAgent {
  /**
   * Return algorithm hints for one or more platforms.
   * Always synchronous — the static playbooks are bundled; no network call.
   */
  getHints(platform: Platform): AlgorithmHints {
    const playbook = PLATFORM_PLAYBOOKS[platform];
    return this.toHints(playbook);
  }

  getHintsForPlatforms(platforms: Platform[]): AlgorithmHints[] {
    return platforms.map((p) => this.getHints(p));
  }

  /** Build the prompt injection string for a platform (used by ContentService). */
  getPromptHint(platform: Platform): string {
    const playbook = PLATFORM_PLAYBOOKS[platform];
    return playbookToPromptHint(playbook);
  }

  private toHints(playbook: PlatformPlaybook): AlgorithmHints {
    return {
      platform: playbook.platform,
      summary: playbook.algorithmSummary,
      topFormat: playbook.bestFormats[0] ?? '',
      optimalTimes: playbook.optimalTimes,
      hashtagStrategy: playbook.hashtagStrategy,
      topRewardSignals: playbook.rewardSignals.slice(0, 3),
      hookAdvice: playbook.hookAdvice,
      bonusTips: playbook.bonusTips,
      promptHint: playbookToPromptHint(playbook),
    };
  }
}
