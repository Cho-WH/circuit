import { Pause, Play } from 'lucide-react';
import './playback-button.css';

export function PlaybackButton({
  paused,
  onToggle,
  playLabel,
  pauseLabel,
  showLabel = false,
  className = '',
}: {
  paused: boolean;
  onToggle: () => void;
  playLabel: string;
  pauseLabel: string;
  showLabel?: boolean;
  className?: string;
}) {
  const label = paused ? playLabel : pauseLabel;
  return (
    <button
      type="button"
      className={`playback-button${showLabel ? ' with-label' : ''} ${className}`}
      aria-label={label}
      data-tooltip={label}
      aria-pressed={paused}
      onClick={onToggle}
    >
      {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
      {showLabel && <span>{paused ? playLabel : '일시 정지'}</span>}
    </button>
  );
}
