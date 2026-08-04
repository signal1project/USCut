/**
 * UploadImages — antd-free native file upload component.
 * Matches the original IUploadimagesRef / IUploadimagesProps interface so all
 * call-sites continue to compile without changes.
 */
import {
  ForwardedRef,
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import React from 'react';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { useUserStore } from '../../store/user';

const FILE_BASE_URL = import.meta.env.VITE_APP_FILE_HOST as string;
const VITE_APP_URL = import.meta.env.VITE_APP_URL as string;

// ─── Minimal UploadFile shape (mirrors antd's type) ────────────────────────
export interface UploadFile {
  uid: string;
  name: string;
  status?: 'uploading' | 'done' | 'error' | 'removed';
  url?: string;
  preview?: string;
  response?: { data: { name: string } };
  originFileObj?: File;
}

export interface IUploadimagesRef {
  clear: () => void;
}

export interface IUploadimagesProps {
  onUploadChange: (files: UploadFile[]) => void;
  fileListValue?: UploadFile[];
  accept?: string;
  maxCount?: number;
  multiple?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uid() {
  return `rc-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
  });
}

// ─── Component ───────────────────────────────────────────────────────────────
const Uploadimages = memo(
  forwardRef(
    (
      {
        accept = '.png,.jpg,.jpeg',
        onUploadChange,
        maxCount,
        multiple = true,
        fileListValue,
      }: IUploadimagesProps,
      ref: ForwardedRef<IUploadimagesRef>,
    ) => {
      const [fileList, setFileList] = useState<UploadFile[]>(
        fileListValue ?? [],
      );
      const inputRef = useRef<HTMLInputElement>(null);
      const token = useUserStore((state) => state.token);

      useImperativeHandle(ref, () => ({
        clear: () => setFileList([]),
      }));

      useEffect(() => {
        onUploadChange(fileList.filter((f) => f.url && f.status === 'done'));
        // onUploadChange is a caller-supplied callback, not guaranteed stable across
        // renders — only fileList changes should trigger this notification.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [fileList]);

      const handleFiles = async (files: FileList | null) => {
        if (!files) return;
        const incoming = Array.from(files);

        for (const file of incoming) {
          // Extension check
          const allowed = accept
            .split(',')
            .some((ext) => file.type.includes(ext.replace('.', '')));
          if (!allowed) {
            toast.warning(`File type ${file.type} is not allowed.`);
            continue;
          }

          const entry: UploadFile = {
            uid: uid(),
            name: file.name,
            status: 'uploading',
            originFileObj: file,
            preview: await getBase64(file),
          };
          setFileList((prev) => [...prev, entry]);

          // Upload
          try {
            const form = new FormData();
            form.append('file', file);
            const res = await fetch(`${VITE_APP_URL}/oss/upload/permanent`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              body: form,
            });
            const json = await res.json();
            setFileList((prev) =>
              prev.map((f) =>
                f.uid === entry.uid
                  ? {
                      ...f,
                      status: 'done',
                      url: FILE_BASE_URL + json.data.name,
                      response: json,
                    }
                  : f,
              ),
            );
          } catch {
            setFileList((prev) =>
              prev.map((f) =>
                f.uid === entry.uid ? { ...f, status: 'error' } : f,
              ),
            );
            toast.error(`Failed to upload ${file.name}`);
          }
        }
      };

      const removeFile = (uid: string) =>
        setFileList((prev) => prev.filter((f) => f.uid !== uid));

      const canAdd = !maxCount || fileList.length < maxCount;

      return (
        <div className="flex flex-wrap gap-2">
          {fileList.map((f) => (
            <div
              key={f.uid}
              className="relative w-20 h-20 rounded-md overflow-hidden border border-border bg-surface-2"
            >
              {(f.preview || f.url) && (
                <img
                  src={f.url ?? f.preview}
                  alt={f.name}
                  className="w-full h-full object-cover"
                />
              )}
              {f.status === 'uploading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <button
                type="button"
                onClick={() => removeFile(f.uid)}
                className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-error transition-colors"
              >
                <X size={10} />
              </button>
            </div>
          ))}

          {canAdd && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-20 h-20 flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-surface-2 text-ink-muted hover:border-accent hover:text-accent transition-colors cursor-pointer"
            >
              <Plus size={20} />
              <span className="text-[10px]">Upload</span>
            </button>
          )}

          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      );
    },
  ),
);
Uploadimages.displayName = 'Uploadimages';

export default Uploadimages;
