import React, { useEffect } from 'react';
import { toast } from 'sonner';
import { SendChannelEnum } from '@@/UtilsEnum';

/** Listens for main-process broadcast events and surfaces them as toasts. */
const Inform: React.FC = () => {
  useEffect(() => {
    const handler = (_e: unknown, args: unknown) => {
      const label =
        typeof args === 'string' ? args : 'Automation task triggered';
      toast.info(label);
    };
    window.ipcRenderer.on(SendChannelEnum.AutoRun, handler);
    return () => {
      window.ipcRenderer.off(SendChannelEnum.AutoRun, handler);
    };
  }, []);

  return null;
};

export default Inform;
