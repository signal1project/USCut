import { memo, useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ipc } from '@/lib/ipc';

const btn =
  'no-drag flex items-center justify-center w-10 h-full text-ink-muted hover:text-ink-strong transition-colors';

const Windowcontrolbuttons = memo(() => {
  const [platform, setPlatform] = useState('');

  useEffect(() => {
    ipc
      .invoke('app:info')
      .then((res) =>
        setPlatform((res as { platform?: string })?.platform ?? ''),
      )
      .catch(() => {
        /* ignore — not critical */
      });
  }, []);

  // Only render on Windows; macOS uses native traffic-light buttons
  if (platform !== 'win32') return null;

  return (
    <div className="no-drag flex items-center h-full">
      <button
        aria-label="Minimize"
        className={btn}
        onClick={() => ipc.invoke('window-minimize')}
      >
        <Minus size={14} />
      </button>
      <button
        aria-label="Maximize"
        className={btn}
        onClick={() => ipc.invoke('window-maximize')}
      >
        <Square size={12} />
      </button>
      <button
        aria-label="Close"
        className={cn(btn, 'hover:bg-error hover:text-bg')}
        onClick={() => ipc.invoke('window-close')}
      >
        <X size={14} />
      </button>
    </div>
  );
});
Windowcontrolbuttons.displayName = 'WindowControlButtons';

export default Windowcontrolbuttons;
