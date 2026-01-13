import React, { useState } from 'react';
import VideoPlayer from './components/VideoPlayer';
import { VideoSource } from './types';
import { PlayCircle, Link as LinkIcon, AlertCircle } from 'lucide-react';

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
  const [error, setError] = useState<string | null>(null);

  const handleLoadUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    // Basic validation
    try {
      new URL(inputUrl);
      setCurrentSource({
        src: inputUrl,
        title: "Custom URL"
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
            <div className="w-8 h-8 bg-gradient-to-br from-red-600 to-red-800 rounded-lg flex items-center justify-center">
              <PlayCircle className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              StreamFlow Pro
            </h1>
          </div>
          <div className="text-xs text-gray-500 hidden sm:block">
            Professional Web Video Player
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 space-y-8">
        
        {/* Player Container */}
        <section className="w-full max-w-5xl mx-auto">
          <VideoPlayer source={currentSource} autoPlay={false} />
          <div className="mt-4">
             <h2 className="text-2xl font-semibold text-white">{currentSource.title || "Unknown Video"}</h2>
             <p className="text-sm text-gray-400 font-mono mt-1 break-all">{currentSource.src}</p>
          </div>
        </section>

        {/* Input Section */}
        <section className="max-w-3xl mx-auto w-full bg-white/5 rounded-2xl p-6 border border-white/5 shadow-xl">
          <form onSubmit={handleLoadUrl} className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
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
            <button
              type="submit"
              className="bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center shadow-lg hover:shadow-red-600/20"
            >
              Load Video
            </button>
          </form>
          
          {error && (
            <div className="mt-4 flex items-center text-red-400 text-sm bg-red-900/20 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4 mr-2" />
              {error}
            </div>
          )}

          <div className="mt-8">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Sample Streams</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SAMPLE_SOURCES.map((sample, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentSource(sample);
                    setError(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className={`text-left p-3 rounded-lg border transition-all ${currentSource.src === sample.src ? 'bg-red-600/10 border-red-600/50' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                >
                  <div className="text-sm font-medium text-white">{sample.title}</div>
                  <div className="text-xs text-gray-500 mt-1">{sample.type?.split('/')[1] || 'video'}</div>
                </button>
              ))}
            </div>
          </div>
        </section>

      </main>

      <footer className="border-t border-white/10 bg-black py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-600 text-sm">
          <p>StreamFlow Pro Player Demo &copy; {new Date().getFullYear()}</p>
          <p className="mt-2 text-xs">Powered by HLS.js, Dash.js and React</p>
        </div>
      </footer>
    </div>
  );
}