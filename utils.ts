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
  if (url.includes('.m3u8')) return 'application/x-mpegURL';
  if (url.includes('.mpd')) return 'application/dash+xml';
  return 'video/mp4'; // Default fallback
};

export const getFriendlyErrorMessage = (error: MediaError | null, nativeError?: string): string => {
  if (nativeError) return nativeError;
  if (!error) return "Unknown Error";

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "The video playback was aborted.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "A network error caused the video download to fail part-way.";
    case MediaError.MEDIA_ERR_DECODE:
      return "The video playback was aborted due to a corruption problem or because the video used features your browser did not support.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "The video could not be loaded, either because the server or network failed or because the format is not supported.";
    default:
      return "An unknown error occurred.";
  }
};