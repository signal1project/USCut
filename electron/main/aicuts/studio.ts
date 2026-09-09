import { ipcMain, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AIProvider } from '@mas/types';
import { JobManager } from '../jobs/jobManager';
import {
  studioAssetSchema,
  studioRevisionSchema,
  validateStudioDraft,
  assembleStudioProject,
  studioTimelineDuration,
  buildStoryboardPrompt,
  parseStoryboardScenes,
  buildRevisionPrompt,
  applySceneRevision,
  type StudioDraft,
  type StudioVoice,
  type StudioMusicBed,
  type StudioAssetInsight,
} from '../../../commont/studio';
import { describeStudioAssets } from './studioVision';
import { listStudioMusic, prepareMusicBed } from './studioMusic';
import { synthesizeVoiceover } from './audioTools';
import { probeVideo } from './ffmpegOps';

type Input =
  | {
      kind: 'plan';
      title: string;
      brief: string;
      assets: StudioDraft['assets'];
    }
  | { kind: 'build'; draft: StudioDraft; narration: boolean }
  | {
      kind: 'revise';
      draft: StudioDraft;
      sceneIndex: number;
      instruction: string;
    };

export function registerStudioHandlers(
  resolveProvider: () => AIProvider,
  resolveMusicDir: () => string | null = () => null,
) {
  const jobs = new JobManager<Input, unknown>(
    path.join(app.getPath('userData'), 'jobs', 'studio'),
    async (input, context) => {
      if (input.kind === 'plan') {
        const provider = resolveProvider();
        context.report('Reviewing your media', 2);
        const insights = await describeStudioAssets(
          input.assets,
          provider,
          context.signal,
          context.report,
        );
        context.report(
          insights.length
            ? 'Writing storyboard from what the AI saw'
            : 'Writing storyboard from your brief',
          10,
        );
        const result = await provider.generateText(
          buildStoryboardPrompt(input, insights),
          { maxTokens: 6000 },
        );
        context.signal.throwIfAborted();
        return {
          kind: 'plan',
          insights,
          draft: validateStudioDraft({
            ...input,
            scenes: parseStoryboardScenes(result),
          }),
        };
      }

      if (input.kind === 'revise') {
        const draft = validateStudioDraft(input.draft);
        const revision = studioRevisionSchema.parse({
          sceneIndex: input.sceneIndex,
          instruction: input.instruction,
        });
        const provider = resolveProvider();
        context.report('Reviewing the footage for this scene', 5);
        const sceneAsset = draft.assets.find(
          (a) => a.id === draft.scenes[revision.sceneIndex]?.assetId,
        );
        const insights = await describeStudioAssets(
          sceneAsset ? [sceneAsset] : [],
          provider,
          context.signal,
        );
        context.report('Revising the scene with your AI provider', 20);
        const raw = await provider.generateText(
          buildRevisionPrompt(draft, revision, insights),
          { maxTokens: 2000 },
        );
        context.signal.throwIfAborted();
        const parsed = JSON.parse(
          raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''),
        );
        return {
          kind: 'revise',
          sceneIndex: revision.sceneIndex,
          draft: applySceneRevision(draft, revision.sceneIndex, parsed.scene),
        };
      }

      const draft = validateStudioDraft(input.draft);
      const voices: Record<number, StudioVoice> = {};
      const created: string[] = [];
      try {
        for (const asset of draft.assets) {
          context.signal.throwIfAborted();
          if (!path.isAbsolute(asset.src))
            throw new Error('Media must be a local absolute path');
          await fs.access(asset.src);
          if (asset.type === 'video') {
            const actual = await probeVideo(asset.src);
            if (
              !actual.width ||
              Math.abs(actual.duration - asset.duration) > 0.1
            )
              throw new Error(`Media changed: import ${asset.name} again`);
          }
        }
        for (let i = 0; i < draft.scenes.length; i++) {
          context.signal.throwIfAborted();
          context.report(
            `Preparing scene ${i + 1} of ${draft.scenes.length}`,
            10 + (80 * i) / draft.scenes.length,
          );
          if (input.narration && draft.scenes[i].narration.trim()) {
            const voice = await synthesizeVoiceover(
              draft.scenes[i].narration,
              path.join(app.getPath('userData'), 'voiceovers'),
            );
            created.push(voice.path);
            voices[i] = { src: voice.path, duration: voice.duration };
          }
        }
        context.signal.throwIfAborted();
        let musicBed: StudioMusicBed | null = null;
        if (draft.music) {
          context.report('Preparing the music bed', 92);
          const bed = await prepareMusicBed(
            draft.music.src,
            studioTimelineDuration(draft, voices),
            path.join(app.getPath('userData'), 'studio-music'),
            context.signal,
          );
          created.push(bed.path);
          musicBed = {
            src: bed.path,
            name: draft.music.name,
            volume: draft.music.volume,
            duration: bed.duration,
          };
        }
        return {
          kind: 'build',
          project: assembleStudioProject(draft, randomUUID(), voices, musicBed),
        };
      } catch (error) {
        await Promise.all(
          created.map((file) => fs.unlink(file).catch(() => {})),
        );
        throw error;
      }
    },
  );
  ipcMain.handle('aicuts:studio-jobs', () => jobs.list());
  ipcMain.handle('aicuts:studio-cancel', (_, id: string) => jobs.cancel(id));
  ipcMain.handle('aicuts:studio-music-list', () =>
    listStudioMusic(resolveMusicDir()),
  );
  ipcMain.handle('aicuts:studio-start', (_, request: unknown) => {
    const base = z
      .object({
        requestId: z.string().uuid(),
        kind: z.enum(['plan', 'build', 'revise']),
      })
      .parse(request);
    const raw = request as Record<string, unknown>;
    let input: Input;
    let label: string;
    if (base.kind === 'plan') {
      input = {
        kind: 'plan',
        ...z
          .object({
            title: z.string().trim().min(1).max(150),
            brief: z.string().trim().min(1).max(12000),
            assets: z.array(studioAssetSchema).min(1).max(100),
          })
          .parse(raw),
      };
      label = 'AI storyboard';
    } else if (base.kind === 'revise') {
      const revision = studioRevisionSchema.parse(raw);
      input = {
        kind: 'revise',
        draft: validateStudioDraft(raw.draft),
        sceneIndex: revision.sceneIndex,
        instruction: revision.instruction,
      };
      label = `Revise scene ${revision.sceneIndex + 1}`;
    } else {
      input = {
        kind: 'build',
        draft: validateStudioDraft(raw.draft),
        narration: z.boolean().parse(raw.narration),
      };
      label = 'Build editable video';
    }
    return jobs.submit(base.requestId, label, input);
  });
}

export type { StudioAssetInsight };
