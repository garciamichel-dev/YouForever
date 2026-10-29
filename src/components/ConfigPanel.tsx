import React, { useState, useEffect } from 'react';
import { Settings, Save, CheckCircle2, AlertCircle, Info, UserCheck, Calendar, Clock } from 'lucide-react';
import { AppConfig } from '../logic/interviewRules.ts';
import { apiFetch } from '../utils/apiClient.ts';

interface ConfigPanelProps {
  adminEmail: string | null;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ adminEmail }) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form fields
  const [openDays, setOpenDays] = useState<number>(15);
  const [sufficiencyThreshold, setSufficiencyThreshold] = useState<number>(100);
  const [maxFollowUps, setMaxFollowUps] = useState<number>(2);
  const [allowEditing, setAllowEditing] = useState<boolean>(true);
  const [allowAdditional, setAllowAdditional] = useState<boolean>(true);

  // Validation errors
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await apiFetch<AppConfig>('/api/config', { retries: 2 });
      if (res.ok && res.data) {
        setConfig(res.data);
        setOpenDays(res.data.defaultOpenDays);
        setSufficiencyThreshold(res.data.defaultSufficiencyThreshold);
        setMaxFollowUps(res.data.defaultMaxFollowUps);
        setAllowEditing(res.data.allowAnswerEditing);
        setAllowAdditional(res.data.allowAdditionalMemories);
      } else if (res.error) {
        setErrorMsg('No se pudo cargar la configuración del servidor: ' + res.error);
      }
    } catch (err: unknown) {
      setErrorMsg('No se pudo cargar la configuración del servidor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!Number.isInteger(openDays) || openDays <= 0 || openDays > 365) {
      newErrors.openDays = 'Los días de apertura deben ser un entero positivo entre 1 y 365 días.';
    }

    if (!Number.isInteger(sufficiencyThreshold) || sufficiencyThreshold <= 0 || sufficiencyThreshold > 500) {
      newErrors.sufficiencyThreshold = 'El umbral de suficiencia debe ser un entero positivo entre 1 y 500 preguntas.';
    }

    if (!Number.isInteger(maxFollowUps) || maxFollowUps < 0 || maxFollowUps > 10) {
      newErrors.maxFollowUps = 'Las preguntas de profundización deben estar entre 0 y 10.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      setSaving(true);
      setErrorMsg(null);
      setSaveSuccess(false);

      const res = await apiFetch<AppConfig>('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({
          defaultOpenDays: Number(openDays),
          defaultSufficiencyThreshold: Number(sufficiencyThreshold),
          defaultMaxFollowUps: Number(maxFollowUps),
          allowAnswerEditing: allowEditing,
          allowAdditionalMemories: allowAdditional,
        }),
      });

      if (res.ok && res.data) {
        setConfig(res.data);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4000);
      } else {
        setErrorMsg(res.error || 'Error al guardar la configuración.');
      }
    } catch (err: unknown) {
      setErrorMsg('Error de conexión al guardar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-stone-500">
        <Clock className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-600" />
        <p>Cargando configuración global...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Title & Description */}
      <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
        <div className="flex items-center space-x-3 mb-2">
          <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-serif text-stone-900">
              Reglas y Configuración Global del Sistema
            </h2>
            <p className="text-sm text-stone-500">
              Parámetros almacenados en <code className="text-amber-800 bg-amber-50 px-1 py-0.5 rounded text-xs">settings/appConfig</code>.
              Estos valores se aplicarán como plantilla a todas las nuevas entrevistas creadas.
            </p>
          </div>
        </div>

        {/* Audit info banner */}
        {config?.updatedAt && (
          <div className="mt-4 flex items-center space-x-2 text-xs text-stone-600 bg-stone-50 p-2.5 rounded-lg border border-stone-200">
            <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Última modificación por <strong>{config.updatedBy || 'Administrador'}</strong> el{' '}
              {new Date(config.updatedAt).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}.
            </span>
          </div>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm space-y-6">
        {errorMsg && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start space-x-3 text-rose-800 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {saveSuccess && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center space-x-3 text-emerald-800 text-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>¡Configuración global actualizada y registrada en la bitácora con éxito!</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Default Open Days */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-stone-800">
              Días naturales de apertura por defecto (<code className="text-xs text-stone-500">defaultOpenDays</code>)
            </label>
            <div className="relative">
              <input
                type="number"
                min="1"
                max="365"
                value={openDays}
                onChange={(e) => setOpenDays(parseInt(e.target.value) || 0)}
                className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-stone-900 focus:outline-none focus:ring-2 ${
                  errors.openDays
                    ? 'border-rose-400 focus:ring-rose-200'
                    : 'border-stone-300 focus:ring-amber-200 focus:border-amber-500'
                }`}
              />
              <span className="absolute right-3.5 top-2.5 text-xs text-stone-400">días naturales</span>
            </div>
            {errors.openDays ? (
              <p className="text-xs text-rose-600 font-medium">{errors.openDays}</p>
            ) : (
              <p className="text-xs text-stone-500">
                Plazo inicial antes de que venza la recepción de respuestas (inicial: 15 días).
              </p>
            )}
          </div>

          {/* Sufficiency Threshold */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-stone-800">
              Umbral de preguntas para evaluación (<code className="text-xs text-stone-500">defaultSufficiencyThreshold</code>)
            </label>
            <div className="relative">
              <input
                type="number"
                min="1"
                max="500"
                value={sufficiencyThreshold}
                onChange={(e) => setSufficiencyThreshold(parseInt(e.target.value) || 0)}
                className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-stone-900 focus:outline-none focus:ring-2 ${
                  errors.sufficiencyThreshold
                    ? 'border-rose-400 focus:ring-rose-200'
                    : 'border-stone-300 focus:ring-amber-200 focus:border-amber-500'
                }`}
              />
              <span className="absolute right-3.5 top-2.5 text-xs text-stone-400">preguntas</span>
            </div>
            {errors.sufficiencyThreshold ? (
              <p className="text-xs text-rose-600 font-medium">{errors.sufficiencyThreshold}</p>
            ) : (
              <p className="text-xs text-stone-500">
                Alcanzado este número de respuestas, el backend solicita a Gemini evaluar la cobertura (inicial: 100).
              </p>
            )}
          </div>

          {/* Max Follow-ups */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-stone-800">
              Profundizaciones máximas por pregunta (<code className="text-xs text-stone-500">defaultMaxFollowUps</code>)
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                max="10"
                value={maxFollowUps}
                onChange={(e) => setMaxFollowUps(parseInt(e.target.value) || 0)}
                className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-stone-900 focus:outline-none focus:ring-2 ${
                  errors.maxFollowUps
                    ? 'border-rose-400 focus:ring-rose-200'
                    : 'border-stone-300 focus:ring-amber-200 focus:border-amber-500'
                }`}
              />
              <span className="absolute right-3.5 top-2.5 text-xs text-stone-400">preguntas adaptativas</span>
            </div>
            {errors.maxFollowUps ? (
              <p className="text-xs text-rose-600 font-medium">{errors.maxFollowUps}</p>
            ) : (
              <p className="text-xs text-stone-500">
                Límite de preguntas secundarias que Gemini puede proponer sobre una respuesta dada (inicial: 2).
              </p>
            )}
          </div>
        </div>

        {/* Toggles */}
        <div className="border-t border-stone-200 pt-5 space-y-4">
          <h3 className="text-sm font-bold text-stone-800 uppercase tracking-wide">
            Permisos de Edición y Memorias Espontáneas
          </h3>

          <div className="flex items-center justify-between p-3.5 bg-stone-50 rounded-lg border border-stone-200">
            <div className="pr-4">
              <div className="font-semibold text-sm text-stone-900">
                Permitir edición de respuestas anteriores (<code className="text-xs text-stone-500">allowAnswerEditing</code>)
              </div>
              <div className="text-xs text-stone-500">
                Los participantes pueden regresar a preguntas contestadas previamente y ajustar su relato mientras la entrevista siga abierta. Las ediciones no incrementan el contador.
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={allowEditing}
                onChange={(e) => setAllowEditing(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-700"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-3.5 bg-stone-50 rounded-lg border border-stone-200">
            <div className="pr-4">
              <div className="font-semibold text-sm text-stone-900">
                Permitir agregar recuerdos adicionales espontáneos (<code className="text-xs text-stone-500">allowAdditionalMemories</code>)
              </div>
              <div className="text-xs text-stone-500">
                Habilita el botón «Añadir un recuerdo adicional» para registrar memorias libres que no provengan del banco prefijado.
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={allowAdditional}
                onChange={(e) => setAllowAdditional(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-700"></div>
            </label>
          </div>
        </div>

        {/* Note on Retroactivity */}
        <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg flex items-start space-x-2.5 text-xs text-amber-900">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <span>
            <strong>Garantía de Inmutabilidad Retroactiva:</strong> Cada entrevista guarda una copia estricta de estos parámetros al ser creada. Cambiar la configuración aquí no alterará las entrevistas que ya estén abiertas, garantizando la consistencia del plazo y el umbral de cada testimonio.
          </span>
        </div>

        {/* Action Button */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center space-x-2 px-5 py-2.5 bg-amber-700 hover:bg-amber-800 text-white font-medium text-sm rounded-lg shadow-sm transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Guardando cambios...' : 'Guardar Configuración Global'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
