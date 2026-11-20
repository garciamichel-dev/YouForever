/**
 * V5.9.0 — Ventana «Activar mi voz» (al finalizar la entrevista y desde el portal).
 * V5.9.3 — Muestra el proceso completo: barra con porcentaje, pasos, detalle de actividad y, al
 * final, si terminó bien (con «Escuchar mi voz») o qué falló y qué hacer. El proceso lo lleva el
 * controlador `useVoiceActivation` del portal, así que sigue aunque esta ventana se cierre.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Hourglass,
  Loader2,
  MinusCircle,
  PlayCircle,
  RefreshCw,
  Mic,
  X,
  XCircle,
} from 'lucide-react';
import { voiceErrorGuidance, type ActivationPhase, type ActivationStep } from '../../logic/voiceActivationProgress.ts';
import type { VoiceActivation } from './useVoiceActivation.ts';
import { VoiceSampleRecorder } from './VoiceSampleRecorder.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  activation: VoiceActivation;
}

const CONSENT_LABEL = 'Autorizo el uso de mis grabaciones para clonar mi voz y utilizarla en Mi Esencia';

const HEADLINES: Record<ActivationPhase, string> = {
  idle: 'Preparando…',
  loading: 'Consultando tu configuración de voz…',
  consent: 'Esperando tu autorización',
  reviewing: 'Revisando tus grabaciones de la entrevista…',
  needs_sample: 'Necesitamos una muestra adicional de tu voz',
  checking_sample: 'Revisando tu muestra de voz…',
  creating: 'Creando tu voz…',
  verifying: 'Comprobando que tu voz funciona…',
  ready: 'Proceso completado: tu voz está lista',
  pending: 'Tu voz se creó; falta una comprobación',
  pvc_link: 'Esperando el enlace de tu voz profesional',
  linking: 'Vinculando tu voz profesional…',
  error: 'El proceso se detuvo',
};

const StepIcon: React.FC<{ state: ActivationStep['state'] }> = ({ state }) => {
  switch (state) {
    case 'listo':
      return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
    case 'en_curso':
      return <Loader2 className="w-4 h-4 text-amber-700 animate-spin" />;
    case 'espera':
      return <Hourglass className="w-4 h-4 text-amber-600" />;
    case 'omitido':
      return <MinusCircle className="w-4 h-4 text-stone-400" />;
    case 'error':
      return <XCircle className="w-4 h-4 text-rose-600" />;
    default:
      return <Circle className="w-4 h-4 text-stone-300" />;
  }
};

const hhmmss = (t: number) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const VoiceSetupWizard: React.FC<Props> = ({ open, onClose, activation }) => {
  const { view, phase, progress, error, log, running } = activation;
  const [consentChecked, setConsentChecked] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(true);
  const [previewState, setPreviewState] = useState<{ busy: boolean; url: string | null; error: string | null; remaining: number | null }>({
    busy: false,
    url: null,
    error: null,
    remaining: null,
  });
  const logListRef = useRef<HTMLUListElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Opening the window starts or resumes the process (unless it is waiting for the participant).
  useEffect(() => {
    if (!open) return;
    if (phase === 'idle' || phase === 'pending') void activation.run();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll only the activity list (scrollIntoView would also move the whole window and hide the
  // recording controls under the fixed progress header).
  useEffect(() => {
    const el = logListRef.current;
    if (open && showLog && el) el.scrollTop = el.scrollHeight;
  }, [log.length, open, showLog]);

  useEffect(() => () => {
    if (previewState.url) URL.revokeObjectURL(previewState.url);
  }, [previewState.url]);

  if (!open) return null;

  const pct = progress.percent;
  const guidance = phase === 'error' ? voiceErrorGuidance(error?.category) : null;
  const done = phase === 'ready';
  const barColor = phase === 'error' ? 'bg-rose-500' : done ? 'bg-emerald-600' : 'bg-amber-600';

  const playPreview = async () => {
    setPreviewState((s) => ({ ...s, busy: true, error: null }));
    try {
      const r = await activation.preview();
      const bytes = Uint8Array.from(atob(r.audioBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mimeType }));
      setPreviewState({ busy: false, url, error: null, remaining: r.remainingToday });
      window.setTimeout(() => audioRef.current?.play().catch(() => undefined), 50);
    } catch (err: any) {
      setPreviewState((s) => ({ ...s, busy: false, error: err?.message || 'No pudimos reproducir tu voz.' }));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-wizard-title"
    >
      <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 space-y-4 max-h-[92vh] overflow-y-auto text-xs">
        {/* Title and progress stay visible while scrolling (e.g. while reading the sample text). */}
        <div className="sticky -top-6 z-10 -mx-6 -mt-6 px-6 pt-6 pb-3 bg-white border-b border-stone-100 space-y-3" data-testid="voice-progress-header">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="voice-wizard-title" className="font-serif text-lg font-bold text-stone-900">
              Activar mi voz
            </h3>
            <p className="text-xs text-stone-600 mt-0.5">Tu familia podrá conversar con tu representación en Mi Esencia escuchando tu propia voz.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress */}
        <div className="space-y-2" data-testid="voice-progress">
          <div className="flex items-end justify-between gap-2">
            <p className={`text-sm font-semibold ${phase === 'error' ? 'text-rose-800' : done ? 'text-emerald-800' : 'text-stone-900'}`} role="status">
              {phase === 'error' && guidance ? guidance.title : HEADLINES[phase]}
            </p>
            <span className="font-mono text-lg font-bold text-stone-900 tabular-nums" data-testid="voice-progress-percent">
              {pct}%
            </span>
          </div>
          <div
            className="h-3 rounded-full bg-stone-200 overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Avance de la activación de tu voz"
          >
            <div className={`h-full ${barColor} transition-[width] duration-500 ${running ? 'animate-pulse' : ''}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        </div>

        {/* Steps */}
        <ol className="space-y-1.5" data-testid="voice-steps">
          {progress.steps.map((s) => (
            <li key={s.key} className="flex items-start gap-2" data-step={s.key} data-state={s.state}>
              <span className="mt-px">
                <StepIcon state={s.state} />
              </span>
              <span className={`flex-1 ${s.state === 'pendiente' ? 'text-stone-400' : 'text-stone-800'}`}>
                <span className={s.state === 'en_curso' || s.state === 'espera' ? 'font-semibold' : ''}>{s.label}</span>
                {s.detail && <span className="text-stone-500"> · {s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>

        {/* Phase panel */}
        {phase === 'consent' && (
          <div className="space-y-3 p-3 rounded-lg border border-stone-200 bg-stone-50">
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
              Usaremos copias de tus grabaciones en las que se escucha tu voz con claridad; tus grabaciones originales no se modifican.
            </p>
            <button
              type="button"
              disabled={!consentChecked}
              onClick={() => void activation.authorize('portal')}
              className="w-full py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold disabled:opacity-50"
            >
              Confirmar autorización y empezar
            </button>
          </div>
        )}

        {running && (
          <p className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
            Puedes cerrar esta ventana: el proceso seguirá mientras esta página esté abierta y verás el avance en el botón «Activar mi voz». Si cierras
            la página, continuará donde se quedó la próxima vez que entres.
          </p>
        )}

        {(phase === 'needs_sample' || phase === 'checking_sample') && (
          <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/60 space-y-2">
            {view?.analysis && (
              <p className="text-stone-700">
                Revisamos {view.analysis.reviewedRecordings ?? 0}
                {typeof view.analysis.totalRecordings === 'number' ? ` de tus ${view.analysis.totalRecordings}` : ''} grabaciones y reunimos{' '}
                <strong>{Math.round(view.analysis.usableSpeechSeconds)} s</strong> de voz clara; necesitamos al menos 60 s.
              </p>
            )}
            {micError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 space-y-1" role="alert">
                <p className="font-semibold">{voiceErrorGuidance('microfono').title}</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {voiceErrorGuidance('microfono').whatToDo.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            <VoiceSampleRecorder
              disabled={phase === 'checking_sample'}
              feedback={activation.sampleFeedback}
              onMicError={(m) => {
                setMicError(m);
                activation.note(m, 'error');
              }}
              onSubmit={(blob, seconds) => {
                setMicError(null);
                void activation.submitSample(blob, seconds);
              }}
            />
          </div>
        )}

        {phase === 'pvc_link' && (
          <div className="space-y-2 p-3 rounded-lg border border-stone-200 bg-stone-50" data-testid="voice-pvc-link">
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
              className="w-full p-2 border border-stone-300 rounded-lg"
            />
            <button
              type="button"
              disabled={!shareLink.trim()}
              onClick={() => void activation.linkProfessional(shareLink)}
              className="w-full py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold disabled:opacity-50"
            >
              Vincular mi voz
            </button>
          </div>
        )}

        {done && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-2.5" data-testid="voice-success">
            <p className="flex items-start gap-2 text-sm font-semibold">
              <CheckCircle2 className="w-5 h-5 shrink-0" /> ¡Listo! Tu voz se creó y se comprobó correctamente.
            </p>
            <p>Tus familiares ya pueden activar la conversación de viva voz en Mi Esencia. No necesitas hacer nada más.</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={playPreview}
                disabled={previewState.busy}
                data-testid="voice-preview-button"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold disabled:opacity-60"
              >
                {previewState.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                Escuchar mi voz
              </button>
              {previewState.remaining !== null && (
                <span className="text-[11px] text-emerald-800">
                  {previewState.remaining === 0
                    ? 'Ya no quedan más escuchas por hoy.'
                    : `Puedes escucharla ${previewState.remaining} ${previewState.remaining === 1 ? 'vez' : 'veces'} más hoy.`}
                </span>
              )}
            </div>
            {previewState.url && <audio ref={audioRef} controls src={previewState.url} className="w-full" data-testid="voice-preview-audio" />}
            {previewState.error && <p className="text-rose-700">{previewState.error}</p>}
          </div>
        )}

        {phase === 'pending' && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 space-y-2">
            <p>
              Tu voz ya se creó, pero el servicio de voz todavía no confirma que pueda usarse. Suele resolverse en unos minutos; la volveremos a
              comprobar cada vez que abras esta ventana.
            </p>
            <button
              type="button"
              onClick={() => void activation.run()}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-amber-300 bg-white rounded-lg font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Comprobar ahora
            </button>
          </div>
        )}

        {phase === 'error' && guidance && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-950 space-y-2" role="alert" data-testid="voice-error">
            <p className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>
                <strong>Qué pasó:</strong> {guidance.whatHappened}
                {error?.message && error.message !== guidance.whatHappened && (
                  <span className="block text-[11px] text-rose-700 mt-0.5">Detalle: {error.message}</span>
                )}
              </span>
            </p>
            <div>
              <p className="font-semibold">Qué puedes hacer:</p>
              <ol className="list-decimal pl-5 space-y-0.5 mt-0.5">
                {guidance.whatToDo.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            </div>
            {activation.supportCode && (
              <p className="text-[11px]">
                Código de soporte: <span className="font-mono font-semibold select-all" data-testid="voice-support-code">{activation.supportCode}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {guidance.primaryAction === 'record' ? (
                <button
                  type="button"
                  onClick={activation.recordAgain}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-stone-900 text-white rounded-lg font-semibold"
                >
                  <Mic className="w-3.5 h-3.5" /> Grabar otra muestra
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void activation.run({ retry: true })}
                data-testid="voice-retry"
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold ${
                  guidance.primaryAction === 'retry' ? 'bg-amber-700 hover:bg-amber-800 text-white' : 'border border-stone-300 bg-white text-stone-800'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reintentar
              </button>
            </div>
          </div>
        )}

        {/* Activity log */}
        {log.length > 0 && (
          <div className="border border-stone-200 rounded-lg">
            <button
              type="button"
              onClick={() => setShowLog((s) => !s)}
              className="w-full flex items-center justify-between px-3 py-2 font-semibold text-stone-700"
              aria-expanded={showLog}
            >
              Detalle del proceso
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showLog ? 'rotate-180' : ''}`} />
            </button>
            {showLog && (
              <ul ref={logListRef} className="max-h-36 overflow-y-auto px-3 pb-2 space-y-1 font-mono text-[11px]" data-testid="voice-activity-log">
                {log.map((e, i) => (
                  <li
                    key={i}
                    className={
                      e.tone === 'error' ? 'text-rose-700' : e.tone === 'warn' ? 'text-amber-800' : e.tone === 'ok' ? 'text-emerald-800' : 'text-stone-600'
                    }
                  >
                    <span className="text-stone-400">{hhmmss(e.at)}</span> {e.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="pt-1 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg font-medium">
            {done ? 'Listo' : running ? 'Seguir en segundo plano' : 'Cerrar'}
          </button>
        </div>
      </div>
    </div>
  );
};
