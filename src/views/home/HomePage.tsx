import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Film,
  Wand2,
  Captions,
  Share2,
  Cpu,
  ShieldCheck,
  Zap,
  Plus,
  Send,
  Calendar,
  Search,
  Kanban,
  Image,
  Building2,
  Clock,
  Trash2,
} from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import {
  listProjects,
  openProject,
  deleteProject,
  type ProjectMeta,
} from '@/lib/projectPersistence';
import CompanySwitcher from '@/components/CompanySwitcher';

const FEATURES = [
  {
    icon: Film,
    title: 'Timeline Editor',
    desc: 'Drag, trim, split and arrange clips on a multi-track timeline. Export 720p–4K MP4.',
    color: '#4d7cff',
    action: 'Start editing',
  },
  {
    icon: Wand2,
    title: 'AI Auto-Edit',
    desc: 'Describe your edit in plain English. Claude Sonnet applies trim decisions across all clips.',
    color: '#8aa6ff',
    action: 'Try AI edit',
  },
  {
    icon: Captions,
    title: 'Auto-Captions',
    desc: 'Paste a transcript and AI places caption clips on the timeline with timing from your video.',
    color: '#e0a93a',
    action: 'Generate captions',
  },
  {
    icon: Share2,
    title: 'Social Publish',
    desc: 'Connect Facebook, Instagram, X, TikTok, YouTube, LinkedIn, Pinterest and Threads in one place.',
    color: '#22c55e',
    action: 'Connect accounts',
  },
];

const ADVANTAGES = [
  { icon: Cpu, text: 'Local processing — no cloud uploads, full privacy' },
  { icon: ShieldCheck, text: 'No watermark, no subscription required' },
  { icon: Zap, text: 'Agent API on :4255 — Omobono can drive your editor' },
];

const SOCIAL_SHORTCUTS = [
  {
    icon: Send,
    label: 'Publish Now',
    desc: 'Post to connected accounts immediately',
    path: '/mas/publish',
    color: '#22c55e',
  },
  {
    icon: Calendar,
    label: 'Schedule',
    desc: 'Queue posts for a specific date & time',
    path: '/mas/scheduler',
    color: '#4d7cff',
  },
  {
    icon: Image,
    label: 'Image Posts',
    desc: 'Create image + caption posts',
    path: '/mas/publish',
    color: '#e0a93a',
  },
  {
    icon: Search,
    label: 'Idea Scraper',
    desc: 'Trending topics & news ideas to post about',
    path: '/mas/research',
    color: '#8aa6ff',
  },
  {
    icon: Building2,
    label: 'Listing Scraper',
    desc: 'Capture property listings from Zillow, Realtor & Redfin',
    path: '/mas/listings',
    color: '#34d399',
  },
  {
    icon: Wand2,
    label: 'AI Generate',
    desc: 'AI-written captions for every platform',
    path: '/mas/content',
    color: '#a78bfa',
  },
  {
    icon: Kanban,
    label: 'Pipeline',
    desc: 'Kanban board — ideas to published',
    path: '/mas/pipeline',
    color: '#f97316',
  },
];

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { resetProject } = useEditorStore();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);

  useEffect(() => {
    void listProjects().then(setProjects);
  }, []);

  const openNew = () => {
    resetProject();
    navigate('/editor');
  };

  const handleOpen = async (id: string) => {
    const result = await openProject(id);
    if (!result.ok) {
      alert(result.error ?? 'Could not open project');
      return;
    }
    if (result.missing.length > 0) {
      alert(
        `Heads up — ${result.missing.length} media file(s) were moved or deleted since this project was saved:\n\n${result.missing.join('\n')}`,
      );
    }
    navigate('/editor');
  };

  const handleDelete = async (e: React.MouseEvent, p: ProjectMeta) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `Delete project "${p.name}"? This cannot be undone. (Your media files are not deleted.)`,
      )
    )
      return;
    await deleteProject(p.id);
    setProjects(await listProjects());
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[#0c0c0f] text-[#f4f4f6]">
      {/* Hero */}
      <div className="flex flex-col items-center pt-16 pb-10 px-8 text-center">
        <div
          className="flex items-center justify-center w-14 h-14 rounded-2xl text-2xl text-white shadow-xl mb-5"
          style={{ background: 'linear-gradient(135deg, #4d7cff, #7b5bff)' }}
        >
          ✂
        </div>
        <h1 className="text-[28px] font-bold tracking-tight text-white mb-2">
          Create & Publish AI-Powered Videos
        </h1>
        <p className="text-[14px] text-[#71717f] max-w-md mb-8">
          Edit, caption, and publish to 8 social platforms — powered by Claude
          AI and FFmpeg, running entirely on your machine.
        </p>
        <button
          onClick={openNew}
          className="flex items-center gap-2.5 px-7 py-3.5 bg-[#4d7cff] hover:bg-[#3d6cf0] text-white text-[14px] font-semibold rounded-xl shadow-lg transition-colors"
        >
          <Plus size={18} strokeWidth={2.5} />
          New Project
        </button>
      </div>

      {/* Company scope switcher */}
      <div className="px-8 pb-8">
        <CompanySwitcher />
      </div>

      {/* Recent projects */}
      {projects.length > 0 && (
        <div className="px-8 pb-8">
          <p className="text-[11px] text-[#5a5a66] uppercase tracking-widest font-medium mb-4">
            Recent projects
          </p>
          <div className="grid grid-cols-3 gap-3">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => void handleOpen(p.id)}
                className="group relative text-left p-4 rounded-xl bg-[#131316] border border-[#1d1d22] hover:border-[#4d7cff]/60 hover:bg-[#161619] transition-colors"
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-lg mb-3 bg-[#4d7cff]/10 text-[#4d7cff]">
                  <Film size={18} strokeWidth={1.8} />
                </div>
                <p className="text-[13px] font-semibold text-[#e8e8f0] mb-1 truncate pr-6">
                  {p.name}
                </p>
                <p className="text-[11px] text-[#71717f]">
                  {p.clipCount} clip{p.clipCount === 1 ? '' : 's'} ·{' '}
                  {p.mediaCount} media
                </p>
                <p className="flex items-center gap-1 text-[10px] text-[#5a5a66] mt-1.5">
                  <Clock size={10} />
                  {p.savedAt
                    ? new Date(p.savedAt).toLocaleString()
                    : 'never saved'}
                </p>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => void handleDelete(e, p)}
                  className="absolute top-3 right-3 p-1.5 rounded-md text-[#4a4a55] opacity-0 group-hover:opacity-100 hover:text-[#f0556a] hover:bg-[#3a1a1f] transition-all"
                  title="Delete project"
                >
                  <Trash2 size={13} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Feature grid */}
      <div className="px-8 pb-8">
        <p className="text-[11px] text-[#5a5a66] uppercase tracking-widest font-medium mb-4">
          What you can do
        </p>
        <div className="grid grid-cols-2 gap-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.title}
                onClick={openNew}
                className="group text-left p-4 rounded-xl bg-[#131316] border border-[#1d1d22] hover:border-[#303039] hover:bg-[#161619] transition-colors"
              >
                <div
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg mb-3"
                  style={{ background: `${f.color}18`, color: f.color }}
                >
                  <Icon size={18} strokeWidth={1.8} />
                </div>
                <p className="text-[13px] font-semibold text-[#e8e8f0] mb-1">
                  {f.title}
                </p>
                <p className="text-[11px] text-[#71717f] leading-relaxed">
                  {f.desc}
                </p>
                <p
                  className="text-[11px] font-medium mt-2.5 group-hover:underline"
                  style={{ color: f.color }}
                >
                  {f.action} →
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Social Hub */}
      <div className="px-8 pb-8">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[11px] text-[#5a5a66] uppercase tracking-widest font-medium">
            Social Hub
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/mas/onboarding')}
              className="text-[11px] text-[#71717f] hover:text-[#c8c8d2] transition-colors"
            >
              First time? Setup guide →
            </button>
            <button
              onClick={() => navigate('/mas/settings')}
              className="text-[11px] text-[#71717f] hover:text-[#c8c8d2] transition-colors"
            >
              Settings →
            </button>
            <button
              onClick={() => navigate('/mas/publish')}
              className="text-[11px] text-[#4d7cff] hover:underline"
            >
              Open Social Hub →
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {SOCIAL_SHORTCUTS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.label}
                onClick={() => navigate(s.path)}
                className="group text-left p-3.5 rounded-xl bg-[#131316] border border-[#1d1d22] hover:border-[#303039] hover:bg-[#161619] transition-colors"
              >
                <div
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg mb-2.5"
                  style={{ background: `${s.color}18`, color: s.color }}
                >
                  <Icon size={16} strokeWidth={1.8} />
                </div>
                <p className="text-[12px] font-semibold text-[#e8e8f0] mb-0.5">
                  {s.label}
                </p>
                <p className="text-[10px] text-[#71717f] leading-relaxed">
                  {s.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Speed control + Transitions callout */}
      <div className="px-8 pb-8">
        <div className="p-4 rounded-xl bg-[#131316] border border-[#1d1d22] flex items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#4d7cff]/10 text-[#4d7cff] shrink-0 mt-0.5">
            <Zap size={20} strokeWidth={1.8} />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-white mb-1">
              New: Speed Control & Fade Transitions
            </p>
            <p className="text-[11px] text-[#71717f] leading-relaxed">
              Set any clip to 0.25x slow-mo up to 4x fast-forward. Add fade
              in/out transitions — all burned in via FFmpeg at export time.
              Select a clip and open the Properties panel to try it.
            </p>
          </div>
        </div>
      </div>

      {/* Advantages vs CapCut */}
      <div className="px-8 pb-12">
        <p className="text-[11px] text-[#5a5a66] uppercase tracking-widest font-medium mb-3">
          Why USCut beats CapCut
        </p>
        <div className="space-y-2">
          {ADVANTAGES.map((a) => {
            const Icon = a.icon;
            return (
              <div
                key={a.text}
                className="flex items-center gap-3 text-[12px] text-[#9a9aa6]"
              >
                <Icon size={14} className="text-[#4d7cff] shrink-0" />
                {a.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default HomePage;
