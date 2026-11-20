/**
 * V5.9.0 — Configuración Global › Voz clonada (ElevenLabs).
 *
 * - «Tipo de clonación de ElevenLabs» (IVC por defecto): se aplica sólo a configuraciones nuevas.
 * - «Cuota diaria predeterminada de mensajes de voz» (30) y «Duración máxima por mensaje de voz»
 *   («Sin límite» por defecto), más el modelo de síntesis de las conversaciones.
 * - Plan de ElevenLabs (crear y mantener voces) separado del costo de conversar.
 * - Prueba comparativa con voces autorizadas: modalidades con el modelo fijo, y modelos con la
 *   misma voz y el mismo texto. Las pruebas no consumen la cuota de los familiares.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Mic, Play, Save } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient.ts';
import {
  DEFAULT_VOICE_SETTINGS,
  STT_ESTIMATED_USD_PER_HOUR,
  TTS_MODELS,
  TTS_RATE_SOURCE,
  VOICE_MODE_LABELS,
  VOICE_STATUS_LABELS,
  type VoiceGlobalSettings,
} from '../../logic/voiceCloningRules.ts';

interface AdminProfile {
  profileId: string;
  interviewId: string;
  participantName: string;
  status: keyof typeof VOICE_STATUS_LABELS;
  mode: 'ivc' | 'pvc';
  voiceId: string | null;
  requirementPending?: string | null;
  lastError?: string | null;
  consent?: { grantedAt: string };
  analysis?: { lastErrorDetail?: string | null; retryPendingAudioIds?: string[] } | null;
}

interface TestRun {
  runId: string;
  purpose: 'comparar_modalidades' | 'comparar_modelos';
  participantName: string;
  mode: 'ivc' | 'pvc';
  modelId: string;
  characters: number;
  audioSeconds: number;
  reportedCredits: number | null;
  estimatedUsd: number | null;
  estimatedUsdPerMinuteOfGeneratedAudio: number | null;
  rateUsdPer1kCharacters: number | null;
  costKind: 'reportado_por_elevenlabs' | 'estimado';
  createdAt: string;
}

interface AccountInfo {
  configured: boolean;
  subscription: null | {
    tier: string;
    status: string;
    characterCount: number | null;
    characterLimit: number | null;
    voiceSlotsUsed: number | null;
    voiceLimit: number | null;
    canUseInstantVoiceCloning: boolean;
    canUseProfessionalVoiceCloning: boolean;
  };
  requirements: string[];
}

const SAMPLE_TEXT = 'Hola, mi amor. Qué gusto escucharte. ¿Te acuerdas de las tardes en el patio, cuando hacíamos pan con canela?';
const usd = (n: number | null | undefined) => (typeof n === 'number' ? `US$${n.toFixed(5)}` : '—');
const modelLabel = (id: string) => TTS_MODELS.find((m) => m.id === id)?.label || id;

export const VoiceGlobalConfigSection: React.FC = () => {
  const [settings, setSettings] = useState<VoiceGlobalSettings>(DEFAULT_VOICE_SETTINGS);
  const [draft, setDraft] = useState<VoiceGlobalSettings>(DEFAULT_VOICE_SETTINGS);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Comparison test state (independent from the conversation settings).
  const [testText, setTestText] = useState(SAMPLE_TEXT);
  const [modeTestModel, setModeTestModel] = useState('eleven_multilingual_v2');
  const [modeTestProfiles, setModeTestProfiles] = useState<string[]>([]);
  const [modelTestProfile, setModelTestProfile] = useState('');
  const [modelTestModels, setModelTestModels] = useState<string[]>(['eleven_flash_v2_5', 'eleven_multilingual_v2']);
  const [testing, setTesting] = useState(false);
  const [audios, setAudios] = useState<Record<string, string>>({});

  const load = async () => {
    const [s, a, p, r] = await Promise.all([
      apiFetch<VoiceGlobalSettings>('/api/voice/admin/settings'),
      apiFetch<AccountInfo>('/api/voice/admin/account'),
      apiFetch<AdminProfile[]>('/api/voice/admin/profiles'),
      apiFetch<TestRun[]>('/api/voice/admin/test-runs'),
    ]);
    if (s.ok && s.data) {
      setSettings(s.data);
      setDraft(s.data);
    }
    if (a.ok && a.data) setAccount(a.data);
    if (p.ok && p.data) setProfiles(p.data);
    if (r.ok && r.data) setRuns(r.data);
    if (!s.ok) setError(s.error || 'No se pudo cargar la configuración de voz.');
  };

  useEffect(() => {
    void load();
  }, []);

  const readyProfiles = useMemo(() => profiles.filter((p) => p.status === 'lista' && p.voiceId && p.consent), [profiles]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    const res = await apiFetch<VoiceGlobalSettings>('/api/voice/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setSaving(false);
    if (res.ok && res.data) {
      setSettings(res.data);
      setDraft(res.data);
      setMessage('Configuración de voz guardada.');
    } else setError(res.error || 'No se pudo guardar.');
  };

  const runTest = async (purpose: TestRun['purpose'], pairs: Array<{ profileId: string; modelId: string }>) => {
    setTesting(true);
    setError(null);
    for (const pair of pairs) {
      const res = await apiFetch<{ run: TestRun; audioBase64: string; audioMimeType: string }>('/api/voice/admin/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pair, text: testText, purpose }),
      });
      if (res.ok && res.data) {
        const { run, audioBase64, audioMimeType } = res.data;
        setAudios((prev) => ({ ...prev, [run.runId]: `data:${audioMimeType};base64,${audioBase64}` }));
        setRuns((prev) => [run, ...prev]);
      } else {
        setError(res.error || 'La prueba no se pudo completar.');
        break;
      }
    }
    setTesting(false);
  };

  const conv = TTS_MODELS.find((m) => m.id === draft.conversationTtsModelId) || TTS_MODELS[0];
  // ~15 characters of Spanish per second of generated audio.
  const perMinuteGenerated = (60 * 15 * conv.estimatedUsdPer1kCharacters) / 1000;
  const perMinuteConversation = (30 * 15 * conv.estimatedUsdPer1kCharacters) / 1000 + (30 / 3600) * STT_ESTIMATED_USD_PER_HOUR;
  const changed = JSON.stringify({ ...draft, updatedAt: undefined, updatedBy: undefined }) !== JSON.stringify({ ...settings, updatedAt: undefined, updatedBy: undefined });

  return (
    <div data-testid="voice-global-config" className="p-4 bg-white border border-stone-200 rounded-xl space-y-4">
      <div>
        <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
          <Mic className="w-3.5 h-3.5 text-amber-700" /> Voz clonada en Mi Esencia (ElevenLabs)
        </h4>
        <p className="text-xs text-stone-600 mt-0.5">
          Función opcional: sólo se activa para quien autoriza el uso de sus grabaciones. El chat escrito, las entrevistas y el libro no cambian.
        </p>
      </div>

      {error && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-start gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {message && <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs">{message}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <label className="space-y-1">
          <span className="font-semibold text-stone-800 block">Tipo de clonación de ElevenLabs</span>
          <select
            data-testid="voice-cloning-mode"
            value={draft.cloningMode}
            onChange={(e) => setDraft({ ...draft, cloningMode: e.target.value as 'ivc' | 'pvc' })}
            className="w-full p-2 border border-stone-300 rounded-lg bg-white"
          >
            <option value="ivc">{VOICE_MODE_LABELS.ivc}</option>
            <option value="pvc">{VOICE_MODE_LABELS.pvc}</option>
          </select>
          <span className="text-[11px] text-stone-500 block">
            Se aplica a las configuraciones nuevas. Los procesos iniciados conservan su modalidad y los clones activos su voz.
          </span>
        </label>

        <label className="space-y-1">
          <span className="font-semibold text-stone-800 block">Cuota diaria predeterminada de mensajes de voz</span>
          <input
            data-testid="voice-default-quota"
            type="number"
            min={0}
            max={1000}
            value={draft.defaultDailyVoiceMessages}
            onChange={(e) => setDraft({ ...draft, defaultDailyVoiceMessages: Math.max(0, parseInt(e.target.value, 10) || 0) })}
            className="w-full p-2 border border-stone-300 rounded-lg"
          />
          <span className="text-[11px] text-stone-500 block">Por participante; la comparten sus familiares autorizados. Aplica también a registros anteriores sin cuota propia.</span>
        </label>

        <label className="space-y-1">
          <span className="font-semibold text-stone-800 block">Duración máxima por mensaje de voz</span>
          <div className="flex gap-2">
            <select
              data-testid="voice-max-duration-mode"
              value={draft.maxSecondsPerVoiceMessage === null ? 'none' : 'limit'}
              onChange={(e) => setDraft({ ...draft, maxSecondsPerVoiceMessage: e.target.value === 'none' ? null : draft.maxSecondsPerVoiceMessage ?? 60 })}
              className="p-2 border border-stone-300 rounded-lg bg-white"
            >
              <option value="none">Sin límite</option>
              <option value="limit">Máximo (segundos)</option>
            </select>
            {draft.maxSecondsPerVoiceMessage !== null && (
              <input
                type="number"
                min={3}
                max={600}
                value={draft.maxSecondsPerVoiceMessage}
                onChange={(e) => setDraft({ ...draft, maxSecondsPerVoiceMessage: Math.max(3, parseInt(e.target.value, 10) || 3) })}
                className="w-24 p-2 border border-stone-300 rounded-lg"
              />
            )}
          </div>
        </label>

        <label className="space-y-1">
          <span className="font-semibold text-stone-800 block">Modelo de síntesis de las conversaciones</span>
          <select
            value={draft.conversationTtsModelId}
            onChange={(e) => setDraft({ ...draft, conversationTtsModelId: e.target.value })}
            className="w-full p-2 border border-stone-300 rounded-lg bg-white"
          >
            {TTS_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving || !changed}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar configuración de voz
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="p-3 rounded-lg border border-stone-200 bg-stone-50/60 space-y-1.5">
          <p className="font-semibold text-stone-900">Plan de ElevenLabs — crear y mantener voces</p>
          {!account ? (
            <p className="text-stone-500">Consultando…</p>
          ) : !account.configured ? (
            <p className="text-rose-700">Falta el secreto ELEVENLABS_API_KEY en el servidor.</p>
          ) : account.subscription ? (
            <ul className="space-y-0.5 text-stone-700">
              <li>Plan: <strong>{account.subscription.tier}</strong> ({account.subscription.status})</li>
              <li>Voces en la cuenta: {account.subscription.voiceSlotsUsed ?? '—'} de {account.subscription.voiceLimit ?? '—'}</li>
              <li>Clonación instantánea (IVC): {account.subscription.canUseInstantVoiceCloning ? 'disponible' : 'no disponible'}</li>
              <li>Clonación profesional (PVC): {account.subscription.canUseProfessionalVoiceCloning ? 'disponible' : 'no disponible'}</li>
              <li>Créditos usados en el periodo: {account.subscription.characterCount ?? '—'} de {account.subscription.characterLimit ?? '—'}</li>
            </ul>
          ) : null}
          {account?.requirements?.map((r) => (
            <p key={r} className="text-amber-900 flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {r}
            </p>
          ))}
          <p className="text-[11px] text-stone-500">La PVC la crea y verifica el titular en su propia cuenta y la comparte en privado con la de YouForever.</p>
        </div>
        <div className="p-3 rounded-lg border border-stone-200 bg-stone-50/60 space-y-1.5">
          <p className="font-semibold text-stone-900">Costo de conversar — transcribir y sintetizar (estimado)</p>
          <ul className="space-y-0.5 text-stone-700">
            <li>Síntesis con {modelLabel(conv.id)}: US${conv.estimatedUsdPer1kCharacters.toFixed(2)} por 1,000 caracteres.</li>
            <li>Transcripción (Scribe v2): US${STT_ESTIMATED_USD_PER_HOUR.toFixed(2)} por hora de audio del familiar.</li>
            <li>Por <strong>minuto de audio generado</strong>: ≈ {usd(perMinuteGenerated)}.</li>
            <li>Por <strong>minuto de conversación completa</strong> (30 s del familiar + 30 s de respuesta): ≈ {usd(perMinuteConversation)}.</li>
          </ul>
          <p className="text-[11px] text-stone-500">Estimación con la {TTS_RATE_SOURCE}; no incluye el motor Gemini/GPT ni la cuota mensual del plan.</p>
        </div>
      </div>

      <div className="text-xs space-y-1.5">
        <p className="font-semibold text-stone-900">Voces registradas</p>
        {profiles.length === 0 ? (
          <p className="text-stone-500">Aún no hay participantes que hayan autorizado su voz.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-stone-500">
                <tr>
                  <th className="py-1 pr-2">Participante</th>
                  <th className="py-1 pr-2">Modalidad</th>
                  <th className="py-1 pr-2">Estado</th>
                  <th className="py-1">Requisito pendiente / error</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.profileId} className="border-t border-stone-100">
                    <td className="py-1 pr-2">{p.participantName}</td>
                    <td className="py-1 pr-2">{p.mode.toUpperCase()}</td>
                    <td className="py-1 pr-2">{VOICE_STATUS_LABELS[p.status] || p.status}</td>
                    <td className="py-1 text-amber-900">{p.requirementPending || p.lastError || (p.analysis?.lastErrorDetail ? `Revisión de grabaciones: ${p.analysis.lastErrorDetail}` : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/40 space-y-3 text-xs" data-testid="voice-comparison-test">
        <div>
          <p className="font-semibold text-stone-900">Prueba comparativa de voces y costos</p>
          <p className="text-[11px] text-stone-600">
            Sólo con voces autorizadas y listas. Estas pruebas no consumen la cuota diaria de los familiares; su consumo en ElevenLabs se registra por separado.
          </p>
        </div>
        <textarea value={testText} onChange={(e) => setTestText(e.target.value)} rows={2} maxLength={1000} className="w-full p-2 border border-stone-300 rounded-lg" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <p className="font-semibold">1. Comparar modalidades (IVC vs PVC) con el mismo modelo</p>
            <select value={modeTestModel} onChange={(e) => setModeTestModel(e.target.value)} className="w-full p-1.5 border border-stone-300 rounded-lg bg-white">
              {TTS_MODELS.map((m) => (
                <option key={m.id} value={m.id}>Modelo fijo: {m.label}</option>
              ))}
            </select>
            {readyProfiles.length === 0 && <p className="text-stone-500">No hay voces listas todavía.</p>}
            {readyProfiles.map((p) => (
              <label key={p.profileId} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={modeTestProfiles.includes(p.profileId)}
                  onChange={(e) =>
                    setModeTestProfiles((prev) => (e.target.checked ? [...prev, p.profileId] : prev.filter((x) => x !== p.profileId)))
                  }
                />
                {p.participantName} · {p.mode.toUpperCase()}
              </label>
            ))}
            <button
              type="button"
              disabled={testing || modeTestProfiles.length === 0 || !testText.trim()}
              onClick={() => runTest('comparar_modalidades', modeTestProfiles.map((profileId) => ({ profileId, modelId: modeTestModel })))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 text-white rounded-lg font-semibold disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" /> Reproducir con cada voz
            </button>
          </div>

          <div className="space-y-1.5">
            <p className="font-semibold">2. Comparar el costo por modelo (misma voz, mismo texto)</p>
            <select value={modelTestProfile} onChange={(e) => setModelTestProfile(e.target.value)} className="w-full p-1.5 border border-stone-300 rounded-lg bg-white">
              <option value="">Elige una voz…</option>
              {readyProfiles.map((p) => (
                <option key={p.profileId} value={p.profileId}>{p.participantName} · {p.mode.toUpperCase()}</option>
              ))}
            </select>
            {TTS_MODELS.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={modelTestModels.includes(m.id)}
                  onChange={(e) => setModelTestModels((prev) => (e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id)))}
                />
                {m.label}
              </label>
            ))}
            <button
              type="button"
              disabled={testing || !modelTestProfile || modelTestModels.length === 0 || !testText.trim()}
              onClick={() => runTest('comparar_modelos', modelTestModels.map((modelId) => ({ profileId: modelTestProfile, modelId })))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 text-white rounded-lg font-semibold disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" /> Reproducir con cada modelo
            </button>
            <p className="text-[11px] text-stone-500">Este control sólo afecta a la prueba; no cambia el modelo de las conversaciones.</p>
          </div>
        </div>

        {testing && (
          <p className="flex items-center gap-1.5 text-stone-700">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando…
          </p>
        )}

        {runs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]" data-testid="voice-test-runs">
              <thead className="text-stone-500">
                <tr>
                  <th className="py-1 pr-2">Voz</th>
                  <th className="py-1 pr-2">Modalidad</th>
                  <th className="py-1 pr-2">Modelo</th>
                  <th className="py-1 pr-2">Caracteres</th>
                  <th className="py-1 pr-2">Audio generado</th>
                  <th className="py-1 pr-2">Créditos (ElevenLabs)</th>
                  <th className="py-1 pr-2">Costo estimado</th>
                  <th className="py-1 pr-2">Por minuto de audio generado</th>
                  <th className="py-1">Escuchar</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.runId} className="border-t border-stone-100 align-middle">
                    <td className="py-1 pr-2">{r.participantName}</td>
                    <td className="py-1 pr-2">{r.mode.toUpperCase()}</td>
                    <td className="py-1 pr-2">{modelLabel(r.modelId)}</td>
                    <td className="py-1 pr-2 tabular-nums">{r.characters}</td>
                    <td className="py-1 pr-2 tabular-nums">{r.audioSeconds.toFixed(1)} s</td>
                    <td className="py-1 pr-2 tabular-nums">{r.reportedCredits ?? 'no reportado'}</td>
                    <td className="py-1 pr-2 tabular-nums">
                      {usd(r.estimatedUsd)} <span className="text-stone-400">(estimado, US${r.rateUsdPer1kCharacters?.toFixed(2)}/1,000 car.)</span>
                    </td>
                    <td className="py-1 pr-2 tabular-nums">{usd(r.estimatedUsdPerMinuteOfGeneratedAudio)}</td>
                    <td className="py-1">{audios[r.runId] ? <audio controls src={audios[r.runId]} className="h-7" /> : <span className="text-stone-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-stone-500 mt-1">
              «Créditos» es lo que ElevenLabs reporta en la respuesta de cada prueba. El costo en dólares es una estimación con la tarifa indicada.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
