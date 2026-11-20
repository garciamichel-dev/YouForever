/**
 * V5.9.3 — Grabación de la muestra adicional de voz.
 *
 * Muestra mientras se graba: cronómetro con barra de 30–90 s (se detiene sola a los 90 s), medidor
 * del micrófono y avisos en vivo (no te escuchamos, voz saturada, ruido de fondo). Antes de enviarla
 * se puede escuchar; sólo se envía si dura al menos 30 s.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, Mic, RotateCcw, Send, Shuffle, Square } from 'lucide-react';
import { VOICE_READING_TEXTS } from './voiceReadingTexts.ts';
import { pickRecorderMimeType } from './voiceClient.ts';
import type { SampleFeedback } from './useVoiceActivation.ts';

export const SAMPLE_MIN_SECONDS = 30;
export const SAMPLE_MAX_SECONDS = 90;
/** 48 kbps keeps 90 seconds under the size limit with any browser codec. */
const SAMPLE_BITS_PER_SECOND = 48_000;

/** Umbrales del medidor (RMS de la señal entre 0 y 1). */
const SILENCE_RMS = 0.012;
const SILENCE_WARN_MS = 3000;
const NOISE_FLOOR_RMS = 0.03;
const CLIP_PEAK = 0.98;

type Hint = { tone: 'ok' | 'warn' | 'info'; text: string };

interface Props {
  disabled?: boolean;
  feedback: SampleFeedback | null;
  onSubmit: (blob: Blob, seconds: number) => void;
  onMicError: (message: string) => void;
}

export const VoiceSampleRecorder: React.FC<Props> = ({ disabled, feedback, onSubmit, onMicError }) => {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState<Hint | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [textIndex, setTextIndex] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const meterRef = useRef({ lastVoiceAt: 0, floor: 1, floorWindowMin: 1, windowStartedAt: 0, clipFrames: 0, frames: 0 });

  const cleanup = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop()); // releases the microphone
    streamRef.current = null;
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    setLevel(0);
  };

  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      cleanup();
    },
    []
  );
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const start = async () => {
    setHint(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      onMicError('No pudimos usar tu micrófono. Revisa el permiso del navegador e inténtalo de nuevo.');
      return;
    }
    streamRef.current = stream;
    const mimeType = pickRecorderMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { audioBitsPerSecond: SAMPLE_BITS_PER_SECOND, ...(mimeType ? { mimeType } : {}) });
    } catch {
      rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      const b = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      setBlob(b);
      setUrl(URL.createObjectURL(b));
      setSeconds(Math.round((Date.now() - startedAtRef.current) / 1000));
      setRecording(false);
      cleanup();
    };

    // Live meter.
    let analyser: AnalyserNode | null = null;
    try {
      const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
    } catch {
      analyser = null; // the recording still works without the meter
    }
    const buf = new Float32Array(1024);
    const now0 = Date.now();
    meterRef.current = { lastVoiceAt: now0, floor: 1, floorWindowMin: 1, windowStartedAt: now0, clipFrames: 0, frames: 0 };

    recorderRef.current = rec;
    startedAtRef.current = now0;
    setSeconds(0);
    setBlob(null);
    if (url) URL.revokeObjectURL(url);
    setUrl(null);

    timerRef.current = window.setInterval(() => {
      const t = Date.now();
      const s = Math.floor((t - startedAtRef.current) / 1000);
      setSeconds(s);
      if (s >= SAMPLE_MAX_SECONDS && rec.state === 'recording') {
        rec.stop();
        return;
      }
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        sum += buf[i] * buf[i];
        const a = Math.abs(buf[i]);
        if (a > peak) peak = a;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Perceptual meter (dB scale between -50 dB and 0 dB).
      const db = 20 * Math.log10(Math.max(rms, 1e-5));
      setLevel(Math.max(0, Math.min(1, (db + 50) / 50)));

      const m = meterRef.current;
      m.frames++;
      if (peak >= CLIP_PEAK) m.clipFrames++;
      if (rms >= SILENCE_RMS) m.lastVoiceAt = t;
      // Background noise: the quietest moment of each 2-second window.
      m.floorWindowMin = Math.min(m.floorWindowMin, rms);
      if (t - m.windowStartedAt >= 2000) {
        m.floor = m.floorWindowMin;
        m.floorWindowMin = 1;
        m.windowStartedAt = t;
      }

      let next: Hint;
      if (t - m.lastVoiceAt >= SILENCE_WARN_MS) {
        next = { tone: 'warn', text: 'No te escuchamos. Acércate al micrófono o revisa que no esté silenciado.' };
      } else if (m.frames >= 20 && m.clipFrames / m.frames > 0.03) {
        next = { tone: 'warn', text: 'Tu voz se escucha saturada. Aléjate un poco del micrófono.' };
      } else if (s >= 5 && m.floor > NOISE_FLOOR_RMS) {
        next = { tone: 'warn', text: 'Se escucha ruido de fondo. Si puedes, busca un lugar más silencioso.' };
      } else if (s >= SAMPLE_MIN_SECONDS) {
        next = { tone: 'ok', text: 'Ya es suficiente. Puedes detener la grabación cuando termines el texto.' };
      } else {
        next = { tone: 'ok', text: 'Te escuchamos con claridad. Sigue leyendo con calma.' };
      }
      setHint((prev) => (prev?.text === next.text ? prev : next));
      // Reset the clipping window every ~2 s so an old peak does not stick.
      if (m.frames >= 20) {
        m.frames = 0;
        m.clipFrames = 0;
      }
    }, 100);

    rec.start(1000);
    setRecording(true);
  };

  const stop = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  };

  const tooShort = seconds < SAMPLE_MIN_SECONDS;
  const pct = Math.min(100, (seconds / SAMPLE_MAX_SECONDS) * 100);
  const minPct = (SAMPLE_MIN_SECONDS / SAMPLE_MAX_SECONDS) * 100;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="space-y-3" data-testid="voice-extra-sample">
      <p className="text-stone-700">
        Busca un lugar tranquilo, sin otras voces, y lee en voz alta el texto con tu tono de siempre, como si se lo contaras a tu familia. Graba
        entre {SAMPLE_MIN_SECONDS} y {SAMPLE_MAX_SECONDS} segundos; podrás escucharla antes de enviarla.
      </p>

      {feedback && !feedback.usable && !recording && !blob && (
        <p className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> La muestra anterior no sirvió: {feedback.reason || 'no se pudo analizar'}. Inténtalo de nuevo.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!recording ? (
          <button
            type="button"
            onClick={start}
            disabled={disabled}
            data-testid="voice-sample-record"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-stone-900 text-white rounded-lg font-semibold disabled:opacity-50"
          >
            {blob ? <RotateCcw className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            {blob ? 'Volver a grabar' : 'Empezar a grabar'}
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            data-testid="voice-sample-stop"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-700 text-white rounded-lg font-semibold"
          >
            <Square className="w-3.5 h-3.5" /> Detener
          </button>
        )}
        {(recording || blob) && (
          <span className="font-mono text-sm text-stone-800 tabular-nums" data-testid="voice-sample-timer">
            {mmss(seconds)} / {mmss(SAMPLE_MAX_SECONDS)}
          </span>
        )}
      </div>

      {(recording || blob) && (
        <div className="space-y-1.5">
          {/* Duration bar with the 30-second mark */}
          <div className="relative h-2.5 rounded-full bg-stone-200 overflow-hidden" aria-label="Duración de la muestra">
            <div
              className={`h-full transition-[width] duration-300 ${seconds >= SAMPLE_MIN_SECONDS ? 'bg-emerald-600' : 'bg-amber-500'}`}
              style={{ width: `${pct}%` }}
            />
            <div className="absolute top-0 bottom-0 w-0.5 bg-stone-700/60" style={{ left: `${minPct}%` }} />
          </div>
          <div className="relative h-3.5 text-[10px] text-stone-500">
            <span className="absolute left-0">0 s</span>
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${minPct}%` }}>
              mínimo {SAMPLE_MIN_SECONDS} s
            </span>
            <span className="absolute right-0 whitespace-nowrap">{SAMPLE_MAX_SECONDS} s (se detiene sola)</span>
          </div>
        </div>
      )}

      {recording && (
        <div className="space-y-1.5" data-testid="voice-sample-live">
          <div className="flex items-center gap-2">
            <Mic className="w-3.5 h-3.5 text-stone-500 shrink-0" />
            <div className="flex-1 h-2 rounded-full bg-stone-200 overflow-hidden" aria-label="Volumen del micrófono" data-testid="voice-mic-meter">
              <div
                className={`h-full transition-[width] duration-100 ${level > 0.92 ? 'bg-rose-500' : level > 0.35 ? 'bg-emerald-500' : 'bg-stone-400'}`}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>
          {hint && (
            <p
              data-testid="voice-sample-hint"
              className={`flex items-start gap-1.5 ${hint.tone === 'warn' ? 'text-amber-800' : 'text-emerald-800'}`}
              role="status"
            >
              {hint.tone === 'warn' ? <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              {hint.text}
            </p>
          )}
        </div>
      )}

      {url && !recording && (
        <div className="space-y-2 p-2.5 rounded-lg border border-stone-200 bg-stone-50">
          <p className="font-semibold text-stone-800">Escucha tu muestra antes de enviarla:</p>
          <audio controls src={url} className="w-full" data-testid="voice-sample-preview" />
          {tooShort ? (
            <p className="text-amber-800">
              Tu muestra dura {seconds} s. Necesitamos al menos {SAMPLE_MIN_SECONDS} s: vuelve a grabar y lee un poco más.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => blob && onSubmit(blob, seconds)}
            disabled={disabled || tooShort || !blob}
            data-testid="voice-sample-send"
            className="w-full inline-flex items-center justify-center gap-1.5 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" /> Usar esta muestra y continuar
          </button>
        </div>
      )}

      <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-2" data-testid="voice-reading-text">
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 font-semibold text-stone-800">
            <BookOpen className="w-3.5 h-3.5 text-amber-700" /> Texto para leer: {VOICE_READING_TEXTS[textIndex].title}
          </p>
          <button
            type="button"
            disabled={recording}
            onClick={() => setTextIndex((i) => (i + 1) % VOICE_READING_TEXTS.length)}
            className="inline-flex items-center gap-1 text-[11px] text-amber-800 hover:underline disabled:opacity-40"
          >
            <Shuffle className="w-3 h-3" /> Otro texto
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto pr-1 space-y-2 font-serif text-[15px] leading-relaxed text-stone-900">
          {VOICE_READING_TEXTS[textIndex].paragraphs.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
        <p className="text-[10px] text-stone-500">Si te equivocas, sigue leyendo con calma; no hace falta empezar de nuevo.</p>
      </div>
    </div>
  );
};
