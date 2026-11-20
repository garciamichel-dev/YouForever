/**
 * V5.9.3 — Progreso de «Activar mi voz» y guía de errores para el participante (lógica pura).
 *
 * El porcentaje se calcula con lo que el servidor ya sabe (grabaciones revisadas, voz clara reunida,
 * estado del clon) y con la etapa en curso del navegador. Sólo la creación de la voz en ElevenLabs no
 * informa avance propio: ahí la barra avanza con el tiempo transcurrido y nunca llega al final hasta
 * que el servidor responde.
 */

export type ActivationPhase =
  | 'idle'
  | 'loading'
  | 'consent'
  | 'reviewing'
  | 'needs_sample'
  | 'checking_sample'
  | 'creating'
  | 'verifying'
  | 'ready'
  | 'pending'
  | 'pvc_link'
  | 'linking'
  | 'error';

export type VoiceErrorCategory = 'configuracion' | 'cuenta' | 'temporal' | 'muestras' | 'microfono' | 'otro';

export type ActivationStepState = 'pendiente' | 'en_curso' | 'listo' | 'omitido' | 'espera' | 'error';

export interface ActivationStep {
  key: 'autorizacion' | 'revision' | 'muestra' | 'creacion' | 'comprobacion' | 'vinculacion';
  label: string;
  state: ActivationStepState;
  detail?: string;
}

/** Lo mínimo de la vista del participante que necesita el cálculo. */
export interface ActivationViewLike {
  authorized?: boolean;
  ready?: boolean;
  mode?: 'ivc' | 'pvc';
  status?: string;
  extraSamples?: number;
  analysis?: {
    sufficient: boolean;
    usableSpeechSeconds: number;
    usableRecordings: number;
    reviewedRecordings?: number | null;
    totalRecordings?: number | null;
    unreviewedRecordings?: number;
    retryPending?: number;
  } | null;
}

/** Voz clara con la que la revisión se da por terminada (ElevenLabs recomienda 1–2 min). */
export const TARGET_CLEAR_VOICE_SECONDS = 120;
/** Tiempo típico de creación de un clon instantáneo, para animar la barra mientras se espera. */
export const EXPECTED_CREATION_MS = 20_000;

const BANDS = {
  authorized: 10,
  reviewEnd: 60,
  sampleEnd: 70,
  creationEnd: 90,
  verificationEnd: 99,
};

/** Fracción revisada: grabaciones revisadas o voz clara reunida, lo que vaya más adelante. */
export function reviewFraction(view: ActivationViewLike): number {
  const a = view.analysis;
  if (!a) return 0;
  const pending = (a.unreviewedRecordings || 0) + (a.retryPending || 0);
  if (pending === 0) return 1;
  const total = a.totalRecordings || 0;
  const byRecordings = total > 0 ? Math.min(1, (a.reviewedRecordings || 0) / total) : 0;
  const byVoice = Math.min(1, (a.usableSpeechSeconds || 0) / TARGET_CLEAR_VOICE_SECONDS);
  return Math.max(byRecordings, byVoice);
}

/** Avance que tiende a 1 sin alcanzarlo mientras no haya respuesta. */
export function waitingFraction(elapsedMs: number, expectedMs: number = EXPECTED_CREATION_MS): number {
  if (!(elapsedMs > 0)) return 0;
  return Math.min(0.95, 1 - Math.exp(-elapsedMs / expectedMs));
}

const fmtSeconds = (s: number) => `${Math.round(s)} s`;

export interface ActivationProgressInput {
  phase: ActivationPhase;
  view: ActivationViewLike | null;
  /** Milisegundos desde que empezó la etapa en curso (para la creación y la comprobación). */
  phaseElapsedMs?: number;
  /** Etapa en la que ocurrió el error (para marcarla y conservar el porcentaje). */
  failedAt?: ActivationPhase | null;
}

export interface ActivationProgress {
  percent: number;
  steps: ActivationStep[];
}

export function activationProgress(input: ActivationProgressInput): ActivationProgress {
  const { view, phaseElapsedMs = 0 } = input;
  const phase = input.phase === 'error' ? input.failedAt || 'error' : input.phase;
  const isError = input.phase === 'error';
  const authorized = Boolean(view?.authorized);
  const ready = Boolean(view?.ready) || phase === 'ready';
  const mode = view?.mode || 'ivc';

  if (mode === 'pvc') {
    const linked = ready || phase === 'pending' || phase === 'verifying';
    const steps: ActivationStep[] = [
      { key: 'autorizacion', label: 'Autorización', state: authorized ? 'listo' : phase === 'consent' ? 'espera' : 'pendiente' },
      {
        key: 'vinculacion',
        label: 'Vincular tu voz profesional',
        state: linked ? 'listo' : phase === 'linking' ? 'en_curso' : phase === 'pvc_link' ? 'espera' : 'pendiente',
      },
      {
        key: 'comprobacion',
        label: 'Comprobar que funciona',
        state: ready ? 'listo' : phase === 'verifying' ? 'en_curso' : phase === 'pending' ? 'espera' : 'pendiente',
      },
    ];
    let percent = !authorized ? 0 : ready ? 100 : linked ? 80 : phase === 'linking' ? 40 + 40 * waitingFraction(phaseElapsedMs) : 30;
    if (isError) markError(steps);
    return { percent: Math.round(percent), steps };
  }

  const a = view?.analysis || null;
  const reviewDone = Boolean(a) && reviewFraction(view!) >= 1;
  const sufficient = Boolean(a?.sufficient);
  const usedSample = (view?.extraSamples || 0) > 0;
  const created = ready || phase === 'verifying' || phase === 'pending' || view?.status === 'pendiente_verificacion';
  const afterReview = ['needs_sample', 'checking_sample', 'creating', 'verifying', 'pending', 'ready'].includes(phase);

  const steps: ActivationStep[] = [
    { key: 'autorizacion', label: 'Autorización', state: authorized ? 'listo' : phase === 'consent' ? 'espera' : 'pendiente' },
    {
      key: 'revision',
      label: 'Revisión de tus grabaciones',
      state: !authorized ? 'pendiente' : reviewDone || afterReview || ready ? 'listo' : phase === 'reviewing' ? 'en_curso' : 'pendiente',
      detail: a
        ? `${typeof a.totalRecordings === 'number' ? `${a.reviewedRecordings ?? 0} de ${a.totalRecordings} revisadas · ` : ''}${fmtSeconds(a.usableSpeechSeconds)} de voz clara`
        : undefined,
    },
    {
      key: 'muestra',
      label: 'Muestra adicional de voz',
      state:
        phase === 'needs_sample'
          ? 'espera'
          : phase === 'checking_sample'
          ? 'en_curso'
          : usedSample && sufficient
          ? 'listo'
          : (sufficient && (reviewDone || afterReview)) || ready
          ? 'omitido'
          : 'pendiente',
      detail:
        phase === 'needs_sample'
          ? 'Hace falta grabarla'
          : usedSample && sufficient
          ? 'Recibida'
          : (sufficient && (reviewDone || afterReview)) || ready
          ? 'No fue necesaria'
          : undefined,
    },
    {
      key: 'creacion',
      label: 'Creación de tu voz',
      state: created ? 'listo' : phase === 'creating' ? 'en_curso' : 'pendiente',
    },
    {
      key: 'comprobacion',
      label: 'Comprobación',
      state: ready ? 'listo' : phase === 'verifying' ? 'en_curso' : phase === 'pending' ? 'espera' : 'pendiente',
    },
  ];

  let percent = 0;
  if (ready) percent = 100;
  else if (!authorized) percent = 0;
  else if (phase === 'verifying' || phase === 'pending') {
    percent = BANDS.creationEnd + (BANDS.verificationEnd - BANDS.creationEnd) * (phase === 'pending' ? 0.5 : waitingFraction(phaseElapsedMs, 8_000));
  } else if (phase === 'creating') {
    percent = BANDS.sampleEnd + (BANDS.creationEnd - BANDS.sampleEnd) * waitingFraction(phaseElapsedMs);
  } else if (phase === 'needs_sample') {
    percent = BANDS.reviewEnd;
  } else if (phase === 'checking_sample') {
    percent = BANDS.reviewEnd + (BANDS.sampleEnd - BANDS.reviewEnd) * waitingFraction(phaseElapsedMs, 10_000);
  } else {
    percent = BANDS.authorized + (BANDS.reviewEnd - BANDS.authorized) * reviewFraction(view || {});
  }

  if (isError) markError(steps);
  return { percent: Math.max(0, Math.min(100, Math.round(percent))), steps };
}

/** La etapa en curso (o la siguiente pendiente) se marca con error. */
function markError(steps: ActivationStep[]) {
  const current = steps.find((s) => s.state === 'en_curso') || steps.find((s) => s.state === 'pendiente' || s.state === 'espera');
  if (current) current.state = 'error';
}

export interface VoiceErrorGuidance {
  title: string;
  whatHappened: string;
  whatToDo: string[];
  /** Acción principal sugerida. */
  primaryAction: 'retry' | 'record' | 'close';
}

export function voiceErrorGuidance(category: VoiceErrorCategory | null | undefined): VoiceErrorGuidance {
  switch (category) {
    case 'configuracion':
      return {
        title: 'El servicio de voz no está disponible',
        whatHappened: 'El servicio de voz de YouForever no está configurado correctamente en este momento.',
        whatToDo: [
          'No necesitas grabar nada más: tu autorización y tus grabaciones quedan guardadas.',
          'Avísale al equipo de YouForever y comparte el código de soporte que aparece abajo.',
          'Cuando te confirmen que está resuelto, vuelve a «Activar mi voz» y presiona «Reintentar».',
        ],
        primaryAction: 'close',
      };
    case 'cuenta':
      return {
        title: 'Se alcanzó un límite del servicio de voz',
        whatHappened: 'La cuenta de voz de YouForever llegó a un límite de su plan (créditos o número de voces).',
        whatToDo: [
          'No necesitas grabar nada más: tu autorización y tus grabaciones quedan guardadas.',
          'Avísale al equipo de YouForever y comparte el código de soporte que aparece abajo.',
          'Cuando te confirmen que está resuelto, vuelve a «Activar mi voz» y presiona «Reintentar».',
        ],
        primaryAction: 'close',
      };
    case 'temporal':
      return {
        title: 'Hubo un problema temporal',
        whatHappened: 'El servicio de voz no respondió a tiempo o se perdió la conexión.',
        whatToDo: [
          'Espera unos minutos y presiona «Reintentar»; continuaremos donde nos quedamos.',
          'Revisa que tu conexión a internet funcione.',
          'Si vuelve a pasar, avísale al equipo de YouForever con el código de soporte.',
        ],
        primaryAction: 'retry',
      };
    case 'muestras':
      return {
        title: 'Tus muestras de voz no se pudieron usar',
        whatHappened: 'El servicio de voz no aceptó las muestras para crear tu voz.',
        whatToDo: [
          'Graba una muestra nueva en un lugar tranquilo, sin otras voces, música ni televisión.',
          'Lee el texto completo con tu voz de siempre, sin prisa.',
        ],
        primaryAction: 'record',
      };
    case 'microfono':
      return {
        title: 'No pudimos usar tu micrófono',
        whatHappened: 'El navegador no nos dio acceso al micrófono o ninguna aplicación lo tiene disponible.',
        whatToDo: [
          'Permite el acceso al micrófono: toca el ícono del candado junto a la dirección de la página.',
          'Cierra otras aplicaciones que puedan estar usando el micrófono (videollamadas, grabadoras).',
          'Presiona «Volver a grabar».',
        ],
        primaryAction: 'record',
      };
    default:
      return {
        title: 'No pudimos terminar de activar tu voz',
        whatHappened: 'Ocurrió un error inesperado en el servicio de voz.',
        whatToDo: [
          'Presiona «Reintentar»; continuaremos donde nos quedamos.',
          'Si vuelve a pasar, avísale al equipo de YouForever con el código de soporte.',
        ],
        primaryAction: 'retry',
      };
  }
}

/** Código corto y estable para que el administrador encuentre la configuración de voz. */
export function voiceSupportCode(profileId: string): string {
  let h = 2166136261;
  for (let i = 0; i < profileId.length; i++) {
    h ^= profileId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `VZ-${(h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6)}`;
}
