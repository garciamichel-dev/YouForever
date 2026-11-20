/**
 * V5.9.3 — Controlador de «Activar mi voz».
 *
 * Vive en el Portal del Participante (no en la ventana), así que el proceso sigue aunque la ventana
 * se cierre: el botón «Activar mi voz» muestra el porcentaje y, al terminar, el portal avisa del
 * resultado. Si se cierra la página, todo lo hecho queda guardado en el servidor y se reanuda donde
 * iba la próxima vez que se abre «Activar mi voz».
 *
 * Flujo automático: autorización → revisión de grabaciones (en tandas, con avance real) → muestra
 * adicional sólo si hace falta (es la única pausa) → creación de la voz → comprobación → lista.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activationProgress,
  TARGET_CLEAR_VOICE_SECONDS,
  type ActivationPhase,
  type VoiceErrorCategory,
} from '../../logic/voiceActivationProgress.ts';
import { blobToBase64, voicePost, VoiceApiError, type ParticipantVoiceView } from './voiceClient.ts';

/** Grabaciones revisadas por solicitud (para mostrar avance real sin esperar a que terminen todas). */
const REVIEW_BATCH = 3;
/** Tope de tandas por ejecución (las fallas temporales se reintentan sólo 3 veces cada una). */
const MAX_REVIEW_ROUNDS = 60;
/** Must match MAX_EXTRA_SAMPLE_BASE64 on the server (one Firestore document). */
export const MAX_SAMPLE_BASE64 = 900_000;
const POLL_MS = 3000;
/** Tope de espera mientras otra pestaña o intento crea la voz (el bloqueo del servidor dura 4 min). */
const MAX_POLL_MS = 5 * 60 * 1000;

export interface ActivationError {
  category: VoiceErrorCategory;
  message: string;
  /** Etapa en la que ocurrió. */
  failedAt: ActivationPhase;
}

export interface ActivityEntry {
  at: number;
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
}

export interface SampleFeedback {
  usable: boolean;
  reason: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorFrom(err: unknown): { category: VoiceErrorCategory; message: string } {
  if (err instanceof VoiceApiError) {
    return { category: err.category || (err.status >= 500 ? 'temporal' : 'otro'), message: err.message };
  }
  // fetch() rejects with a TypeError when there is no connection.
  if (err instanceof TypeError) return { category: 'temporal', message: 'No hay conexión con el servidor.' };
  return { category: 'otro', message: (err as any)?.message || 'Ocurrió un error inesperado.' };
}

/** Quedan grabaciones por revisar y todavía no se reunió la voz clara deseada. */
export function needsReview(v: ParticipantVoiceView): boolean {
  if (!v.analysis) return true;
  const pending = (v.analysis.unreviewedRecordings || 0) + (v.analysis.retryPending || 0);
  return pending > 0 && v.analysis.usableSpeechSeconds < TARGET_CLEAR_VOICE_SECONDS;
}

export function useVoiceActivation(token: string, enabled: boolean) {
  const [view, setView] = useState<ParticipantVoiceView | null>(null);
  const [phase, setPhase] = useState<ActivationPhase>('idle');
  const [phaseStartedAt, setPhaseStartedAt] = useState(Date.now());
  const [error, setError] = useState<ActivationError | null>(null);
  const [log, setLog] = useState<ActivityEntry[]>([]);
  const [sampleFeedback, setSampleFeedback] = useState<SampleFeedback | null>(null);
  const [now, setNow] = useState(Date.now());
  const runningRef = useRef(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const phaseRef = useRef<ActivationPhase>('idle');
  const viewRef = useRef<ParticipantVoiceView | null>(null);

  const enter = useCallback((p: ActivationPhase) => {
    phaseRef.current = p;
    setPhase(p);
    setPhaseStartedAt(Date.now());
  }, []);

  const apply = useCallback((v: ParticipantVoiceView) => {
    const merged = { ...(viewRef.current || {}), ...v } as ParticipantVoiceView;
    if (v.serviceConfigured === undefined && viewRef.current?.serviceConfigured !== undefined) {
      merged.serviceConfigured = viewRef.current.serviceConfigured;
    }
    viewRef.current = merged;
    setView(merged);
    return merged;
  }, []);

  const note = useCallback((text: string, tone: ActivityEntry['tone'] = 'info') => {
    setLog((l) => [...l.slice(-40), { at: Date.now(), text, tone }]);
  }, []);

  const fail = useCallback(
    (category: VoiceErrorCategory, message: string) => {
      const failedAt = phaseRef.current === 'error' ? 'loading' : phaseRef.current;
      setError({ category, message, failedAt });
      note(message, 'error');
      enter('error');
    },
    [enter, note]
  );

  // Silent status load (the header button needs it); no phase change.
  const refreshStatus = useCallback(async () => {
    const v = await voicePost<ParticipantVoiceView>('/participant/status', { token: tokenRef.current });
    return apply(v);
  }, [apply]);

  useEffect(() => {
    if (!enabled || !token) return;
    let cancelled = false;
    voicePost<ParticipantVoiceView>('/participant/status', { token })
      .then((v) => !cancelled && apply(v))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, token, apply]);

  // Ticks while waiting on ElevenLabs, so the bar keeps moving.
  useEffect(() => {
    if (!['creating', 'verifying', 'checking_sample', 'linking'].includes(phase)) return;
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, [phase]);

  const waitWhileInProgress = useCallback(async () => {
    const started = Date.now();
    let v = viewRef.current!;
    while (v.inProgress && Date.now() - started < MAX_POLL_MS) {
      await sleep(POLL_MS);
      v = await refreshStatus();
    }
    return v;
  }, [refreshStatus]);

  const verify = useCallback(async () => {
    enter('verifying');
    note('Comprobando que tu voz funciona…');
    const v = apply(await voicePost<ParticipantVoiceView>('/participant/recheck', { token: tokenRef.current }));
    if (v.ready) {
      enter('ready');
      note('¡Tu voz está lista!', 'ok');
      return;
    }
    if (v.verificationError) {
      fail(v.verificationErrorCategory || 'temporal', v.verificationError);
      return;
    }
    enter('pending');
    note('La voz se creó, pero todavía falta una comprobación del servicio de voz.', 'warn');
  }, [apply, enter, fail, note]);

  const create = useCallback(async () => {
    enter('creating');
    note('Creando tu voz con el servicio de voz (suele tardar menos de un minuto)…');
    let v = apply(await voicePost<ParticipantVoiceView>('/participant/create-instant', { token: tokenRef.current, verify: false }));
    if (v.inProgress) {
      note('Ya había un intento en curso; esperamos a que termine.');
      v = await waitWhileInProgress();
    }
    if (v.ready) {
      enter('ready');
      note('¡Tu voz está lista!', 'ok');
      return;
    }
    if (v.status === 'error') {
      fail(v.errorCategory || 'otro', v.lastError || 'No se pudo crear tu voz.');
      return;
    }
    if (v.status === 'pendiente_verificacion') {
      note('Tu voz se creó.', 'ok');
      await verify();
      return;
    }
    fail('temporal', 'El servicio de voz tardó demasiado en responder.');
  }, [apply, enter, fail, note, verify, waitWhileInProgress]);

  const review = useCallback(async () => {
    let v = viewRef.current!;
    if (!needsReview(v)) return v;
    enter('reviewing');
    const total = v.analysis?.totalRecordings ?? v.recordingsAvailable ?? null;
    note(
      total
        ? `Revisando tus grabaciones de la entrevista (${total} con voz)…`
        : 'Buscando grabaciones con tu voz en la entrevista…'
    );
    for (let round = 0; round < MAX_REVIEW_ROUNDS && needsReview(v); round++) {
      const before = v.analysis;
      v = apply(
        await voicePost<ParticipantVoiceView>('/participant/analyze', { token: tokenRef.current, maxRecordings: REVIEW_BATCH })
      );
      const a = v.analysis;
      if (!a) break;
      const gained = Math.round(a.usableSpeechSeconds - (before?.usableSpeechSeconds || 0));
      note(
        `${typeof a.totalRecordings === 'number' ? `Revisadas ${a.reviewedRecordings ?? 0} de ${a.totalRecordings}` : 'Revisión'}` +
          ` · ${Math.round(a.usableSpeechSeconds)} s de voz clara${gained > 0 ? ` (+${gained} s)` : ''}` +
          `${a.retryPending ? ` · ${a.retryPending} por reintentar` : ''}`,
        gained > 0 ? 'ok' : 'info'
      );
      // Nothing new could be reviewed in this round (e.g. only retries left that keep failing).
      if (
        before &&
        a.reviewedRecordings === before.reviewedRecordings &&
        a.usableSpeechSeconds === before.usableSpeechSeconds &&
        (a.retryPending || 0) >= (before.retryPending || 0) &&
        (a.unreviewedRecordings || 0) >= (before.unreviewedRecordings || 0)
      ) {
        break;
      }
    }
    const a = v.analysis;
    if (a && a.totalRecordings === 0) note('Tu entrevista no tiene grabaciones de voz que podamos usar.', 'warn');
    else if (a?.rejected.length) {
      const reasons = Array.from(new Set(a.rejected.map((r) => r.label))).join('; ');
      note(`No usamos ${a.rejected.length} grabación(es): ${reasons}.`, 'warn');
    }
    return v;
  }, [apply, enter, note]);

  /** Ejecuta (o reanuda) todo el proceso hasta que termina o necesita algo del participante. */
  const run = useCallback(
    async (opts: { retry?: boolean } = {}) => {
      if (runningRef.current || !tokenRef.current) return;
      runningRef.current = true;
      setError(null);
      try {
        if (!viewRef.current || phaseRef.current === 'idle' || phaseRef.current === 'error') enter('loading');
        let v = await refreshStatus();
        if (v.serviceConfigured === false) {
          fail('configuracion', 'El servicio de voz no está configurado en el servidor.');
          return;
        }
        if (!v.authorized) {
          enter('consent');
          return;
        }
        if (v.ready) {
          enter('ready');
          return;
        }
        if (v.inProgress) {
          enter('creating');
          note('Tu voz se está creando; seguimos esperando la respuesta.');
          v = await waitWhileInProgress();
          if (v.ready) {
            enter('ready');
            note('¡Tu voz está lista!', 'ok');
            return;
          }
        }
        if (v.mode === 'pvc') {
          if (v.status === 'pendiente_verificacion') await verify();
          else if (v.status === 'error' && !opts.retry) fail(v.errorCategory || 'otro', v.lastError || 'No se pudo vincular tu voz.');
          else enter('pvc_link');
          return;
        }
        if (v.status === 'pendiente_verificacion') {
          await verify();
          return;
        }
        if (v.status === 'error' && !opts.retry) {
          // Show the saved outcome; the participant decides when to retry.
          setError({ category: v.errorCategory || 'otro', message: v.lastError || 'No se pudo crear tu voz.', failedAt: 'creating' });
          enter('error');
          return;
        }
        v = await review();
        if (!v.analysis?.sufficient) {
          enter('needs_sample');
          note(
            `Reunimos ${Math.round(v.analysis?.usableSpeechSeconds || 0)} s de voz clara; necesitamos al menos 60 s. Graba una muestra adicional para continuar.`,
            'warn'
          );
          return;
        }
        note('Tenemos suficiente voz clara para crear tu voz.', 'ok');
        await create();
      } catch (err) {
        const e = errorFrom(err);
        fail(e.category, e.message);
      } finally {
        runningRef.current = false;
      }
    },
    [create, enter, fail, note, refreshStatus, review, verify, waitWhileInProgress]
  );

  const authorize = useCallback(
    async (source: 'portal' | 'finalizar_entrevista' = 'portal') => {
      try {
        await voicePost('/participant/authorize', { token: tokenRef.current, source });
        note('Autorización guardada.', 'ok');
      } catch (err) {
        const e = errorFrom(err);
        fail(e.category, e.message);
        return;
      }
      await run();
    },
    [fail, note, run]
  );

  const submitSample = useCallback(
    async (blob: Blob, seconds: number) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setSampleFeedback(null);
      enter('checking_sample');
      note(`Revisando tu muestra de ${seconds} s…`);
      let ok = false;
      try {
        const audioBase64 = await blobToBase64(blob);
        if (audioBase64.length > MAX_SAMPLE_BASE64) {
          throw new VoiceApiError('La muestra quedó demasiado pesada. Grábala de nuevo con una duración de 30 a 90 segundos.', 400, 'sample_too_large', 'muestras');
        }
        const v = apply(
          await voicePost<ParticipantVoiceView>('/participant/extra-sample', {
            token: tokenRef.current,
            audioBase64,
            mimeType: blob.type || 'audio/webm',
            durationSeconds: seconds,
          })
        );
        const usable = Boolean(v.sample?.usable);
        setSampleFeedback({ usable, reason: v.sample?.reason || null });
        if (usable) {
          note(`Muestra aceptada (${Math.round(v.sample?.speechSeconds || 0)} s de voz clara).`, 'ok');
          ok = true;
        } else {
          note(`La muestra no sirvió: ${v.sample?.reason || 'no se pudo analizar'}.`, 'warn');
          enter('needs_sample');
        }
      } catch (err) {
        const e = errorFrom(err);
        setSampleFeedback({ usable: false, reason: e.message });
        note(`No pudimos revisar tu muestra: ${e.message}`, 'warn');
        if (e.category === 'configuracion' || e.category === 'cuenta') fail(e.category, e.message);
        else enter('needs_sample');
      } finally {
        runningRef.current = false;
      }
      // The saved error (if any) is superseded by the new sample: continue as a retry.
      if (ok) await run({ retry: true });
    },
    [apply, enter, fail, note, run]
  );

  const linkProfessional = useCallback(
    async (shareLink: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      enter('linking');
      note('Vinculando tu voz profesional…');
      try {
        const v = apply(await voicePost<ParticipantVoiceView>('/participant/link-professional', { token: tokenRef.current, shareLink }));
        if (v.ready) {
          enter('ready');
          note('¡Tu voz está lista!', 'ok');
        } else if (v.status === 'pendiente_verificacion') {
          enter('pending');
          note('Tu voz se vinculó, pero todavía falta una comprobación.', 'warn');
        } else if (v.status === 'error') {
          fail(v.errorCategory || 'otro', v.lastError || 'No se pudo vincular tu voz.');
        }
      } catch (err) {
        const e = errorFrom(err);
        if (e.category === 'otro') {
          // Invalid link and similar: let the participant correct it.
          note(e.message, 'warn');
          enter('pvc_link');
        } else fail(e.category, e.message);
      } finally {
        runningRef.current = false;
      }
    },
    [apply, enter, fail, note]
  );

  /** Lleva a la grabación de una muestra nueva (por ejemplo, tras un error con las muestras). */
  const recordAgain = useCallback(() => {
    setError(null);
    setSampleFeedback(null);
    enter('needs_sample');
  }, [enter]);

  const preview = useCallback(async () => {
    return voicePost<{ audioBase64: string; mimeType: string; remainingToday: number; text: string }>('/participant/preview', {
      token: tokenRef.current,
    });
  }, []);

  const progress = useMemo(
    () => activationProgress({ phase, view, phaseElapsedMs: now - phaseStartedAt, failedAt: error?.failedAt || null }),
    [phase, view, now, phaseStartedAt, error]
  );

  const running = ['loading', 'reviewing', 'checking_sample', 'creating', 'verifying', 'linking'].includes(phase);

  return {
    view,
    phase,
    error,
    log,
    progress,
    running,
    sampleFeedback,
    supportCode: view?.supportCode || null,
    run,
    authorize,
    submitSample,
    linkProfessional,
    recordAgain,
    preview,
    refreshStatus,
    note,
  };
}

export type VoiceActivation = ReturnType<typeof useVoiceActivation>;
