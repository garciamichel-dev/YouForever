import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  FileText,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

export interface AudioPlayerProps {
  audioUrl: string;
  audioDataUrl?: string;
  durationSeconds?: number;
  transcription?: string;
  title?: string;
  className?: string;
  autoPlay?: boolean;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioUrl,
  audioDataUrl,
  durationSeconds,
  transcription,
  title,
  className = '',
  autoPlay = false,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(durationSeconds || 0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [currentSrc, setCurrentSrc] = useState(audioUrl);
  const [usingFallback, setUsingFallback] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  // Helper to convert dataUrl to Blob ObjectURL for reliable native playback
  const convertDataUrlToBlobUrl = (dataUrlStr: string): string | null => {
    try {
      if (!dataUrlStr || !dataUrlStr.startsWith('data:')) return null;
      const commaIdx = dataUrlStr.indexOf(',');
      if (commaIdx === -1) return null;
      const header = dataUrlStr.substring(0, commaIdx);
      const mimeMatch = header.match(/^data:([^;]+)/);
      const mime = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : 'audio/webm';
      const cleanBase64 = dataUrlStr.substring(commaIdx + 1).replace(/\s+/g, '');
      const binary = atob(cleanBase64);
      const len = binary.length;
      const u8 = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        u8[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([u8], { type: mime });
      const objUrl = URL.createObjectURL(blob);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      objectUrlRef.current = objUrl;
      return objUrl;
    } catch (err) {
      console.warn('[AudioPlayer] DataUrl to Blob conversion failed:', err);
      return null;
    }
  };

  useEffect(() => {
    // If audioDataUrl is available or audioUrl is data URI, use Blob ObjectURL for instant playback
    if (audioDataUrl && audioDataUrl.startsWith('data:')) {
      const blobUrl = convertDataUrlToBlobUrl(audioDataUrl);
      if (blobUrl) {
        setCurrentSrc(blobUrl);
      } else {
        setCurrentSrc(audioUrl);
      }
    } else if (audioUrl && audioUrl.startsWith('data:')) {
      const blobUrl = convertDataUrlToBlobUrl(audioUrl);
      setCurrentSrc(blobUrl || audioUrl);
    } else {
      setCurrentSrc(audioUrl);
    }

    setUsingFallback(false);
    setPlaybackError(null);
    setCurrentTime(0);
    setIsPlaying(false);
    if (durationSeconds) {
      setTotalDuration(durationSeconds);
    }

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [audioUrl, audioDataUrl, durationSeconds]);

  const togglePlayPause = async () => {
    if (!audioRef.current) return;
    setPlaybackError(null);

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        setIsLoading(true);
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err: any) {
        console.warn('[AudioPlayer] Playback failed with src:', currentSrc, err);

        // Fallback 1: If we have audioDataUrl, convert to blob URL
        if (!usingFallback && audioDataUrl) {
          console.log('[AudioPlayer] Switching to audioDataUrl blob fallback...');
          setUsingFallback(true);
          const blobUrl = convertDataUrlToBlobUrl(audioDataUrl) || audioDataUrl;
          setCurrentSrc(blobUrl);
          setTimeout(async () => {
            try {
              if (audioRef.current) {
                audioRef.current.src = blobUrl;
                await audioRef.current.play();
                setIsPlaying(true);
                setPlaybackError(null);
              }
            } catch (err2: any) {
              setPlaybackError('No se pudo reproducir el archivo de voz en este dispositivo.');
              setIsPlaying(false);
            } finally {
              setIsLoading(false);
            }
          }, 80);
          return;
        }

        // Fallback 2: If server url failed, try direct fetch -> blob -> objectUrl
        if (currentSrc && !currentSrc.startsWith('data:') && !currentSrc.startsWith('blob:')) {
          try {
            console.log('[AudioPlayer] Fetching audio as direct blob fallback...');
            const res = await fetch(currentSrc);
            if (res.ok) {
              const blob = await res.blob();
              const fetchedObjUrl = URL.createObjectURL(blob);
              if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
              }
              objectUrlRef.current = fetchedObjUrl;
              setCurrentSrc(fetchedObjUrl);
              if (audioRef.current) {
                audioRef.current.src = fetchedObjUrl;
                await audioRef.current.play();
                setIsPlaying(true);
                setPlaybackError(null);
                return;
              }
            }
          } catch (fetchErr) {
            console.warn('[AudioPlayer] Direct fetch fallback failed:', fetchErr);
          }
        }

        setPlaybackError('No se pudo iniciar la reproducción del audio.');
        setIsPlaying(false);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration;
      if (Number.isFinite(dur) && dur > 0) {
        setTotalDuration(Math.round(dur));
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = Number(e.target.value);
    setCurrentTime(targetTime);
    if (audioRef.current) {
      audioRef.current.currentTime = targetTime;
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const handleReset = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      const nextMuted = !isMuted;
      audioRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
    }
  };

  const formatTime = (secs: number) => {
    if (!Number.isFinite(secs) || secs < 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`bg-white border border-indigo-200/90 rounded-xl p-3 shadow-xs space-y-2.5 transition-all ${className}`}
    >
      <audio
        ref={audioRef}
        src={currentSrc}
        preload="metadata"
        autoPlay={autoPlay}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={(e) => {
          console.warn('[AudioPlayer] Audio element error:', e);
          if (!usingFallback && audioDataUrl) {
            setUsingFallback(true);
            setCurrentSrc(audioDataUrl);
          } else {
            setPlaybackError('Formato o recurso de voz no reproducible.');
            setIsPlaying(false);
          }
        }}
      />

      {/* Main player controls row */}
      <div className="flex items-center gap-3">
        {/* Big accessible Play / Pause button */}
        <button
          type="button"
          onClick={togglePlayPause}
          disabled={isLoading}
          aria-label={isPlaying ? 'Pausar audio' : 'Reproducir audio'}
          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-transform shadow-xs cursor-pointer ${
            isPlaying
              ? 'bg-amber-600 hover:bg-amber-700 text-white scale-105'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white'
          }`}
          title={isPlaying ? 'Pausar nota de voz' : 'Escuchar nota de voz'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-white" />
          ) : (
            <Play className="w-4 h-4 fill-white translate-x-0.5" />
          )}
        </button>

        {/* Info & progress bar */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-800 truncate">
              {title || 'Nota de voz guardada'}
            </span>
            <span className="font-mono text-slate-500 font-medium">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={totalDuration || 1}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>
        </div>

        {/* Secondary controls: Rewind / Mute */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleReset}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-md hover:bg-slate-100 transition"
            title="Volver al inicio"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={toggleMute}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-md hover:bg-slate-100 transition"
            title={isMuted ? 'Activar sonido' : 'Silenciar'}
          >
            {isMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-500" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Visual soundwave when playing */}
      {isPlaying && (
        <div className="flex items-center justify-center gap-1 py-1 px-3 bg-indigo-50/70 rounded-lg">
          {[12, 24, 16, 28, 20, 14, 26, 18, 30, 22, 16, 24, 20, 14, 28, 16].map((h, i) => (
            <div
              key={i}
              style={{
                height: `${h}px`,
                animationDelay: `${(i % 5) * 0.12}s`,
              }}
              className="w-1 bg-indigo-600 rounded-full animate-pulse"
            />
          ))}
          <span className="text-[10px] font-medium text-indigo-800 ml-2">Reproduciendo voz...</span>
        </div>
      )}

      {playbackError && (
        <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-xs text-rose-700">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
            <span>{playbackError}</span>
          </div>
          <button
            type="button"
            onClick={togglePlayPause}
            className="text-[11px] font-bold text-rose-800 underline hover:no-underline ml-2"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Transcription block if provided */}
      {transcription && (
        <div className="pt-2 border-t border-indigo-100/80">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-indigo-950 mb-1">
            <FileText className="w-3 h-3 text-indigo-600" />
            <span>Transcripción completa:</span>
          </div>
          <p className="text-xs text-slate-800 bg-slate-50/90 p-2.5 rounded-lg border border-slate-200/70 italic leading-relaxed">
            «{transcription}»
          </p>
        </div>
      )}
    </div>
  );
};
