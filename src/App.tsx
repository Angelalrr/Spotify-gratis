/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Repeat,
  Shuffle,
  Volume2,
  Volume1,
  VolumeX,
  Download,
  Music,
  Heart,
  Search,
  Clock,
  Sparkles,
  RefreshCw,
  Headphones,
  Disc3,
  ListMusic,
  Trash2,
  X,
} from 'lucide-react';

interface VideoInfo {
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
  video_id: string;
}

interface CompletedItem {
  id: string;
  title: string;
  uploader: string;
  thumbnail: string;
  filename: string;
  downloadUrl: string;
  streamUrl: string;
  duration?: number;
  timestamp: number;
  liked?: boolean;
}

interface MusicTrack {
  id: string;
  url: string;
  title: string;
  uploader: string;
  durationText: string;
  thumbnail: string;
  searchTarget: string;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

export default function App() {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>('Esperando pista…');
  const [showProgress, setShowProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Autocomplete & Live Music Search State
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [musicResults, setMusicResults] = useState<MusicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Active audio player state
  const [activeTrack, setActiveTrack] = useState<{
    jobId: string;
    title: string;
    uploader: string;
    thumbnail: string;
    filename: string;
    streamUrl: string;
    downloadUrl: string;
    duration?: number;
  } | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  // Library / Conversion history
  const [library, setLibrary] = useState<CompletedItem[]>(() => {
    try {
      const saved = localStorage.getItem('spotify_music_library');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('spotify_music_library', JSON.stringify(library.slice(0, 30)));
    } catch {}
  }, [library]);

  const formatDuration = (s: number) => {
    if (!s || isNaN(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Click outside to dismiss dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced music search: ONLY music tracks with official square covers
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      setSuggestions([]);
      setMusicResults([]);
      setShowDropdown(false);
      return;
    }

    setShowDropdown(true);
    setIsSearching(true);

    const timer = setTimeout(async () => {
      try {
        const [suggestRes, searchRes] = await Promise.allSettled([
          fetch(`/api/suggest?q=${encodeURIComponent(trimmed)}`),
          fetch(`/api/search?q=${encodeURIComponent(trimmed)}`),
        ]);

        if (suggestRes.status === 'fulfilled' && suggestRes.value.ok) {
          const suggData = await suggestRes.value.json();
          setSuggestions(Array.isArray(suggData) ? suggData : []);
        }

        if (searchRes.status === 'fulfilled' && searchRes.value.ok) {
          const searchData = await searchRes.value.json();
          setMusicResults(Array.isArray(searchData) ? searchData : []);
        }
      } catch {
      } finally {
        setIsSearching(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [query]);

  // Synchronize audio element settings
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.loop = isLooping;
  }, [isLooping]);

  // Audio event listeners
  const onTimeUpdate = () => {
    if (audioRef.current && !isDraggingSeek) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const onLoadedMetadata = () => {
    if (audioRef.current) {
      const d = audioRef.current.duration;
      if (d && !isNaN(d) && isFinite(d)) {
        setDuration(d);
      }
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const onEnded = () => {
    if (isLooping) return;
    if (library.length > 1) {
      playNextTrack();
    } else {
      setIsPlaying(false);
      setCurrentTime(0);
    }
  };

  const playNextTrack = () => {
    if (library.length === 0) return;
    const currentIndex = library.findIndex((item) => item.id === activeTrack?.jobId);
    let nextIndex = 0;
    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * library.length);
    } else if (currentIndex !== -1 && currentIndex < library.length - 1) {
      nextIndex = currentIndex + 1;
    }
    playTrack(library[nextIndex]);
  };

  // Play / Pause toggle
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  // Skip 10 seconds
  const handleSkip = (seconds: number) => {
    if (!audioRef.current) return;
    const target = Math.min(
      Math.max(audioRef.current.currentTime + seconds, 0),
      duration || audioRef.current.duration || 99999
    );
    audioRef.current.currentTime = target;
    setCurrentTime(target);
  };

  // Timeline scrub
  const handleSeekChange = (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
    if (!progressBarRef.current || !audioRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = clickX / rect.width;
    const newTime = percentage * (duration || audioRef.current.duration || 0);
    setCurrentTime(newTime);
    audioRef.current.currentTime = newTime;
  };

  const handleSeekMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingSeek(true);
    handleSeekChange(e);

    const onMouseMove = (moveEvent: MouseEvent) => {
      handleSeekChange(moveEvent);
    };

    const onMouseUp = () => {
      setIsDraggingSeek(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Cycle speed
  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate);
    const nextIdx = (idx + 1) % SPEED_OPTIONS.length;
    setPlaybackRate(SPEED_OPTIONS[nextIdx]);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleSkip(5);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleSkip(-5);
      } else if (e.key === 'm' || e.key === 'M') {
        setIsMuted((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, duration]);

  const resetConversionState = () => {
    setInfo(null);
    setShowProgress(false);
    setProgressPercent(0);
    setStatusText('Iniciando descarga…');
    setError(null);
  };

  // Start conversion from a track or text input
  const handleStartJob = async (selectedTrack?: MusicTrack | string) => {
    let targetQuery = '';
    let customTitle = '';
    let customArtist = '';
    let customCover = '';

    if (selectedTrack && typeof selectedTrack === 'object') {
      targetQuery = selectedTrack.url || selectedTrack.searchTarget;
      customTitle = selectedTrack.title;
      customArtist = selectedTrack.uploader;
      customCover = selectedTrack.thumbnail;
      setQuery(`${selectedTrack.uploader} - ${selectedTrack.title}`);
    } else {
      const rawText = (typeof selectedTrack === 'string' ? selectedTrack : query).trim();
      if (!rawText) {
        setError('Escribe el nombre de una canción o artista');
        return;
      }
      targetQuery = rawText;
      setQuery(rawText);
    }

    setShowDropdown(false);
    resetConversionState();
    setIsLoading(true);

    let videoData: VideoInfo;
    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetQuery,
          title: customTitle,
          artist: customArtist,
          cover: customCover,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || 'No se pudo encontrar la pista');
        setIsLoading(false);
        return;
      }

      videoData = await res.json();
      setInfo(videoData);
      setShowProgress(true);
      setStatusText('Descargando stream de audio…');
    } catch (err: any) {
      setError('Error de conexión: ' + (err.message || 'Verifica la conexión al servidor'));
      setIsLoading(false);
      return;
    }

    // 2. Start download stream via SSE
    try {
      const resp = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetQuery,
          title: customTitle || videoData.title,
          artist: customArtist || videoData.uploader,
        }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        setError(errJson.detail || 'Error al procesar el audio');
        setIsLoading(false);
        return;
      }

      if (!resp.body) {
        setError('No se pudo establecer la conexión');
        setIsLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev: any;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (ev.type === 'progress') {
            setProgressPercent(ev.percent);
            const speed = ev.speed ? ` · ${ev.speed}` : '';
            const eta = ev.eta !== undefined ? ` · ETA ${ev.eta}s` : '';
            setStatusText(`Descargando audio… ${Math.round(ev.percent)}%${speed}${eta}`);
          } else if (ev.type === 'postprocess') {
            setProgressPercent(95);
            setStatusText('Masterizando a MP3 320 kbps…');
          } else if (ev.type === 'done') {
            setProgressPercent(100);
            setStatusText('Listo para reproducir ✓');

            const stream = `/api/file/${ev.job_id}`;
            const download = `/api/file/${ev.job_id}?download=true`;

            const newTrack = {
              jobId: ev.job_id,
              title: videoData.title,
              uploader: videoData.uploader,
              thumbnail: videoData.thumbnail,
              filename: ev.filename,
              streamUrl: stream,
              downloadUrl: download,
              duration: videoData.duration,
            };

            // Set as active track in bottom player
            setActiveTrack(newTrack);
            setCurrentTime(0);
            setDuration(videoData.duration || 0);

            // Add to library
            setLibrary((prev) => [
              {
                id: ev.job_id,
                title: videoData.title,
                uploader: videoData.uploader,
                thumbnail: videoData.thumbnail,
                filename: ev.filename,
                downloadUrl: download,
                streamUrl: stream,
                duration: videoData.duration,
                timestamp: Date.now(),
              },
              ...prev.filter((item) => item.title !== videoData.title),
            ]);

            setIsLoading(false);
          } else if (ev.type === 'error') {
            setError(ev.detail || 'Ocurrió un error al procesar el audio');
            setIsLoading(false);
          }
        }
      }
    } catch (err: any) {
      setError('Error en la transferencia: ' + (err.message || 'Desconectado'));
      setIsLoading(false);
    }
  };

  const playTrack = (item: CompletedItem) => {
    setActiveTrack({
      jobId: item.id,
      title: item.title,
      uploader: item.uploader,
      thumbnail: item.thumbnail,
      filename: item.filename,
      streamUrl: item.streamUrl || `/api/file/${item.id}`,
      downloadUrl: item.downloadUrl || `/api/file/${item.id}?download=true`,
      duration: item.duration,
    });
    setCurrentTime(0);
    setDuration(item.duration || 0);
    // Update the search bar with the song name
    setQuery(`${item.uploader} - ${item.title}`);
  };

  const toggleLike = (id: string) => {
    setLibrary((prev) =>
      prev.map((item) => (item.id === id ? { ...item, liked: !item.liked } : item))
    );
    if (activeTrack?.jobId === id) {
      setIsLiked(!isLiked);
    }
  };

  const removeTrack = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLibrary((prev) => prev.filter((item) => item.id !== id));
    if (activeTrack?.jobId === id) {
      setActiveTrack(null);
      setIsPlaying(false);
    }
  };

  const progressRatio = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  return (
    <div className="min-h-screen bg-[#121212] text-[#b3b3b3] font-sans flex flex-col antialiased selection:bg-[#1ed760] selection:text-black pb-28">
      {/* Hidden Audio Element */}
      {activeTrack && (
        <audio
          ref={audioRef}
          src={activeTrack.streamUrl}
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onEnded={onEnded}
          onError={() => setIsPlaying(false)}
          className="hidden"
        />
      )}

      {/* Top Spotify Header Bar */}
      <header className="sticky top-0 z-40 bg-[#121212]/95 backdrop-blur-md border-b border-[#242424] px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#1ed760] flex items-center justify-center text-black shadow-lg shadow-[#1ed760]/20">
            <Disc3 className="w-5 h-5 animate-[spin_6s_linear_infinite]" />
          </div>
          <div>
            <h1 className="text-white text-lg font-bold tracking-tight flex items-center gap-2">
              Spotify <span className="text-[#1ed760] font-normal text-xs uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#1ed760]/10 border border-[#1ed760]/20">Music Player</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-neutral-300 bg-[#242424] px-3 py-1.5 rounded-full font-medium border border-[#333]">
            <Headphones className="w-3.5 h-3.5 text-[#1ed760]" />
            Audio 320 kbps HQ Master
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-8 space-y-8">
        {/* Search & Autocomplete Hero Card */}
        <div className="bg-gradient-to-b from-[#242424] to-[#181818] rounded-2xl p-6 sm:p-8 border border-[#2b2b2b] shadow-2xl relative">
          <div className="relative z-10 max-w-3xl">
            <span className="text-[#1ed760] font-semibold text-xs tracking-wider uppercase flex items-center gap-1.5 mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              Catálogo Oficial de Música
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
              Busca cualquier canción o artista
            </h2>
            <p className="text-sm text-[#a7a7a7] mb-6">
              Sin enlaces. Escribe el título o artista, selecciona la canción con su portada oficial y disfrútala en máxima fidelidad.
            </p>

            {/* Spotify-style Search Input with Autocomplete Container */}
            <div ref={searchContainerRef} className="relative">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <Search className="w-5 h-5 text-[#b3b3b3] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => {
                      if (query.trim() && (suggestions.length > 0 || musicResults.length > 0)) {
                        setShowDropdown(true);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isLoading) {
                        setShowDropdown(false);
                        handleStartJob(query);
                      } else if (e.key === 'Escape') {
                        setShowDropdown(false);
                      }
                    }}
                    placeholder="Escribe una canción o artista (ej: Yan Block 666, Bad Bunny, Queen...)"
                    disabled={isLoading}
                    className="w-full bg-[#121212] hover:bg-[#181818] focus:bg-[#121212] border border-[#383838] focus:border-[#1ed760] text-white placeholder-[#777] rounded-full pl-11 pr-10 py-3.5 text-sm outline-none transition-all shadow-inner"
                  />
                  {query && (
                    <button
                      onClick={() => {
                        setQuery('');
                        setShowDropdown(false);
                      }}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#777] hover:text-white p-1 rounded-full"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleStartJob(query)}
                  disabled={isLoading}
                  className="bg-[#1ed760] hover:bg-[#1fdf64] hover:scale-[1.02] active:scale-[0.98] text-black font-bold text-sm px-8 py-3.5 rounded-full transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1ed760]/20 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-black" />
                      <span>Cargando…</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-black" />
                      <span>Reproducir</span>
                    </>
                  )}
                </button>
              </div>

              {/* ---------------- AUTOCOMPLETE POPUP DROPDOWN (ONLY MUSIC + OFFICIAL COVERS) ---------------- */}
              {showDropdown && (suggestions.length > 0 || musicResults.length > 0 || isSearching) && (
                <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-[#282828] border border-[#3e3e3e] rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150">
                  {/* Loading indicator */}
                  {isSearching && (
                    <div className="px-4 py-2.5 text-xs text-[#b3b3b3] flex items-center gap-2 border-b border-[#333]">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#1ed760]" />
                      <span>Buscando canciones y portadas oficiales…</span>
                    </div>
                  )}

                  {/* Top query suggestions chips */}
                  {suggestions.length > 0 && (
                    <div className="p-3 border-b border-[#333] bg-[#222]">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#888] mb-2 px-1">
                        Sugerencias
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestions.slice(0, 5).map((sugg, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setQuery(sugg);
                              handleStartJob(sugg);
                            }}
                            className="bg-[#303030] hover:bg-[#383838] text-white hover:text-[#1ed760] text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors border border-[#404040]"
                          >
                            <Search className="w-3 h-3 text-[#1ed760]" />
                            <span>{sugg}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Matching Music Tracks (100% Music Only + Official Square Covers) */}
                  {musicResults.length > 0 && (
                    <div className="max-h-80 overflow-y-auto divide-y divide-[#333] p-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#888] py-1 px-3">
                        Canciones Oficiales
                      </p>
                      {musicResults.map((track) => (
                        <div
                          key={track.id}
                          onClick={() => handleStartJob(track)}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-[#383838] transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-3 overflow-hidden min-w-0">
                            {/* Official 1:1 Square Album Cover */}
                            <img
                              src={track.thumbnail}
                              alt=""
                              className="w-12 h-12 aspect-square object-cover rounded-lg bg-black shrink-0 border border-[#444] shadow"
                            />
                            <div className="truncate">
                              <p className="text-white text-xs sm:text-sm font-semibold truncate group-hover:text-[#1ed760] transition-colors">
                                {track.title}
                              </p>
                              <p className="text-[11px] text-[#b3b3b3] truncate mt-0.5">
                                {track.uploader} {track.durationText ? `· ${track.durationText}` : ''}
                              </p>
                            </div>
                          </div>

                          <button
                            className="bg-[#1ed760] text-black px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all shadow shrink-0"
                          >
                            <Play className="w-3 h-3 fill-black" />
                            <span>Reproducir</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="mt-4 bg-[#e91429]/15 border border-[#e91429]/40 text-[#ff7782] px-4 py-3 rounded-xl text-xs flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-[#e91429]" />
                <span className="flex-1 font-medium">{error}</span>
              </div>
            )}
          </div>
        </div>

        {/* Live Progress Card */}
        {showProgress && (
          <div className="bg-[#181818] rounded-2xl p-5 border border-[#282828] shadow-xl animate-fade-in space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3.5 overflow-hidden">
                {info?.thumbnail ? (
                  <img
                    src={info.thumbnail}
                    alt=""
                    className="w-14 h-14 aspect-square object-cover rounded-xl bg-black border border-[#333] shadow"
                  />
                ) : (
                  <div className="w-14 h-14 aspect-square rounded-xl bg-[#282828] flex items-center justify-center">
                    <Music className="w-6 h-6 text-[#1ed760]" />
                  </div>
                )}
                <div className="truncate">
                  <p className="text-white font-bold text-sm sm:text-base truncate">{info?.title || 'Obteniendo audio…'}</p>
                  <p className="text-xs text-[#b3b3b3] truncate mt-0.5">{info?.uploader || 'Artista'}</p>
                </div>
              </div>

              <span className="text-xs font-mono font-semibold text-[#1ed760] bg-[#1ed760]/10 px-2.5 py-1 rounded-full border border-[#1ed760]/20">
                {progressPercent > 0 ? `${Math.round(progressPercent)}%` : 'Iniciando'}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-[#282828] h-2 rounded-full overflow-hidden">
              <div
                className="bg-[#1ed760] h-full transition-all duration-300 ease-out rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-[11px] font-mono text-[#888]">{statusText}</p>
          </div>
        )}

        {/* Spotify Library / Playlist Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListMusic className="w-5 h-5 text-[#1ed760]" />
              <h3 className="text-white text-lg font-bold tracking-tight">Tu Biblioteca Musical</h3>
              <span className="text-xs text-[#888] font-medium bg-[#242424] px-2 py-0.5 rounded-full">
                {library.length}
              </span>
            </div>

            {library.length > 0 && (
              <button
                onClick={() => setLibrary([])}
                className="text-xs text-[#888] hover:text-white flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Limpiar historial</span>
              </button>
            )}
          </div>

          {library.length === 0 ? (
            <div className="bg-[#181818] border border-[#242424] rounded-2xl p-8 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-[#242424] flex items-center justify-center mx-auto text-[#888]">
                <Music className="w-6 h-6" />
              </div>
              <p className="text-white font-medium text-sm">Tu biblioteca está vacía</p>
              <p className="text-xs text-[#888]">Escribe el nombre de una canción o artista arriba para escucharla con su portada oficial.</p>
            </div>
          ) : (
            <div className="bg-[#181818] border border-[#242424] rounded-2xl overflow-hidden shadow-xl">
              {/* Table Header */}
              <div className="grid grid-cols-12 px-4 py-2.5 text-[11px] font-semibold text-[#888] border-b border-[#242424] uppercase tracking-wider select-none">
                <span className="col-span-1 text-center">#</span>
                <span className="col-span-6 sm:col-span-6">Canción</span>
                <span className="hidden sm:block col-span-3">Artista</span>
                <span className="col-span-5 sm:col-span-2 text-right pr-2 flex items-center justify-end gap-1">
                  <Clock className="w-3.5 h-3.5" />
                </span>
              </div>

              {/* Tracks List */}
              <div className="divide-y divide-[#222222]">
                {library.map((item, index) => {
                  const isCurrent = activeTrack?.jobId === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => playTrack(item)}
                      className={`grid grid-cols-12 items-center px-4 py-2.5 text-xs group cursor-pointer transition-colors ${
                        isCurrent ? 'bg-[#282828] text-white' : 'hover:bg-[#202020]'
                      }`}
                    >
                      {/* Number / Play Icon */}
                      <div className="col-span-1 flex items-center justify-center text-[#888] font-mono">
                        {isCurrent && isPlaying ? (
                          <div className="flex items-end gap-0.5 h-3.5">
                            <span className="w-0.5 h-3 bg-[#1ed760] animate-pulse" />
                            <span className="w-0.5 h-2 bg-[#1ed760] animate-pulse delay-100" />
                            <span className="w-0.5 h-3.5 bg-[#1ed760] animate-pulse delay-200" />
                          </div>
                        ) : (
                          <span className="group-hover:hidden">{index + 1}</span>
                        )}
                        <Play className="w-3.5 h-3.5 text-white fill-white hidden group-hover:block" />
                      </div>

                      {/* Track info & square cover */}
                      <div className="col-span-6 sm:col-span-6 flex items-center gap-3 overflow-hidden pr-2">
                        {item.thumbnail ? (
                          <img
                            src={item.thumbnail}
                            alt=""
                            className="w-10 h-10 aspect-square object-cover rounded-md bg-black shrink-0 border border-[#333]"
                          />
                        ) : (
                          <div className="w-10 h-10 aspect-square rounded-md bg-[#242424] flex items-center justify-center shrink-0">
                            <Music className="w-4 h-4 text-[#888]" />
                          </div>
                        )}
                        <div className="truncate">
                          <p className={`font-semibold truncate text-[13px] ${isCurrent ? 'text-[#1ed760]' : 'text-white'}`}>
                            {item.title}
                          </p>
                          <p className="text-[11px] text-[#888] truncate sm:hidden">{item.uploader}</p>
                        </div>
                      </div>

                      {/* Uploader */}
                      <div className="hidden sm:block col-span-3 text-[#b3b3b3] truncate">
                        {item.uploader}
                      </div>

                      {/* Duration & Actions */}
                      <div className="col-span-5 sm:col-span-2 flex items-center justify-end gap-2 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLike(item.id);
                          }}
                          className={`p-1.5 rounded-full transition-colors ${
                            item.liked ? 'text-[#1ed760]' : 'text-[#888] hover:text-white'
                          }`}
                          title="Me gusta"
                        >
                          <Heart className={`w-3.5 h-3.5 ${item.liked ? 'fill-[#1ed760]' : ''}`} />
                        </button>

                        <a
                          href={item.downloadUrl || `/api/file/${item.id}?download=true`}
                          download={item.filename}
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 rounded-full text-[#888] hover:text-[#1ed760] hover:bg-[#2e2e2e] transition-colors"
                          title="Descargar MP3 320kbps"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>

                        <button
                          onClick={(e) => removeTrack(item.id, e)}
                          className="p-1.5 rounded-full text-[#888] hover:text-red-400 hover:bg-[#2e2e2e] transition-colors opacity-0 group-hover:opacity-100"
                          title="Eliminar de la lista"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        <span className="font-mono text-[#888] text-[11px] w-9 text-right">
                          {formatDuration(item.duration || 0)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* ================= SPOTIFY BOTTOM PLAYER BAR (SQUARE ALBUM ART) ================= */}
      {activeTrack ? (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#181818] border-t border-[#282828] px-4 py-3 shadow-[0_-8px_30px_rgba(0,0,0,0.8)]">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3 md:gap-6">
            {/* Left Track Info with Square Cover */}
            <div className="flex items-center gap-3.5 w-full md:w-1/4 min-w-0">
              {activeTrack.thumbnail ? (
                <img
                  src={activeTrack.thumbnail}
                  alt=""
                  className="w-14 h-14 aspect-square object-cover rounded-lg bg-black border border-[#333] shrink-0 shadow"
                />
              ) : (
                <div className="w-14 h-14 aspect-square rounded-lg bg-[#282828] flex items-center justify-center shrink-0">
                  <Music className="w-6 h-6 text-[#1ed760]" />
                </div>
              )}
              <div className="truncate flex-1">
                <p className="text-white text-xs sm:text-sm font-bold truncate hover:underline cursor-pointer">
                  {activeTrack.title}
                </p>
                <p className="text-[#b3b3b3] text-[11px] truncate mt-0.5">{activeTrack.uploader || 'Artista'}</p>
              </div>
              <button
                onClick={() => toggleLike(activeTrack.jobId)}
                className={`p-1.5 rounded-full transition-colors ${
                  isLiked ? 'text-[#1ed760]' : 'text-[#888] hover:text-white'
                }`}
                title="Me gusta"
              >
                <Heart className={`w-4 h-4 ${isLiked ? 'fill-[#1ed760]' : ''}`} />
              </button>
            </div>

            {/* Center Player Controls & Timeline */}
            <div className="flex flex-col items-center gap-1.5 w-full md:w-2/4 max-w-xl">
              {/* Buttons Row */}
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setIsShuffle(!isShuffle)}
                  className={`p-1.5 transition-colors ${
                    isShuffle ? 'text-[#1ed760]' : 'text-[#888] hover:text-white'
                  }`}
                  title={isShuffle ? 'Aleatorio activado' : 'Reproducción aleatoria'}
                >
                  <Shuffle className="w-4 h-4" />
                </button>

                <button
                  onClick={() => handleSkip(-10)}
                  className="p-1.5 text-[#b3b3b3] hover:text-white transition-colors"
                  title="Retroceder 10 segundos"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                {/* Big Spotify Circular Play Button */}
                <button
                  onClick={togglePlay}
                  className="w-9 h-9 rounded-full bg-white hover:scale-105 active:scale-95 text-black flex items-center justify-center shadow-lg transition-transform"
                  title={isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-black" />
                  ) : (
                    <Play className="w-4 h-4 fill-black ml-0.5" />
                  )}
                </button>

                <button
                  onClick={() => handleSkip(10)}
                  className="p-1.5 text-[#b3b3b3] hover:text-white transition-colors"
                  title="Adelantar 10 segundos"
                >
                  <RotateCw className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setIsLooping(!isLooping)}
                  className={`p-1.5 transition-colors ${
                    isLooping ? 'text-[#1ed760]' : 'text-[#888] hover:text-white'
                  }`}
                  title={isLooping ? 'Repetición activada' : 'Repetir canción'}
                >
                  <Repeat className="w-4 h-4" />
                </button>
              </div>

              {/* Progress Scrub Bar */}
              <div className="flex items-center gap-2.5 w-full">
                <span className="text-[11px] font-mono text-[#888] w-8 text-right select-none">
                  {formatDuration(currentTime)}
                </span>
                <div
                  ref={progressBarRef}
                  onMouseDown={handleSeekMouseDown}
                  className="flex-1 h-1 bg-[#4d4d4d] hover:h-1.5 rounded-full cursor-pointer relative group transition-all"
                >
                  <div
                    className="h-full bg-white group-hover:bg-[#1ed760] rounded-full relative transition-colors"
                    style={{ width: `${progressRatio}%` }}
                  >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 shadow" />
                  </div>
                </div>
                <span className="text-[11px] font-mono text-[#888] w-8 text-left select-none">
                  {formatDuration(duration)}
                </span>
              </div>
            </div>

            {/* Right Tools: Speed, Volume, Download */}
            <div className="flex items-center justify-end gap-3 w-full md:w-1/4">
              <button
                onClick={cycleSpeed}
                className="text-[11px] font-mono font-semibold bg-[#282828] hover:bg-[#333] text-white px-2 py-1 rounded border border-[#3e3e3e] transition-colors"
                title="Velocidad de reproducción"
              >
                {playbackRate}x
              </button>

              {/* Volume */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="text-[#888] hover:text-white transition-colors p-1"
                  title={isMuted ? 'Activar sonido' : 'Silenciar'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setVolume(v);
                    if (isMuted && v > 0) setIsMuted(false);
                  }}
                  className="w-16 sm:w-20 accent-[#1ed760] h-1 bg-[#4d4d4d] rounded-lg cursor-pointer"
                  title="Volumen"
                />
              </div>

              {/* Download MP3 */}
              <a
                href={activeTrack.downloadUrl}
                download={activeTrack.filename}
                className="bg-[#1ed760] hover:bg-[#1fdf64] text-black font-bold text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow transition-all hover:scale-105 active:scale-95 shrink-0"
                title="Descargar archivo MP3"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">MP3</span>
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
