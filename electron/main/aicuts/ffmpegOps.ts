import ffmpeg from 'fluent-ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import { resolveFfmpegPath } from '../../util/ffmpegBinary';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import {
  ASPECT_DIMENSIONS,
  buildExportGraph,
  buildAssSubtitles,
  type AspectRatio,
  type CaptionStyleSpec,
  type GraphClip,
  type Resolution,
} from './exportGraph';

ffmpeg.setFfmpegPath(resolveFfmpegPath());
ffmpeg.setFfprobePath(
  ffprobePath.path.replace('app.asar', 'app.asar.unpacked'),
);

export interface ProbeResult {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
}

export interface TimelineClip {
  id: string;
  src: string;
  startTime: number;
  trimStart: number;
  trimEnd: number;
  duration: number;
  type: 'video' | 'audio' | 'caption' | 'image';
  captionText?: string;
  volume?: number;
  speed?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Index among video tracks (0 = base, 1+ = overlay). Defaults to 0. */
  trackIndex?: number;
  trackMuted?: boolean;
  captionStyle?: CaptionStyleSpec;
  transitionIn?: { type: string; duration: number };
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

export interface ExportOptions {
  outputPath: string;
  resolution: Resolution;
  aspect?: AspectRatio;
  format: 'mp4' | 'mov';
  fps: number;
  duckMusic?: boolean;
  /**
   * Directory of bundled font files (e.g. public/assets/fonts) for caption
   * `captionStyle.fontFamily` matching, in addition to fonts installed on
   * the system. Matched by libass against each file's own name-table
   * family/style records, so a caller-supplied fontFamily must match what
   * the font file actually declares itself as (see fontTools name-table
   * fixups in the fonts asset pipeline for why this matters).
   */
  fontsDir?: string;
  onProgress?: (percent: number) => void;
}

export async function probeVideo(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const videoStream = data.streams.find((s) => s.codec_type === 'video');
      const audioStream = data.streams.find((s) => s.codec_type === 'audio');
      const duration = data.format.duration ?? 0;
      const fpsStr = videoStream?.r_frame_rate ?? '30/1';
      const [num, den] = fpsStr.split('/').map(Number);
      resolve({
        duration: Number(duration),
        width: videoStream?.width,
        height: videoStream?.height,
        fps: den ? num / den : 30,
        hasAudio: !!audioStream,
        videoCodec: videoStream?.codec_name,
        audioCodec: audioStream?.codec_name,
      });
    });
  });
}

export async function getThumbnail(
  filePath: string,
  timeSeconds = 0,
  outDirOverride?: string,
): Promise<string> {
  const outDir = outDirOverride ?? path.join(os.tmpdir(), 'aicuts-thumbs');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${uuidv4()}.jpg`);

  return new Promise((resolve) => {
    ffmpeg(filePath)
      .seekInput(timeSeconds)
      .frames(1)
      .output(outFile)
      .on('end', () => resolve(outFile))
      .on('error', () => resolve(''))
      .run();
  });
}

/** Escape a Windows path for use inside an ffmpeg ass= filter argument. */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * Export the timeline via a single filter_complex graph (see exportGraph.ts).
 * Honors timeline positions (gaps = black+silence), audio-track clips,
 * per-clip volume/speed/fades, transitions, overlays, and aspect presets.
 * Captions burn in as styled ASS subtitles on the compressed timeline.
 */
export async function exportProject(
  clips: TimelineClip[],
  options: ExportOptions,
): Promise<void> {
  const visual = clips.filter((c) => c.type === 'video' || c.type === 'image');
  if (visual.length === 0) throw new Error('No video clips to export');

  const dims = ASPECT_DIMENSIONS[options.aspect ?? '16:9'][options.resolution];

  // Probe audio presence once per unique source so the graph knows where to
  // generate silence instead of referencing a missing audio stream.
  const hasAudioBySrc: Record<string, boolean> = {};
  const videoSrcs = new Set(
    clips.filter((c) => c.type === 'video').map((c) => c.src),
  );
  for (const src of videoSrcs) {
    try {
      hasAudioBySrc[src] = (await probeVideo(src)).hasAudio;
    } catch {
      hasAudioBySrc[src] = false;
    }
  }

  const graphClips: GraphClip[] = clips.map((c) => ({
    ...c,
    trackIndex: c.trackIndex ?? 0,
  }));

  const graph = buildExportGraph(graphClips, {
    width: dims.width,
    height: dims.height,
    fps: options.fps,
    hasAudioBySrc,
    duckMusic: options.duckMusic,
  });

  const filters = [...graph.filters];
  let videoLabel = graph.videoLabel;

  // Styled caption burn-in.
  const captions = graphClips.filter(
    (c) => c.type === 'caption' && (c.captionText ?? '').trim(),
  );
  let assPath: string | null = null;
  if (captions.length > 0) {
    assPath = path.join(os.tmpdir(), `aicuts-captions-${uuidv4()}.ass`);
    fs.writeFileSync(
      assPath,
      buildAssSubtitles(captions, {
        width: dims.width,
        height: dims.height,
        transitions: graph.transitions,
      }),
    );
    const fontsdir = options.fontsDir
      ? `:fontsdir='${escapeFilterPath(options.fontsDir)}'`
      : '';
    filters.push(
      `[${videoLabel}]ass='${escapeFilterPath(assPath)}'${fontsdir}[vsub]`,
    );
    videoLabel = 'vsub';
  }

  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg();
    for (const input of graph.inputs) {
      cmd.input(input.path);
      if (input.options.length > 0) cmd.inputOptions(input.options);
    }
    cmd
      .complexFilter(filters)
      .outputOptions([
        '-map',
        `[${videoLabel}]`,
        '-map',
        `[${graph.audioLabel}]`,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        '-t',
        graph.durationSeconds.toFixed(3),
      ])
      .output(options.outputPath)
      .on('progress', (prog) => {
        if (options.onProgress && prog.percent != null) {
          options.onProgress(
            Math.max(0, Math.min(100, Math.round(prog.percent))),
          );
        }
      })
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });

  if (assPath) fs.unlink(assPath, () => {});
}
