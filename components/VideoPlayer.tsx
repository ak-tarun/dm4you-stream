import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import dashjs from 'dashjs';
import { Play, Loader2, Forward, Rewind } from 'lucide-react';
import ControlBar from './ControlBar';
import { PlayerState, VideoQuality, VideoSource } from '../types';
import { getFromStorage, saveToStorage, detectMimeType } from '../utils';

interface VideoPlayerProps {
  source: VideoSource;
  autoPlay?: boolean;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ source, autoPlay = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<number>(0);

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
  });

  const [qualities, setQualities] = useState<VideoQuality[]>([]);
  const [showControls, setShowControls] = useState(true);
  const [controlTimeout, setControlTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [doubleTapAction, setDoubleTapAction] = useState<'forward' | 'rewind' | null>(null);

  // --- Initialization & Source Handling ---

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset State for new source
    setState(prev => ({ 
        ...prev, 
        playing: autoPlay, 
        buffering: true, 
        currentTime: 0,
        error: null 
    }));
    setQualities([]);

    const mimeType = source.type || detectMimeType(source.src);
    const savedTime = getFromStorage(STORAGE_TIME_KEY, 0);

    const initHls = () => {
      if (Hls.isSupported()) {
        if (hlsRef.current) hlsRef.current.destroy();
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90
        });
        hlsRef.current = hls;

        hls.loadSource(source.src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
          const levels = data.levels.map((level, index) => ({
            height: level.height,
            bitrate: level.bitrate,
            index: index,
            label: level.height ? `${level.height}p` : 'Auto'
          }));
          setQualities(levels);
          
          if (savedTime > 0) video.currentTime = savedTime;
          if (autoPlay) video.play().catch(() => setState(s => ({ ...s, playing: false, muted: true }))); 
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
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
                 break;
             }
           }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Safari HLS
        video.src = source.src;
        video.addEventListener('loadedmetadata', () => {
           if (savedTime > 0) video.currentTime = savedTime;
           if (autoPlay) video.play();
        });
      }
    };

    const initDash = () => {
      if (dashRef.current) dashRef.current.reset();
      const dash = dashjs.MediaPlayer().create();
      dashRef.current = dash;
      dash.initialize(video, source.src, autoPlay);
      
      dash.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
         const bitrates = dash.getBitrateInfoListFor("video");
         const levels = bitrates.map((b, i) => ({
            height: b.height,
            bitrate: b.bitrate,
            index: i,
            label: `${b.height}p`
         }));
         setQualities(levels);
         if (savedTime > 0) dash.seek(savedTime);
      });
    };

    if (mimeType === 'application/x-mpegURL') {
      initHls();
    } else if (mimeType === 'application/dash+xml') {
      initDash();
    } else {
      // MP4 / Native
      video.src = source.src;
      video.load();
      if (savedTime > 0) video.currentTime = savedTime;
      if (autoPlay) video.play();
    }

    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (dashRef.current) dashRef.current.reset();
    };
  }, [source.src, autoPlay]);

  // --- Event Listeners ---

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

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
      // Save progress every 5 seconds roughly
      if (Math.floor(video.currentTime) % 5 === 0) {
        saveToStorage(STORAGE_TIME_KEY, video.currentTime);
      }
    };
    
    const onDurationChange = () => setState(s => ({ ...s, duration: video.duration }));
    const onError = () => setState(s => ({ ...s, error: video.error?.message || "Unknown error" }));

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
  }, [source.src]);

  // --- Control Handlers ---

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(e => console.warn(e));
    } else {
      video.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(0, time), video.duration);
  }, []);

  const skip = useCallback((amount: number) => {
     const video = videoRef.current;
     if (!video) return;
     seek(video.currentTime + amount);
     
     // Animation trigger
     setDoubleTapAction(amount > 0 ? 'forward' : 'rewind');
     setTimeout(() => setDoubleTapAction(null), 500);
  }, [seek]);

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
    // If unmuting and volume is 0, set to default 0.5
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
        // Dash.js quality switching logic (simplified)
        const cfg = { 'video': { 'abr': { 'autoSwitchBitrate': { 'video': index === -1 } } } };
        dashRef.current.updateSettings(cfg);
        if (index !== -1) {
            dashRef.current.setQualityFor('video', index);
        }
    }
  }, []);

  // --- Interaction Observers ---

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      switch(e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowright':
        case 'l':
          skip(10);
          break;
        case 'arrowleft':
        case 'j':
          skip(-10);
          break;
        case 'f':
          toggleFullScreen();
          break;
        case 'm':
          toggleMute();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, skip, toggleFullScreen, toggleMute]);

  // Mouse Move / Hide Controls
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlTimeout) clearTimeout(controlTimeout);
    const timeout = setTimeout(() => {
        if (state.playing) setShowControls(false);
    }, 3000);
    setControlTimeout(timeout);
  };
  
  // Mobile double-tap zones logic
  const handleZoneClick = (side: 'left' | 'right') => (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 300;
      
      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
          // Double Tap Detected
          skip(side === 'left' ? -10 : 10);
          lastTapRef.current = 0; // Reset
      } else {
          // Single Tap - Just toggle controls/play
          lastTapRef.current = now;
          togglePlay();
      }
  };

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
        crossOrigin="anonymous"
      />

      {/* Buffering Indicator */}
      {state.buffering && !state.error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20 z-10">
          <Loader2 className="w-16 h-16 text-red-600 animate-spin" />
        </div>
      )}

      {/* Big Play Button (Initial or Paused) */}
      {!state.playing && !state.buffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/10 z-10">
           <div className="w-20 h-20 bg-red-600/90 rounded-full flex items-center justify-center pl-2 shadow-lg scale-100 transition-transform hover:scale-110">
              <Play className="w-10 h-10 text-white fill-white" />
           </div>
        </div>
      )}

      {/* Double Tap Animations */}
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

      {/* Double Tap Touch Zones (Mobile) */}
      <div 
         className="absolute top-0 left-0 w-1/4 h-3/4 z-20 opacity-0 md:hidden" 
         onClick={handleZoneClick('left')}
      />
      <div 
         className="absolute top-0 right-0 w-1/4 h-3/4 z-20 opacity-0 md:hidden" 
         onClick={handleZoneClick('right')}
      />

      {/* Controls */}
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