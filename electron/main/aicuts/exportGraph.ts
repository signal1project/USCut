/**
 * Export pipeline v2 — builds a single ffmpeg filter_complex graph from the
 * timeline instead of the old trim-and-concat approach. Fixes the silent
 * losses of v1: audio-track clips and per-clip volume now reach the output,
 * timeline gaps render as black+silence (so caption timing is honest),
 * transitions (xfade/acrossfade) work, and vertical/square aspects export.
 *
 * Everything here is PURE (no ffmpeg, no fs) so the graph is unit-testable;
 * ffmpegOps.exportProject feeds it to fluent-ffmpeg.
 */

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';
export type Resolution = '720p' | '1080p' | '4k';

export interface CaptionStyleSpec {
  fontFamily?: string;
  fontSize?: number; // pt at 1080p-height baseline
  color?: string; // '#rrggbb'
  bold?: boolean;
  position?: 'top' | 'middle' | 'bottom';
  background?: boolean;
}

export interface GraphClip {
  id: string;
  src: string;
  type: 'video' | 'audio' | 'image' | 'caption';
  /** Index among video-type tracks: 0 = base track, 1+ = overlay tracks. */
  trackIndex: number;
  trackMuted?: boolean;
  startTime: number;
  trimStart: number;
  trimEnd: number;
  duration: number;
  speed?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  transitionIn?: { type: string; duration: number };
  captionText?: string;
  captionStyle?: CaptionStyleSpec;
  overlay?: { x: number; y: number; scale: number; opacity: number };
  adjust?: {
    preset?: string;
    brightness?: number;
    contrast?: number;
    saturation?: number;
  };
  chromaKey?: {
    enabled: boolean;
    color: string;
    similarity: number;
    blend: number;
  };
  motion?: 'none' | 'zoom_in' | 'zoom_out';
}

export interface GraphOptions {
  width: number;
  height: number;
  fps: number;
  /** hasAudio per source path (from ffprobe) — silence is generated when false. */
  hasAudioBySrc: Record<string, boolean>;
  /** Duck music under base-track voice (sidechaincompress). */
  duckMusic?: boolean;
}

export interface InputSpec {
  path: string;
  options: string[];
}

export interface BuiltGraph {
  inputs: InputSpec[];
  filters: string[];
  videoLabel: string;
  audioLabel: string;
  /** Output duration after transition compression. */
  durationSeconds: number;
  /** Transition boundaries (uncompressed timeline) — for caption/music mapping. */
  transitions: TransitionPoint[];
}

export const ASPECT_DIMENSIONS: Record<
  AspectRatio,
  Record<Resolution, { width: number; height: number }>
> = {
  '16:9': {
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
    '4k': { width: 3840, height: 2160 },
  },
  '9:16': {
    '720p': { width: 720, height: 1280 },
    '1080p': { width: 1080, height: 1920 },
    '4k': { width: 2160, height: 3840 },
  },
  '1:1': {
    '720p': { width: 720, height: 720 },
    '1080p': { width: 1080, height: 1080 },
    '4k': { width: 2160, height: 2160 },
  },
  '4:5': {
    '720p': { width: 720, height: 900 },
    '1080p': { width: 1080, height: 1350 },
    '4k': { width: 2160, height: 2700 },
  },
};

export const XFADE_TRANSITIONS = [
  'fade',
  'wipeleft',
  'wiperight',
  'slideup',
  'circleopen',
] as const;

export function clipEffectiveDuration(c: GraphClip): number {
  return (c.duration - c.trimStart - c.trimEnd) / (c.speed ?? 1);
}

const EPS = 0.001;

// ── Timeline compression (transitions overlap adjacent clips) ────────────────

export interface TransitionPoint {
  /** Timeline time (uncompressed) where the transition boundary sits. */
  at: number;
  duration: number;
}

/**
 * Transitions make the incoming clip start `duration` early, shortening the
 * output. Maps an uncompressed timeline time to the compressed output time so
 * captions and music stay in sync with the picture.
 */
export function compressTime(
  t: number,
  transitions: TransitionPoint[],
): number {
  let shift = 0;
  for (const tr of transitions) {
    if (t >= tr.at - EPS) shift += tr.duration;
  }
  return Math.max(0, t - shift);
}

// ── Segment planning ──────────────────────────────────────────────────────────

export interface PlannedSegment {
  kind: 'clip' | 'gap';
  clip?: GraphClip;
  duration: number;
  /** Uncompressed timeline start. */
  timelineStart: number;
}

/**
 * Lay the base video track out as a contiguous list of clip + gap segments.
 * Overlapping base clips are clamped (the later clip starts where the earlier
 * one ended). `minDuration` extends the tail with black so music/captions
 * that outlast the video are not cut off.
 */
export function planBaseSegments(
  clips: GraphClip[],
  minDuration = 0,
): PlannedSegment[] {
  const base = clips
    .filter(
      (c) => (c.type === 'video' || c.type === 'image') && c.trackIndex === 0,
    )
    .sort((a, b) => a.startTime - b.startTime);

  const segments: PlannedSegment[] = [];
  let cursor = 0;
  for (const clip of base) {
    const start = Math.max(clip.startTime, cursor);
    if (start > cursor + EPS) {
      segments.push({
        kind: 'gap',
        duration: start - cursor,
        timelineStart: cursor,
      });
      cursor = start;
    }
    const dur = clipEffectiveDuration(clip);
    if (dur <= EPS) continue;
    segments.push({ kind: 'clip', clip, duration: dur, timelineStart: cursor });
    cursor += dur;
  }
  if (minDuration > cursor + EPS) {
    segments.push({
      kind: 'gap',
      duration: minDuration - cursor,
      timelineStart: cursor,
    });
  }
  return segments;
}

/** Transition points (uncompressed timeline) taken from planned segments. */
export function transitionPoints(
  segments: PlannedSegment[],
): TransitionPoint[] {
  const points: TransitionPoint[] = [];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const prev = segments[i - 1];
    const tr = seg.kind === 'clip' ? seg.clip?.transitionIn : undefined;
    if (!tr || tr.duration <= EPS) continue;
    // A transition needs meat on both sides; clamp to the shorter neighbour.
    const d = Math.min(tr.duration, prev.duration - EPS, seg.duration - EPS);
    if (d <= EPS) continue;
    points.push({ at: seg.timelineStart, duration: d });
  }
  return points;
}

// ── Filter builders ───────────────────────────────────────────────────────────

function ffColor(hex: string): string {
  const clean = (hex || '#000000').replace('#', '');
  return `0x${clean}`;
}

/** eq/hue chain for per-clip color adjustments. */
export function adjustFilter(adjust?: GraphClip['adjust']): string[] {
  if (!adjust) return [];
  const parts: string[] = [];
  let { brightness = 0, contrast = 1, saturation = 1 } = adjust;
  switch (adjust.preset) {
    case 'vivid':
      saturation *= 1.35;
      contrast *= 1.1;
      break;
    case 'warm':
      parts.push('colortemperature=temperature=4500');
      break;
    case 'cool':
      parts.push('colortemperature=temperature=8000');
      break;
    case 'mono':
      saturation = 0;
      break;
    case 'bright':
      brightness += 0.12;
      break;
  }
  if (
    Math.abs(brightness) > 0.001 ||
    Math.abs(contrast - 1) > 0.001 ||
    Math.abs(saturation - 1) > 0.001
  ) {
    parts.push(
      `eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`,
    );
  }
  return parts;
}

function motionFilter(
  motion: GraphClip['motion'],
  durationSeconds: number,
  fps: number,
  w: number,
  h: number,
): string[] {
  if (!motion || motion === 'none') return [];
  const frames = Math.max(1, Math.round(durationSeconds * fps));
  const zExpr =
    motion === 'zoom_in'
      ? `min(1+0.15*on/${frames},1.15)`
      : `max(1.15-0.15*on/${frames},1)`;
  return [
    `zoompan=z='${zExpr}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=${fps}`,
  ];
}

/** Video filter chain for one base-track clip segment. */
export function videoSegmentFilters(
  clip: GraphClip,
  inputIdx: number,
  label: string,
  opts: GraphOptions,
): string {
  const speed = clip.speed ?? 1;
  const segDur = clipEffectiveDuration(clip);
  const chain: string[] = [];

  if (clip.type === 'image') {
    // -loop 1 -t <dur> input; just normalize timing.
    chain.push('setpts=PTS-STARTPTS');
  } else {
    chain.push(
      `trim=start=${clip.trimStart.toFixed(3)}:end=${(clip.duration - clip.trimEnd).toFixed(3)}`,
    );
    chain.push(
      speed !== 1
        ? `setpts=(PTS-STARTPTS)/${speed.toFixed(4)}`
        : 'setpts=PTS-STARTPTS',
    );
  }

  if (clip.chromaKey?.enabled) {
    chain.push(
      `chromakey=color=${ffColor(clip.chromaKey.color)}:similarity=${(clip.chromaKey.similarity || 0.1).toFixed(3)}:blend=${(clip.chromaKey.blend || 0).toFixed(3)}`,
    );
  }

  chain.push(
    `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease`,
    `pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fps=${opts.fps}`,
  );

  chain.push(...adjustFilter(clip.adjust));
  chain.push(
    ...motionFilter(clip.motion, segDur, opts.fps, opts.width, opts.height),
  );

  const fadeIn = clip.fadeIn ?? 0;
  const fadeOut = clip.fadeOut ?? 0;
  if (fadeIn > EPS) chain.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  if (fadeOut > EPS)
    chain.push(
      `fade=t=out:st=${Math.max(0, segDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`,
    );

  chain.push('format=yuv420p');
  return `[${inputIdx}:v]${chain.join(',')}[${label}]`;
}

/** Audio chain for one base segment (real audio or generated silence). */
export function audioSegmentFilters(
  seg: PlannedSegment,
  inputIdx: number | null,
  label: string,
  opts: GraphOptions,
): string {
  const clip = seg.clip;
  const hasAudio =
    seg.kind === 'clip' &&
    !!clip &&
    clip.type === 'video' &&
    !clip.trackMuted &&
    (clip.volume ?? 1) > EPS &&
    opts.hasAudioBySrc[clip.src] !== false;

  if (!hasAudio || inputIdx == null || !clip) {
    return `anullsrc=r=48000:cl=stereo,atrim=0:${seg.duration.toFixed(3)},asetpts=PTS-STARTPTS[${label}]`;
  }

  const speed = clip.speed ?? 1;
  const chain: string[] = [
    `atrim=start=${clip.trimStart.toFixed(3)}:end=${(clip.duration - clip.trimEnd).toFixed(3)}`,
    'asetpts=PTS-STARTPTS',
  ];
  chain.push(...atempoChain(speed));
  const vol = clip.volume ?? 1;
  if (Math.abs(vol - 1) > EPS) chain.push(`volume=${vol.toFixed(3)}`);
  const fadeIn = clip.fadeIn ?? 0;
  const fadeOut = clip.fadeOut ?? 0;
  if (fadeIn > EPS) chain.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  if (fadeOut > EPS)
    chain.push(
      `afade=t=out:st=${Math.max(0, seg.duration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`,
    );
  chain.push('aresample=48000', 'aformat=channel_layouts=stereo');
  return `[${inputIdx}:a]${chain.join(',')}[${label}]`;
}

export function atempoChain(speed: number): string[] {
  if (Math.abs(speed - 1) < 0.001) return [];
  const parts: string[] = [];
  let s = speed;
  while (s >= 1.999) {
    parts.push('atempo=2.0');
    s /= 2.0;
  }
  while (s <= 0.5001) {
    parts.push('atempo=0.5');
    s /= 0.5;
  }
  if (Math.abs(s - 1.0) > 0.001) parts.push(`atempo=${s.toFixed(4)}`);
  return parts;
}

// ── Whole-graph builder ───────────────────────────────────────────────────────

export function buildExportGraph(
  clips: GraphClip[],
  opts: GraphOptions,
): BuiltGraph {
  const inputs: InputSpec[] = [];
  const filters: string[] = [];

  const musicClips = clips
    .filter((c) => c.type === 'audio' && !c.trackMuted && (c.volume ?? 1) > EPS)
    .sort((a, b) => a.startTime - b.startTime);
  const overlayClips = clips
    .filter(
      (c) => (c.type === 'video' || c.type === 'image') && c.trackIndex > 0,
    )
    .sort((a, b) => a.startTime - b.startTime);
  const captionClips = clips.filter((c) => c.type === 'caption');

  const contentEnd = Math.max(
    0,
    ...musicClips.map((c) => c.startTime + clipEffectiveDuration(c)),
    ...captionClips.map((c) => c.startTime + clipEffectiveDuration(c)),
    ...overlayClips.map((c) => c.startTime + clipEffectiveDuration(c)),
  );

  const segments = planBaseSegments(clips, contentEnd);
  if (segments.length === 0)
    throw new Error('Nothing to export — the timeline is empty.');

  const transitions = transitionPoints(segments);
  const totalDuration =
    segments.reduce((sum, s) => sum + s.duration, 0) -
    transitions.reduce((sum, t) => sum + t.duration, 0);

  const addInput = (spec: InputSpec): number => {
    inputs.push(spec);
    return inputs.length - 1;
  };

  // — Base video + per-segment audio —
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  segments.forEach((seg, i) => {
    const vLabel = `v${i}`;
    const aLabel = `a${i}`;
    if (seg.kind === 'gap' || !seg.clip) {
      filters.push(
        `color=c=black:s=${opts.width}x${opts.height}:r=${opts.fps}:d=${seg.duration.toFixed(3)},format=yuv420p[${vLabel}]`,
      );
      filters.push(audioSegmentFilters(seg, null, aLabel, opts));
    } else {
      const clip = seg.clip;
      const idx = addInput(
        clip.type === 'image'
          ? {
              path: clip.src,
              options: ['-loop', '1', '-t', seg.duration.toFixed(3)],
            }
          : { path: clip.src, options: [] },
      );
      filters.push(videoSegmentFilters(clip, idx, vLabel, opts));
      filters.push(
        audioSegmentFilters(
          seg,
          clip.type === 'video' ? idx : null,
          aLabel,
          opts,
        ),
      );
    }
    videoLabels.push(vLabel);
    audioLabels.push(aLabel);
  });

  // — Chain segments together (concat or xfade/acrossfade) —
  let vAcc = videoLabels[0];
  let aAcc = audioLabels[0];
  let accDur = segments[0].duration;
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const tr = seg.kind === 'clip' ? seg.clip?.transitionIn : undefined;
    const point = transitions.find(
      (p) => Math.abs(p.at - seg.timelineStart) < EPS,
    );
    const vNext = `vc${i}`;
    const aNext = `ac${i}`;
    if (tr && point) {
      const type = XFADE_TRANSITIONS.includes(
        tr.type as (typeof XFADE_TRANSITIONS)[number],
      )
        ? tr.type
        : 'fade';
      filters.push(
        `[${vAcc}][${videoLabels[i]}]xfade=transition=${type}:duration=${point.duration.toFixed(3)}:offset=${(accDur - point.duration).toFixed(3)}[${vNext}]`,
      );
      filters.push(
        `[${aAcc}][${audioLabels[i]}]acrossfade=d=${point.duration.toFixed(3)}[${aNext}]`,
      );
      accDur += seg.duration - point.duration;
    } else {
      filters.push(`[${vAcc}][${videoLabels[i]}]concat=n=2:v=1:a=0[${vNext}]`);
      filters.push(`[${aAcc}][${audioLabels[i]}]concat=n=2:v=0:a=1[${aNext}]`);
      accDur += seg.duration;
    }
    vAcc = vNext;
    aAcc = aNext;
  }

  // — Overlay tracks (PiP / images / watermarks) —
  overlayClips.forEach((clip, k) => {
    const dur = clipEffectiveDuration(clip);
    if (dur <= EPS) return;
    const idx = addInput(
      clip.type === 'image'
        ? { path: clip.src, options: ['-loop', '1', '-t', dur.toFixed(3)] }
        : { path: clip.src, options: [] },
    );
    const ov = clip.overlay ?? { x: 0.65, y: 0.05, scale: 0.3, opacity: 1 };
    const w = Math.max(16, Math.round(opts.width * ov.scale));
    const prep: string[] = [];
    if (clip.type === 'video') {
      prep.push(
        `trim=start=${clip.trimStart.toFixed(3)}:end=${(clip.duration - clip.trimEnd).toFixed(3)}`,
        clip.speed && clip.speed !== 1
          ? `setpts=(PTS-STARTPTS)/${clip.speed.toFixed(4)}`
          : 'setpts=PTS-STARTPTS',
      );
    } else {
      prep.push('setpts=PTS-STARTPTS');
    }
    if (clip.chromaKey?.enabled) {
      prep.push(
        `chromakey=color=${ffColor(clip.chromaKey.color)}:similarity=${(clip.chromaKey.similarity || 0.1).toFixed(3)}:blend=${(clip.chromaKey.blend || 0).toFixed(3)}`,
      );
    }
    prep.push(`scale=${w}:-2`, ...adjustFilter(clip.adjust), 'format=yuva420p');
    if (ov.opacity < 1 - EPS)
      prep.push(`colorchannelmixer=aa=${ov.opacity.toFixed(3)}`);
    // Shift into position on the compressed timeline.
    const start = compressTime(clip.startTime, transitions);
    prep.push(`setpts=PTS+${start.toFixed(3)}/TB`);
    const ovLabel = `ov${k}`;
    filters.push(`[${idx}:v]${prep.join(',')}[${ovLabel}]`);
    const x = `${(ov.x * opts.width).toFixed(0)}`;
    const y = `${(ov.y * opts.height).toFixed(0)}`;
    const outLabel = `vo${k}`;
    filters.push(
      `[${vAcc}][${ovLabel}]overlay=${x}:${y}:enable='between(t,${start.toFixed(3)},${(start + dur).toFixed(3)})'[${outLabel}]`,
    );
    vAcc = outLabel;
  });

  // — Music bus (audio-track clips positioned on the compressed timeline) —
  const musicLabels: string[] = [];
  musicClips.forEach((clip, k) => {
    const dur = clipEffectiveDuration(clip);
    if (dur <= EPS) return;
    const idx = addInput({ path: clip.src, options: [] });
    const chain: string[] = [
      `atrim=start=${clip.trimStart.toFixed(3)}:end=${(clip.duration - clip.trimEnd).toFixed(3)}`,
      'asetpts=PTS-STARTPTS',
      ...atempoChain(clip.speed ?? 1),
    ];
    const vol = clip.volume ?? 1;
    if (Math.abs(vol - 1) > EPS) chain.push(`volume=${vol.toFixed(3)}`);
    if ((clip.fadeIn ?? 0) > EPS)
      chain.push(`afade=t=in:st=0:d=${(clip.fadeIn ?? 0).toFixed(3)}`);
    if ((clip.fadeOut ?? 0) > EPS)
      chain.push(
        `afade=t=out:st=${Math.max(0, dur - (clip.fadeOut ?? 0)).toFixed(3)}:d=${(clip.fadeOut ?? 0).toFixed(3)}`,
      );
    chain.push('aresample=48000', 'aformat=channel_layouts=stereo');
    const startMs = Math.round(
      compressTime(clip.startTime, transitions) * 1000,
    );
    chain.push(`adelay=${startMs}:all=1`);
    const label = `m${k}`;
    filters.push(`[${idx}:a]${chain.join(',')}[${label}]`);
    musicLabels.push(label);
  });

  let audioLabel = aAcc;
  if (musicLabels.length > 0) {
    let musicBus = musicLabels[0];
    if (musicLabels.length > 1) {
      filters.push(
        `[${musicLabels.join('][')}]amix=inputs=${musicLabels.length}:duration=longest:normalize=0[mbus]`,
      );
      musicBus = 'mbus';
    }
    if (opts.duckMusic) {
      // Duck music under the base track's voice.
      filters.push(`[${aAcc}]asplit=2[voice][sc]`);
      filters.push(
        `[${musicBus}][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked]`,
      );
      filters.push(
        `[voice][ducked]amix=inputs=2:duration=first:normalize=0[aout]`,
      );
    } else {
      filters.push(
        `[${aAcc}][${musicBus}]amix=inputs=2:duration=first:normalize=0[aout]`,
      );
    }
    audioLabel = 'aout';
  }

  return {
    inputs,
    filters,
    videoLabel: vAcc,
    audioLabel,
    durationSeconds: totalDuration,
    transitions,
  };
}

// ── ASS subtitles (styled captions, compressed timeline) ─────────────────────

function assColor(hex: string | undefined, fallback = 'FFFFFF'): string {
  const clean = (hex ?? '').replace('#', '');
  const rgb = /^[0-9a-fA-F]{6}$/.test(clean) ? clean : fallback;
  const r = rgb.slice(0, 2);
  const g = rgb.slice(2, 4);
  const b = rgb.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function assTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

const POSITION_ALIGNMENT: Record<string, number> = {
  bottom: 2,
  middle: 5,
  top: 8,
};

export function buildAssSubtitles(
  captions: GraphClip[],
  opts: { width: number; height: number; transitions: TransitionPoint[] },
): string {
  const styleKeys = new Map<
    string,
    { name: string; style: CaptionStyleSpec }
  >();
  const styleName = (s?: CaptionStyleSpec): string => {
    const key = JSON.stringify(s ?? {});
    let entry = styleKeys.get(key);
    if (!entry) {
      entry = { name: `S${styleKeys.size}`, style: s ?? {} };
      styleKeys.set(key, entry);
    }
    return entry.name;
  };

  const events = captions
    .filter((c) => (c.captionText ?? '').trim())
    .sort((a, b) => a.startTime - b.startTime)
    .map((c) => {
      const start = compressTime(c.startTime, opts.transitions);
      const end = compressTime(
        c.startTime + clipEffectiveDuration(c),
        opts.transitions,
      );
      const text = (c.captionText ?? '').replace(/\r?\n/g, '\\N');
      return `Dialogue: 0,${assTime(start)},${assTime(end)},${styleName(c.captionStyle)},,0,0,0,,${text}`;
    });

  const scale = opts.height / 1080; // font sizes are authored at 1080p baseline
  const styles = [...styleKeys.values()].map(({ name, style }) => {
    const size = Math.round((style.fontSize ?? 48) * scale);
    const align = POSITION_ALIGNMENT[style.position ?? 'bottom'] ?? 2;
    const bold = style.bold === false ? 0 : -1;
    const border = style.background ? 3 : 1;
    const font = style.fontFamily ?? 'Arial';
    return `Style: ${name},${font},${size},${assColor(style.color)},&H000000FF,&H00000000,&H80000000,${bold},0,0,0,100,100,0,0,${border},2,1,${align},40,40,40,1`;
  });

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
  ].join('\n');
}
