import React, { useState } from 'react';
import VideoPlayer from './components/VideoPlayer';
import { VideoSource } from './types';
import { PlayCircle, Link as LinkIcon, AlertCircle, Settings2, ShieldCheck } from 'lucide-react';

const SAMPLE_SOURCES: VideoSource[] = [
  {
    title: "Big Buck Bunny (HLS)",
    src: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    type: "application/x-mpegURL"
  },
  {
    title: "Sintel (DASH)",
    src: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd",
    type: "application/dash+xml"
  },
  {
    title: "Ocean (MP4)",
    src: "https://vjs.zencdn.net/v/oceans.mp4",
    type: "video/mp4"
  }
];

export default function App() {
  const [currentSource, setCurrentSource] = useState<VideoSource>(SAMPLE_SOURCES[0]);
  const [inputUrl, setInputUrl] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoadUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    // Basic validation
    try {
      new URL(inputUrl);
      
      const headers: Record<string, string> = {};
      if (authHeader.trim()) {
        headers['Authorization'] = authHeader.trim();
      }

      setCurrentSource({
        src: inputUrl,
        title: "Custom Stream",
        proxyUrl: proxyUrl.trim() || undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        withCredentials: !!authHeader.trim()
      });
      setError(null);
    } catch (err) {
      setError("Please enter a valid URL including http:// or https://");
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-gray-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-red-600 to-red-800 rounded-lg flex items-center justify-center shadow-lg shadow-red-900/20">
              <PlayCircle className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              StreamFlow Pro
            </h1>
          </div>
          <div className="flex items-center space-x-4">
             <div className="flex items-center text-xs text-green-500 bg-green-900/10 px-2 py-1 rounded-full border border-green-900/30">
                <ShieldCheck className="w-3 h-3 mr-1" />
                Secure Player
             </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 space-y-8">
        
        {/* Player Container */}
        <section className="w-full max-w-5xl mx-auto">
          <VideoPlayer source={currentSource} autoPlay={false} />
          <div className="mt-6 flex items-start justify-between border-b border-white/5 pb-6">
             <div>
                <h2 className="text-2xl font-bold text-white">{currentSource.title || "Unknown Video"}</h2>
                <div className="flex items-center space-x-2 mt-2">
                    <span className="text-xs font-mono bg-white/10 text-gray-300 px-2 py-0.5 rounded">
                        {currentSource.type?.split('/')[1]?.toUpperCase() || 'VIDEO'}
                    </span>
                    {currentSource.proxyUrl && (
                        <span className="text-xs font-mono bg-blue-900/30 text-blue-300 px-2 py-0.5 rounded border border-blue-800/30">
                            PROXY ACTIVE
                        </span>
                    )}
                </div>
             </div>
             <p className="text-xs text-gray-500 font-mono max-w-xs truncate" title={currentSource.src}>
                {currentSource.src}
             </p>
          </div>
        </section>

        {/* Input Section */}
        <section className="max-w-3xl mx-auto w-full bg-stone-900/50 rounded-2xl p-6 border border-white/5 shadow-xl">
          <form onSubmit={handleLoadUrl} className="space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <LinkIcon className="h-5 w-5 text-gray-500" />
              </div>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Paste m3u8, mpd, or mp4 URL here..."
                className="w-full bg-black/50 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent transition-all"
              />
            </div>

            {/* Advanced Toggle */}
            <div className="flex justify-end">
                <button 
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="text-xs text-gray-400 flex items-center hover:text-white transition-colors"
                >
                    <Settings2 className="w-3 h-3 mr-1" />
                    {showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
                </button>
            </div>

            {/* Advanced Options Panel */}
            {showAdvanced && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-black/30 p-4 rounded-lg border border-white/5 animate-in slide-in-from-top-2">
                    <div>
                        <label className="text-xs text-gray-500 uppercase font-semibold mb-1 block">Auth Header (Bearer Token)</label>
                        <input
                            type="text"
                            value={authHeader}
                            onChange={(e) => setAuthHeader(e.target.value)}
                            placeholder="Bearer eyJhbG..."
                            className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-gray-300 focus:border-red-600 outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 uppercase font-semibold mb-1 block">Proxy URL</label>
                        <input
                            type="text"
                            value={proxyUrl}
                            onChange={(e) => setProxyUrl(e.target.value)}
                            placeholder="https://my-proxy.com/fetch"
                            className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-gray-300 focus:border-red-600 outline-none"
                        />
                        <p className="text-[10px] text-gray-600 mt-1">Appends ?url= to this endpoint</p>
                    </div>
                </div>
            )}

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold py-3 px-6 rounded-lg transition-all flex items-center justify-center shadow-lg shadow-red-900/20"
            >
              Load Video Stream
            </button>
          </form>
          
          {error && (
            <div className="mt-4 flex items-center text-red-400 text-sm bg-red-900/10 border border-red-900/30 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4 mr-2" />
              {error}
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-white/5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Quick Load Samples</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SAMPLE_SOURCES.map((sample, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentSource(sample);
                    setError(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className={`text-left p-3 rounded-lg border transition-all group ${currentSource.src === sample.src ? 'bg-red-900/10 border-red-600/30' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                >
                  <div className={`text-sm font-medium ${currentSource.src === sample.src ? 'text-red-400' : 'text-gray-300 group-hover:text-white'}`}>
                    {sample.title}
                  </div>
                  <div className="text-xs text-gray-600 mt-1 group-hover:text-gray-500">{sample.type?.split('/')[1] || 'video'}</div>
                </button>
              ))}
            </div>
          </div>
        </section>

      </main>

      <footer className="border-t border-white/10 bg-black py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-600 text-sm">
          <p>StreamFlow Pro Enterprise Player &copy; {new Date().getFullYear()}</p>
          <div className="flex justify-center space-x-4 mt-2 text-xs text-gray-700">
             <span>HLS.js</span>
             <span>•</span>
             <span>Dash.js</span>
             <span>•</span>
             <span>AES-128 Ready</span>
          </div>
        </div>
      </footer>
    </div>
  );
}