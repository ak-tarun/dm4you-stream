export interface VideoQuality {
  height: number;
  bitrate: number;
  index: number; // -1 for auto
  label: string;
}

export interface PlayerState {
  playing: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  fullScreen: boolean;
  pip: boolean;
  quality: number; // index
  autoQuality: boolean;
  buffered: number;
  error: string | null;
}

export interface VideoSource {
  src: string;
  type?: 'application/x-mpegURL' | 'application/dash+xml' | 'video/mp4' | string;
  title?: string;
}