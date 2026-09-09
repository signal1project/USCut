import type { ProjectFileV1 } from '../electron/main/aicuts/projects';

/** In-archive relative folder for bundled media. */
export const ARCHIVE_MEDIA_DIR = 'media';
export const ARCHIVE_SCHEMA = 'uscut-project-archive/1';

type ClipLike = { src?: unknown; previewSrc?: unknown } & Record<
  string,
  unknown
>;
type TrackLike = { clips?: unknown } & Record<string, unknown>;

function clipsOf(project: ProjectFileV1): ClipLike[] {
  const out: ClipLike[] = [];
  for (const track of (project.tracks ?? []) as TrackLike[])
    if (Array.isArray(track?.clips))
      for (const clip of track.clips as ClipLike[])
        if (clip && typeof clip === 'object') out.push(clip);
  return out;
}

/** Every distinct on-disk media path a project references (clip + library
 * `src`). Caption clips (`src: ''`) and blank entries are ignored. */
export function collectMediaSources(project: ProjectFileV1): string[] {
  const seen = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) seen.add(value);
  };
  for (const clip of clipsOf(project)) add(clip.src);
  for (const item of project.mediaLibrary ?? []) add(item.src);
  return [...seen];
}

/**
 * Returns a copy of the project with every media `src` replaced through `map`.
 * `previewSrc` (a renderer-only proxy path) is dropped wherever `src` changes —
 * it is regenerated on next import and would otherwise dangle.
 */
export function remapProjectMedia(
  project: ProjectFileV1,
  map: (src: string) => string | undefined,
): ProjectFileV1 {
  const remapString = (value: unknown) =>
    typeof value === 'string' ? (map(value) ?? value) : value;
  const tracks = ((project.tracks ?? []) as TrackLike[]).map((track) => ({
    ...track,
    clips: Array.isArray(track?.clips)
      ? (track.clips as ClipLike[]).map((clip) => {
          if (!clip || typeof clip !== 'object') return clip;
          const src = remapString(clip.src);
          const changed = src !== clip.src;
          const next = { ...clip, src };
          if (changed && 'previewSrc' in next) delete next.previewSrc;
          return next;
        })
      : track.clips,
  }));
  const mediaLibrary = (project.mediaLibrary ?? []).map((item) => {
    const src = remapString(item.src);
    const changed = src !== item.src;
    const next = { ...item, src } as (typeof project.mediaLibrary)[number];
    if (changed && 'previewSrc' in next)
      delete (next as Record<string, unknown>).previewSrc;
    return next;
  });
  return { ...project, tracks, mediaLibrary };
}
