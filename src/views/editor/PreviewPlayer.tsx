import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import {
  useEditorStore,
  findClipAt,
  findBaseVisualClipAt,
  findOverlayClipsAt,
  clipEffectiveDuration,
  cssFilterFor,
  type Clip,
} from '@/store/editorStore';
import { toMediaUrl } from '@/lib/media';

/** Timeline seconds → source-file seconds for a clip (speed-aware). */
function toClipTime(clip: Clip, timelineTime: number): number {
  return clip.trimStart + (timelineTime - clip.startTime) * (clip.speed ?? 1);
}

/** Positioned overlay element (image or muted video) over the preview stage. */
const OverlayItem: React.FC<{
  clip: Clip;
  isPlaying: boolean;
  playhead: number;
}> = ({ clip, isPlaying, playhead }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const ov = clip.overlay ?? { x: 0.65, y: 0.05, scale: 0.3, opacity: 1 };
  const src = toMediaUrl(clip.previewSrc ?? clip.src);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (isPlaying) v.play().catch(() => {});
    else v.pause();
  }, [isPlaying]);

  useEffect(() => {
    const v = ref.current;
    if (!v || isPlaying) return;
    const t = toClipTime(clip, playhead);
    if (Math.abs(v.currentTime - t) > 0.25) v.currentTime = t;
  }, [playhead, isPlaying, clip]);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${ov.x * 100}%`,
    top: `${ov.y * 100}%`,
    width: `${ov.scale * 100}%`,
    opacity: ov.opacity,
    filter: cssFilterFor(clip.adjust),
    pointerEvents: 'none',
  };

  if (clip.type === 'image') {
    return <img src={src} style={style} alt="" />;
  }
  return <video ref={ref} src={src} muted style={style} preload="auto" />;
};

const PreviewPlayer: React.FC = () => {
  const { tracks, playhead, duration, isPlaying, setPlayhead, setIsPlaying } =
    useEditorStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [muted, setMuted] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);

  // Base track visual (video or full-frame image) at the playhead
  const activeBase = findBaseVisualClipAt(tracks, playhead);
  const baseClip = activeBase?.clip ?? null;
  const activeClip = baseClip?.type === 'video' ? baseClip : null; // drives <video>
  const baseImage = baseClip?.type === 'image' ? baseClip : null;
  const videoTrackMuted = !!activeBase?.track.muted;

  // Overlay clips (video tracks 1+)
  const overlays = findOverlayClipsAt(tracks, playhead).filter(
    ({ track }) => !track.muted,
  );

  // Active audio-track clip (music/voiceover laid on the audio track)
  const activeAudio = findClipAt(tracks, 'audio', playhead);
  const audioClip =
    activeAudio && !activeAudio.track.muted ? activeAudio.clip : null;
  const audioSrc = audioClip
    ? toMediaUrl(audioClip.previewSrc ?? audioClip.src)
    : null;

  // Active caption clip (text + style)
  const captionClip = findClipAt(tracks, 'caption', playhead)?.clip ?? null;
  const capStyle = captionClip?.captionStyle ?? {};

  useEffect(() => {
    if (!activeClip) {
      setCurrentSrc(null);
      return;
    }
    const newSrc = toMediaUrl(activeClip.previewSrc ?? activeClip.src);
    if (newSrc !== currentSrc) setCurrentSrc(newSrc);
    // Intentionally narrow: re-derive src only when the active clip identity changes,
    // not on every activeClip/currentSrc reference change — see smooth-playback note
    // above (broader deps here reintroduces per-frame re-render/seek stutter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClip?.id]);

  // Position the video on scrub/clip-change. While playing, the video element
  // is the clock master (effect below) — seeking it here every frame would
  // cause constant decoder hitches, so only genuine jumps (drift beyond what
  // playback itself produces) trigger a seek.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip || !currentSrc) return;
    const clipTime = toClipTime(activeClip, playhead);
    const threshold = isPlaying ? 0.4 : 0.05;
    if (Math.abs(video.currentTime - clipTime) > threshold) {
      video.currentTime = clipTime;
    }
  }, [playhead, activeClip, currentSrc, isPlaying]);

  // Honor per-clip speed + volume in preview (matches export)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = activeClip?.speed ?? 1;
    video.volume = Math.max(0, Math.min(1, activeClip?.volume ?? 1));
  }, [activeClip?.speed, activeClip?.volume, currentSrc]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, audioClip?.volume ?? 1));
  }, [audioClip?.volume, audioSrc]);

  // CLOCK MASTER — while a video clip plays, drive the timeline playhead from
  // the video element's own clock instead of an external rAF accumulator.
  // Two independent clocks drift, and correcting drift means seeking the
  // video mid-playback = visible stutter. One clock, no fights.
  useEffect(() => {
    const video = videoRef.current;
    if (!isPlaying || !video || !activeClip || !currentSrc) return;
    let raf: number;
    const speed = activeClip.speed ?? 1;
    const clipEnd = activeClip.startTime + clipEffectiveDuration(activeClip);
    const loop = () => {
      const s = useEditorStore.getState();
      if (!s.isPlaying) return;
      const t =
        activeClip.startTime +
        (video.currentTime - activeClip.trimStart) / speed;
      if (t >= clipEnd - 0.017 || video.ended) {
        // Hand off: past this clip's trimmed end. Nudge the playhead to the
        // boundary so the next clip (or the gap ticker) takes over.
        if (s.duration > 0 && clipEnd >= s.duration - 0.017) {
          s.setPlayhead(s.duration);
          s.setIsPlaying(false);
        } else {
          s.setPlayhead(clipEnd);
        }
        return;
      }
      // Monotonic: never yank the playhead backwards while the video buffers.
      if (t > s.playhead) s.setPlayhead(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, activeClip, currentSrc]);

  // Keep the audio-track element in sync with the playhead
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioClip) return;
    audio.playbackRate = audioClip.speed ?? 1;
    const clipTime = toClipTime(audioClip, playhead);
    // Loose threshold while playing: audio runs on its own real-time clock,
    // constant micro-seeks are audible clicks.
    const threshold = isPlaying ? 0.3 : 0.05;
    if (Math.abs(audio.currentTime - clipTime) > threshold) {
      audio.currentTime = clipTime;
    }
  }, [playhead, audioClip, isPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentSrc) return;
    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, currentSrc]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    if (isPlaying) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying, audioSrc]);

  const handleScrub = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setPlayhead(ratio * duration);
    },
    [duration, setPlayhead],
  );

  const pct = duration > 0 ? (playhead / duration) * 100 : 0;

  // Caption preview styling (fontSize is authored at 1080p; ~scale to preview)
  const capPosition = capStyle.position ?? 'bottom';
  const captionWrapStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    padding: '0 24px',
    pointerEvents: 'none',
    ...(capPosition === 'top'
      ? { top: '6%' }
      : capPosition === 'middle'
        ? { top: '50%', transform: 'translateY(-50%)' }
        : { bottom: '6%' }),
  };
  const captionTextStyle: React.CSSProperties = {
    color: capStyle.color ?? '#ffffff',
    fontWeight: capStyle.bold === false ? 500 : 800,
    fontFamily: capStyle.fontFamily ?? 'Arial, sans-serif',
    // 48pt at 1080p ≈ 4.4% of frame height; preview stage scales with width
    fontSize: `${((capStyle.fontSize ?? 48) / 1080) * 100 * 2.2}cqh`,
    textShadow: capStyle.background ? 'none' : '0 2px 6px rgba(0,0,0,0.9)',
    background: capStyle.background ? 'rgba(0,0,0,0.55)' : 'transparent',
    padding: capStyle.background ? '0.15em 0.5em' : '0.15em 0',
    borderRadius: 6,
    textAlign: 'center' as const,
    whiteSpace: 'pre-wrap' as const,
  };

  return (
    <div className="flex flex-col items-center w-full h-full px-6 pt-5 pb-4 gap-3">
      {/* Video stage */}
      <div className="relative flex-1 w-full flex items-center justify-center min-h-0">
        <div
          className="relative max-w-full max-h-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl ring-1 ring-[#202027] flex items-center justify-center"
          style={{ width: '100%', containerType: 'size' }}
        >
          {currentSrc ? (
            <video
              ref={videoRef}
              src={currentSrc}
              muted={muted || videoTrackMuted}
              className="max-w-full max-h-full w-full h-full object-contain"
              style={{ filter: cssFilterFor(activeClip?.adjust) }}
              preload="auto"
            />
          ) : baseImage ? (
            <img
              src={toMediaUrl(baseImage.src)}
              className="max-w-full max-h-full w-full h-full object-contain"
              style={{ filter: cssFilterFor(baseImage.adjust) }}
              alt=""
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-[#3f3f4a]">
              <div className="w-16 h-16 rounded-2xl border-2 border-[#2a2a33] flex items-center justify-center">
                <Play size={26} strokeWidth={1.4} className="translate-x-0.5" />
              </div>
              <p className="text-xs text-[#5a5a66]">
                Import media and add it to the timeline
              </p>
            </div>
          )}

          {/* Overlay tracks (PiP / logos / stickers) */}
          {overlays.map(({ clip }) => (
            <OverlayItem
              key={clip.id}
              clip={clip}
              isPlaying={isPlaying}
              playhead={playhead}
            />
          ))}

          {/* Hidden audio element for audio-track clips (music/voiceover) */}
          {audioSrc && (
            <audio
              ref={audioRef}
              src={audioSrc}
              muted={muted}
              preload="auto"
              className="hidden"
            />
          )}

          {/* Caption overlay (styled to match export) */}
          {captionClip?.captionText && (
            <div style={captionWrapStyle}>
              <span style={captionTextStyle}>{captionClip.captionText}</span>
            </div>
          )}
        </div>
      </div>

      {/* Transport + scrubber */}
      <div className="w-full max-w-3xl flex flex-col gap-2">
        <div
          className="group w-full h-1.5 bg-[#26262d] rounded-full cursor-pointer relative"
          onClick={handleScrub}
        >
          <div
            className="h-full bg-[#4d7cff] rounded-full relative"
            style={{ width: `${pct}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={duration === 0}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-[#26262d] hover:bg-[#303039] text-ink-strong disabled:opacity-30 transition-colors"
            >
              {isPlaying ? (
                <Pause size={13} />
              ) : (
                <Play size={13} className="translate-x-0.5" />
              )}
            </button>
            <button
              onClick={() => setMuted((m) => !m)}
              className="flex items-center justify-center w-7 h-7 rounded text-[#71717f] hover:text-ink-base transition-colors"
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
          <span className="text-[11px] font-mono text-[#71717f] tabular-nums">
            {fmt(playhead)}{' '}
            <span className="text-[#3f3f4a]">/ {fmt(duration)}</span>
          </span>
          <button
            className="flex items-center justify-center w-7 h-7 rounded text-[#71717f] hover:text-ink-base transition-colors"
            title="Fullscreen"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${ms}`;
}

export default PreviewPlayer;
