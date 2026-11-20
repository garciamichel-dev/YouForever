/**
 * V5.9.0 — Panel de Administración › «Cuota diaria de mensajes de voz» de un participante
 * (junto a «Libro PDF y Cuota de Edición»): valor particular o regreso al valor global.
 */
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/apiClient.ts';
import { VOICE_STATUS_LABELS } from '../../logic/voiceCloningRules.ts';

interface InterviewVoiceStatus {
  profiles: Array<{ profileId: string; participantName: string; mode: 'ivc' | 'pvc'; status: keyof typeof VOICE_STATUS_LABELS; requirementPending?: string | null }>;
  quota: { limit: number; used: number; reserved: number; remaining: number; usesGlobal: boolean };
  override: number | null;
}

export const VoiceQuotaInlineControl: React.FC<{ interviewId: string; interviewTitle?: string }> = ({ interviewId, interviewTitle }) => {
  const [data, setData] = useState<InterviewVoiceStatus | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    const res = await apiFetch<InterviewVoiceStatus>('/api/voice/admin/interview-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewId }),
    });
    if (res.ok && res.data) {
      setData(res.data);
      setDraft(String(res.data.override ?? res.data.quota.limit));
    }
  };

  useEffect(() => {
    void load();
  }, [interviewId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveValue = async (dailyLimit: number | null) => {
    setSaving(true);
    setError(null);
    const res = await apiFetch('/api/voice/admin/quota-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewId, dailyLimit }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error || 'No se pudo guardar.');
      return;
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
    await load();
  };

  if (!data) return null;
  return (
    <div data-testid={`voice-quota-${interviewId}`}>
      <span className="text-stone-500 block">Cuota diaria de mensajes de voz:</span>
      <div className="flex flex-wrap items-center gap-1.5 mt-0.5 tabular-nums">
        <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-900 border border-sky-200 font-semibold text-[11px]">
          Hoy: {data.quota.used} de {data.quota.limit}
        </span>
        <span className="text-[11px] text-stone-600">{data.quota.usesGlobal ? 'Valor global' : 'Valor particular'}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
        <label htmlFor={`voice-quota-input-${interviewId}`} className="sr-only">
          Cuota diaria de mensajes de voz para {interviewTitle || interviewId}
        </label>
        <input
          id={`voice-quota-input-${interviewId}`}
          type="number"
          min={0}
          max={1000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-16 px-1.5 py-0.5 border border-stone-300 rounded text-xs font-bold text-stone-900 text-center tabular-nums bg-white"
        />
        <button
          type="button"
          disabled={saving || draft === ''}
          onClick={() => saveValue(Math.max(0, parseInt(draft, 10) || 0))}
          className="px-2 py-0.5 bg-sky-700 hover:bg-sky-800 text-white rounded text-[11px] font-semibold transition disabled:opacity-50"
        >
          {saved ? '¡Guardada!' : 'Guardar'}
        </button>
        {!data.quota.usesGlobal && (
          <button
            type="button"
            disabled={saving}
            onClick={() => saveValue(null)}
            className="px-2 py-0.5 border border-stone-300 text-stone-700 rounded text-[11px] font-semibold hover:bg-stone-100 disabled:opacity-50"
          >
            Usar valor global
          </button>
        )}
      </div>
      {data.profiles.length > 0 && (
        <div className="mt-1 text-[11px] text-stone-600 space-y-0.5">
          {data.profiles.map((p) => (
            <div key={p.profileId}>
              Voz de {p.participantName}: {p.mode.toUpperCase()} · {VOICE_STATUS_LABELS[p.status] || p.status}
              {p.requirementPending ? <span className="text-amber-800"> — {p.requirementPending}</span> : null}
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-[11px] text-rose-700 mt-0.5">{error}</p>}
    </div>
  );
};
