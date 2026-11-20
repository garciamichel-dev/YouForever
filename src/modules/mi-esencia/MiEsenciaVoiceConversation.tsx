/**
 * V5.9.0 — Conversación de viva voz en «Mi Esencia» (función opcional).
 *
 * Aparece debajo de «Sugerencias opcionales» sólo cuando la voz clonada está lista. Al pulsar
 * «Habilitar voz» se pide el micrófono y se conversa por turnos sin botón de envío:
 *   escuchar → detectar el fin del turno (silencio) → enviar la grabación al servidor, que transcribe,
 *   usa el MISMO flujo de Mi Esencia y responde con la voz clonada → reproducir.
 * Si el familiar vuelve a hablar mientras Mi Esencia responde, el audio se detiene y se procesa el
 * nuevo turno. «Deshabilitar voz» libera el micrófono y el chat escrito sigue en el mismo hilo.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Volume2 } from 'lucide-react';
import { blobToBase64, newTurnId, pickRecorderMimeType, voicePost, VoiceApiError } from '../../components/voice/voiceClient.ts';

interface FamilyVoiceStatus {
  available: boolean;
  status: string;
  quota: { limit: number; used: number; reserved: number; remaining: number };
  maxSecondsPerMessage: number | null;
  exhaustedMessage: string;
}

type Phase = 'off' | 'starting' | 'listening' | 'capturing' | 'processing' | 'speaking';

interface Props {
  personalCode: string;
  selectedPersonId?: string;
  sessionId?: string;
  /** Aplica al hilo la respuesta del flujo de Mi Esencia (igual que el chat escrito). */
  onConverseResult: (data: any) => void;
  /** Con un mensaje de texto en curso no se capturan turnos de voz. */
  textBusy?: boolean;
}

// Voice activity detection (tuned for a quiet room with echo cancellation on).
const FRAME_MS = 50;
const ONSET_MS = 150;
const END_SILENCE_MS = 1100;
const MIN_SPEECH_MS = 400;
const BARGE_IN_MS = 300;
/** After a turn is cut at the maximum duration, wait for a pause before listening again. */
const PAUSE_AFTER_CUT_MS = 600;

export const MiEsenciaVoiceConversation: React.FC<Props> = ({ personalCode, selectedPersonId, sessionId, onConverseResult, textBusy }) => {
  const [status, setStatus] = useState<FamilyVoiceStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('off');
  const [notice, setNotice] = useState<string | null>(null);

  const phaseRef = useRef<Phase>('off');
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const loopRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const vad = useRef({ floor: 0.006, above: 0, lastVoiceAt: 0, speechMs: 0, captureStartedAt: 0, waitForPause: false, quietMs: 0 });
  /** Turn whose reply must still be played; an older one is ignored after an interruption. */
  const currentTurnRef = useRef<string | null>(null);
  const propsRef = useRef({ personalCode, selectedPersonId, sessionId, onConverseResult, textBusy, status });
  propsRef.current = { personalCode, selectedPersonId, sessionId, onConverseResult, textBusy, status };

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const refreshStatus = useCallback(async () => {
    if (!personalCode) return;
    try {
      const s = await voicePost<FamilyVoiceStatus>('/family/status', { personalCode, selectedPersonId });
      setStatus(s);
    } catch {
      setStatus(null);
    }
  }, [personalCode, selectedPersonId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const stopPlayback = () => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src);
    }
    audioRef.current = null;
  };

  const shutdown = useCallback((message?: string | null) => {
    if (loopRef.current) window.clearInterval(loopRef.current);
    loopRef.current = null;
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== 'inactive') {
      rec.ondataavailable = null;
      rec.onstop = null;
      rec.stop();
    }
    stopPlayback();
    streamRef.current?.getTracks().forEach((t) => t.stop()); // releases the microphone
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    analyserRef.current = null;
    currentTurnRef.current = null;
    setPhaseBoth('off');
    if (message !== undefined) setNotice(message);
  }, []);

  useEffect(() => () => shutdown(), [shutdown]);
  // A different person (couple avatar) or thread: stop the voice session.
  useEffect(() => {
    if (phaseRef.current !== 'off') shutdown(null);
  }, [selectedPersonId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ack = (turnId: string, delivered: boolean) =>
    voicePost<{ quota: FamilyVoiceStatus['quota'] }>('/family/ack', {
      personalCode: propsRef.current.personalCode,
      selectedPersonId: propsRef.current.selectedPersonId,
      turnId,
      delivered,
    })
      .then((r) => setStatus((s) => (s ? { ...s, quota: r.quota } : s)))
      .catch(() => undefined);

  const sendTurn = async (blob: Blob, durationSeconds: number) => {
    const turnId = newTurnId();
    currentTurnRef.current = turnId;
    setPhaseBoth('processing');
    try {
      const audioBase64 = await blobToBase64(blob);
      const r = await voicePost<any>('/family/turn', {
        personalCode: propsRef.current.personalCode,
        selectedPersonId: propsRef.current.selectedPersonId,
        sessionId: propsRef.current.sessionId,
        turnId,
        audioBase64,
        mimeType: blob.type || 'audio/webm',
        durationSeconds,
      });
      if (r.quota) setStatus((s) => (s ? { ...s, quota: r.quota } : s));
      if (r.conversation) propsRef.current.onConverseResult(r.conversation);
      if (r.noSpeech) {
        if (currentTurnRef.current === turnId && phaseRef.current === 'processing') setPhaseBoth('listening');
        return;
      }
      if (currentTurnRef.current !== turnId || phaseRef.current === 'off') {
        void ack(turnId, false); // superseded by a newer turn: not delivered, not charged
        return;
      }
      const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.audioBase64), (c) => c.charCodeAt(0))], { type: r.audioMimeType || 'audio/mpeg' }));
      const audio = new Audio(url);
      audioRef.current = audio;
      let acknowledged = false;
      audio.addEventListener('playing', () => {
        if (!acknowledged) {
          acknowledged = true;
          void ack(turnId, true); // delivered: one voice message is charged
        }
      });
      audio.addEventListener('ended', () => {
        if (audioRef.current === audio) {
          stopPlayback();
          if (phaseRef.current === 'speaking') setPhaseBoth('listening');
        }
      });
      audio.addEventListener('error', () => {
        if (!acknowledged) void ack(turnId, false);
        if (phaseRef.current === 'speaking') setPhaseBoth('listening');
      });
      setPhaseBoth('speaking');
      await audio.play().catch(() => {
        if (!acknowledged) void ack(turnId, false);
        setPhaseBoth('listening');
      });
    } catch (err) {
      if (err instanceof VoiceApiError && err.code === 'quota_exhausted') {
        shutdown(propsRef.current.status?.exhaustedMessage || 'Se alcanzó el límite diario de mensajes de voz. Puedes seguir conversando por texto');
        void refreshStatus();
        return;
      }
      if (err instanceof VoiceApiError && (err.code === 'too_long' || err.code === 'invalid_turn')) {
        setNotice(err.message);
        if (phaseRef.current === 'processing') setPhaseBoth('listening');
        return;
      }
      shutdown(`${(err as Error)?.message || 'El servicio de voz no respondió.'} Puedes seguir conversando por texto.`);
    }
  };

  const startCapture = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickRecorderMimeType();
    const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    recorderRef.current = rec;
    const now = performance.now();
    vad.current.captureStartedAt = now;
    vad.current.lastVoiceAt = now;
    vad.current.speechMs = 0;
    rec.start();
    setPhaseBoth('capturing');
  };

  const finishCapture = (send: boolean) => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec || rec.state === 'inactive') return;
    const startedAt = vad.current.captureStartedAt;
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
      chunksRef.current = [];
      if (send && blob.size > 0) void sendTurn(blob, Math.round((performance.now() - startedAt) / 100) / 10);
      else if (phaseRef.current === 'capturing') setPhaseBoth('listening');
    };
    rec.stop();
  };

  const tick = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const v = vad.current;
    const threshold = Math.max(0.015, v.floor * 3);
    const now = performance.now();
    const p = phaseRef.current;

    // The rest of an utterance cut at the maximum duration is not a new turn nor an interruption.
    if (v.waitForPause && p !== 'capturing') {
      v.quietMs = rms < threshold ? v.quietMs + FRAME_MS : 0;
      if (v.quietMs >= PAUSE_AFTER_CUT_MS) {
        v.waitForPause = false;
        v.quietMs = 0;
      }
      v.above = 0;
      return;
    }

    if (p === 'listening') {
      if (rms < threshold) v.floor = v.floor * 0.95 + rms * 0.05;
      v.above = rms > threshold ? v.above + FRAME_MS : 0;
      if (v.above >= ONSET_MS && !propsRef.current.textBusy) startCapture();
    } else if (p === 'capturing') {
      if (rms > threshold * 0.7) {
        v.lastVoiceAt = now;
        v.speechMs += FRAME_MS;
      }
      const max = propsRef.current.status?.maxSecondsPerMessage;
      if (max && now - v.captureStartedAt >= max * 1000) {
        v.waitForPause = true;
        v.quietMs = 0;
        finishCapture(v.speechMs >= MIN_SPEECH_MS);
      } else if (now - v.lastVoiceAt >= END_SILENCE_MS) {
        finishCapture(v.speechMs >= MIN_SPEECH_MS);
      }
    } else if (p === 'speaking' || p === 'processing') {
      // Barge-in: louder and longer than the onset, so the reply's own echo does not trigger it.
      v.above = rms > threshold * 2 ? v.above + FRAME_MS : 0;
      if (v.above >= BARGE_IN_MS) {
        v.above = 0;
        stopPlayback();
        currentTurnRef.current = null; // the pending/playing reply is superseded
        startCapture();
      }
    }
  };

  const enable = async () => {
    setNotice(null);
    setPhaseBoth('starting');
    await refreshStatus();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      vad.current = { floor: 0.006, above: 0, lastVoiceAt: 0, speechMs: 0, captureStartedAt: 0, waitForPause: false, quietMs: 0 };
      loopRef.current = window.setInterval(tick, FRAME_MS);
      setPhaseBoth('listening');
    } catch {
      shutdown('No tenemos permiso para usar tu micrófono. Puedes permitirlo en tu navegador o seguir conversando por texto.');
    }
  };

  if (!status?.available) return null;

  const active = phase !== 'off';
  const exhausted = status.quota.remaining <= 0 && !active;
  const label =
    phase === 'starting'
      ? 'Preparando el micrófono…'
      : phase === 'listening'
      ? 'Mi Esencia te está escuchando…'
      : phase === 'capturing'
      ? 'Te escucho…'
      : phase === 'processing'
      ? 'Mi Esencia está pensando su respuesta…'
      : phase === 'speaking'
      ? 'Mi Esencia está respondiendo… (puedes hablar para interrumpir)'
      : null;

  return (
    <div className="pb-2 space-y-1.5" data-testid="mi-esencia-voice">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="mi-esencia-voice-toggle"
          disabled={phase === 'starting' || exhausted}
          onClick={() => (active ? shutdown(null) : void enable())}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
            active
              ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
              : 'bg-amber-600 hover:bg-amber-500 border-amber-700 text-stone-950'
          }`}
        >
          {active ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          {active ? 'Deshabilitar voz' : 'Habilitar voz'}
        </button>
        {label && (
          <span className="text-[11px] text-stone-600 dark:text-stone-300 flex items-center gap-1.5" role="status" aria-live="polite">
            {phase === 'speaking' ? (
              <Volume2 className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
            ) : phase === 'processing' || phase === 'starting' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700 dark:text-amber-400" />
            ) : (
              <span className={`w-2 h-2 rounded-full ${phase === 'capturing' ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
            )}
            {label}
          </span>
        )}
        <span className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
          Mensajes de voz hoy: {status.quota.remaining} de {status.quota.limit}
        </span>
      </div>
      {(notice || exhausted) && (
        <p className="text-[11px] text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg px-2.5 py-1.5" role="alert">
          {notice || status.exhaustedMessage}
        </p>
      )}
    </div>
  );
};
