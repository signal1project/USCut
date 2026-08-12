import { Outlet, useNavigate, useLocation, NavLink } from 'react-router-dom';
import { useEffect } from 'react';
import {
  Home,
  Send,
  Wand2,
  Search,
  Kanban,
  BarChart2,
  MessageSquare,
  Calendar,
  Building2,
  Palette,
  Settings,
} from 'lucide-react';
import WindowControlButtons from '@/components/WindowControlButtons/WindowControlButtons';
import { ipc } from '@/lib/ipc';
import { useEditorStore } from '@/store/editorStore';

const MAS_NAV = [
  { path: '/mas/publish', label: 'Publish', icon: Send },
  { path: '/mas/scheduler', label: 'Schedule', icon: Calendar },
  { path: '/mas/content', label: 'Generate', icon: Wand2 },
  { path: '/mas/research', label: 'Research', icon: Search },
  { path: '/mas/listings', label: 'Listings', icon: Building2 },
  { path: '/mas/pipeline', label: 'Pipeline', icon: Kanban },
  { path: '/mas/analytics', label: 'Analytics', icon: BarChart2 },
  { path: '/mas/engagement', label: 'Inbox', icon: MessageSquare },
  { path: '/mas/brand', label: 'Brand', icon: Palette },
  { path: '/mas/settings', label: 'Settings', icon: Settings },
];

export const LayoutBody = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const projectName = useEditorStore((s) => s.projectName);
  const inEditor = location.pathname === '/editor';
  const inSocial = location.pathname.startsWith('/mas');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.code === 'KeyI') {
        event.preventDefault();
        ipc.invoke('OPEN_DEV_TOOLS', 'right');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg text-ink-base">
      <header
        className="drag-region flex items-center justify-between shrink-0 pl-3 pr-1 border-b border-border bg-surface-1"
        style={{ height: 'var(--titlebar-height)' }}
      >
        <div className="no-drag flex items-center gap-2 select-none">
          <span
            className="flex items-center justify-center w-6 h-6 rounded-md text-[13px] font-bold text-white shadow-sm"
            style={{ background: 'linear-gradient(135deg, #4d7cff, #7b5bff)' }}
          >
            ✂
          </span>
          <span className="text-[13px] font-semibold text-ink-strong tracking-tight">
            USCut
          </span>
          {inEditor && (
            <>
              <span className="text-ink-subtle">·</span>
              <span className="text-xs text-ink-muted">{projectName}</span>
              <button
                onClick={() => navigate('/')}
                className="ml-1 flex items-center justify-center w-6 h-6 rounded text-[#5a5a66] hover:text-[#c8c8d2] hover:bg-[#1d1d22] transition-colors"
                title="Home"
              >
                <Home size={13} strokeWidth={1.8} />
              </button>
            </>
          )}
          {inSocial && (
            <>
              <span className="text-ink-subtle">·</span>
              <span className="text-xs text-[#4d7cff] font-medium">
                Social Hub
              </span>
              <button
                onClick={() => navigate('/')}
                className="ml-1 flex items-center justify-center w-6 h-6 rounded text-[#5a5a66] hover:text-[#c8c8d2] hover:bg-[#1d1d22] transition-colors"
                title="Home"
              >
                <Home size={13} strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>
        <div className="no-drag flex items-center h-full">
          <button
            onClick={() => navigate('/mas/settings')}
            className={`flex items-center gap-1.5 h-7 px-2.5 mr-1 rounded text-xs font-medium transition-colors ${
              location.pathname === '/mas/settings'
                ? 'bg-[#1d2540] text-[#8aa9ff]'
                : 'text-[#858592] hover:bg-[#1d1d22] hover:text-[#d5d5dc]'
            }`}
            title="Open Settings"
            aria-label="Open Settings"
          >
            <Settings size={14} strokeWidth={1.8} />
            <span>Settings</span>
          </button>
          <WindowControlButtons />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {inSocial && (
          <nav className="w-40 shrink-0 flex flex-col bg-[#101013] border-r border-[#202027] py-3 gap-0.5">
            {MAS_NAV.map(({ path, label, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 mx-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-[#1d2540] text-[#7ba0ff]'
                      : 'text-[#71717f] hover:bg-[#1a1a1f] hover:text-[#c8c8d2]'
                  }`
                }
              >
                <Icon size={14} strokeWidth={1.8} />
                {label}
              </NavLink>
            ))}
          </nav>
        )}
        <main className="flex-1 overflow-hidden overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
