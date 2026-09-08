import { z } from 'zod';
import type {
  ProjectSnapshot,
  Track,
  MediaItem,
} from '../src/store/editorStore';

export const studioAssetSchema = z.object({
  id: z.string().min(1).max(100),
  src: z.string().min(1),
  name: z.string().min(1).max(500),
  type: z.enum(['video', 'image']),
  duration: z.number().finite().positive().max(86400),
  previewSrc: z.string().optional(),
  thumbnail: z.string().optional(),
});
export const studioSceneSchema = z.object({
  assetId: z.string().min(1),
  duration: z.number().finite().min(0.5).max(120),
  sourceStart: z.number().finite().nonnegative().default(0),
  narration: z.string().max(2000).default(''),
  headline: z.string().max(180).default(''),
});
export const studioDraftSchema = z.object({
  title: z.string().trim().min(1).max(150),
  brief: z.string().max(12000),
  assets: z.array(studioAssetSchema).min(1).max(100),
  scenes: z.array(studioSceneSchema).min(1).max(60),
});
export type StudioDraft = z.infer<typeof studioDraftSchema>;
export type StudioAsset = z.infer<typeof studioAssetSchema>;
export type StudioScene = z.infer<typeof studioSceneSchema>;
export interface StudioVoice {
  src: string;
  duration: number;
}

export function validateStudioDraft(value: unknown): StudioDraft {
  const draft = studioDraftSchema.parse(value);
  const assets = new Map(draft.assets.map((a) => [a.id, a]));
  if (assets.size !== draft.assets.length)
    throw new Error('Duplicate media IDs');
  for (const scene of draft.scenes) {
    const asset = assets.get(scene.assetId);
    if (!asset) throw new Error('A scene references unavailable media');
    if (
      asset.type === 'video' &&
      scene.sourceStart + scene.duration > asset.duration + 0.001
    )
      throw new Error(`Scene exceeds the available duration of ${asset.name}`);
  }
  return draft;
}

/** Pure assembly: source durations and trims retain their native editor meaning. */
export function assembleStudioProject(
  value: unknown,
  id: string,
  voices: Record<number, StudioVoice> = {},
): ProjectSnapshot {
  const draft = validateStudioDraft(value);
  const visual: Track = {
    id: `${id}-visual`,
    type: 'video',
    label: 'Scenes',
    clips: [],
  };
  const text: Track = {
    id: `${id}-text`,
    type: 'caption',
    label: 'Headlines',
    clips: [],
  };
  const audio: Track = {
    id: `${id}-voice`,
    type: 'audio',
    label: 'Narration',
    clips: [],
  };
  const mediaLibrary: MediaItem[] = [...draft.assets];
  let startTime = 0;
  draft.scenes.forEach((scene, index) => {
    const asset = draft.assets.find((a) => a.id === scene.assetId)!;
    const voice = voices[index];
    if (voice && (!Number.isFinite(voice.duration) || voice.duration <= 0))
      throw new Error('Invalid narration duration');
    const duration = Math.max(scene.duration, voice?.duration ?? 0);
    if (
      asset.type === 'video' &&
      scene.sourceStart + duration > asset.duration + 0.001
    )
      throw new Error(
        `Narration is longer than available footage in scene ${index + 1}. Shorten the script or choose longer footage.`,
      );
    visual.clips.push({
      ...asset,
      id: `${id}-scene-${index}`,
      trackId: visual.id,
      duration: asset.type === 'image' ? duration : asset.duration,
      startTime,
      trimStart: asset.type === 'image' ? 0 : scene.sourceStart,
      trimEnd:
        asset.type === 'image'
          ? 0
          : Math.max(0, asset.duration - scene.sourceStart - duration),
      volume: voice ? 0 : 1,
    });
    if (scene.headline.trim())
      text.clips.push({
        id: `${id}-text-${index}`,
        trackId: text.id,
        src: '',
        name: scene.headline,
        type: 'caption',
        captionText: scene.headline,
        duration,
        startTime,
        trimStart: 0,
        trimEnd: 0,
        captionStyle: { position: 'bottom', background: true, fontSize: 48 },
      });
    if (voice) {
      const item: MediaItem = {
        id: `${id}-voice-${index}`,
        src: voice.src,
        name: `Scene ${index + 1} narration`,
        type: 'audio',
        duration: voice.duration,
      };
      mediaLibrary.push(item);
      audio.clips.push({
        ...item,
        trackId: audio.id,
        startTime,
        trimStart: 0,
        trimEnd: 0,
        volume: 1,
      });
    }
    startTime += duration;
  });
  return {
    version: 1,
    id,
    name: draft.title,
    tracks: [visual, text, audio],
    mediaLibrary,
    zoom: 40,
  };
}
