import React, { useState, useEffect } from 'react';
import {
  Settings,
  Save,
  CheckCircle2,
  AlertCircle,
  Info,
  UserCheck,
  Clock,
  Cpu,
  BookOpen,
  Plus,
  Check,
  RotateCcw,
  Trash2,
  Layers,
  Edit3,
  X,
} from 'lucide-react';
import {
  AppConfig,
  BookAiProvider,
  BookStructureMode,
  DEFAULT_LITERARY_PROMPTS_CONFIG,
  DEFAULT_LITERARY_PROMPT_VERSIONS,
  DEFAULT_LITERARY_PROMPTS_TEXT,
  LiteraryPromptStyleId,
  LiteraryPromptVersion,
  LiteraryStylePromptConfig,
} from '../logic/interviewRules.ts';
import { DEMO_NARRATIVE_STYLES } from '../logic/demoStoryRules.ts';
import { apiFetch } from '../utils/apiClient.ts';

interface ConfigPanelProps {
  adminEmail: string | null;
}

interface BookModelPreset {
  id: string;
  label: string;
  description: string;
}

const GEMINI_BOOK_MODEL_PRESETS: BookModelPreset[] = [
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview (Recomendado)',
    description: 'Alta velocidad, ventana de 1M de tokens y lectura íntegra del PDF del Compilado Testimonial.',
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    description: 'Modelo multimodal de última generación con seguimiento estricto de estilo literario.',
  },
  {
    id: 'gemini-flash-latest',
    label: 'Gemini Flash Latest',
    description: 'Alias estable hacia la versión vigente de Google Gemini Flash.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    description: 'Modelo ligero optimizado para respuestas rápidas y eficiencia operativa.',
  },
];

const OPENAI_BOOK_MODEL_PRESETS: BookModelPreset[] = [
  {
    id: 'gpt-6',
    label: 'GPT-6 (Recomendado OpenAI — Última Generación)',
    description: 'Modelo insignia de OpenAI con máxima fidelidad al Compilado Testimonial y redacción literaria.',
  },
  {
    id: 'gpt-6-astra',
    label: 'GPT-6 Astra (Razonamiento Profundo y Empatía)',
    description: 'Variante avanzada para matices emocionales complejos y apego estricto al prompt.',
  },
  {
    id: 'gpt-6.1-sol',
    label: 'GPT-6.1 Sol (Narración Autobiográfica Avanzada)',
    description: 'Optimizado para redacción biográfica extensa con lectura íntegra de documentos.',
  },
  {
    id: 'gpt-6.1-terra',
    label: 'GPT-6.1 Terra (Alta Velocidad y Contexto Extenso)',
    description: 'Equilibrio entre baja latencia y comprensión de entrevistas completas.',
  },
  {
    id: 'gpt-6-luna',
    label: 'GPT-6 Luna (Ágil y Eficiente)',
    description: 'Modelo ligero de nueva generación para redacción fluida.',
  },
  {
    id: 'gpt-5',
    label: 'GPT-5 (Flagship Multimodal)',
    description: 'Modelo multimodal de alta precisión documental y análisis de fotografías.',
  },
  {
    id: 'gpt-5.5-pro',
    label: 'GPT-5.5 Pro',
    description: 'Versión profesional de la serie GPT-5 para edición literaria detallada.',
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 Mini',
    description: 'Modelo rápido de la familia GPT-5 con excelente relación velocidad/contexto.',
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1 (Compatibilidad Extendida)',
    description: 'Ventana de 1M de tokens y seguimiento riguroso de prompts extensos.',
  },
  {
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
    description: 'Balance entre seguimiento de instrucciones personalizadas, velocidad y costo.',
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o (Multimodal Estándar)',
    description: 'Modelo multimodal compatible con todos los niveles de cuenta OpenAI.',
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o Mini (Compatibilidad Rápida)',
    description: 'Modelo ágil compatible con cuentas iniciales de OpenAI.',
  },
];

const STYLE_LABELS: Record<
  LiteraryPromptStyleId,
  { badge: string; shortTitle: string }
> = {
  first_person_simple: {
    badge: 'Estilo A',
    shortTitle: 'Primera persona — Relato sencillo y fiel',
  },
  first_person_literary: {
    badge: 'Estilo B',
    shortTitle: 'Primera persona — Narrativa literaria y emotiva',
  },
  third_person_biography: {
    badge: 'Estilo C',
    shortTitle: 'Tercera persona — Biografía narrativa',
  },
};

const NO_SPINNER_NUMBER_CLASS =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ adminEmail }) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Core numeric & boolean form fields
  const [openDays, setOpenDays] = useState<number>(15);
  const [sufficiencyThreshold, setSufficiencyThreshold] = useState<number>(100);
  const [maxFollowUps, setMaxFollowUps] = useState<number>(2);
  const [allowEditing, setAllowEditing] = useState<boolean>(true);
  const [allowAdditional, setAllowAdditional] = useState<boolean>(true);

  // AI Provider & Model for Book Generation
  const [bookAiProvider, setBookAiProvider] = useState<BookAiProvider>('gemini');
  const [bookAiGeminiModel, setBookAiGeminiModel] = useState<string>('gemini-3-flash-preview');
  const [bookAiOpenAiModel, setBookAiOpenAiModel] = useState<string>('gpt-6');
  const [bookStructureMode, setBookStructureMode] = useState<BookStructureMode>('prompt_autonomous');
  const [isCustomGeminiModel, setIsCustomGeminiModel] = useState<boolean>(false);
  const [isCustomOpenAiModel, setIsCustomOpenAiModel] = useState<boolean>(false);

  // Live AI Engine Connection Verification state
  const [testingAiEngines, setTestingAiEngines] = useState<boolean>(false);
  const [aiEngineTestResult, setAiEngineTestResult] = useState<{
    testedAt: string;
    primaryProvider: BookAiProvider;
    gemini: {
      provider: BookAiProvider;
      providerLabel: string;
      configuredModel: string;
      respondedModel: string;
      ok: boolean;
      latencyMs: number;
      sampleResponse: string;
      availableModels: string[];
      isConfiguredModelAvailable: boolean;
      contextCachingSupported: boolean;
      contextCachingExplanation: string;
      diagnosticMessage: string;
      errorDetail?: string;
    };
    openai: {
      provider: BookAiProvider;
      providerLabel: string;
      configuredModel: string;
      respondedModel: string;
      ok: boolean;
      latencyMs: number;
      sampleResponse: string;
      availableModels: string[];
      isConfiguredModelAvailable: boolean;
      contextCachingSupported: boolean;
      contextCachingExplanation: string;
      diagnosticMessage: string;
      errorDetail?: string;
    };
  } | null>(null);
  const [aiEngineTestError, setAiEngineTestError] = useState<string | null>(null);
  const [providersStatus, setProvidersStatus] = useState<{
    geminiConfiguredOnServer: boolean;
    openaiConfiguredOnServer: boolean;
  } | null>(null);

  // Literary Prompts Manager state
  const [selectedStyleTab, setSelectedStyleTab] = useState<LiteraryPromptStyleId>('first_person_literary');
  const [literaryPrompts, setLiteraryPrompts] = useState<
    Record<LiteraryPromptStyleId, LiteraryStylePromptConfig>
  >({ ...DEFAULT_LITERARY_PROMPTS_CONFIG });
  const [literaryPromptVersions, setLiteraryPromptVersions] = useState<LiteraryPromptVersion[]>([
    ...DEFAULT_LITERARY_PROMPT_VERSIONS,
  ]);
  const [newVersionName, setNewVersionName] = useState<string>('');
  const [promptFeedbackMessage, setPromptFeedbackMessage] = useState<string | null>(null);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [editingVersionName, setEditingVersionName] = useState<string>('');
  const [editingVersionText, setEditingVersionText] = useState<string>('');

  // Validation errors
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const [res, provRes] = await Promise.all([
        apiFetch<AppConfig>('/api/config', { retries: 2 }),
        apiFetch<{
          geminiConfiguredOnServer: boolean;
          openaiConfiguredOnServer: boolean;
        }>('/api/mi-esencia/admin/providers-status', { retries: 1 }),
      ]);

      if (provRes.ok && provRes.data) {
        setProvidersStatus({
          geminiConfiguredOnServer: Boolean(provRes.data.geminiConfiguredOnServer),
          openaiConfiguredOnServer: Boolean(provRes.data.openaiConfiguredOnServer),
        });
      }

      if (res.ok && res.data) {
        const data = res.data;
        setConfig(data);
        setOpenDays(data.defaultOpenDays);
        setSufficiencyThreshold(data.defaultSufficiencyThreshold);
        setMaxFollowUps(data.defaultMaxFollowUps);
        setAllowEditing(data.allowAnswerEditing);
        setAllowAdditional(data.allowAdditionalMemories);

        const provider = data.bookAiProvider === 'openai' ? 'openai' : 'gemini';
        const gemModel = data.bookAiGeminiModel || 'gemini-3-flash-preview';
        const oaiModel = data.bookAiOpenAiModel || 'gpt-6';
        const structMode: BookStructureMode =
          data.bookStructureMode === 'fixed_five_stages' ? 'fixed_five_stages' : 'prompt_autonomous';

        setBookAiProvider(provider);
        setBookAiGeminiModel(gemModel);
        setBookAiOpenAiModel(oaiModel);
        setBookStructureMode(structMode);
        setIsCustomGeminiModel(!GEMINI_BOOK_MODEL_PRESETS.some((m) => m.id === gemModel));
        setIsCustomOpenAiModel(!OPENAI_BOOK_MODEL_PRESETS.some((m) => m.id === oaiModel));

        const mergedPrompts: Record<LiteraryPromptStyleId, LiteraryStylePromptConfig> = {
          ...DEFAULT_LITERARY_PROMPTS_CONFIG,
          ...(data.literaryPrompts || {}),
        };
        setLiteraryPrompts(mergedPrompts);

        const mergedVersions =
          Array.isArray(data.literaryPromptVersions) && data.literaryPromptVersions.length > 0
            ? data.literaryPromptVersions
            : [...DEFAULT_LITERARY_PROMPT_VERSIONS];
        setLiteraryPromptVersions(mergedVersions);
      } else if (res.error) {
        setErrorMsg('No se pudo cargar la configuración del servidor: ' + res.error);
      }
    } catch (_err: unknown) {
      setErrorMsg('No se pudo cargar la configuración del servidor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const showPromptFeedback = (msg: string) => {
    setPromptFeedbackMessage(msg);
    setTimeout(() => {
      setPromptFeedbackMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!Number.isInteger(openDays) || openDays <= 0 || openDays > 365) {
      newErrors.openDays = 'Los días de apertura deben ser un entero positivo entre 1 y 365 días.';
    }

    if (
      !Number.isInteger(sufficiencyThreshold) ||
      sufficiencyThreshold <= 0 ||
      sufficiencyThreshold > 500
    ) {
      newErrors.sufficiencyThreshold =
        'El umbral de suficiencia debe ser un entero positivo entre 1 y 500 preguntas.';
    }

    if (!Number.isInteger(maxFollowUps) || maxFollowUps < 0 || maxFollowUps > 10) {
      newErrors.maxFollowUps = 'Las preguntas de profundización deben estar entre 0 y 10.';
    }

    if (bookAiProvider === 'gemini' && !bookAiGeminiModel.trim()) {
      newErrors.bookModel = 'Debes seleccionar o indicar un modelo de Google Gemini.';
    }

    if (bookAiProvider === 'openai' && !bookAiOpenAiModel.trim()) {
      newErrors.bookModel = 'Debes seleccionar o indicar un modelo de OpenAI (ChatGPT).';
    }

    const styles: LiteraryPromptStyleId[] = [
      'first_person_simple',
      'first_person_literary',
      'third_person_biography',
    ];
    for (const st of styles) {
      if (!literaryPrompts[st]?.promptText || literaryPrompts[st].promptText.trim().length < 20) {
        newErrors.literaryPrompts = `El prompt activo de ${STYLE_LABELS[st].badge} no puede estar vacío (mínimo 20 caracteres).`;
        break;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const persistGlobalConfiguration = async (
    overridePrompts?: Record<LiteraryPromptStyleId, LiteraryStylePromptConfig>,
    overrideVersions?: LiteraryPromptVersion[],
    overrideStructureMode?: BookStructureMode
  ) => {
    if (!validate()) return;

    const promptsToSave = overridePrompts || literaryPrompts;
    const versionsToSave = overrideVersions || literaryPromptVersions;
    const structureModeToSave = overrideStructureMode || bookStructureMode;

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
          bookAiProvider,
          bookAiGeminiModel: bookAiGeminiModel.trim() || 'gemini-3-flash-preview',
          bookAiOpenAiModel: bookAiOpenAiModel.trim() || 'gpt-6',
          bookStructureMode: structureModeToSave,
          literaryPrompts: promptsToSave,
          literaryPromptVersions: versionsToSave,
        }),
      });

      if (res.ok && res.data) {
        setConfig(res.data);
        if (res.data.bookStructureMode) {
          setBookStructureMode(res.data.bookStructureMode);
        }
        if (res.data.literaryPrompts) {
          setLiteraryPrompts(res.data.literaryPrompts);
        }
        if (Array.isArray(res.data.literaryPromptVersions)) {
          setLiteraryPromptVersions(res.data.literaryPromptVersions);
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4000);
      } else {
        setErrorMsg(res.error || 'Error al guardar la configuración.');
      }
    } catch (_err: unknown) {
      setErrorMsg('Error de conexión al guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await persistGlobalConfiguration();
  };

  const handlePromptTextChange = (styleId: LiteraryPromptStyleId, newText: string) => {
    setLiteraryPrompts((prev) => ({
      ...prev,
      [styleId]: {
        ...prev[styleId],
        styleId,
        promptText: newText,
        updatedAt: new Date().toISOString(),
        updatedBy: adminEmail || 'Administrador',
      },
    }));
  };

  const handleSaveNewPromptVersion = async (assignToCurrentStyle: boolean) => {
    const activeStylePrompt = literaryPrompts[selectedStyleTab];
    const cleanText = (activeStylePrompt?.promptText || '').trim();
    if (cleanText.length < 20) {
      setErrorMsg('El texto del prompt debe tener al menos 20 caracteres para guardarse como versión.');
      return;
    }

    const versionName =
      newVersionName.trim() ||
      `${STYLE_LABELS[selectedStyleTab].badge} — Versión ${new Date().toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}`;

    const newVersion: LiteraryPromptVersion = {
      id: `lpv_${selectedStyleTab}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: versionName,
      styleId: selectedStyleTab,
      promptText: cleanText,
      createdForStyleId: selectedStyleTab,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: adminEmail || 'Administrador',
    };

    const nextVersions = [newVersion, ...literaryPromptVersions];
    setLiteraryPromptVersions(nextVersions);

    let nextPrompts = { ...literaryPrompts };
    if (assignToCurrentStyle) {
      nextPrompts = {
        ...literaryPrompts,
        [selectedStyleTab]: {
          ...literaryPrompts[selectedStyleTab],
          styleId: selectedStyleTab,
          activeVersionId: newVersion.id,
          promptText: cleanText,
          updatedAt: new Date().toISOString(),
          updatedBy: adminEmail || 'Administrador',
        },
      };
      setLiteraryPrompts(nextPrompts);
    }

    setNewVersionName('');
    showPromptFeedback(
      assignToCurrentStyle
        ? `Versión «${versionName}» guardada y asignada como Prompt Activo de ${STYLE_LABELS[selectedStyleTab].badge}.`
        : `Versión «${versionName}» guardada en la biblioteca de versiones.`
    );
    await persistGlobalConfiguration(nextPrompts, nextVersions);
  };

  const handleUpdateActiveVersionContent = async () => {
    const currentStyleConfig = literaryPrompts[selectedStyleTab];
    const cleanText = (currentStyleConfig?.promptText || '').trim();
    if (cleanText.length < 20) {
      setErrorMsg('El prompt debe contener al menos 20 caracteres.');
      return;
    }

    const activeVerId = currentStyleConfig.activeVersionId;
    const nextVersions = literaryPromptVersions.map((v) =>
      v.id === activeVerId
        ? {
            ...v,
            promptText: cleanText,
            updatedAt: new Date().toISOString(),
          }
        : v
    );
    const nextPrompts: Record<LiteraryPromptStyleId, LiteraryStylePromptConfig> = {
      ...literaryPrompts,
      [selectedStyleTab]: {
        ...currentStyleConfig,
        promptText: cleanText,
        updatedAt: new Date().toISOString(),
        updatedBy: adminEmail || 'Administrador',
      },
    };

    setLiteraryPromptVersions(nextVersions);
    setLiteraryPrompts(nextPrompts);
    showPromptFeedback(
      `Prompt activo de ${STYLE_LABELS[selectedStyleTab].badge} actualizado y guardado permanentemente.`
    );
    await persistGlobalConfiguration(nextPrompts, nextVersions);
  };

  const handleAssignVersionToStyle = async (
    version: LiteraryPromptVersion,
    targetStyleId: LiteraryPromptStyleId
  ) => {
    const nextPrompts: Record<LiteraryPromptStyleId, LiteraryStylePromptConfig> = {
      ...literaryPrompts,
      [targetStyleId]: {
        styleId: targetStyleId,
        activeVersionId: version.id,
        promptText: version.promptText,
        updatedAt: new Date().toISOString(),
        updatedBy: adminEmail || 'Administrador',
      },
    };
    setLiteraryPrompts(nextPrompts);
    setSelectedStyleTab(targetStyleId);
    showPromptFeedback(
      `Versión «${version.name}» asignada como único Prompt Activo para ${STYLE_LABELS[targetStyleId].badge}.`
    );
    await persistGlobalConfiguration(nextPrompts, literaryPromptVersions);
  };

  const handleStartEditVersionCard = (ver: LiteraryPromptVersion) => {
    setEditingVersionId(ver.id);
    setEditingVersionName(ver.name);
    setEditingVersionText(ver.promptText);
    setErrorMsg(null);
  };

  const handleCancelEditVersionCard = () => {
    setEditingVersionId(null);
    setEditingVersionName('');
    setEditingVersionText('');
  };

  const handleSaveEditedVersionCard = async (ver: LiteraryPromptVersion) => {
    const cleanName = editingVersionName.trim() || ver.name;
    const cleanText = editingVersionText.trim();
    if (cleanText.length < 20) {
      setErrorMsg('El texto del prompt debe tener al menos 20 caracteres.');
      return;
    }

    const nowIso = new Date().toISOString();
    const nextVersions = literaryPromptVersions.map((item) =>
      item.id === ver.id
        ? {
            ...item,
            name: cleanName,
            promptText: cleanText,
            updatedAt: nowIso,
          }
        : item
    );

    const nextPrompts: Record<LiteraryPromptStyleId, LiteraryStylePromptConfig> = {
      ...literaryPrompts,
    };
    const allStyles: LiteraryPromptStyleId[] = [
      'first_person_simple',
      'first_person_literary',
      'third_person_biography',
    ];
    const updatedStyleBadges: string[] = [];
    for (const stId of allStyles) {
      if (nextPrompts[stId]?.activeVersionId === ver.id) {
        nextPrompts[stId] = {
          ...nextPrompts[stId],
          promptText: cleanText,
          updatedAt: nowIso,
          updatedBy: adminEmail || 'Administrador',
        };
        updatedStyleBadges.push(STYLE_LABELS[stId].badge);
      }
    }

    setLiteraryPromptVersions(nextVersions);
    setLiteraryPrompts(nextPrompts);
    setEditingVersionId(null);
    showPromptFeedback(
      updatedStyleBadges.length > 0
        ? `Versión «${cleanName}» modificada y actualizada automáticamente en ${updatedStyleBadges.join(', ')}.`
        : `Versión «${cleanName}» modificada y guardada en la Biblioteca de Versiones.`
    );
    await persistGlobalConfiguration(nextPrompts, nextVersions);
  };

  const handleRestoreDefaultStylePrompt = async (styleId: LiteraryPromptStyleId) => {
    const defaultVersionId =
      styleId === 'first_person_simple'
        ? 'lpv_default_style_a'
        : styleId === 'third_person_biography'
        ? 'lpv_default_style_c'
        : 'lpv_default_style_b';
    const defaultText = DEFAULT_LITERARY_PROMPTS_TEXT[styleId];

    const nextPrompts: Record<LiteraryPromptStyleId, LiteraryStylePromptConfig> = {
      ...literaryPrompts,
      [styleId]: {
        styleId,
        activeVersionId: defaultVersionId,
        promptText: defaultText,
        updatedAt: new Date().toISOString(),
        updatedBy: adminEmail || 'Administrador',
      },
    };
    setLiteraryPrompts(nextPrompts);
    showPromptFeedback(`Se restauró el prompt base oficial para ${STYLE_LABELS[styleId].badge}.`);
    await persistGlobalConfiguration(nextPrompts, literaryPromptVersions);
  };

  const handleDeletePromptVersion = async (versionId: string) => {
    if (versionId.startsWith('lpv_default_')) {
      setErrorMsg('Las versiones base del sistema no se pueden eliminar.');
      return;
    }
    const nextVersions = literaryPromptVersions.filter((v) => v.id !== versionId);
    setLiteraryPromptVersions(nextVersions);
    showPromptFeedback('Versión eliminada del historial.');
    await persistGlobalConfiguration(literaryPrompts, nextVersions);
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-stone-500">
        <Clock className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-600" />
        <p>Cargando configuración global...</p>
      </div>
    );
  }

  const currentStyleSpec =
    DEMO_NARRATIVE_STYLES.find((s) => s.id === selectedStyleTab) || DEMO_NARRATIVE_STYLES[1];
  const currentStyleConfig =
    literaryPrompts[selectedStyleTab] || DEFAULT_LITERARY_PROMPTS_CONFIG[selectedStyleTab];
  const activeVersionObj = literaryPromptVersions.find(
    (v) => v.id === currentStyleConfig.activeVersionId
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
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
              Parámetros almacenados en{' '}
              <code className="text-amber-800 bg-amber-50 px-1 py-0.5 rounded text-xs">
                settings/appConfig
              </code>
              . Incluye reglas operativas, motor de IA para generación de libros y el Gestor de Prompts Literarios.
            </p>
          </div>
        </div>

        {/* Audit info banner */}
        {config?.updatedAt && (
          <div className="mt-4 flex items-center space-x-2 text-xs text-stone-600 bg-stone-50 p-2.5 rounded-lg border border-stone-200">
            <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Última modificación por <strong>{config.updatedBy || 'Administrador'}</strong> el{' '}
              {new Date(config.updatedAt).toLocaleString('es-MX', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
              .
            </span>
          </div>
        )}
      </div>

      {/* Form */}
      <form
        onSubmit={handleSave}
        className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm space-y-8"
      >
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

        {/* Section 1: Numeric Parameters (Without Spinners) */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-stone-800 uppercase tracking-wide">
            Parámetros de Apertura y Evaluación de Entrevistas
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Default Open Days */}
            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-stone-800">
                Días naturales de apertura (<code className="text-xs text-stone-500">defaultOpenDays</code>)
              </label>
              <div className="relative">
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="365"
                  value={openDays}
                  onChange={(e) => setOpenDays(parseInt(e.target.value, 10) || 0)}
                  className={`w-full px-3.5 py-2.5 pr-24 rounded-lg border text-sm text-stone-900 focus:outline-none focus:ring-2 ${NO_SPINNER_NUMBER_CLASS} ${
                    errors.openDays
                      ? 'border-rose-400 focus:ring-rose-200'
                      : 'border-stone-300 focus:ring-amber-200 focus:border-amber-500'
                  }`}
                />
                <span className="absolute right-3.5 top-2.5 text-xs text-stone-400 pointer-events-none">
                  días naturales
                </span>
              </div>
              {errors.openDays ? (
                <p className="text-xs text-rose-600 font-medium">{errors.openDays}</p>
              ) : (
                <p className="text-xs text-stone-500">
                  Plazo inicial antes de que venza la recepción de respuestas (1 a 365 días).
                </p>
              )}
            </div>

            {/* Sufficiency Threshold */}
            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-stone-800">
                Umbral para evaluación (<code className="text-xs text-stone-500">defaultSufficiencyThreshold</code>)
              </label>
              <div className="relative">
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="500"
                  value={sufficiencyThreshold}
                  onChange={(e) => setSufficiencyThreshold(parseInt(e.target.value, 10) || 0)}
                  className={`w-full px-3.5 py-2.5 pr-20 rounded-lg border text-sm text-stone-900 focus:outline-none focus:ring-2 ${NO_SPINNER_NUMBER_CLASS} ${
                    errors.sufficiencyThreshold
                      ? 'border-rose-400 focus:ring-rose-200'
                      : 'border-stone-300 focus:ring-amber-200 focus:border-amber-500'
                  }`}
                />
                <span className="absolute right-3.5 top-2.5 text-xs text-stone-400 pointer-events-none">
                  preguntas
                </span>
              </div>
              {errors.sufficiencyThreshold ? (
                <p className="text-xs text-rose-600 font-medium">{errors.sufficiencyThreshold}</p>
              ) : (
                <p className="text-xs text-stone-500">
                  Respuestas requeridas para evaluar cobertura narrativa (1 a 500).
                </p>
              )}
            </div>

            {/* Max Follow-ups */}
            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-stone-800">
                Profundizaciones máximas (<code className="text-xs text-stone-500">defaultMaxFollowUps</code>)
              </label>
              <div className="relative">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="10"
                  value={maxFollowUps}
                  onChange={(e) => setMaxFollowUps(parseInt(e.target.value, 10) || 0)}
                  className={`w-full px-3.5 py-2.5 pr-24 rounded-lg border text-sm text-stone-900 focus:outline-none focus:ring-2 ${NO_SPINNER_NUMBER_CLASS} ${
                    errors.maxFollowUps
                      ? 'border-rose-400 focus:ring-rose-200'
                      : 'border-stone-300 focus:ring-amber-200 focus:border-amber-500'
                  }`}
                />
                <span className="absolute right-3.5 top-2.5 text-xs text-stone-400 pointer-events-none">
                  adaptativas
                </span>
              </div>
              {errors.maxFollowUps ? (
                <p className="text-xs text-rose-600 font-medium">{errors.maxFollowUps}</p>
              ) : (
                <p className="text-xs text-stone-500">
                  Límite de repreguntas autónomas por respuesta principal (0 a 10).
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Toggles */}
        <div className="border-t border-stone-200 pt-6 space-y-4">
          <h3 className="text-sm font-bold text-stone-800 uppercase tracking-wide">
            Permisos de Edición y Memorias Espontáneas
          </h3>

          <div className="flex items-center justify-between p-3.5 bg-stone-50 rounded-lg border border-stone-200">
            <div className="pr-4">
              <div className="font-semibold text-sm text-stone-900">
                Permitir edición de respuestas anteriores (
                <code className="text-xs text-stone-500">allowAnswerEditing</code>)
              </div>
              <div className="text-xs text-stone-500">
                Los participantes pueden regresar a preguntas contestadas previamente y ajustar su relato mientras la entrevista siga abierta. Las ediciones no incrementan el contador.
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
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
                Permitir agregar recuerdos adicionales espontáneos (
                <code className="text-xs text-stone-500">allowAdditionalMemories</code>)
              </div>
              <div className="text-xs text-stone-500">
                Habilita el botón «Añadir información adicional» para registrar memorias libres con voz, transcripción editable y fotografías adjuntas.
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
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

        {/* Section 3: AI Provider & Model Selector for Book Generation */}
        <div className="border-t border-stone-200 pt-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-200">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold font-serif text-stone-900">
                  Motor de Inteligencia Artificial para Generación de Libros
                </h3>
                <p className="text-xs text-stone-500">
                  Selección exclusivamente administrativa del proveedor (OpenAI ChatGPT o Google Gemini) y modelo específico para redactar los libros autobiográficos a partir del Compilado Testimonial Fidedigno (PDF fuente).
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Provider Option: Google Gemini */}
            <button
              type="button"
              onClick={() => setBookAiProvider('gemini')}
              className={`text-left p-4 rounded-xl border-2 transition ${
                bookAiProvider === 'gemini'
                  ? 'border-amber-700 bg-amber-50/50 shadow-sm'
                  : 'border-stone-200 bg-white hover:border-stone-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-sm text-stone-900">
                  Google (Gemini)
                </span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                    providersStatus?.geminiConfiguredOnServer !== false
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {providersStatus?.geminiConfiguredOnServer !== false
                    ? 'Clave API activa en servidor'
                    : 'Pendiente en servidor'}
                </span>
              </div>
              <p className="text-xs text-stone-600">
                Envía el PDF íntegro del Compilado Testimonial Fidedigno, las fotografías adjuntas y el prompt literario activo al motor multimodal de Google Gemini.
              </p>
              <div className="mt-2 text-xs font-medium text-amber-900">
                Modelo seleccionado: <code>{bookAiGeminiModel}</code>
              </div>
            </button>

            {/* Provider Option: OpenAI ChatGPT */}
            <button
              type="button"
              onClick={() => setBookAiProvider('openai')}
              className={`text-left p-4 rounded-xl border-2 transition ${
                bookAiProvider === 'openai'
                  ? 'border-amber-700 bg-amber-50/50 shadow-sm'
                  : 'border-stone-200 bg-white hover:border-stone-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-sm text-stone-900">
                  OpenAI (ChatGPT)
                </span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                    providersStatus?.openaiConfiguredOnServer
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-stone-100 text-stone-700'
                  }`}
                >
                  {providersStatus?.openaiConfiguredOnServer
                    ? 'Clave API activa en servidor'
                    : 'Con respaldo automático'}
                </span>
              </div>
              <p className="text-xs text-stone-600">
                Envía el contenido íntegro del PDF del Compilado Testimonial Fidedigno, las fotografías con sus descripciones y el prompt literario activo a OpenAI ChatGPT.
              </p>
              <div className="mt-2 text-xs font-medium text-amber-900">
                Modelo seleccionado: <code>{bookAiOpenAiModel}</code>
              </div>
            </button>
          </div>

          {/* Model Selection Dropdown + Manual Input Option */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-stone-50 p-4 rounded-xl border border-stone-200">
            {/* Gemini Model Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wide text-stone-700">
                Modelo de Google (Gemini){' '}
                {bookAiProvider === 'gemini' && (
                  <span className="text-amber-800 font-semibold">(Proveedor Principal Activo)</span>
                )}
              </label>
              <select
                value={isCustomGeminiModel ? '__custom__' : bookAiGeminiModel}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__custom__') {
                    setIsCustomGeminiModel(true);
                  } else {
                    setIsCustomGeminiModel(false);
                    setBookAiGeminiModel(val);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-500"
              >
                {GEMINI_BOOK_MODEL_PRESETS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
                <option value="__custom__">Escribir modelo manualmente...</option>
              </select>
              {isCustomGeminiModel && (
                <input
                  type="text"
                  value={bookAiGeminiModel}
                  onChange={(e) => setBookAiGeminiModel(e.target.value)}
                  placeholder="Ej. gemini-3-flash-preview"
                  className="w-full px-3 py-2 rounded-lg border border-amber-400 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
              )}
              <p className="text-[11px] text-stone-500">
                {GEMINI_BOOK_MODEL_PRESETS.find((m) => m.id === bookAiGeminiModel)?.description ||
                  'Identificador manual de modelo Google Gemini.'}
              </p>
            </div>

            {/* OpenAI Model Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wide text-stone-700">
                Modelo de OpenAI (ChatGPT){' '}
                {bookAiProvider === 'openai' && (
                  <span className="text-amber-800 font-semibold">(Proveedor Principal Activo)</span>
                )}
              </label>
              <select
                value={isCustomOpenAiModel ? '__custom__' : bookAiOpenAiModel}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__custom__') {
                    setIsCustomOpenAiModel(true);
                  } else {
                    setIsCustomOpenAiModel(false);
                    setBookAiOpenAiModel(val);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-500"
              >
                {OPENAI_BOOK_MODEL_PRESETS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
                <option value="__custom__">Escribir modelo manualmente...</option>
              </select>
              {isCustomOpenAiModel && (
                <input
                  type="text"
                  value={bookAiOpenAiModel}
                  onChange={(e) => setBookAiOpenAiModel(e.target.value)}
                  placeholder="Ej. gpt-6 o gpt-4o"
                  className="w-full px-3 py-2 rounded-lg border border-amber-400 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
              )}
              <p className="text-[11px] text-stone-500">
                {OPENAI_BOOK_MODEL_PRESETS.find((m) => m.id === bookAiOpenAiModel)?.description ||
                  'Identificador manual de modelo OpenAI ChatGPT.'}
              </p>
            </div>
          </div>

          {errors.bookModel && (
            <p className="text-xs text-rose-600 font-medium">{errors.bookModel}</p>
          )}

          {/* Live AI Engine Connection Verifier */}
          <div className="p-4 bg-white border border-stone-200 rounded-xl space-y-3.5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 text-amber-700" />
                  <span>Diagnóstico en Vivo de Motores de IA y Contexto en Caché</span>
                </h4>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  Verifica en tiempo real la conexión con Google Gemini y OpenAI, inspecciona la respuesta real de cada motor, su latencia y los modelos habilitados en tu cuenta.
                </p>
              </div>
              <button
                type="button"
                data-testid="btn-verify-ai-engines"
                disabled={testingAiEngines}
                onClick={async () => {
                  setTestingAiEngines(true);
                  setAiEngineTestError(null);
                  try {
                    const res = await apiFetch('/api/config/test-ai-engines', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
                      },
                      body: JSON.stringify({
                        bookAiProvider,
                        bookAiGeminiModel: bookAiGeminiModel.trim(),
                        bookAiOpenAiModel: bookAiOpenAiModel.trim(),
                      }),
                    });
                    if (!res.ok || !res.data) {
                      throw new Error(res.error || 'No se pudo verificar la conexión con los motores de IA.');
                    }
                    setAiEngineTestResult(res.data);
                  } catch (err: any) {
                    setAiEngineTestError(err?.message || 'Error al probar los motores de IA.');
                  } finally {
                    setTestingAiEngines(false);
                  }
                }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-700 hover:bg-amber-800 text-white shadow-xs transition-colors disabled:opacity-60 cursor-pointer shrink-0"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>
                  {testingAiEngines
                    ? 'Verificando motores de IA...'
                    : 'Verificar conexión con los motores de IA configurados'}
                </span>
              </button>
            </div>

            {aiEngineTestError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{aiEngineTestError}</span>
              </div>
            )}

            {aiEngineTestResult && (
              <div
                data-testid="ai-engines-diagnostic-results"
                className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1"
              >
                {[aiEngineTestResult.gemini, aiEngineTestResult.openai].map((eng) => {
                  const isPrimary = bookAiProvider === eng.provider;
                  return (
                    <div
                      key={eng.provider}
                      data-testid={`ai-diagnostic-card-${eng.provider}`}
                      className={`p-3.5 rounded-xl border text-xs space-y-2.5 ${
                        eng.ok
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : 'bg-amber-50/50 border-amber-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-stone-900">{eng.providerLabel}</span>
                          {isPrimary ? (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-amber-800 text-white">
                              Motor Principal
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase bg-stone-200 text-stone-700">
                              Motor Alterno (Respaldo)
                            </span>
                          )}
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold tabular-nums ${
                            eng.ok
                              ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                              : 'bg-rose-100 text-rose-900 border border-rose-300'
                          }`}
                        >
                          {eng.ok ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                              <span>Conectado · {eng.latencyMs} ms</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3.5 h-3.5 text-rose-700" />
                              <span>Fallo · {eng.latencyMs} ms</span>
                            </>
                          )}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] bg-white/80 p-2 rounded-lg border border-stone-200/80">
                        <div>
                          <span className="text-stone-500 block">Modelo configurado:</span>
                          <span className="font-mono font-semibold text-stone-900">
                            {eng.configuredModel}
                          </span>
                        </div>
                        <div>
                          <span className="text-stone-500 block">Modelo que respondió:</span>
                          <span className="font-mono font-semibold text-stone-900">
                            {eng.respondedModel}
                          </span>
                        </div>
                      </div>

                      <p
                        className={`text-[11px] leading-relaxed font-medium ${
                          eng.ok ? 'text-emerald-950' : 'text-amber-950'
                        }`}
                      >
                        {eng.diagnosticMessage}
                      </p>

                      {eng.sampleResponse && (
                        <div className="p-2.5 rounded-lg bg-white border border-emerald-200 text-[11px] text-stone-800">
                          <span className="font-bold text-emerald-900 block mb-0.5">
                            Respuesta en vivo del motor de IA:
                          </span>
                          <p className="italic">«{eng.sampleResponse}»</p>
                        </div>
                      )}

                      <div className="p-2 rounded-lg bg-stone-100/80 border border-stone-200/80 text-[11px] text-stone-700">
                        <span className="font-bold text-stone-800">Contexto en Caché: </span>
                        <span>{eng.contextCachingExplanation}</span>
                      </div>

                      {eng.availableModels && eng.availableModels.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block">
                            Modelos disponibles en la cuenta (clic para seleccionar):
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {eng.availableModels.slice(0, 10).map((mId) => {
                              const isCurrent =
                                eng.provider === 'gemini'
                                  ? bookAiGeminiModel === mId
                                  : bookAiOpenAiModel === mId;
                              return (
                                <button
                                  key={mId}
                                  type="button"
                                  onClick={() => {
                                    if (eng.provider === 'gemini') {
                                      const inPreset = GEMINI_BOOK_MODEL_PRESETS.some(
                                        (p) => p.id === mId
                                      );
                                      setIsCustomGeminiModel(!inPreset);
                                      setBookAiGeminiModel(mId);
                                    } else {
                                      const inPreset = OPENAI_BOOK_MODEL_PRESETS.some(
                                        (p) => p.id === mId
                                      );
                                      setIsCustomOpenAiModel(!inPreset);
                                      setBookAiOpenAiModel(mId);
                                    }
                                  }}
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                                    isCurrent
                                      ? 'bg-amber-700 text-white border-amber-800 font-bold'
                                      : 'bg-white text-stone-700 border-stone-300 hover:border-amber-500'
                                  }`}
                                >
                                  {mId}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selector Manual de Estructura de Capítulos y Obediencia al Prompt Literario */}
          <div
            data-testid="book-structure-mode-selector"
            className="p-4 bg-white border border-stone-200 rounded-xl space-y-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                  Modo de Estructura de Capítulos y Obediencia al Prompt Literario en PDF
                </h4>
                <p className="text-xs text-stone-600 mt-0.5">
                  Elige manualmente cómo debe estructurar la IA tanto el PDF de muestra (6 páginas) como el PDF del libro completo. Antes de cada generación, el sistema verifica cuál opción está seleccionada aquí y la aplica.
                </p>
              </div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shrink-0">
                Activa: {bookStructureMode === 'fixed_five_stages' ? 'Opción 2 (5 Capítulos Fijos)' : 'Opción 1 (Prompt Autónomo 100%)'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                data-testid="book-structure-option-prompt_autonomous"
                onClick={() => {
                  setBookStructureMode('prompt_autonomous');
                  persistGlobalConfiguration(undefined, undefined, 'prompt_autonomous');
                }}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  bookStructureMode === 'prompt_autonomous'
                    ? 'border-amber-700 bg-amber-50/70 ring-2 ring-amber-700/20'
                    : 'border-stone-200 bg-stone-50/60 hover:border-stone-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-stone-900">
                    Opción 1 (Predeterminada) — Obedecer 100% el Prompt Literario Activo
                  </span>
                  {bookStructureMode === 'prompt_autonomous' && (
                    <span className="px-2 py-0.5 bg-amber-700 text-white text-[10px] font-bold rounded uppercase">
                      Seleccionada
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  La IA tiene libertad total para definir títulos literarios propios, capítulos personalizados según el peso de la historia, prólogo, epílogo y fusión orgánica de recuerdos repetidos tal como lo ordena tu prompt completo de 34 secciones.
                </p>
              </button>

              <button
                type="button"
                data-testid="book-structure-option-fixed_five_stages"
                onClick={() => {
                  setBookStructureMode('fixed_five_stages');
                  persistGlobalConfiguration(undefined, undefined, 'fixed_five_stages');
                }}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  bookStructureMode === 'fixed_five_stages'
                    ? 'border-amber-700 bg-amber-50/70 ring-2 ring-amber-700/20'
                    : 'border-stone-200 bg-stone-50/60 hover:border-stone-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-stone-900">
                    Opción 2 — Mantener los 5 Capítulos Fijos por Etapa de Vida
                  </span>
                  {bookStructureMode === 'fixed_five_stages' && (
                    <span className="px-2 py-0.5 bg-amber-700 text-white text-[10px] font-bold rounded uppercase">
                      Seleccionada
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  Organiza el libro en los 5 capítulos fijos tradicionales por etapa (Infancia, Juventud, Adultez, Madurez y Legado) aplicando la voz y estilo literario elegido en cada párrafo.
                </p>
              </button>
            </div>
          </div>

          <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg text-xs text-indigo-950 flex items-start space-x-2.5">
            <Info className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
            <span>
              <strong>Política de Conmutación Temporal con Aviso y Caché de Contexto:</strong> El sistema utiliza siempre el proveedor y modelo configurados aquí como motor principal, activando caché de contexto e historial por estilo literario. Si durante una generación el modelo configurado no está habilitado en la cuenta (por ejemplo, <code>gpt-6-luna</code>), el sistema detecta de inmediato la disponibilidad y conmuta temporalmente al proveedor alterno sin bloquear ni abortar la generación.
            </span>
          </div>
        </div>

        {/* Section 4: Literary Prompts Manager */}
        <div className="border-t border-stone-200 pt-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-amber-100 text-amber-800 rounded-lg border border-amber-200">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold font-serif text-stone-900">
                  Gestor de Prompts Literarios para Generación de Libros
                </h3>
                <p className="text-xs text-stone-500">
                  Cada uno de los tres estilos literarios tiene su propio prompt independiente y un único prompt activo asignado que se aplica obligatoriamente al redactar el libro.
                </p>
              </div>
            </div>
          </div>

          {promptFeedbackMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center space-x-2 text-xs text-emerald-900 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{promptFeedbackMessage}</span>
            </div>
          )}

          {errors.literaryPrompts && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
              {errors.literaryPrompts}
            </div>
          )}

          {/* Tabs for the 3 existing Literary Styles */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {DEMO_NARRATIVE_STYLES.map((style) => {
              const stId = style.id as LiteraryPromptStyleId;
              const isSelected = selectedStyleTab === stId;
              const assignedCfg = literaryPrompts[stId] || DEFAULT_LITERARY_PROMPTS_CONFIG[stId];
              const assignedVer = literaryPromptVersions.find(
                (v) => v.id === assignedCfg.activeVersionId
              );

              return (
                <button
                  key={stId}
                  type="button"
                  onClick={() => setSelectedStyleTab(stId)}
                  className={`text-left p-3.5 rounded-xl border-2 transition ${
                    isSelected
                      ? 'border-amber-700 bg-amber-50/70 shadow-sm'
                      : 'border-stone-200 bg-white hover:border-stone-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                      {STYLE_LABELS[stId].badge}
                    </span>
                    <span className="text-[11px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                      Prompt Activo
                    </span>
                  </div>
                  <div className="font-bold text-sm text-stone-900 line-clamp-1">
                    {style.individualTitle}
                  </div>
                  <p className="text-[11px] text-stone-500 mt-1 line-clamp-2">
                    {style.individualDescription}
                  </p>
                  <div className="mt-2 pt-2 border-t border-stone-200/80 text-[11px] text-stone-700 truncate">
                    Asignado: <strong>{assignedVer?.name || 'Prompt personalizado activo'}</strong>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Prompt Editor for Selected Literary Style */}
          <div className="bg-stone-50 p-5 rounded-xl border border-stone-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-stone-200 pb-3">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 bg-amber-800 text-white text-xs font-bold rounded">
                    {STYLE_LABELS[selectedStyleTab].badge}
                  </span>
                  <h4 className="font-bold text-sm text-stone-900">
                    {currentStyleSpec.individualTitle}
                  </h4>
                </div>
                <p className="text-xs text-stone-600 mt-1">
                  {currentStyleSpec.individualDescription}
                </p>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleRestoreDefaultStylePrompt(selectedStyleTab)}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white hover:bg-stone-100 border border-stone-300 rounded-lg transition"
                  title="Restaurar el prompt original de este estilo literario"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar base</span>
                </button>
                <button
                  type="button"
                  onClick={handleUpdateActiveVersionContent}
                  disabled={saving}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg shadow-sm transition disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar y Actualizar Prompt Activo</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
              <div>
                Versión activa asignada a <strong>{STYLE_LABELS[selectedStyleTab].badge}</strong>:{' '}
                <span className="font-semibold text-amber-900">
                  {activeVersionObj?.name || 'Prompt Activo Personalizado'}
                </span>
              </div>
              <div>
                Última actualización:{' '}
                {currentStyleConfig.updatedAt
                  ? new Date(currentStyleConfig.updatedAt).toLocaleString('es-MX', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : 'Original'}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-stone-700 mb-1.5">
                Instrucciones del Prompt Activo ({STYLE_LABELS[selectedStyleTab].shortTitle})
              </label>
              <textarea
                rows={10}
                value={currentStyleConfig.promptText}
                onChange={(e) => handlePromptTextChange(selectedStyleTab, e.target.value)}
                className="w-full p-3.5 rounded-lg border border-stone-300 bg-white font-mono text-xs text-stone-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-500"
                placeholder="Escribe aquí las instrucciones detalladas del prompt literario para este estilo..."
              />
            </div>

            {/* Save as a new version in the Version Library */}
            <div className="bg-white p-3.5 rounded-lg border border-stone-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-bold uppercase tracking-wide text-stone-600 mb-1">
                  Guardar texto actual como nueva versión reutilizable
                </label>
                <input
                  type="text"
                  value={newVersionName}
                  onChange={(e) => setNewVersionName(e.target.value)}
                  placeholder={`Ej. ${STYLE_LABELS[selectedStyleTab].badge} — Edición Poética Extendida v2`}
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-300 text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
              </div>
              <div className="flex items-center space-x-2 sm:pt-4">
                <button
                  type="button"
                  onClick={() => handleSaveNewPromptVersion(true)}
                  disabled={saving}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Guardar Nueva Versión y Activar en {STYLE_LABELS[selectedStyleTab].badge}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Saved Prompt Versions Library (usable across any of the 3 literary styles) */}
          <div className="bg-white p-4 rounded-xl border border-stone-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Layers className="w-4 h-4 text-amber-700" />
                <h4 className="text-xs font-bold uppercase tracking-wide text-stone-800">
                  Biblioteca de Versiones de Prompts Literarios ({literaryPromptVersions.length})
                </h4>
              </div>
              <span className="text-[11px] text-stone-500">
                Puedes asignar cualquier versión guardada como Prompt Activo en cualquiera de los 3 estilos literarios
              </span>
            </div>

            <div className="divide-y divide-stone-200 max-h-[520px] overflow-y-auto pr-1">
              {literaryPromptVersions.map((ver) => {
                const isActiveInA =
                  literaryPrompts.first_person_simple?.activeVersionId === ver.id;
                const isActiveInB =
                  literaryPrompts.first_person_literary?.activeVersionId === ver.id;
                const isActiveInC =
                  literaryPrompts.third_person_biography?.activeVersionId === ver.id;
                const isDefaultVersion = ver.id.startsWith('lpv_default_');
                const isEditingThisCard = editingVersionId === ver.id;

                return (
                  <div
                    key={ver.id}
                    data-testid={`prompt-version-card-${ver.id}`}
                    className="py-3.5 space-y-3"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-xs text-stone-900">{ver.name}</span>
                          {isActiveInA && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-900 text-[10px] font-bold rounded">
                              Activo en Estilo A
                            </span>
                          )}
                          {isActiveInB && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-900 text-[10px] font-bold rounded">
                              Activo en Estilo B
                            </span>
                          )}
                          {isActiveInC && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-900 text-[10px] font-bold rounded">
                              Activo en Estilo C
                            </span>
                          )}
                        </div>
                        {!isEditingThisCard && (
                          <p className="text-[11px] text-stone-500 line-clamp-2 font-mono">
                            {ver.promptText}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            isEditingThisCard
                              ? handleCancelEditVersionCard()
                              : handleStartEditVersionCard(ver)
                          }
                          data-testid={`btn-edit-prompt-version-${ver.id}`}
                          className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-semibold border transition cursor-pointer ${
                            isEditingThisCard
                              ? 'bg-stone-200 text-stone-800 border-stone-300'
                              : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
                          }`}
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>{isEditingThisCard ? 'Cerrar edición' : 'Editar prompt'}</span>
                        </button>

                        {(['first_person_simple', 'first_person_literary', 'third_person_biography'] as LiteraryPromptStyleId[]).map(
                          (stId) => {
                            const isAlreadyActive =
                              literaryPrompts[stId]?.activeVersionId === ver.id;
                            return (
                              <button
                                key={stId}
                                type="button"
                                onClick={() => handleAssignVersionToStyle(ver, stId)}
                                className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-semibold border transition cursor-pointer ${
                                  isAlreadyActive
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-stone-50 hover:bg-amber-50 text-stone-700 border-stone-300'
                                }`}
                              >
                                {isAlreadyActive && <Check className="w-3 h-3" />}
                                <span>
                                  {isAlreadyActive
                                    ? `Activo en ${STYLE_LABELS[stId].badge}`
                                    : `Usar en ${STYLE_LABELS[stId].badge}`}
                                </span>
                              </button>
                            );
                          }
                        )}
                        {!isDefaultVersion && (
                          <button
                            type="button"
                            onClick={() => handleDeletePromptVersion(ver.id)}
                            className="p-1.5 text-stone-400 hover:text-rose-600 rounded transition cursor-pointer"
                            title="Eliminar esta versión"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditingThisCard && (
                      <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-3.5 space-y-3">
                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wide text-stone-700 mb-1">
                            Nombre de la versión
                          </label>
                          <input
                            type="text"
                            value={editingVersionName}
                            onChange={(e) => setEditingVersionName(e.target.value)}
                            data-testid={`input-edit-version-name-${ver.id}`}
                            className="w-full px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-300"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wide text-stone-700 mb-1">
                            Contenido del Prompt Literario
                          </label>
                          <textarea
                            rows={7}
                            value={editingVersionText}
                            onChange={(e) => setEditingVersionText(e.target.value)}
                            data-testid={`textarea-edit-version-text-${ver.id}`}
                            className="w-full p-3 rounded-lg border border-stone-300 bg-white font-mono text-xs text-stone-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-300"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={handleCancelEditVersionCard}
                            className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 text-xs font-semibold transition cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Cancelar</span>
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => handleSaveEditedVersionCard(ver)}
                            data-testid={`btn-save-edited-version-${ver.id}`}
                            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>Guardar cambios en versión y estilos activos</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Note on Retroactivity */}
        <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg flex items-start space-x-2.5 text-xs text-amber-900">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <span>
            <strong>Garantía de Aplicación Inmediata y Persistencia:</strong> El proveedor de IA, el modelo seleccionado y los Prompts Literarios activos de cada estilo se almacenan de forma persistente y se aplican obligatoriamente en todas las generaciones de libros autobiográficos a partir del Compilado Testimonial Fidedigno.
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
