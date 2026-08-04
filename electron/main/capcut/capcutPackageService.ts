import type { Platform } from '@mas/types';
import type {
  CapCutExportTarget,
  CapCutPackageServiceDeps,
  CapCutProductionPackage,
  CapCutScene,
  CreateCapCutPackageInput,
} from './types';

function safeTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.([0-9]{3})Z$/, '$1000Z');
}

function manifestTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, '').replace('.', '');
}

function aspectRatioFor(platform: Platform): '9:16' | '16:9' | '1:1' {
  if (platform === 'youtube') return '9:16'; // Shorts-first MVP.
  if (platform === 'pinterest') return '9:16';
  return '9:16';
}

function splitScript(script: string): string[] {
  const parts = script
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [script.trim()].filter(Boolean);
}

function truncate(text: string, max = 58): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export class CapCutPackageService {
  private readonly now: () => Date;

  constructor(deps: CapCutPackageServiceDeps = {}) {
    this.now = deps.now ?? (() => new Date());
  }

  createPackage(input: CreateCapCutPackageInput): CapCutProductionPackage {
    const createdAt = this.now();
    const stamp = safeTimestamp(createdAt);
    const lines = [input.hook, ...splitScript(input.script)].filter(Boolean);
    const scenes = this.buildScenes(lines, input);
    const exports = this.buildExports(input);

    return {
      id: `capcut_${input.campaignId}_${stamp}`,
      campaignId: input.campaignId,
      campaignTitle: input.campaignTitle,
      status: 'draft',
      editingMode: 'editable_project_package',
      createdAt: createdAt.toISOString(),
      platforms: input.platforms,
      trendKeywords: input.trendKeywords,
      strategyNotes: input.strategyNotes,
      scenes,
      exports,
      rendering: {
        automatedExport: false,
        instructions:
          'Open in CapCut as an editable project package. Review scene timing, captions, overlays, music, and brand assets manually before exporting.',
      },
      approval: {
        required: true,
        gate: 'omobono_review_then_dale_approval',
      },
      manifestFileName: `capcut-package-${input.campaignId}-${manifestTimestamp(createdAt)}.json`,
    };
  }

  private buildScenes(
    lines: string[],
    input: CreateCapCutPackageInput,
  ): CapCutScene[] {
    return lines.map((line, index): CapCutScene => {
      const isHook = index === 0;
      const trend =
        input.trendKeywords[index % Math.max(1, input.trendKeywords.length)] ??
        input.campaignTitle;
      return {
        id: `scene_${String(index + 1).padStart(2, '0')}`,
        durationSeconds: isHook ? 3 : 5,
        visualDirection: isHook
          ? 'Fast first-frame hook, high contrast text, immediate pattern interrupt.'
          : 'Support the voiceover with quick cuts, proof visuals, UI captures, or relevant b-roll.',
        voiceover: line,
        onScreenText: truncate(line),
        brollPrompt: `Vertical short-form b-roll for "${input.campaignTitle}" tied to trend "${trend}".`,
      };
    });
  }

  private buildExports(input: CreateCapCutPackageInput): CapCutExportTarget[] {
    return input.platforms.map((platform) => {
      const variant = input.captionVariants.find(
        (v) => v.platform === platform,
      );
      return {
        platform,
        aspectRatio: aspectRatioFor(platform),
        resolution: '1080x1920',
        caption: variant?.body ?? input.hook,
        hashtags: variant?.hashtags ?? [],
      };
    });
  }
}
