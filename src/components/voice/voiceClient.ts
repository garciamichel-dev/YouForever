/**
 * V5.9.0 — Llamadas del navegador a /api/voice/* (la clave de ElevenLabs nunca sale del servidor).
 */
export type VoiceStatus = 'sin_configurar' | 'en_proceso' | 'pendiente_verificacion' | 'lista' | 'error';

export interface ParticipantVoiceView {
  exists: boolean;
  status: VoiceStatus;
  mode: 'ivc' | 'pvc';
  authorized: boolean;
  inProgress: boolean;
  ready: boolean;
  lastError: string | null;
  analysis: {
    sufficient: boolean;
    usableSpeechSeconds: number;
    usableRecordings: number;
    rejected: Array<{ reason: string; label: string }>;
    /** Recordings that could not be checked because of a temporary failure; they are retried. */
    retryPending?: number;
  } | null;
  extraSamples: number;
  consentText: string;
  recordingsAvailable?: number;
  serviceConfigured?: boolean;
  duplicatePrevented?: boolean;
  sample?: { usable: boolean; reason: string | null; speechSeconds: number };
}

export class VoiceApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function voicePost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/voice${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new VoiceApiError(json?.error || 'No fue posible completar la operación de voz.', res.status, json?.code);
  }
  return json.data as T;
}

export async function voiceGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/voice${path}`, { credentials: 'same-origin' });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new VoiceApiError(json?.error || 'Error del servicio de voz.', res.status, json?.code);
  return json.data as T;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]+,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function pickRecorderMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export function newTurnId(): string {
  const rnd =
    typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function'
      ? (crypto as any).randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `turn_${rnd}`.slice(0, 60);
}
