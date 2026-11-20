/**
 * V5.9.0 — Asistente «Activar mi voz» (el mismo al finalizar la entrevista y desde el portal).
 * V5.9.1 — Carga una sola vez al abrir (antes se recargaba sin fin dentro del portal), reintenta
 * las grabaciones que no se pudieron revisar y ofrece un texto para leer en la muestra adicional.
 *
 * Pasos: autorización (casilla desmarcada) → revisión de las grabaciones de la entrevista →
 * muestra adicional si hace falta (se escucha antes de enviarla) → creación del clon (IVC) o
 * vinculación de la voz profesional (PVC) → verificación. Se puede cerrar y retomar en cualquier
 * momento; el servidor evita clones duplicados.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, Loader2, Mic, RefreshCw, RotateCcw, Shuffle, Square, X } from 'lucide-react';
import { VOICE_READING_TEXTS } from './voiceReadingTexts.ts';
import {
  blobToBase64,
  pickRecorderMimeType,
  voicePost,
  type ParticipantVoiceView,
} from './voiceClient.ts';

interface Props {
  token: string;
  open: boolean;
  onClose: () => void;
  /** Avisa al portal cuando cambia el estado (para mostrar u ocultar «Activar mi voz»). */
  onStatusChange?: (view: ParticipantVoiceView) => void;
}

const CONSENT_LABEL = 'Autorizo el uso de mis grabaciones para clonar mi voz y utilizarla en Mi Esencia';
/** Must match MAX_EXTRA_SAMPLE_BASE64 on the server (one Firestore document). */
const MAX_SAMPLE_BASE64 = 900_000;
/** 48 kbps keeps 90 seconds under the limit with any browser codec. */
const SAMPLE_BITS_PER_SECOND = 48_000;

/** Analysis is (re)run when it never ran or when some recordings are waiting for a retry. */
const shouldAnalyze = (v: ParticipantVoiceView) =>
  v.authorized && v.mode === 'ivc' && v.status !== 'lista' && !v.inProgress && (!v.analysis || (v.analysis.retryPending || 0) > 0);

export const VoiceSetupWizard: React.FC<Props> = ({ token, open, onClose, onStatusChange }) => {
  const [view, setView] = useState<ParticipantVoiceView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [recording, setRecording] = useState(false);
  const [sampleBlob, setSampleBlob] = useState<Blob | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [sampleSeconds, setSampleSeconds] = useState(0);
  const [textIndex, setTextIndex] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  // The parent may pass a new function on every render: keep it in a ref so `apply`, `run` and the
  // loading effect stay stable (otherwise each update re-triggered the load, endlessly).
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const apply = useCallback((v: ParticipantVoiceView) => {
    setView(v);
    onStatusChangeRef.current?.(v);
  }, []);

  const run = useCallback(
    async (label: string, fn: () => Promise<ParticipantVoiceView>) => {
      setBusy(label);
      setError(null);
      try {
        apply(await fn());
      } catch (err: any) {
        setError(err?.message || 'No fue posible completar este paso.');
      } finally {
        setBusy(null);
      }
    },
    [apply]
  );

  // Load (and resume) the configuration when the window opens.
  useEffect(() => {
    if (!open || !token) return;
    void run('Cargando tu configuración de voz…', async () => {
      const v = await voicePost<ParticipantVoiceView>('/participant/status', { token });
      if (shouldAnalyze(v)) {
        return { ...v, ...(await voicePost<ParticipantVoiceView>('/participant/analyze', { token })) };
      }
      return v;
    });
  }, [open, token, run]);

  // While another attempt is creating the voice, check again every few seconds.
  useEffect(() => {
    if (!open || !view?.inProgress) return;
    const id = window.setInterval(() => {
      voicePost<ParticipantVoiceView>('/participant/status', { token }).then(apply).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(id);
  }, [open, view?.inProgress, token, apply]);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => {
    stopStream();
    if (sampleUrl) URL.revokeObjectURL(sampleUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    stopStream();
    setRecording(false);
    onClose();
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const options: MediaRecorderOptions = { audioBitsPerSecond: SAMPLE_BITS_PER_SECOND };
      if (mimeType) options.mimeType = mimeType;
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, options);
      } catch {
        rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      }
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (sampleUrl) URL.revokeObjectURL(sampleUrl);
        setSampleBlob(blob);
        setSampleUrl(URL.createObjectURL(blob));
        setSampleSeconds(Math.round((Date.now() - startedAtRef.current) / 1000));
        stopStream();
      };
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      setSampleSeconds(0);
      timerRef.current = window.setInterval(() => {
        const s = Math.round((Date.now() - startedAtRef.current) / 1000);
        setSampleSeconds(s);
        if (s >= 90 && rec.state === 'recording') rec.stop();
      }, 500);
      rec.start();
      setRecording(true);
    } catch {
      setError('No pudimos usar tu micrófono. Revisa el permiso del navegador e inténtalo de nuevo.');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    setRecording(false);
  };

  const sendSample = () =>
    run('Revisando tu muestra…', async () => {
      if (!sampleBlob) throw new Error('Primero graba tu muestra.');
      const audioBase64 = await blobToBase64(sampleBlob);
      if (audioBase64.length > MAX_SAMPLE_BASE64) {
        throw new Error('La muestra quedó demasiado pesada. Grábala de nuevo con una duración de 30 a 90 segundos.');
      }
      const v = await voicePost<ParticipantVoiceView>('/participant/extra-sample', {
        token,
        audioBase64,
        mimeType: sampleBlob.type || 'audio/webm',
        durationSeconds: sampleSeconds,
      });
      if (v.sample?.usable) {
        setSampleBlob(null);
        if (sampleUrl) URL.revokeObjectURL(sampleUrl);
        setSampleUrl(null);
      }
      return v;
    });

  if (!open) return null;

  const v = view;
  const needsConsent = !v?.authorized;
  const needsSample = Boolean(v && v.authorized && v.mode === 'ivc' && v.analysis && !v.analysis.sufficient && v.status !== 'lista');
  const canCreate = Boolean(v && v.authorized && v.mode === 'ivc' && v.analysis?.sufficient && !v.ready && !v.inProgress && v.status !== 'pendiente_verificacion');

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="voice-wizard-title">
      <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="voice-wizard-title" className="font-serif text-lg font-bold text-stone-900">Activar mi voz</h3>
            <p className="text-xs text-stone-600 mt-0.5">
              Tu familia podrá conversar con tu representación en Mi Esencia escuchando tu propia voz.
            </p>
          </div>
          <button type="button" onClick={handleClose} aria-label="Cerrar" className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {busy && (
          <div className="flex items-center gap-2 text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-2.5" role="status">
            <Loader2 className="w-4 h-4 animate-spin text-amber-700" /> {busy}
          </div>
        )}
        {error && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-start gap-2" role="alert">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {v && needsConsent && (
          <div className="space-y-3">
            <label className="flex items-start gap-2.5 text-sm text-stone-800 cursor-pointer">
              <input
                type="checkbox"
                data-testid="voice-consent-checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-1 h-4 w-4 accent-amber-700"
              />
              <span>{CONSENT_LABEL}</span>
            </label>
            <p className="text-[11px] text-stone-500 leading-relaxed">
              Usaremos copias de fragmentos de tus grabaciones en los que se escucha tu voz con claridad; tus grabaciones originales no se modifican.
            </p>
            <button
              type="button"
              disabled={!consentChecked || Boolean(busy)}
              onClick={() =>
                run('Guardando tu autorización…', async () => {
                  await voicePost('/participant/authorize', { token, source: 'portal' });
                  const st = await voicePost<ParticipantVoiceView>('/participant/status', { token });
                  return st.mode === 'ivc' ? voicePost<ParticipantVoiceView>('/participant/analyze', { token }) : st;
                })
              }
              className="w-full py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              Confirmar autorización
            </button>
          </div>
        )}

        {v && !needsConsent && (
          <div className="space-y-3 text-xs text-stone-700">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-stone-100 border border-stone-200 font-semibold">
                {v.mode === 'pvc' ? 'Clonación profesional (PVC)' : 'Clonación instantánea (IVC)'}
              </span>
              <span
                data-testid="voice-status-badge"
                className={`px-2 py-0.5 rounded font-semibold border ${
                  v.ready
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : v.status === 'error'
                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                    : 'bg-amber-50 text-amber-900 border-amber-200'
                }`}
              >
                {v.ready
                  ? 'Lista'
                  : v.status === 'en_proceso'
                  ? 'En proceso'
                  : v.status === 'pendiente_verificacion'
                  ? 'Pendiente de verificación'
                  : v.status === 'error'
                  ? 'Error'
                  : 'Sin configurar'}
              </span>
            </div>

            {v.ready && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Tu voz está lista. Tus familiares ya pueden activar la conversación de viva voz en Mi Esencia.</span>
              </div>
            )}

            {v.inProgress && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Estamos preparando tu voz. Puedes cerrar esta ventana y volver más tarde.</span>
              </div>
            )}

            {v.mode === 'ivc' && v.analysis && !v.ready && (
              <p>
                Encontramos <strong>{v.analysis.usableRecordings}</strong> grabación(es) útiles de tu entrevista
                ({Math.round(v.analysis.usableSpeechSeconds)} s de voz clara).
                {v.analysis.rejected.length > 0 && <> Descartamos {v.analysis.rejected.length} porque {Array.from(new Set(v.analysis.rejected.map((r) => r.label))).join(', ')}.</>}
              </p>
            )}

            {v.mode === 'ivc' && v.analysis && !v.ready && (v.analysis.retryPending || 0) > 0 && (
              <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50 flex flex-wrap items-center justify-between gap-2" data-testid="voice-analysis-retry">
                <span>
                  No pudimos revisar {v.analysis.retryPending} grabación(es) por un problema temporal. Puedes intentarlo de nuevo o grabar una muestra.
                </span>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => run('Revisando tus grabaciones…', () => voicePost<ParticipantVoiceView>('/participant/analyze', { token }))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-stone-300 bg-white rounded-lg font-semibold disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Volver a revisar
                </button>
              </div>
            )}

            {needsSample && (
              <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/60 space-y-2.5" data-testid="voice-extra-sample">
                <p className="text-amber-950 font-semibold">Necesitamos una muestra adicional de tu voz.</p>
                <p>
                  Busca un lugar tranquilo, sin otras voces, y lee en voz alta el siguiente texto con tu tono de siempre, como si se lo contaras a tu familia
                  (de 30 a 90 segundos). Podrás escucharla antes de enviarla.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {!recording ? (
                    <button type="button" onClick={startRecording} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 text-white rounded-lg font-semibold disabled:opacity-50">
                      {sampleBlob ? <RotateCcw className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                      {sampleBlob ? 'Volver a grabar' : 'Grabar muestra'}
                    </button>
                  ) : (
                    <button type="button" onClick={stopRecording} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-700 text-white rounded-lg font-semibold">
                      <Square className="w-3.5 h-3.5" /> Detener ({sampleSeconds} s)
                    </button>
                  )}
                </div>
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
                {v.sample && !v.sample.usable && (
                  <p className="text-rose-700">La muestra anterior no sirvió porque {v.sample.reason}. Inténtalo de nuevo.</p>
                )}
                {sampleUrl && !recording && (
                  <div className="space-y-2">
                    <audio controls src={sampleUrl} className="w-full" data-testid="voice-sample-preview" />
                    <button type="button" onClick={sendSample} disabled={Boolean(busy)} className="w-full py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold disabled:opacity-50">
                      Enviar esta muestra
                    </button>
                  </div>
                )}
              </div>
            )}

            {canCreate && (
              <button
                type="button"
                data-testid="voice-create-instant"
                disabled={Boolean(busy)}
                onClick={() => run('Creando tu voz con ElevenLabs…', () => voicePost<ParticipantVoiceView>('/participant/create-instant', { token }))}
                className="w-full py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {v.status === 'error' ? 'Reintentar' : 'Crear mi voz'}
              </button>
            )}

            {v.mode === 'pvc' && !v.ready && !v.inProgress && (
              <div className="space-y-2" data-testid="voice-pvc-link">
                <ol className="list-decimal pl-4 space-y-1 text-stone-700">
                  <li>Crea tu clon profesional en tu cuenta de ElevenLabs y completa su verificación.</li>
                  <li>En «Mis voces», elige «Compartir voz», comparte con la cuenta de YouForever y copia el enlace.</li>
                  <li>Pega aquí el enlace para vincularla.</li>
                </ol>
                <input
                  type="url"
                  value={shareLink}
                  onChange={(e) => setShareLink(e.target.value)}
                  placeholder="https://elevenlabs.io/app/voice-lab/share/…"
                  className="w-full p-2 border border-stone-300 rounded-lg text-xs"
                />
                <button
                  type="button"
                  disabled={!shareLink.trim() || Boolean(busy)}
                  onClick={() => run('Vinculando tu voz profesional…', () => voicePost<ParticipantVoiceView>('/participant/link-professional', { token, shareLink }))}
                  className="w-full py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {v.status === 'error' ? 'Reintentar vinculación' : 'Vincular mi voz'}
                </button>
              </div>
            )}

            {v.status === 'pendiente_verificacion' && !v.inProgress && (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => run('Comprobando tu voz…', () => voicePost<ParticipantVoiceView>('/participant/recheck', { token }))}
                className="w-full py-2 border border-amber-300 text-amber-900 rounded-lg font-semibold disabled:opacity-50"
              >
                Volver a comprobar
              </button>
            )}

            {v.lastError && <p className="text-rose-700">{v.lastError}</p>}
          </div>
        )}

        <div className="pt-1 flex justify-between items-center gap-2">
          <p className="text-[10px] text-stone-400">Puedes cerrar y retomarlo después desde «Activar mi voz».</p>
          <button type="button" onClick={handleClose} className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg text-xs font-medium">
            {v?.ready ? 'Listo' : 'Cerrar'}
          </button>
        </div>
      </div>
    </div>
  );
};
