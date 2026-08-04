import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { toast } from 'sonner';

// Thin global notification shim backed by sonner.
// Components that previously called useCommontStore().notification.success(...)
// can now call notify.success(...) directly, or import { toast } from 'sonner'.
export const notify = {
  success: (msg: string) => toast.success(msg),
  error: (msg: string) => toast.error(msg),
  info: (msg: string) => toast.info(msg),
  warning: (msg: string) => toast.warning(msg),
};

export interface ICommontStore {
  // reserved for future global state (theme, locale, etc.)
  _placeholder?: never;
}

const store: ICommontStore = {};

export const useCommontStore = create(
  combine({ ...store }, (_set, _get) => ({})),
);
