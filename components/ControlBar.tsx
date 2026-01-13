import React from 'react';
import { 
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, 
  Settings, PictureInPicture, Rewind, FastForward, SkipForward
} from 'lucide-react';
import { VideoQuality, PlayerState } from '../types';
import { formatTime } from '../utils';

interface ControlBarProps {
  state: PlayerState;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleFullScreen: () => void;
  onTogglePip: () => void;
  onQualityChange: (index: number) => void;
  onSpeedChange: (speed: number) => void;
  qualities: VideoQuality[];
  showControls: boolean;
}

const ControlBar: React.FC<ControlBarProps> = ({
  state,
  onPlayPause,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleFullScreen,
  onTogglePip,
  onQualityChange,
  onSpeedChange,
  qualities,
  showControls
}) => {
  const [showSettings, setShowSettings] = React.useState(false);
  const [seeking, setSeeking] = React.useState(false);
  const [hoverTime, setHoverTime] = React.useState<number | null>(null);
  const progressBarRef = React.useRef<HTMLDivElement>(null);

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(Number(e.target.value));
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const percent = Math.min(Math.max(0, e.clientX - rect.left), rect.width) / rect.width;
    setHoverTime(percent * state.duration);
  };

  const percentPlayed = (state.currentTime / state.duration) * 100 || 0;
  const percentBuffered = (state.buffered / state.duration) * 100 || 0;

  return (
    <div 
      className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-12 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Progress Bar Container */}
      <div 
        className="group relative flex items-center h-4 cursor-pointer mb-4"
        ref={progressBarRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverTime(null)}
        onClick={(e) => {
            if (!progressBarRef.current) return;
            const rect = progressBarRef.current.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            onSeek(percent * state.duration);
        }}
      >
        {/* Timestamp Tooltip */}
        {hoverTime !== null && (
          <div 
            className="absolute bottom-6 bg-stone-800 text-white text-xs px-2 py-1 rounded border border-stone-600 transform -translate-x-1/2 pointer-events-none"
            style={{ left: `${(hoverTime / state.duration) * 100}%` }}
          >
            {formatTime(hoverTime)}
          </div>
        )}

        {/* Background Track */}
        <div className="w-full h-1 group-hover:h-2 bg-white/30 rounded-full transition-all duration-200 relative overflow-hidden">
          {/* Buffer Bar */}
          <div 
            className="absolute top-0 left-0 h-full bg-white/40 transition-all duration-300"
            style={{ width: `${percentBuffered}%` }}
          />
          {/* Play Progress */}
          <div 
            className="absolute top-0 left-0 h-full bg-red-600 transition-all duration-100"
            style={{ width: `${percentPlayed}%` }}
          />
        </div>
        
        {/* Scrubber Knob */}
        <div 
          className="absolute h-3 w-3 bg-red-600 rounded-full scale-0 group-hover:scale-100 transition-transform duration-200"
          style={{ left: `${percentPlayed}%`, transform: `translate(-50%, 0) scale(${seeking ? 1.2 : 1})` }}
        />
        
        {/* Invisible Range Input for accessibility/dragging */}
        <input 
          type="range" 
          min="0" 
          max={state.duration || 100} 
          step="0.1"
          value={state.currentTime} 
          onChange={handleSeekChange}
          onMouseDown={() => setSeeking(true)}
          onMouseUp={() => setSeeking(false)}
          className="absolute w-full h-full opacity-0 cursor-pointer z-10"
        />
      </div>

      <div className="flex items-center justify-between">
        {/* Left Controls */}
        <div className="flex items-center space-x-4">
          <button onClick={onPlayPause} className="hover:text-red-500 transition-colors">
            {state.playing ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
          </button>
          
          <div className="group relative flex items-center space-x-2">
            <button onClick={onToggleMute} className="hover:text-red-500 transition-colors">
              {state.muted || state.volume === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </button>
            <div className="w-0 overflow-hidden group-hover:w-24 transition-all duration-300 flex items-center">
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05"
                value={state.muted ? 0 : state.volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="w-20 h-1 bg-white/30 rounded-lg accent-red-600 cursor-pointer"
              />
            </div>
          </div>

          <div className="text-sm font-medium text-gray-200">
            {formatTime(state.currentTime)} <span className="text-gray-400">/</span> {formatTime(state.duration)}
          </div>
          
          {state.error && <span className="text-xs text-red-500 bg-red-900/20 px-2 py-1 rounded">Error detected: Retrying...</span>}
        </div>

        {/* Right Controls */}
        <div className="flex items-center space-x-4">
          {/* Settings Menu */}
          <div className="relative">
            <button 
              onClick={() => setShowSettings(!showSettings)} 
              className={`hover:text-red-500 transition-colors ${showSettings ? 'rotate-45 text-red-500' : ''}`}
            >
              <Settings className="w-5 h-5" />
            </button>

            {showSettings && (
              <div className="absolute bottom-10 right-0 w-64 bg-stone-900/95 backdrop-blur-md rounded-lg shadow-xl border border-white/10 overflow-hidden z-20 animate-in fade-in zoom-in-95 duration-200 p-2">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-400 uppercase px-3 py-1">Playback Speed</div>
                  <div className="flex flex-wrap gap-1 px-2 pb-2 border-b border-white/10">
                    {[0.5, 1, 1.25, 1.5, 2].map(speed => (
                      <button
                        key={speed}
                        onClick={() => onSpeedChange(speed)}
                        className={`text-xs px-2 py-1 rounded ${state.playbackRate === speed ? 'bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>

                  {qualities.length > 0 && (
                    <>
                      <div className="text-xs font-semibold text-gray-400 uppercase px-3 py-1 mt-1">Quality</div>
                      <div className="max-h-40 overflow-y-auto no-scrollbar">
                        <button
                          onClick={() => {
                              onQualityChange(-1);
                              setShowSettings(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 rounded flex justify-between ${state.autoQuality ? 'text-red-500 font-bold' : ''}`}
                        >
                          <span>Auto</span>
                          {state.autoQuality && <span className="text-xs bg-red-500/20 px-1 rounded">Current</span>}
                        </button>
                        {qualities.map((q) => (
                          <button
                            key={q.index}
                            onClick={() => {
                                onQualityChange(q.index);
                                setShowSettings(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 rounded flex justify-between ${!state.autoQuality && state.quality === q.index ? 'text-red-500 font-bold' : ''}`}
                          >
                            <span>{q.label || `${q.height}p`}</span>
                            {q.bitrate > 0 && <span className="text-xs text-gray-500">{(q.bitrate / 1000000).toFixed(1)} Mbps</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <button onClick={onTogglePip} className="hover:text-red-500 transition-colors hidden sm:block">
            <PictureInPicture className="w-5 h-5" />
          </button>

          <button onClick={onToggleFullScreen} className="hover:text-red-500 transition-colors">
            {state.fullScreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ControlBar;