import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Loader2, Forward, Rewind, AlertTriangle } from 'lucide-react';
import ControlBar from './ControlBar';
import { PlayerState, VideoQuality, VideoSource } from '../types';
import { getFromStorage, saveToStorage, detectMimeType, getFriendlyErrorMessage, getYouTubeId } from '../utils';

interface VideoPlayerProps {
  source: VideoSource;
  autoPlay?: boolean;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ source, autoPlay = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Refs for library instances
  const hlsRef = useRef<any>(null);
  const dashRef = useRef<any>(null);
  
  const lastTapRef = useRef<number>(0);
  const retryCount = useRef<number>(0);

  // Constants
  const STORAGE_VOL_KEY = 'streamflow-volume';
  const STORAGE_TIME_KEY = `streamflow-time-${source.src}`;

  // State
  const [state, setState] = useState<PlayerState>({
    playing: false,
    buffering: true,
    currentTime: 0,
    duration: 0,
    volume: getFromStorage(STORAGE_VOL_KEY, 1),
    muted: false,
    playbackRate: 1,
    fullScreen: false,
    pip: false,
    quality: -1,
    autoQuality: true,
    buffered: 0,
    error: null,
    isLive: false,
  });

  const [qualities, setQualities] = useState<VideoQuality[]>([]);
  const [showControls, setShowControls] = useState(true);
  const [controlTimeout, setControlTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [doubleTapAction, setDoubleTapAction] = useState<'forward' | 'rewind' | null>(null);
  const [isYoutubeMode, setIsYoutubeMode] = useState(false);

  // --- Initialization & Source Handling ---

  useEffect(() => {
    // Reset State on source change
    setState(prev => ({ 
        ...prev, 
        playing: autoPlay, 
        buffering: true, 
        currentTime: 0, 
        duration: 0,
        error: null,
        isLive: false
    }));
    setQualities([]);
    setIsYoutubeMode(false);
    retryCount.current = 0;
    
    const mimeType = source.type || detectMimeType(source.src);

    // YouTube Handling (IFrame Mode)
    if (mimeType === 'youtube') {
        setIsYoutubeMode(true);
        setState(prev => ({ ...prev, buffering: false }));
        return; 
    }

    const video = videoRef.current;
    if (!video) return;

    // Cleanup previous instances
    if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
    }
    if (dashRef.current) {
        dashRef.current.reset();
        dashRef.current = null;
    }

    // Determine Final URL (Apply Proxy if set)
    // IMPORTANT: If transcode is needed (AVI/MKV), append query param
    let finalUrl = source.proxyUrl 
        ? `${source.proxyUrl}?url=${encodeURIComponent(source.src)}` 
        : source.src;
    
    if (mimeType === 'video/x-matroska' || mimeType === 'video/x-msvideo') {
       if (source.proxyUrl) finalUrl += '&transcode=true';
    }
    
    const savedTime = getFromStorage(STORAGE_TIME_KEY, 0);

    const initHls = async () => {
      try {
        const { default: Hls } = await import('hls.js');
        
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
            xhrSetup: (xhr: XMLHttpRequest, url: string) => {
                if (source.headers) {
                    Object.entries(source.headers).forEach(([key, value]) => {
                        xhr.setRequestHeader(key, value);
                    });
                }
                if (source.withCredentials) {
                    xhr.withCredentials = true;
                }
            }
          });
          hlsRef.current = hls;

          hls.loadSource(finalUrl);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, (event: any, data: any) => {
            const levels = data.levels.map((level: any, index: number) => ({
              height: level.height,
              bitrate: level.bitrate,
              index: index,
              label: level.height ? `${level.height}p` : 'Auto'
            }));
            setQualities(levels);
            
            if (data.levels.length > 0 && data.levels[0].details?.live) {
                setState(s => ({ ...s, isLive: true }));
            }
            
            if (savedTime > 0 && !state.isLive) video.currentTime = savedTime;
            if (autoPlay) video.play().catch(() => setState(s => ({ ...s, playing: false, muted: true }))); 
          });

          hls.on(Hls.Events.ERROR, (event: any, data: any) => {
             if (data.fatal) {
               switch (data.type) {
                 case Hls.ErrorTypes.NETWORK_ERROR:
                   hls.startLoad();
                   break;
                 case Hls.ErrorTypes.MEDIA_ERROR:
                   hls.recoverMediaError();
                   break;
                 default:
                   hls.destroy();
                   setState(s => ({ ...s, error: "HLS Stream error. Ensure CORS/Headers are correct." }));
                   break;
               }
             }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS (Safari)
          video.src = finalUrl;
          video.addEventListener('loadedmetadata', () => {
             if (savedTime > 0) video.currentTime = savedTime;
             if (autoPlay) video.play();
          }, { once: true });
        }
      } catch (err) {
        setState(s => ({ ...s, error: "Failed to load HLS player module" }));
      }
    };

    const initDash = async () => {
      try {
        const { default: dashjs } = await import('dashjs');
        
        const dash = dashjs.MediaPlayer().create();
        dashRef.current = dash;
        
        // Header injection
        if (source.headers) {
            dash.extend("RequestModifier", () => {
                return {
                    modifyRequestHeader: (xhr: XMLHttpRequest) => {
                        Object.entries(source.headers || {}).forEach(([key, value]) => {
                            xhr.setRequestHeader(key, value);
                        });
                        return xhr;
                    },
                    modifyRequestURL: (url: string) => url 
                };
            }, true);
        }

        // DRM Configuration
        if (source.drm) {
            const protectionData: any = {};
            if (source.drm.type === 'widevine') {
                protectionData['com.widevine.alpha'] = {
                    serverURL: source.drm.licenseUrl,
                    httpRequestHeaders: source.drm.headers
                };
            } else if (source.drm.type === 'clearkey') {
                 protectionData['org.w3.clearkey'] = {
                    serverURL: source.drm.licenseUrl
                };
            }
            dash.setProtectionData(protectionData);
        }

        dash.initialize(video, finalUrl, autoPlay);
        
        dash.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED as string, () => {
           const bitrates = (dash as any).getBitrateInfoListFor("video");
           const levels = bitrates.map((b: any, i: number) => ({
              height: b.height,
              bitrate: b.bitrate,
              index: i,
              label: `${b.height}p`
           }));
           setQualities(levels);
           
           const isDynamic = dash.isDynamic();
           setState(s => ({ ...s, isLive: isDynamic }));

           if (savedTime > 0 && !isDynamic) dash.seek(savedTime);
        });
        
        dash.on(dashjs.MediaPlayer.events.ERROR as string, (e: any) => {
             // Silently handle manifest loading errors if possible, or show error
             if (e.error === 'download') {
                 setState(s => ({...s, error: `Connection failed.`}));
             }
        });

      } catch (err) {
        setState(s => ({ ...s, error: "Failed to load DASH player module" }));
      }
    };

    if (mimeType === 'application/x-mpegURL') {
      initHls();
    } else if (mimeType === 'application/dash+xml') {
      initDash();
    } else {
      // MP4 / Native / FMP4
      video.src = finalUrl;
      video.load();
      const handleMetadata = () => {
          if (savedTime > 0) video.currentTime = savedTime;
          if (autoPlay) video.play();
      };
      video.addEventListener('loadedmetadata', handleMetadata, { once: true });
    }

    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (dashRef.current) dashRef.current.reset();
    };
  }, [source.src, source.proxyUrl, source.headers, autoPlay, source.drm]);

  // --- Event Listeners ---

  useEffect(() => {
    const video = videoRef.current;
    if (!video || isYoutubeMode) return;

    const onPlay = () => setState(s => ({ ...s, playing: true, buffering: false }));
    const onPause = () => setState(s => ({ ...s, playing: false }));
    const onWaiting = () => setState(s => ({ ...s, buffering: true }));
    const onCanPlay = () => setState(s => ({ ...s, buffering: false }));
    
    const onTimeUpdate = () => {
      setState(s => ({
        ...s,
        currentTime: video.currentTime,
        buffered: video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0
      }));
      if (Math.floor(video.currentTime) % 5 === 0) {
        saveToStorage(STORAGE_TIME_KEY, video.currentTime);
      }
    };
    
    const onDurationChange = () => setState(s => ({ ...s, duration: video.duration }));
    
    const onError = (e: Event) => {
        const target = e.target as HTMLVideoElement;
        // Don't show error immediately on network glitch, try to reload once
        if (retryCount.current < 1 && target.error?.code === MediaError.MEDIA_ERR_NETWORK) {
            retryCount.current++;
            console.log("Network error, retrying...");
            target.load();
            if (state.currentTime > 0) target.currentTime = state.currentTime;
            target.play();
            return;
        }

        setState(s => ({ 
            ...s, 
            error: getFriendlyErrorMessage(target.error, "Stream prevented by browser security. Ensure Gateway is active.") 
        }));
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onCanPlay);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onCanPlay);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('error', onError);
    };
  }, [source.src, isYoutubeMode]);

  // --- Control Handlers ---

  const togglePlay = useCallback(() => {
    if (isYoutubeMode) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(e => console.warn(e));
    } else {
      video.pause();
    }
  }, [isYoutubeMode]);

  const seek = useCallback((time: number) => {
    if (isYoutubeMode) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(0, time), video.duration);
  }, [isYoutubeMode]);

  const skip = useCallback((amount: number) => {
     if (isYoutubeMode) return;
     const video = videoRef.current;
     if (!video) return;
     seek(video.currentTime + amount);
     setDoubleTapAction(amount > 0 ? 'forward' : 'rewind');
     setTimeout(() => setDoubleTapAction(null), 500);
  }, [seek, isYoutubeMode]);

  const changeVolume = useCallback((vol: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = vol;
    video.muted = vol === 0;
    setState(s => ({ ...s, volume: vol, muted: vol === 0 }));
    saveToStorage(STORAGE_VOL_KEY, vol);
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const newMuted = !video.muted;
    video.muted = newMuted;
    if (!newMuted && video.volume === 0) {
        video.volume = 0.5;
        setState(s => ({ ...s, volume: 0.5 }));
    }
    setState(s => ({ ...s, muted: newMuted }));
  }, []);

  const toggleFullScreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setState(s => ({ ...s, fullScreen: true })));
    } else {
      document.exitFullscreen().then(() => setState(s => ({ ...s, fullScreen: false })));
    }
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      setState(s => ({ ...s, pip: false }));
    } else if (video.requestPictureInPicture) {
      await video.requestPictureInPicture();
      setState(s => ({ ...s, pip: true }));
    }
  }, []);

  const changeSpeed = useCallback((speed: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    setState(s => ({ ...s, playbackRate: speed }));
  }, []);

  const changeQuality = useCallback((index: number) => {
    setState(s => ({ ...s, quality: index, autoQuality: index === -1 }));
    
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index;
    } else if (dashRef.current) {
        const cfg = { 'video': { 'abr': { 'autoSwitchBitrate': { 'video': index === -1 } } } };
        dashRef.current.updateSettings(cfg);
        if (index !== -1) {
            dashRef.current.setQualityFor('video', index);
        }
    }
  }, []);

  // --- Interaction Observers ---

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlTimeout) clearTimeout(controlTimeout);
    const timeout = setTimeout(() => {
        if (state.playing) setShowControls(false);
    }, 3000);
    setControlTimeout(timeout);
  };
  
  const handleZoneClick = (side: 'left' | 'right') => (e: React.MouseEvent) => {
      if (isYoutubeMode) return;
      e.stopPropagation();
      e.preventDefault();
      
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 300;
      
      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
          skip(side === 'left' ? -10 : 10);
          lastTapRef.current = 0; 
      } else {
          lastTapRef.current = now;
          togglePlay();
      }
  };

  if (isYoutubeMode) {
      const ytId = getYouTubeId(source.src);
      return (
          <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl">
              {ytId ? (
                <iframe
                    src={`https://www.youtube.com/embed/${ytId}?autoplay=${autoPlay ? 1 : 0}&controls=1&modestbranding=1&rel=0`}
                    title="YouTube video player"
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                />
              ) : (
                  <div className="flex items-center justify-center h-full text-white">Invalid YouTube URL</div>
              )}
          </div>
      );
  }

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-video bg-black group overflow-hidden shadow-2xl rounded-xl select-none"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => state.playing && setShowControls(false)}
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain cursor-pointer"
        playsInline
        webkit-playsinline="true"
        crossOrigin="anonymous"
      />

      {state.buffering && !state.error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20 z-10">
          <Loader2 className="w-16 h-16 text-red-600 animate-spin" />
        </div>
      )}

      {state.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-auto bg-black/90 z-30 text-white p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
          <h3 className="text-xl font-bold mb-2">Playback Failed</h3>
          <p className="text-gray-300 max-w-md mb-6">{state.error}</p>
          <div className="flex gap-4">
            <button 
                onClick={() => window.location.reload()} 
                className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded text-sm transition-colors"
            >
                Reload Player
            </button>
          </div>
        </div>
      )}

      {!state.playing && !state.buffering && !state.error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/10 z-10">
           <div className="w-20 h-20 bg-red-600/90 rounded-full flex items-center justify-center pl-2 shadow-lg scale-100 transition-transform hover:scale-110">
              <Play className="w-10 h-10 text-white fill-white" />
           </div>
        </div>
      )}

      {doubleTapAction === 'forward' && (
          <div className="absolute right-10 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-4 animate-ping z-20">
             <Forward className="w-8 h-8 text-white" />
          </div>
      )}
      {doubleTapAction === 'rewind' && (
          <div className="absolute left-10 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-4 animate-ping z-20">
             <Rewind className="w-8 h-8 text-white" />
          </div>
      )}

      <div 
         className="absolute top-0 left-0 w-1/4 h-3/4 z-20 opacity-0 md:hidden" 
         onClick={handleZoneClick('left')}
      />
      <div 
         className="absolute top-0 right-0 w-1/4 h-3/4 z-20 opacity-0 md:hidden" 
         onClick={handleZoneClick('right')}
      />

      <ControlBar 
        state={state}
        showControls={showControls || !state.playing}
        qualities={qualities}
        onPlayPause={togglePlay}
        onSeek={seek}
        onVolumeChange={changeVolume}
        onToggleMute={toggleMute}
        onToggleFullScreen={toggleFullScreen}
        onTogglePip={togglePip}
        onSpeedChange={changeSpeed}
        onQualityChange={changeQuality}
      />
    </div>
  );
};

export default VideoPlayer;