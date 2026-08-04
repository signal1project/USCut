import { describe, it, expect } from 'vitest';
import { PLATFORMS } from '@mas/types';
import { PLATFORM_PLAYBOOKS, playbookToPromptHint } from '../platformPlaybooks';
import { PlatformAlgorithmAgent } from '../algorithmAgent';
import {
  extractHashtags,
  buildAlgorithmAwareBrief,
} from '../../content/contentService';

// ── PLATFORM_PLAYBOOKS ────────────────────────────────────────────────────────

describe('PLATFORM_PLAYBOOKS', () => {
  it('contains an entry for every supported platform', () => {
    for (const platform of PLATFORMS) {
      expect(
        PLATFORM_PLAYBOOKS[platform],
        `Missing playbook for ${platform}`,
      ).toBeDefined();
    }
  });

  it('every playbook has required fields', () => {
    for (const [name, playbook] of Object.entries(PLATFORM_PLAYBOOKS)) {
      expect(
        playbook.algorithmSummary,
        `${name}: missing algorithmSummary`,
      ).toBeTruthy();
      expect(
        playbook.bestFormats.length,
        `${name}: empty bestFormats`,
      ).toBeGreaterThan(0);
      expect(
        playbook.optimalTimes.length,
        `${name}: empty optimalTimes`,
      ).toBeGreaterThan(0);
      expect(
        playbook.hashtagStrategy,
        `${name}: missing hashtagStrategy`,
      ).toBeTruthy();
      expect(
        playbook.contentLength,
        `${name}: missing contentLength`,
      ).toBeTruthy();
      expect(
        playbook.rewardSignals.length,
        `${name}: empty rewardSignals`,
      ).toBeGreaterThan(0);
      expect(playbook.hookAdvice, `${name}: missing hookAdvice`).toBeTruthy();
    }
  });

  it('instagram playbook mentions Saves and Carousels', () => {
    const ig = PLATFORM_PLAYBOOKS.instagram;
    expect(ig.rewardSignals[0].toLowerCase()).toContain('save');
    expect(ig.bestFormats[0].toLowerCase()).toContain('carousel');
  });

  it('tiktok playbook mentions completion rate', () => {
    const tt = PLATFORM_PLAYBOOKS.tiktok;
    const hasCompletion = tt.rewardSignals.some((s) =>
      s.toLowerCase().includes('completion'),
    );
    expect(hasCompletion).toBe(true);
  });

  it('linkedin playbook mentions 3-5 hashtags', () => {
    expect(PLATFORM_PLAYBOOKS.linkedin.hashtagStrategy).toContain('3');
  });
});

// ── playbookToPromptHint ──────────────────────────────────────────────────────

describe('playbookToPromptHint', () => {
  it('includes the platform name and algorithm summary', () => {
    const hint = playbookToPromptHint(PLATFORM_PLAYBOOKS.instagram);
    expect(hint).toContain('INSTAGRAM');
    expect(hint).toContain('ALGORITHM GUIDANCE');
    expect(hint).toContain('Saves');
  });

  it('includes hook advice and reward signals', () => {
    const hint = playbookToPromptHint(PLATFORM_PLAYBOOKS.twitter);
    expect(hint).toContain('Hook advice');
    expect(hint).toContain('Top reward signals');
  });
});

// ── PlatformAlgorithmAgent ────────────────────────────────────────────────────

describe('PlatformAlgorithmAgent', () => {
  const agent = new PlatformAlgorithmAgent();

  it('getHints returns all required fields for instagram', () => {
    const hints = agent.getHints('instagram');
    expect(hints.platform).toBe('instagram');
    expect(hints.summary).toBeTruthy();
    expect(hints.topFormat).toBeTruthy();
    expect(hints.optimalTimes.length).toBeGreaterThan(0);
    expect(hints.topRewardSignals.length).toBe(3);
    expect(hints.hookAdvice).toBeTruthy();
    expect(hints.promptHint).toContain('INSTAGRAM');
  });

  it('getHintsForPlatforms returns one entry per platform', () => {
    const hints = agent.getHintsForPlatforms([
      'instagram',
      'twitter',
      'facebook',
    ]);
    expect(hints).toHaveLength(3);
    expect(hints.map((h) => h.platform)).toEqual([
      'instagram',
      'twitter',
      'facebook',
    ]);
  });

  it('getPromptHint returns non-empty string for all platforms', () => {
    for (const platform of PLATFORMS) {
      const hint = agent.getPromptHint(platform);
      expect(hint.length, `${platform}: empty promptHint`).toBeGreaterThan(50);
    }
  });
});

// ── ContentService integration ────────────────────────────────────────────────

describe('buildAlgorithmAwareBrief', () => {
  it('prepends the algorithm hint to the brief', () => {
    const hint = '[INSTAGRAM ALGORITHM GUIDANCE]\nSaves are king.';
    const brief = 'Write a post about home buying tips.';
    const combined = buildAlgorithmAwareBrief(brief, hint);
    expect(combined).toContain('[INSTAGRAM ALGORITHM GUIDANCE]');
    expect(combined).toContain('home buying tips');
    // Hint comes before the brief.
    expect(combined.indexOf('[INSTAGRAM')).toBeLessThan(
      combined.indexOf('home buying'),
    );
  });
});

describe('extractHashtags', () => {
  it('extracts hashtags from body text', () => {
    const tags = extractHashtags(
      'Check out #RealEstate tips! #HomeOwnership #Investing',
    );
    expect(tags).toEqual(['#RealEstate', '#HomeOwnership', '#Investing']);
  });

  it('deduplicates hashtags', () => {
    const tags = extractHashtags('#Real #Estate #Real');
    expect(tags).toHaveLength(2);
  });

  it('returns empty array for text without hashtags', () => {
    expect(extractHashtags('No hashtags here.')).toEqual([]);
  });
});
