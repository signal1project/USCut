import React, { useState } from 'react';
import {
  Plus,
  Film,
  Music,
  Loader2,
  Type,
  Sparkles,
  UploadCloud,
  Wand2,
  Captions,
  Mic,
  Eraser,
  Scissors,
  Trash2,
} from 'lucide-react';
import { useEditorStore, type MediaItem } from '@/store/editorStore';
import { ipc } from '@/lib/ipc';
import { toMediaUrl } from '@/lib/media';
import { v4 as uuidv4 } from 'uuid';
import { useMasApi } from '@/views/mas/useMasApi';

export type PanelSection = 'media' | 'audio' | 'text' | 'effects' | 'ai';

const SECTION_TITLE: Record<PanelSection, string> = {
  media: 'Media',
  audio: 'Audio',
  text: 'Text',
  effects: 'Effects',
  ai: 'AI Tools',
};

const TEXT_PRESETS = [
  { label: 'Default caption', text: 'Add your text', size: 'text-sm' },
  { label: 'Bold title', text: 'BIG TITLE', size: 'text-base font-extrabold' },
  { label: 'Subtitle', text: 'Subtitle line', size: 'text-xs' },
];

interface Props {
  section: PanelSection;
}

const MediaPanel: React.FC<Props> = ({ section }) => {
  // Narrow selectors — a full-store subscription would re-render this whole
  // panel on every 60fps playhead tick during playback. The playhead itself
  // is read via getState() at click time in addCaption.
  const mediaLibrary = useEditorStore((s) => s.mediaLibrary);
  const tracks = useEditorStore((s) => s.tracks);
  const addMediaItem = useEditorStore((s) => s.addMediaItem);
  const removeMediaItem = useEditorStore((s) => s.removeMediaItem);
  const addClipToTrack = useEditorStore((s) => s.addClipToTrack);
  const addTrack = useEditorStore((s) => s.addTrack);
  const [importing, setImporting] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [captionsBusy, setCaptionsBusy] = useState(false);
  const [autoEditPrompt, setAutoEditPrompt] = useState('');
  const [autoEditBusy, setAutoEditBusy] = useState(false);
  const masApi = useMasApi();
  const [clipSrt, setClipSrt] = useState('');
  const [clipSourceId, setClipSourceId] = useState<string>('');
  const [clipMaxClips, setClipMaxClips] = useState(3);
  const [clipSeconds, setClipSeconds] = useState(30);
  const [clipVertical, setClipVertical] = useState(true);
  const [clipBurnCaptions, setClipBurnCaptions] = useState(true);
  const [clipTrackSubject, setClipTrackSubject] = useState(true);
  const [clipQuery, setClipQuery] = useState('');
  const [clipBusy, setClipBusy] = useState(false);
  const [clipStatus, setClipStatus] = useState<string | null>(null);
  const [clipResults, setClipResults] = useState<
    | {
        pickedBy: string;
        clips: Array<{
          hook: string;
          score: number;
          tracked: boolean;
          durationSeconds: number;
        }>;
      }
    | null
  >(null);
  const [whisperBusy, setWhisperBusy] = useState(false);
  const [whisperStatus, setWhisperStatus] = useState<string | null>(null);
  const [ttsText, setTtsText] = useState('');
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<string | null>(null);

  /** One-click captions: Whisper on the first base-track video clip. */
  const handleWhisperCaptions = async () => {
    const state = useEditorStore.getState();
    const baseVideo = state.tracks
      .filter((t) => t.type === 'video')[0]
      ?.clips.find((c) => c.type === 'video');
    if (!baseVideo) {
      setWhisperStatus('Add a video clip to the timeline first.');
      return;
    }
    setWhisperBusy(true);
    setWhisperStatus(null);
    const result = (await ipc.invoke(
      'aicuts:transcribe-video',
      baseVideo.src,
    )) as
      | {
          segments?: Array<{ start: number; end: number; text: string }>;
          error?: string;
        }
      | undefined;
    setWhisperBusy(false);
    if (!result || result.error) {
      setWhisperStatus(result?.error ?? 'Transcription failed');
      return;
    }
    const segments = result.segments ?? [];
    if (segments.length === 0) {
      setWhisperStatus('No speech detected.');
      return;
    }
    const captionTrack = tracks.find((t) => t.type === 'caption') ?? {
      id: addTrack('caption'),
    };
    // Segment times are source-file times; map onto the timeline through the
    // clip's position/trim (speed shifts handled by the same mapping).
    const speed = baseVideo.speed ?? 1;
    for (const seg of segments) {
      const start =
        baseVideo.startTime + (seg.start - baseVideo.trimStart) / speed;
      const end = baseVideo.startTime + (seg.end - baseVideo.trimStart) / speed;
      if (end <= baseVideo.startTime) continue;
      addClipToTrack(captionTrack.id, {
        src: '',
        name: 'Caption',
        duration: Math.max(0.3, end - Math.max(start, baseVideo.startTime)),
        startTime: Math.max(start, baseVideo.startTime),
        trimStart: 0,
        trimEnd: 0,
        type: 'caption',
        captionText: seg.text,
      });
    }
    setWhisperStatus(
      `✓ ${segments.length} caption${segments.length === 1 ? '' : 's'} placed`,
    );
  };

  /** Windows TTS voiceover → audio library item. */
  const handleTts = async () => {
    if (!ttsText.trim()) return;
    setTtsBusy(true);
    setTtsStatus(null);
    const result = (await ipc.invoke('aicuts:tts', ttsText)) as
      | { path?: string; duration?: number; name?: string; error?: string }
      | undefined;
    setTtsBusy(false);
    if (!result?.path) {
      setTtsStatus(result?.error ?? 'Voiceover failed');
      return;
    }
    addMediaItem({
      id: uuidv4(),
      src: result.path,
      name: result.name ?? 'Voiceover',
      duration: result.duration ?? 5,
      type: 'audio',
    });
    setTtsStatus('✓ Voiceover added to the Audio library');
    setTtsText('');
  };

  const clipVideoOptions = mediaLibrary.filter((m) => m.type === 'video');

  const handleAutoClip = async () => {
    const sourceVideo =
      clipVideoOptions.find((m) => m.id === clipSourceId) ?? clipVideoOptions[0];
    if (!masApi || !sourceVideo) return;
    setClipBusy(true);
    setClipStatus(null);
    setClipResults(null);
    try {
      const result = await masApi.autoClip({
        videoPath: sourceVideo.src,
        transcriptSrt: clipSrt.trim() || undefined,
        maxClips: clipMaxClips,
        clipSeconds,
        vertical: clipVertical,
        burnCaptions: clipBurnCaptions,
        trackSubject: clipTrackSubject,
        query: clipQuery.trim() || undefined,
      });
      // Clips already come back ranked highest-score first (see
      // ClipService.autoClip) — add them to the library in that order.
      for (const clip of result.clips) {
        addMediaItem({
          id: uuidv4(),
          name: clip.hook
            ? `Clip: ${clip.hook.slice(0, 40)}`
            : `Clip ${clip.start}s`,
          src: clip.path,
          duration: clip.durationSeconds,
          type: 'video',
        } as MediaItem);
      }
      setClipResults({
        pickedBy: result.pickedBy,
        clips: result.clips.map((c) => ({
          hook: c.hook,
          score: c.score,
          tracked: c.tracked,
          durationSeconds: c.durationSeconds,
        })),
      });
      setClipStatus(
        `✓ ${result.clips.length} clip${result.clips.length === 1 ? '' : 's'} added to library`,
      );
      setClipSrt('');
      setClipQuery('');
    } catch (err) {
      setClipStatus(err instanceof Error ? err.message : 'Auto-clip failed');
    } finally {
      setClipBusy(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    const items = (await ipc.invoke('aicuts:import-video')) as
      | Omit<MediaItem, 'id'>[]
      | undefined;
    setImporting(false);
    if (!items) return;
    for (const item of items) {
      addMediaItem({ id: uuidv4(), ...item });
    }
  };

  const handleRemoveMedia = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeMediaItem(id);
  };

  const handleAddToTimeline = (item: MediaItem) => {
    // Images ride the video track (base = full-frame; drag to a second video
    // track to make them overlays/watermarks).
    const trackType = item.type === 'image' ? 'video' : item.type;
    const targetTrack = tracks.find((t) => t.type === trackType) ?? tracks[0];
    if (!targetTrack) return;
    const lastEnd = targetTrack.clips.reduce((max, c) => {
      const end = c.startTime + (c.duration - c.trimStart - c.trimEnd);
      return Math.max(max, end);
    }, 0);
    addClipToTrack(targetTrack.id, {
      src: item.src,
      previewSrc: item.previewSrc,
      name: item.name,
      duration: item.duration,
      startTime: lastEnd,
      trimStart: 0,
      trimEnd: 0,
      type: item.type === 'image' ? 'image' : item.type,
      thumbnail: item.thumbnail,
    });
  };

  const addCaption = (text: string) => {
    const captionTrack = tracks.find((t) => t.type === 'caption') ?? {
      id: addTrack('caption'),
    };
    addClipToTrack(captionTrack.id, {
      src: '',
      name: 'Caption',
      duration: 3,
      startTime: useEditorStore.getState().playhead,
      trimStart: 0,
      trimEnd: 0,
      type: 'caption',
      captionText: text,
    });
  };

  const handleGenerateCaptions = async () => {
    if (!transcript.trim()) return;
    setCaptionsBusy(true);
    const allClips = tracks.flatMap((t) =>
      t.clips.map((c) => ({
        id: c.id,
        src: c.src,
        startTime: c.startTime,
        trimStart: c.trimStart,
        trimEnd: c.trimEnd,
        duration: c.duration,
        type: c.type,
      })),
    );
    const result = (await ipc.invoke(
      'aicuts:generate-captions',
      transcript,
      allClips,
    )) as
      | Array<{ startTime: number; endTime: number; text: string }>
      | undefined;
    setCaptionsBusy(false);
    if (!result || result.length === 0) return;
    const captionTrack = tracks.find((t) => t.type === 'caption') ?? {
      id: addTrack('caption'),
    };
    for (const seg of result) {
      addClipToTrack(captionTrack.id, {
        src: '',
        name: 'Caption',
        duration: seg.endTime - seg.startTime,
        startTime: seg.startTime,
        trimStart: 0,
        trimEnd: 0,
        type: 'caption',
        captionText: seg.text,
      });
    }
    setTranscript('');
  };

  const handleAutoEdit = async () => {
    if (!autoEditPrompt.trim()) return;
    setAutoEditBusy(true);
    const allClips = tracks.flatMap((t) =>
      t.clips.map((c) => ({
        id: c.id,
        name: c.name,
        duration: c.duration,
        src: c.src,
      })),
    );
    const result = (await ipc.invoke('aicuts:auto-edit', {
      clips: allClips,
      prompt: autoEditPrompt,
    })) as
      | {
          decisions?: Array<{
            clipId: string;
            trimStart: number;
            trimEnd: number;
            startTime: number;
          }>;
          summary?: string;
          error?: string;
        }
      | undefined;
    setAutoEditBusy(false);
    if (result?.decisions) {
      const { updateClip } = useEditorStore.getState();
      for (const d of result.decisions) {
        updateClip(d.clipId, {
          trimStart: d.trimStart,
          trimEnd: d.trimEnd,
          startTime: d.startTime,
        });
      }
      setAutoEditPrompt('');
    }
  };

  const visibleMedia = mediaLibrary.filter((m) =>
    section === 'audio' ? m.type === 'audio' : m.type !== 'audio',
  );

  const showImport = section === 'media' || section === 'audio';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-11 border-b border-[#202027] shrink-0">
        <span className="text-[13px] font-semibold text-ink-strong tracking-tight">
          {SECTION_TITLE[section]}
        </span>
        {showImport && (
          <button
            onClick={handleImport}
            disabled={importing}
            className="flex items-center gap-1.5 text-[11px] font-medium bg-[#4d7cff] hover:bg-[#3d6cf0] text-white rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-50 shadow-sm"
          >
            {importing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Plus size={12} strokeWidth={2.5} />
            )}
            Import
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {/* Media / Audio grid */}
        {showImport && (
          <>
            {visibleMedia.length === 0 ? (
              <button
                onClick={handleImport}
                className="flex flex-col items-center justify-center gap-3 w-full mt-4 py-10 rounded-xl border border-dashed border-[#2f2f38] text-[#5a5a66] hover:border-[#4d7cff]/50 hover:text-[#8a8a96] transition-colors"
              >
                <UploadCloud size={30} strokeWidth={1.4} />
                <div className="text-center">
                  <p className="text-xs font-medium text-[#b8b8c2]">
                    Import {section === 'audio' ? 'audio' : 'media'}
                  </p>
                  <p className="text-[10px] mt-0.5">Click or drag files here</p>
                </div>
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {visibleMedia.map((item) => (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleAddToTimeline(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleAddToTimeline(item);
                      }
                    }}
                    className="group relative flex flex-col rounded-lg overflow-hidden bg-[#1d1d22] border border-transparent hover:border-[#4d7cff] transition-colors text-left cursor-pointer"
                    title={`Add to timeline: ${item.name}`}
                  >
                    <div className="relative aspect-video bg-[#0c0c0f] flex items-center justify-center overflow-hidden">
                      {item.thumbnail ? (
                        <img
                          src={toMediaUrl(item.thumbnail)}
                          className="w-full h-full object-cover"
                          alt=""
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              'none';
                          }}
                        />
                      ) : item.type === 'audio' ? (
                        <Music size={20} className="text-[#5a5a66]" />
                      ) : (
                        <Film size={20} className="text-[#5a5a66]" />
                      )}
                      <span className="absolute bottom-1 right-1 text-[9px] font-mono text-white/90 bg-black/60 px-1 rounded">
                        {fmt(item.duration)}
                      </span>
                      {item.missing && (
                        <span className="absolute top-1 left-1 text-[9px] font-medium bg-red-600/85 text-white px-1 rounded">
                          file missing
                        </span>
                      )}
                      <button
                        onClick={(e) => handleRemoveMedia(e, item.id)}
                        title={`Remove from library: ${item.name}`}
                        className="absolute top-1 right-1 flex items-center justify-center w-5 h-5 rounded-md bg-black/70 text-white/80 opacity-0 group-hover:opacity-100 hover:!bg-red-600 hover:text-white transition-all z-10"
                      >
                        <Trash2 size={11} />
                      </button>
                      <div className="absolute inset-0 flex items-center justify-center bg-[#4d7cff]/0 group-hover:bg-[#4d7cff]/15 transition-colors">
                        <Plus
                          size={22}
                          strokeWidth={2.5}
                          className="text-white opacity-0 group-hover:opacity-100 drop-shadow"
                        />
                      </div>
                    </div>
                    <p className="px-1.5 py-1 text-[10px] text-[#b8b8c2] truncate leading-tight">
                      {item.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Text section */}
        {section === 'text' && (
          <div className="space-y-2">
            <button
              onClick={() => addCaption('Add your text')}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-[#4d7cff] hover:bg-[#3d6cf0] text-white text-xs font-medium transition-colors shadow-sm"
            >
              <Type size={14} /> Add text to timeline
            </button>
            <p className="text-[10px] text-[#5a5a66] uppercase tracking-wider pt-2 px-0.5">
              Styles
            </p>
            {TEXT_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => addCaption(p.text)}
                className="flex items-center w-full h-16 rounded-lg bg-[#1d1d22] hover:bg-[#26262d] border border-[#26262d] hover:border-[#4d7cff]/50 transition-colors px-4"
              >
                <span className={`text-[#f4f4f6] ${p.size}`}>{p.text}</span>
              </button>
            ))}
          </div>
        )}

        {/* Effects section */}
        {section === 'effects' && (
          <div className="space-y-3">
            <p className="text-[10px] text-[#5a5a66] uppercase tracking-wider px-0.5">
              Transitions
            </p>
            <p className="text-[10px] text-[#71717f] leading-relaxed">
              Select a clip then use the{' '}
              <span className="text-[#c8c8d2]">Properties</span> panel on the
              right to set Fade In / Fade Out duration for that clip.
            </p>
            <div className="mt-3 p-3 rounded-lg bg-[#1d1d22] border border-[#26262d]">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles size={13} className="text-[#4d7cff]" />
                <span className="text-[11px] font-medium text-ink-strong">
                  Per-clip fades
                </span>
              </div>
              <p className="text-[10px] text-[#71717f]">
                Fade in / fade out are burned into the export via FFmpeg — no
                quality loss.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-[#1d1d22] border border-[#26262d] opacity-50">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-medium text-ink-strong">
                  Clip transitions
                </span>
                <span className="text-[9px] bg-[#26262d] text-[#71717f] px-1.5 py-0.5 rounded font-medium">
                  Soon
                </span>
              </div>
              <p className="text-[10px] text-[#71717f]">
                Cross-dissolve, wipe, slide between clips
              </p>
            </div>
            <div className="p-3 rounded-lg bg-[#1d1d22] border border-[#26262d] opacity-50">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-medium text-ink-strong">
                  Color grading
                </span>
                <span className="text-[9px] bg-[#26262d] text-[#71717f] px-1.5 py-0.5 rounded font-medium">
                  Soon
                </span>
              </div>
              <p className="text-[10px] text-[#71717f]">
                Brightness, contrast, saturation, LUTs
              </p>
            </div>
          </div>
        )}

        {/* AI Tools section */}
        {section === 'ai' && (
          <div className="space-y-4">
            {/* Auto-Captions */}
            <div className="p-3 rounded-xl bg-[#1d1d22] border border-[#26262d]">
              <div className="flex items-center gap-2 mb-2">
                <Captions size={14} className="text-[#4d7cff]" />
                <span className="text-[12px] font-semibold text-ink-strong">
                  Auto-Captions
                </span>
              </div>
              <p className="text-[10px] text-[#71717f] mb-2.5">
                One click: listen to your video and place timed captions
                (Whisper — needs an OpenAI key in Settings). Or paste a
                transcript below.
              </p>
              <button
                onClick={handleWhisperCaptions}
                disabled={whisperBusy}
                className="w-full flex items-center justify-center gap-1.5 bg-[#4d7cff] hover:bg-[#3d6cf0] disabled:opacity-50 text-white text-[11px] font-medium rounded-lg py-2 transition-colors"
              >
                {whisperBusy ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Listening…
                  </>
                ) : (
                  'Generate from video audio'
                )}
              </button>
              {whisperStatus && (
                <p className="text-[10px] text-[#a1a1ab] mt-1.5">
                  {whisperStatus}
                </p>
              )}
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="…or paste a transcript here"
                className="mt-2 w-full bg-[#0c0c0f] text-[10px] text-ink-base rounded-lg p-2 h-16 resize-none border border-[#303039] focus:outline-none focus:border-[#4d7cff] placeholder:text-[#4a4a55]"
              />
              <button
                onClick={handleGenerateCaptions}
                disabled={captionsBusy || !transcript.trim()}
                className="mt-2 w-full flex items-center justify-center gap-1.5 bg-[#4d7cff] hover:bg-[#3d6cf0] disabled:opacity-50 text-white text-[11px] font-medium rounded-lg py-2 transition-colors"
              >
                {captionsBusy ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Generating…
                  </>
                ) : (
                  'Generate Captions'
                )}
              </button>
            </div>

            {/* Auto-Edit */}
            <div className="p-3 rounded-xl bg-[#1d1d22] border border-[#26262d]">
              <div className="flex items-center gap-2 mb-2">
                <Wand2 size={14} className="text-[#8aa6ff]" />
                <span className="text-[12px] font-semibold text-ink-strong">
                  AI Auto-Edit
                </span>
              </div>
              <p className="text-[10px] text-[#71717f] mb-2.5">
                Describe your edit — Claude Sonnet applies trim decisions across
                all clips.
              </p>
              <textarea
                value={autoEditPrompt}
                onChange={(e) => setAutoEditPrompt(e.target.value)}
                placeholder="e.g. Make a 60-second highlight reel with the best moments"
                className="w-full bg-[#0c0c0f] text-[10px] text-ink-base rounded-lg p-2 h-16 resize-none border border-[#303039] focus:outline-none focus:border-[#4d7cff] placeholder:text-[#4a4a55]"
              />
              <button
                onClick={handleAutoEdit}
                disabled={autoEditBusy || !autoEditPrompt.trim()}
                className="mt-2 w-full flex items-center justify-center gap-1.5 bg-[#1d2540] hover:bg-[#243056] disabled:opacity-50 text-[#8aa6ff] text-[11px] font-medium rounded-lg py-2 transition-colors"
              >
                {autoEditBusy ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Editing…
                  </>
                ) : (
                  'Apply AI Edit'
                )}
              </button>
            </div>

            {/* Auto-Clip (Opus-Clip-style repurposing) */}
            <div className="p-3 rounded-xl bg-[#1d1d22] border border-[#26262d]">
              <div className="flex items-center gap-2 mb-2">
                <Scissors size={14} className="text-[#34d399]" />
                <span className="text-[12px] font-semibold text-ink-strong">
                  Auto-Clip
                </span>
              </div>
              <p className="text-[10px] text-[#71717f] mb-2.5">
                Finds and ranks the best moments in a source video, cuts
                vertical short clips, and burns captions.
              </p>

              <label className="block text-[9px] font-medium text-[#71717f] mb-1">
                Source video
              </label>
              <select
                value={clipSourceId || clipVideoOptions[0]?.id || ''}
                onChange={(e) => setClipSourceId(e.target.value)}
                disabled={clipVideoOptions.length === 0}
                className="w-full bg-[#0c0c0f] text-[10px] text-ink-base rounded-lg p-2 mb-2 border border-[#303039] focus:outline-none focus:border-[#34d399] disabled:opacity-50"
              >
                {clipVideoOptions.length === 0 ? (
                  <option value="">No video in library</option>
                ) : (
                  clipVideoOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))
                )}
              </select>

              <textarea
                value={clipSrt}
                onChange={(e) => setClipSrt(e.target.value)}
                placeholder="Optional: paste SRT/VTT transcript, or leave empty for Whisper…"
                className="w-full bg-[#0c0c0f] text-[10px] text-ink-base rounded-lg p-2 h-14 resize-none border border-[#303039] focus:outline-none focus:border-[#34d399] placeholder:text-[#4a4a55]"
              />

              <input
                value={clipQuery}
                onChange={(e) => setClipQuery(e.target.value)}
                placeholder='Optional: "find the funny moments"…'
                className="w-full bg-[#0c0c0f] text-[10px] text-ink-base rounded-lg p-2 mt-2 border border-[#303039] focus:outline-none focus:border-[#34d399] placeholder:text-[#4a4a55]"
              />

              <div className="flex gap-2 mt-2">
                <div className="flex-1">
                  <label className="block text-[9px] font-medium text-[#71717f] mb-1">
                    Clips
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={clipMaxClips}
                    onChange={(e) =>
                      setClipMaxClips(
                        Math.min(8, Math.max(1, Number(e.target.value) || 1)),
                      )
                    }
                    className="w-full bg-[#0c0c0f] text-[10px] text-ink-base rounded-lg p-2 border border-[#303039] focus:outline-none focus:border-[#34d399]"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[9px] font-medium text-[#71717f] mb-1">
                    Length (s)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={90}
                    value={clipSeconds}
                    onChange={(e) =>
                      setClipSeconds(
                        Math.min(90, Math.max(10, Number(e.target.value) || 10)),
                      )
                    }
                    className="w-full bg-[#0c0c0f] text-[10px] text-ink-base rounded-lg p-2 border border-[#303039] focus:outline-none focus:border-[#34d399]"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1 mt-2">
                <label className="flex items-center gap-1.5 text-[10px] text-[#a1a1ab]">
                  <input
                    type="checkbox"
                    checked={clipVertical}
                    onChange={(e) => setClipVertical(e.target.checked)}
                    className="accent-[#34d399]"
                  />
                  Crop to vertical (9:16)
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-[#a1a1ab]">
                  <input
                    type="checkbox"
                    checked={clipBurnCaptions}
                    onChange={(e) => setClipBurnCaptions(e.target.checked)}
                    className="accent-[#34d399]"
                  />
                  Burn captions
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-[#a1a1ab]">
                  <input
                    type="checkbox"
                    checked={clipTrackSubject}
                    onChange={(e) => setClipTrackSubject(e.target.checked)}
                    disabled={!clipVertical}
                    className="accent-[#34d399] disabled:opacity-50"
                  />
                  Follow subject (needs a vision-capable AI provider — falls
                  back to a fixed crop otherwise)
                </label>
              </div>

              <button
                onClick={handleAutoClip}
                disabled={clipBusy || !masApi || clipVideoOptions.length === 0}
                className="mt-2.5 w-full flex items-center justify-center gap-1.5 bg-[#12352a] hover:bg-[#174534] disabled:opacity-50 text-[#34d399] text-[11px] font-medium rounded-lg py-2 transition-colors"
              >
                {clipBusy ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Clipping…
                  </>
                ) : (
                  'Find & Cut Clips'
                )}
              </button>
              {clipStatus && (
                <p className="text-[10px] text-[#a1a1ab] mt-1.5">
                  {clipStatus}
                </p>
              )}
              {clipResults && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <p className="text-[9px] text-[#71717f]">
                    picked by:{' '}
                    {clipResults.pickedBy === 'ai-visual'
                      ? 'AI (transcript + visual)'
                      : clipResults.pickedBy === 'ai'
                        ? 'AI (transcript)'
                        : 'heuristic (no AI provider configured)'}
                  </p>
                  {clipResults.clips.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 bg-[#0c0c0f] rounded-lg px-2 py-1.5 border border-[#26262d]"
                    >
                      <span className="text-[10px] font-semibold text-[#34d399] shrink-0">
                        {c.score}
                      </span>
                      <span className="text-[10px] text-ink-base flex-1 truncate">
                        {c.hook || `${c.durationSeconds}s clip`}
                      </span>
                      {c.tracked && (
                        <span className="text-[8px] bg-[#12352a] text-[#34d399] px-1 py-0.5 rounded shrink-0">
                          tracked
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Remove Background stub */}
            <div className="p-3 rounded-xl bg-[#1d1d22] border border-[#26262d] opacity-60">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Eraser size={14} className="text-[#e0a93a]" />
                  <span className="text-[12px] font-semibold text-ink-strong">
                    Remove Background
                  </span>
                </div>
                <span className="text-[9px] bg-[#26262d] text-[#71717f] px-1.5 py-0.5 rounded font-medium">
                  Soon
                </span>
              </div>
              <p className="text-[10px] text-[#71717f]">
                AI-powered background removal for video clips
              </p>
            </div>

            {/* Voice Studio — Windows TTS keyless default, ElevenLabs upgrade in Settings */}
            <div className="p-3 rounded-xl bg-[#1d1d22] border border-[#26262d]">
              <div className="flex items-center gap-2 mb-2">
                <Mic size={14} className="text-[#22c55e]" />
                <span className="text-[12px] font-semibold text-ink-strong">
                  Voice Studio
                </span>
              </div>
              <p className="text-[10px] text-[#71717f] mb-2.5">
                Type a script — turned into a voiceover clip in your Audio
                library. Windows speech synthesis by default (no key needed);
                add an ElevenLabs key in Settings for higher-quality voices.
              </p>
              <textarea
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
                placeholder="Voiceover script…"
                className="w-full bg-[#0c0c0f] text-[10px] text-ink-base rounded-lg p-2 h-16 resize-none border border-[#303039] focus:outline-none focus:border-[#22c55e] placeholder:text-[#4a4a55]"
              />
              <button
                onClick={handleTts}
                disabled={ttsBusy || !ttsText.trim()}
                className="mt-2 w-full flex items-center justify-center gap-1.5 bg-[#12352a] hover:bg-[#174534] disabled:opacity-50 text-[#22c55e] text-[11px] font-medium rounded-lg py-2 transition-colors"
              >
                {ttsBusy ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Speaking…
                  </>
                ) : (
                  'Generate Voiceover'
                )}
              </button>
              {ttsStatus && (
                <p className="text-[10px] text-[#a1a1ab] mt-1.5">{ttsStatus}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default MediaPanel;
