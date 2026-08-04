import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import router from '@/router/index';
// Inform removed for AICut — no social-engine IPC channels needed

const App = () => {
  return (
    <>
      <Toaster
        position="top-right"
        offset={48}
        toastOptions={{
          classNames: {
            toast:
              'bg-surface-1 border border-border text-ink-base rounded-lg shadow-lg text-sm',
            title: 'text-ink-strong font-medium',
            description: 'text-ink-muted',
            actionButton:
              'bg-accent text-bg rounded-md px-2 py-1 text-xs font-medium',
            cancelButton:
              'bg-surface-3 text-ink-muted rounded-md px-2 py-1 text-xs',
          },
        }}
      />
      <RouterProvider router={router} />
    </>
  );
};

export default App;
