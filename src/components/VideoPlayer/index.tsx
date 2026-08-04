import React, { useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import styles from './videoPlayer.module.scss';

interface VideoPlayerProps {
  videoUrl: string;
  visible: boolean;
  onClose: () => void;
  title?: string;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoUrl,
  visible,
  onClose,
  title,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!visible && videoRef.current) {
      videoRef.current.pause();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`${styles.videoModal ?? ''} relative bg-surface-1 rounded-lg shadow-xl w-full max-w-3xl mx-4`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-ink-strong">
            {title || 'Video Player'}
          </span>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink-strong transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        {/* Video */}
        <div className={`${styles.videoContainer ?? ''} p-4`}>
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            className={`${styles.videoPlayer ?? ''} w-full rounded-md`}
          />
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
