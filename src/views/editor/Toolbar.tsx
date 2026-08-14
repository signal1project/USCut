import React, { useState } from 'react';
import { toast } from 'sonner';
import {
  Play,
  Pause,
  Square,
  Scissors,
  Trash2,
  Undo2,
  Redo2,
  Download,
  Wand2,
  ZoomIn,
  ZoomOut,
  Type,
  Loader2,
  Save,
  Check,
  Copy,
  Send,
} from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { ipc } from '@/lib/ipc';
import { saveCurrentProject, saveProjectAs } from '@/lib/projectPersistence';
import ShareDialog from './ShareDialog';

const RESOLUTIONS = ['1080p', '4k', '720p'] as const;
const ASPECTS = [
  { id: '16:9', label: '16:9 Wide' },
  { id: '9:16', label: '9:16 Vertical' },
  { id: '1:1', label: '1:1 Square' },
  { id: '4:5', label: '4:5 Portrait' },
] as const;

/** Isolated so only this tiny node re-renders on 60fps playhead ticks. */
const Timecode: React.FC = () => {
  const playhead = useEditorStore((s) => s.playhead);
  const duration = useEditorStore((s) => s.duration);
  return (
    <div className="font-mono text-xs text-[#9a9aa6] bg-[#0c0c0f] px-2.5 py-1.5 rounded-md min-w-[112px] text-center select-none tabular-nums border border-[#202027]">
      <span className="text-ink-strong">{fmt(playhead)}</span>
      <span className="text-[#4a4a55]"> / {fmt(duration)}</span>
    </div>
  );
};

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${ms}`;
}

const Toolbar: React.FC = () => {
  // Narrow selectors — no playhead subscription here (see Timecode); a
  // full-store subscription would re-render the toolbar every frame.
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const duration = useEditorStore((s) => s.duration);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const zoom = useEditorStore((s) => s.zoom);
  const exportProgress = useEditorStore((s) => s.exportProgress);
  const saveState = useEditorStore((s) => s.saveState);
  const tracks = useEditorStore((s) => s.tracks);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const removeClip = useEditorStore((s) => s.removeClip);
  const splitClip = useEditorStore((s) => s.splitClip);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setExportProgress = useEditorStore((s) => s.setExportProgress);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  const [autoEditPrompt, setAutoEditPrompt] = useState('');
  const [showAutoEdit, setShowAutoEdit] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [resolution, setResolution] = useState<'1080p' | '4k' | '720p'>(
    '1080p',
  );
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1' | '4:5'>('16:9');
  const [duckMusic, setDuckMusic] = useState(false);
  const [autoEditing, setAutoEditing] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [savingAs, setSavingAs] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const openSaveAs = () => {
    setSaveAsName(`${useEditorStore.getState().projectName} copy`);
    setShowSaveAs((v) => !v);
  };

  const handleSaveAs = async () => {
    if (!saveAsName.trim()) return;
    setSavingAs(true);
    const ok = await saveProjectAs(saveAsName);
    setSavingAs(false);
    if (ok) setShowSaveAs(false);
  };

  const togglePlay = () => {
    if (duration === 0) return;
    if (useEditorStore.getState().playhead >= duration) setPlayhead(0);
    setIsPlaying(!isPlaying);
  };

  const stop = () => {
    setIsPlaying(false);
    setPlayhead(0);
  };

  const handleSplit = () => {
    if (!selectedClipId) return;
    splitClip(selectedClipId, useEditorStore.getState().playhead);
  };

  const handleDelete = () => {
    if (!selectedClipId) return;
    removeClip(selectedClipId);
  };

  const addCaption = () => {
    const state = useEditorStore.getState();
    const { addTrack, addClipToTrack, tracks: t } = state;
    const captionTrack = t.find((tr) => tr.type === 'caption') ?? {
      id: addTrack('caption'),
    };
    addClipToTrack(captionTrack.id, {
      src: '',
      name: 'Caption',
      duration: 3,
      startTime: state.playhead,
      trimStart: 0,
      trimEnd: 0,
      type: 'caption',
      captionText: 'Caption text',
    });
  };

  const handleExport = async () => {
    // trackIndex: position among VIDEO tracks (0 = base, 1+ = overlays).
    let videoTrackCounter = 0;
    const allClips = tracks.flatMap((t) => {
      const trackIndex = t.type === 'video' ? videoTrackCounter++ : 0;
      return t.clips.map((c) => ({
        id: c.id,
        src: c.src,
        startTime: c.startTime,
        trimStart: c.trimStart,
        trimEnd: c.trimEnd,
        duration: c.duration,
        type: c.type,
        captionText: c.captionText,
        captionStyle: c.captionStyle,
        volume: c.volume,
        speed: c.speed,
        fadeIn: c.fadeIn,
        fadeOut: c.fadeOut,
        transitionIn: c.transitionIn,
        overlay: c.overlay,
        adjust: c.adjust,
        chromaKey: c.chromaKey,
        motion: c.motion,
        trackIndex,
        trackMuted: !!t.muted,
      }));
    });
    if (allClips.length === 0) return;
    setExportProgress(0);
    const result = (await ipc.invoke('aicuts:export', allClips, {
      resolution,
      aspect,
      duckMusic,
      format: 'mp4',
      fps: 30,
    })) as
      | { success?: boolean; outputPath?: string; error?: string }
      | undefined;
    setExportProgress(null);
    setShowExport(false);
    if (result?.success) {
      toast.success(`Exported to: ${result.outputPath}`);
    } else if (result?.error) {
      toast.error(`Export failed: ${result.error}`);
    }
  };

  const handleAutoEdit = async () => {
    if (!autoEditPrompt.trim()) return;
    setAutoEditing(true);
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
          decisions?: {
            clipId: string;
            trimStart: number;
            trimEnd: number;
            startTime: number;
          }[];
          summary?: string;
          error?: string;
        }
      | undefined;
    setAutoEditing(false);
    if (result?.decisions) {
      const { updateClip } = useEditorStore.getState();
      for (const d of result.decisions) {
        updateClip(d.clipId, {
          trimStart: d.trimStart,
          trimEnd: d.trimEnd,
          startTime: d.startTime,
        });
      }
      toast.success(`Auto-edit complete: ${result.summary}`, {
        duration: 15000,
      });
    } else if (result?.error) {
      toast.error(`Auto-edit failed: ${result.error}`, { duration: 15000 });
    }
    setShowAutoEdit(false);
    setAutoEditPrompt('');
  };

  return (
    <div className="flex items-center gap-1.5 px-3 h-12 bg-[#131316] border-b border-[#202027] shrink-0">
      {/* Transport */}
      <button onClick={stop} className="tb-btn" title="Stop">
        <Square size={14} />
      </button>
      <button
        onClick={togglePlay}
        className="flex items-center justify-center w-9 h-8 rounded-md bg-[#26262d] hover:bg-[#303039] text-ink-strong transition-colors"
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause size={15} /> : <Play size={15} />}
      </button>

      {/* Timecode */}
      <Timecode />

      <div className="tb-sep" />

      {/* Edit ops */}
      <button
        onClick={handleSplit}
        disabled={!selectedClipId}
        className="tb-btn"
        title="Split at playhead (S)"
      >
        <Scissors size={14} />
      </button>
      <button
        onClick={handleDelete}
        disabled={!selectedClipId}
        className="tb-btn tb-btn--danger"
        title="Delete selected (Del)"
      >
        <Trash2 size={14} />
      </button>
      <button onClick={addCaption} className="tb-btn" title="Add text">
        <Type size={14} />
      </button>

      <div className="tb-sep" />

      {/* Undo/Redo */}
      <button
        onClick={undo}
        disabled={!canUndo}
        className="tb-btn"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 size={14} />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        className="tb-btn"
        title="Redo (Ctrl+Y)"
      >
        <Redo2 size={14} />
      </button>

      <div className="tb-sep" />

      {/* Save */}
      <button
        onClick={() => void saveCurrentProject()}
        disabled={saveState === 'saving'}
        className="flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-[#26262d] hover:bg-[#303039] text-[#c8c8d2] text-[11px] font-medium transition-colors disabled:opacity-60"
        title="Save project (Ctrl+S) — autosaves as you edit"
      >
        {saveState === 'saving' ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Saving…
          </>
        ) : saveState === 'saved' || saveState === 'clean' ? (
          <>
            <Check size={12} className="text-[#22c55e]" />
            Saved
          </>
        ) : (
          <>
            <Save size={12} />
            Save
          </>
        )}
      </button>

      {/* Save As */}
      <div className="relative">
        <button
          onClick={openSaveAs}
          className="flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-[#26262d] hover:bg-[#303039] text-[#c8c8d2] text-[11px] font-medium transition-colors"
          title="Save a copy as a new project"
        >
          <Copy size={12} />
          Save As
        </button>
        {showSaveAs && (
          <div className="absolute left-0 top-full mt-2 z-50 bg-[#1d1d22] border border-[#303039] rounded-xl shadow-2xl p-3.5 w-72">
            <p className="text-xs font-medium text-ink-strong mb-2 flex items-center gap-1.5">
              <Copy size={13} className="text-[#4d7cff]" /> Save as new project
            </p>
            <input
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveAs();
                if (e.key === 'Escape') setShowSaveAs(false);
              }}
              autoFocus
              placeholder="Project name"
              className="w-full bg-[#0c0c0f] text-xs text-ink-base rounded-lg px-2.5 py-2 border border-[#303039] focus:outline-none focus:border-[#4d7cff] placeholder:text-[#4a4a55]"
            />
            <p className="text-[10px] text-[#71717f] mt-1.5">
              The current project stays saved under its old name.
            </p>
            <button
              onClick={() => void handleSaveAs()}
              disabled={savingAs || !saveAsName.trim()}
              className="mt-2.5 w-full flex items-center justify-center gap-2 bg-[#4d7cff] hover:bg-[#3d6cf0] disabled:opacity-50 text-white text-xs font-medium rounded-lg py-2 transition-colors"
            >
              {savingAs ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Saving…
                </>
              ) : (
                'Save As New Project'
              )}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Zoom */}
      <button
        onClick={() => setZoom(zoom - 10)}
        className="tb-btn"
        title="Zoom out"
      >
        <ZoomOut size={14} />
      </button>
      <span className="text-[10px] text-[#71717f] min-w-[42px] text-center tabular-nums">
        {zoom} px/s
      </span>
      <button
        onClick={() => setZoom(zoom + 10)}
        className="tb-btn"
        title="Zoom in"
      >
        <ZoomIn size={14} />
      </button>

      <div className="tb-sep" />

      {/* Auto-edit */}
      <div className="relative">
        <button
          onClick={() => setShowAutoEdit((v) => !v)}
          className="flex items-center gap-1.5 px-3 h-8 rounded-md bg-[#1d2540] hover:bg-[#243056] text-[#8aa6ff] text-xs font-medium transition-colors"
        >
          <Wand2 size={13} />
          Auto-Edit
        </button>
        {showAutoEdit && (
          <div className="absolute right-0 top-full mt-2 z-50 bg-[#1d1d22] border border-[#303039] rounded-xl shadow-2xl p-3.5 w-80">
            <p className="text-xs font-medium text-ink-strong mb-2 flex items-center gap-1.5">
              <Wand2 size={13} className="text-[#8aa6ff]" /> Describe your edit
            </p>
            <textarea
              value={autoEditPrompt}
              onChange={(e) => setAutoEditPrompt(e.target.value)}
              placeholder="e.g. Make a 60-second highlight reel with the best moments"
              className="w-full bg-[#0c0c0f] text-xs text-ink-base rounded-lg p-2.5 h-20 resize-none border border-[#303039] focus:outline-none focus:border-[#4d7cff] placeholder:text-[#4a4a55]"
            />
            <button
              onClick={handleAutoEdit}
              disabled={autoEditing || !autoEditPrompt.trim()}
              className="mt-2.5 w-full flex items-center justify-center gap-2 bg-[#4d7cff] hover:bg-[#3d6cf0] disabled:opacity-50 text-white text-xs font-medium rounded-lg py-2 transition-colors"
            >
              {autoEditing ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Editing…
                </>
              ) : (
                'Apply AI Edit'
              )}
            </button>
          </div>
        )}
      </div>

      {/* Share */}
      <button
        onClick={() => setShowShare(true)}
        className="flex items-center gap-1.5 px-3 h-8 rounded-md bg-[#12352a] hover:bg-[#174534] text-[#22c55e] text-xs font-semibold transition-colors"
        title="Export and post to social platforms"
      >
        <Send size={13} />
        Share
      </button>

      {/* Export */}
      <div className="relative">
        <button
          onClick={() => setShowExport((v) => !v)}
          className="flex items-center gap-1.5 px-3.5 h-8 rounded-md bg-[#22c55e] hover:bg-[#1faa52] text-[#06210f] text-xs font-semibold transition-colors shadow-sm"
        >
          {exportProgress != null ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              {exportProgress}%
            </>
          ) : (
            <>
              <Download size={13} strokeWidth={2.5} />
              Export
            </>
          )}
        </button>
        {showExport && exportProgress == null && (
          <div className="absolute right-0 top-full mt-2 z-50 bg-[#1d1d22] border border-[#303039] rounded-xl shadow-2xl p-3.5 w-60">
            <p className="text-[10px] text-[#71717f] uppercase tracking-wider mb-2">
              Aspect ratio
            </p>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAspect(a.id)}
                  className={`text-[11px] font-medium px-2 py-1.5 rounded-md transition-colors ${
                    aspect === a.id
                      ? 'bg-[#4d7cff] text-white'
                      : 'bg-[#26262d] text-[#9a9aa6] hover:bg-[#303039]'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[#71717f] uppercase tracking-wider mb-2">
              Resolution
            </p>
            <div className="flex gap-1.5 mb-3">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  className={`flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md transition-colors ${
                    resolution === r
                      ? 'bg-[#4d7cff] text-white'
                      : 'bg-[#26262d] text-[#9a9aa6] hover:bg-[#303039]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 mb-3 text-[11px] text-[#9a9aa6] cursor-pointer">
              <input
                type="checkbox"
                checked={duckMusic}
                onChange={(e) => setDuckMusic(e.target.checked)}
                className="accent-[#4d7cff]"
              />
              Duck music under voice
            </label>
            <button
              onClick={handleExport}
              className="w-full bg-[#22c55e] hover:bg-[#1faa52] text-[#06210f] text-xs font-semibold rounded-lg py-2 transition-colors"
            >
              Export MP4
            </button>
          </div>
        )}
      </div>

      {showShare && <ShareDialog onClose={() => setShowShare(false)} />}

      <style>{`
        .tb-btn {
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 6px; color: #9a9aa6;
          transition: background 0.15s, color 0.15s;
        }
        .tb-btn:hover:not(:disabled) { background: #26262d; color: #f4f4f6; }
        .tb-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .tb-btn--danger:hover:not(:disabled) { background: #3a1a1f; color: #f0556a; }
        .tb-sep { width: 1px; height: 20px; background: #26262d; margin: 0 4px; }
      `}</style>
    </div>
  );
};

export default Toolbar;
