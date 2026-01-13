export const formatTime = (seconds: number): string => {
  if (isNaN(seconds)) return "00:00";
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const saveToStorage = (key: string, value: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Storage save failed", e);
  }
};

export const getFromStorage = <T>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
};

export const detectMimeType = (url: string): string => {
  const lowerUrl = url.toLowerCase();
  
  // Manifest based streaming
  if (lowerUrl.includes('.m3u8')) return 'application/x-mpegURL';
  if (lowerUrl.includes('.mpd')) return 'application/dash+xml';
  
  // Specific Providers
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  
  // Generic containers
  if (lowerUrl.includes('.webm')) return 'video/webm';
  if (lowerUrl.includes('.mkv')) return 'video/x-matroska'; // Will trigger transcode
  if (lowerUrl.includes('.avi')) return 'video/x-msvideo';  // Will trigger transcode
  
  // Default to MP4 for everything else (signed URLs often lack extension)
  return 'video/mp4'; 
};

export const getYouTubeId = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
};

export const getFriendlyErrorMessage = (error: MediaError | null, nativeError?: string): string => {
  if (nativeError) return nativeError;
  if (!error) return "Unknown Error";

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Playback aborted by user.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "Network error. The stream connection was lost.";
    case MediaError.MEDIA_ERR_DECODE:
      return "The video file is corrupted or uses an unsupported codec.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "The format is not supported by this browser or the link is expired.";
    default:
      return "An unknown error occurred.";
  }
};