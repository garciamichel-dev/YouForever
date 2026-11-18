import { normalizeOpenAiModelId } from '../../logic/openAiModelIds.ts';
import React, { useState } from 'react';
import {
  Cpu,
  FileText,
  History,
  Upload,
  Download,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Play,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Eye,
  ShieldCheck,
} from 'lucide-react';
import type { MiEsenciaPersonProfile, MiEsenciaArchivedCompilationPdf } from '../../logic/miEsenciaRules';
import {
  AVAILABLE_GEMINI_MODELS,
  AVAILABLE_OPENAI_MODELS,
  SUPPORTED_DYNAMIC_VARIABLES,
  type MiEsenciaAiProvider,
  type MiEsenciaConversationConfigMode,
  type MiEsenciaLibraryPromptRecord,
  type MiEsenciaPromptVersionRecord,
  type MiEsenciaProvidersAvailabilityStatus,
} from '../../logic/miEsenciaAiTypesAndRules';

interface MiEsenciaAvatarAiConfigPanelProps {
  person: MiEsenciaPersonProfile;
  archivedPdf?: MiEsenciaArchivedCompilationPdf;
  testimoniesCount: number;
  promptLibrary: MiEsenciaLibraryPromptRecord[];
  avatarPromptVersions: MiEsenciaPromptVersionRecord[];
  providersStatus?: MiEsenciaProvidersAvailabilityStatus;
  adminEmail: string;
  onUpdated: () => Promise<void>;
  onDownloadPdf: (pdfId: string, fileName: string) => void;
  onOpenSimulator: (params: {
    personId: string;
    provider: MiEsenciaAiProvider;
    model: string;
    draftPromptContent: string;
  }) => void;
  onNotify: (type: 'ok' | 'err', text: string) => void;
}

export const MiEsenciaAvatarAiConfigPanel: React.FC<MiEsenciaAvatarAiConfigPanelProps> = ({
  person,
  archivedPdf,
  testimoniesCount,
  promptLibrary,
  avatarPromptVersions,
  providersStatus,
  adminEmail,
  onUpdated,
  onDownloadPdf,
  onOpenSimulator,
  onNotify,
}) => {
  const ai = person.aiConfig;

  const [activeTab, setActiveTab] = useState<'motor' | 'prompts' | 'documento'>('motor');

  // Motor conversacional state
  const [configMode, setConfigMode] = useState<MiEsenciaConversationConfigMode>(
    ai?.conversationConfigMode || 'modo_existente'
  );
  const [primaryProvider, setPrimaryProvider] = useState<MiEsenciaAiProvider>(
    ai?.primaryProvider || 'gemini'
  );
  const [enableFallback, setEnableFallback] = useState<boolean>(
    ai?.enableAutomaticFallback ?? true
  );
  const [geminiModel, setGeminiModel] = useState<string>(
    ai?.geminiModel || 'gemini-3.8-flash'
  );
  const [openaiModel, setOpenaiModel] = useState<string>(normalizeOpenAiModelId(ai?.openaiModel));
  const [customOpenaiModelMode, setCustomOpenaiModelMode] = useState<boolean>(
    Boolean(ai?.openaiModel && !AVAILABLE_OPENAI_MODELS.some((m) => m.id === ai.openaiModel))
  );
  const [customGeminiModelMode, setCustomGeminiModelMode] = useState<boolean>(
    Boolean(ai?.geminiModel && !AVAILABLE_GEMINI_MODELS.some((m) => m.id === ai.geminiModel))
  );
  const [testingProvider, setTestingProvider] = useState<'gemini' | 'openai' | null>(null);
  const [connectionTestResults, setConnectionTestResults] = useState<
    Record<
      string,
      {
        connected: boolean;
        requestedModel: string;
        respondedModel: string;
        latencyMs: number;
        sampleResponse?: string;
        errorDetail?: string;
        diagnosticAdvice?: string;
      }
    >
  >({});

  // Prompts independientes state
  const [geminiPromptName, setGeminiPromptName] = useState<string>(
    ai?.geminiPromptName || 'Prompt Gemini del Avatar'
  );
  const [geminiPromptContent, setGeminiPromptContent] = useState<string>(
    ai?.geminiPromptContent || ''
  );
  const [openaiPromptName, setOpenaiPromptName] = useState<string>(
    ai?.openaiPromptName || 'Prompt OpenAI GPT del Avatar'
  );
  const [openaiPromptContent, setOpenaiPromptContent] = useState<string>(
    ai?.openaiPromptContent || ''
  );

  const [selectedLibraryForGemini, setSelectedLibraryForGemini] = useState<string>('');
  const [selectedLibraryForOpenAi, setSelectedLibraryForOpenAi] = useState<string>('');

  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [showVersionHistoryFor, setShowVersionHistoryFor] = useState<'gemini' | 'openai' | null>(
    null
  );

  // Vista previa de variables dinámicas
  const [variablePreviewData, setVariablePreviewData] = useState<{
    provider: 'gemini' | 'openai';
    resolvedPrompt: string;
    variablesUsed: Record<string, string>;
  } | null>(null);

  // Reemplazo de PDF state
  const [replacePdfFileName, setReplacePdfFileName] = useState<string>('');
  const [replacePdfBase64, setReplacePdfBase64] = useState<string>('');
  const [replaceRawText, setReplaceRawText] = useState<string>('');
  const [isReplacingPdf, setIsReplacingPdf] = useState<boolean>(false);

  const geminiVersions = avatarPromptVersions.filter(
    (v) => v.targetId === person.personId && v.targetType === 'avatar_gemini_prompt'
  );
  const openaiVersions = avatarPromptVersions.filter(
    (v) => v.targetId === person.personId && v.targetType === 'avatar_openai_prompt'
  );

  const handleTestProviderConnection = async (provider: 'gemini' | 'openai') => {
    setTestingProvider(provider);
    try {
      const modelToTest = provider === 'openai' ? openaiModel : geminiModel;
      const res = await fetch('/api/mi-esencia/admin/ai-test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          provider,
          model: modelToTest,
        }),
      });
      const json = await res.json();
      if (json.data) {
        setConnectionTestResults((prev) => ({
          ...prev,
          [provider]: json.data,
        }));
        if (json.data.connected && json.data.modelSubstituted) {
          // V5.6.3: the connection works but another model answered — never shown as plain success.
          onNotify('err', json.data.diagnosticAdvice);
        } else if (json.data.connected) {
          onNotify(
            'ok',
            `Conexión exitosa con ${provider === 'openai' ? 'OpenAI GPT' : 'Google Gemini'} (${json.data.respondedModel} • ${json.data.latencyMs} ms).`
          );
        } else {
          onNotify(
            'err',
            json.data.diagnosticAdvice ||
              json.data.errorDetail ||
              `No se pudo conectar a ${provider.toUpperCase()}.`
          );
        }
      }
    } catch (err: any) {
      onNotify('err', err?.message || 'Error al probar la conexión con la API.');
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSaveAiConfigAndPrompts = async () => {
    setIsSavingConfig(true);
    try {
      const res = await fetch('/api/mi-esencia/admin/persons/ai-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          personId: person.personId,
          conversationConfigMode: configMode,
          primaryProvider,
          enableAutomaticFallback: enableFallback,
          geminiModel,
          geminiPromptName,
          geminiPromptContent,
          openaiModel,
          openaiPromptName,
          openaiPromptContent,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo guardar la configuración de IA del avatar.');
        return;
      }
      onNotify(
        'ok',
        `Configuración de IA y prompts guardada para «${person.fullName}». Se aplicará inmediatamente en la siguiente respuesta sin reiniciar sesiones.`
      );
      await onUpdated();
    } catch (err: any) {
      onNotify('err', err?.message || 'Error al guardar configuración de IA.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleCopyFromLibrary = async (targetProvider: 'gemini' | 'openai') => {
    const promptId =
      targetProvider === 'gemini' ? selectedLibraryForGemini : selectedLibraryForOpenAi;
    if (!promptId) {
      onNotify('err', 'Selecciona primero un prompt de la Biblioteca Global.');
      return;
    }

    try {
      const res = await fetch('/api/mi-esencia/admin/prompts/assign-to-avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          promptId,
          personId: person.personId,
          targetProvider,
          activateCustomMode: true,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo copiar el prompt de la biblioteca.');
        return;
      }
      const updatedAi = json.data.person.aiConfig;
      if (targetProvider === 'gemini' && updatedAi) {
        setGeminiPromptName(updatedAi.geminiPromptName);
        setGeminiPromptContent(updatedAi.geminiPromptContent);
      } else if (targetProvider === 'openai' && updatedAi) {
        setOpenaiPromptName(updatedAi.openaiPromptName);
        setOpenaiPromptContent(updatedAi.openaiPromptContent);
      }
      setConfigMode('modo_personalizado');
      onNotify(
        'ok',
        `Se creó una copia independiente del prompt de la biblioteca en el bloque ${
          targetProvider === 'gemini' ? 'Gemini' : 'OpenAI GPT'
        } de «${person.fullName}».`
      );
      await onUpdated();
    } catch (err: any) {
      onNotify('err', err?.message || 'Error al copiar prompt de la biblioteca.');
    }
  };

  const handleRestoreVersion = async (versionId: string, versionNumber: number) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/persons/prompt-restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          personId: person.personId,
          versionId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo restaurar la versión del prompt.');
        return;
      }
      const updatedAi = json.data.person.aiConfig;
      if (updatedAi) {
        setGeminiPromptName(updatedAi.geminiPromptName);
        setGeminiPromptContent(updatedAi.geminiPromptContent);
        setOpenaiPromptName(updatedAi.openaiPromptName);
        setOpenaiPromptContent(updatedAi.openaiPromptContent);
      }
      onNotify(
        'ok',
        `Versión v${versionNumber} restaurada como nueva versión activa sin destruir el historial previo.`
      );
      await onUpdated();
    } catch (err: any) {
      onNotify('err', err?.message || 'Error al restaurar versión.');
    }
  };

  const handlePreviewVariables = async (provider: 'gemini' | 'openai') => {
    const template = provider === 'gemini' ? geminiPromptContent : openaiPromptContent;
    if (!template.trim()) {
      onNotify('err', 'Escribe o selecciona un prompt primero para previsualizar sus variables.');
      return;
    }
    try {
      const res = await fetch('/api/mi-esencia/admin/simulator/preview-variables', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          personId: person.personId,
          promptTemplate: template,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setVariablePreviewData({
          provider,
          resolvedPrompt: json.data.resolvedPrompt,
          variablesUsed: json.data.variablesUsed,
        });
      }
    } catch {
      onNotify('err', 'Error al previsualizar variables dinámicas.');
    }
  };

  const handleInsertVariable = (provider: 'gemini' | 'openai', token: string) => {
    if (provider === 'gemini') {
      setGeminiPromptContent((prev) => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${token}`);
    } else {
      setOpenaiPromptContent((prev) => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${token}`);
    }
  };

  const handleReplacePdfFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReplacePdfFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      setReplacePdfBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleReplacePdfSubmit = async () => {
    const effectiveFileName =
      replacePdfFileName.trim() ||
      `Compilado_${person.fullName.replace(/\s+/g, '_')}_v${(ai?.documentVersion || 1) + 1}.pdf`;

    if (!replacePdfBase64 && !replaceRawText.trim()) {
      onNotify(
        'err',
        'Selecciona un archivo .pdf o ingresa el texto de preguntas y respuestas para actualizar el documento de recuerdos.'
      );
      return;
    }

    setIsReplacingPdf(true);
    try {
      const res = await fetch('/api/mi-esencia/admin/persons/replace-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          personId: person.personId,
          fileName: effectiveFileName.endsWith('.pdf')
            ? effectiveFileName
            : `${effectiveFileName}.pdf`,
          pdfBase64: replacePdfBase64 || undefined,
          rawCompilationText: replaceRawText.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo reemplazar el documento PDF.');
        return;
      }
      setReplacePdfFileName('');
      setReplacePdfBase64('');
      setReplaceRawText('');
      onNotify(
        'ok',
        `Documento PDF de «${person.fullName}» reemplazado y reindexado atómicamente (${json.data.testimoniesCount} bloques de recuerdos listos).`
      );
      await onUpdated();
    } catch (err: any) {
      onNotify('err', err?.message || 'Error al reemplazar documento PDF.');
    } finally {
      setIsReplacingPdf(false);
    }
  };

  const geminiConfigured = Boolean(geminiPromptContent.trim());
  const openaiConfigured = Boolean(openaiPromptContent.trim());

  return (
    <div className="mt-3 pt-4 border-t border-stone-200 bg-stone-50/80 rounded-xl p-4 space-y-4">
      {/* Sub-barra de pestañas del avatar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('motor')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'motor'
                ? 'bg-stone-900 text-amber-300'
                : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-100'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Motor conversacional</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('prompts')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'prompts'
                ? 'bg-stone-900 text-amber-300'
                : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-100'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Personalidad e instrucciones de IA</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('documento')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'documento'
                ? 'bg-stone-900 text-amber-300'
                : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-100'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Documento de recuerdos</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span
            className={`px-2.5 py-0.5 rounded-full font-semibold ${
              configMode === 'modo_personalizado'
                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                : 'bg-stone-200 text-stone-800'
            }`}
          >
            {configMode === 'modo_personalizado'
              ? `Modo Personalizado • Activo: ${primaryProvider === 'openai' ? 'OpenAI GPT' : 'Gemini'}`
              : 'Modo Existente (Compatibilidad 100%)'}
          </span>
          <button
            type="button"
            onClick={() =>
              onOpenSimulator({
                personId: person.personId,
                provider: primaryProvider,
                model: primaryProvider === 'openai' ? openaiModel : geminiModel,
                draftPromptContent:
                  primaryProvider === 'openai' ? openaiPromptContent : geminiPromptContent,
              })
            }
            className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Play className="w-3 h-3" />
            <span>Simulador «Probar Conversación»</span>
          </button>
        </div>
      </div>

      {/* SECCIÓN 1: MOTOR CONVERSACIONAL */}
      {activeTab === 'motor' && (
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl bg-white border border-stone-200 space-y-2">
              <label className="block font-bold text-stone-900">
                1. Modo de Operación Conversacional del Avatar
              </label>
              <select
                value={configMode}
                onChange={(e) =>
                  setConfigMode(e.target.value as MiEsenciaConversationConfigMode)
                }
                className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-xs font-medium"
              >
                <option value="modo_existente">
                  modo_existente — Conservar comportamiento actual de YouForever (Por defecto en avatares existentes)
                </option>
                <option value="modo_personalizado">
                  modo_personalizado — Usar proveedor y prompt administrativo personalizado (Gemini / OpenAI GPT)
                </option>
              </select>
              <p className="text-[11px] text-stone-500">
                En <strong>modo_existente</strong> el avatar conserva intacto su flujo original. En{' '}
                <strong>modo_personalizado</strong> la personalidad queda gobernada exclusivamente
                por el prompt del proveedor seleccionado sin mezclar prompts antiguos.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-white border border-stone-200 space-y-2">
              <label className="block font-bold text-stone-900">
                2. Proveedor Principal de IA para este Avatar
              </label>
              <select
                value={primaryProvider}
                onChange={(e) => setPrimaryProvider(e.target.value as MiEsenciaAiProvider)}
                className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-xs font-medium"
              >
                <option value="gemini">Google Gemini (Proveedor Principal)</option>
                <option value="openai">OpenAI GPT (Proveedor Principal)</option>
              </select>
              <label className="flex items-center gap-2 pt-1 cursor-pointer text-stone-700">
                <input
                  type="checkbox"
                  checked={enableFallback}
                  onChange={(e) => setEnableFallback(e.target.checked)}
                  className="rounded border-stone-300 text-amber-700"
                />
                <span>
                  Activar respaldo automático al proveedor secundario si el primario falla
                  temporalmente (máx. 1 conmutación usando el modelo y prompt propios del respaldo)
                </span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Tarjeta Gemini */}
            <div className="p-3.5 rounded-xl bg-white border border-stone-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-stone-900">Configuración Google Gemini</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      geminiConfigured
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    Prompt: {geminiConfigured ? `Configurado (v${ai?.geminiPromptVersion || 1})` : 'Sin configurar'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      providersStatus?.geminiConfiguredOnServer
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    API: {providersStatus?.geminiConfiguredOnServer ? 'Activa' : 'Sin configurar'}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-semibold text-stone-600">
                    Modelo Gemini Asignado
                  </label>
                  <button
                    type="button"
                    onClick={() => setCustomGeminiModelMode(!customGeminiModelMode)}
                    className="text-[10px] text-amber-800 hover:underline font-semibold cursor-pointer"
                  >
                    {customGeminiModelMode ? 'Elegir de lista' : 'Escribir modelo manual'}
                  </button>
                </div>
                {customGeminiModelMode ? (
                  <input
                    type="text"
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    placeholder="Ej. gemini-3-flash-preview, gemini-3.1-pro-preview..."
                    className="w-full px-3 py-2 rounded-lg border border-amber-400 bg-amber-50/40 font-mono text-xs"
                  />
                ) : (
                  <select
                    value={geminiModel}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomGeminiModelMode(true);
                      } else {
                        setGeminiModel(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-xs"
                  >
                    {AVAILABLE_GEMINI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} — {m.description}
                      </option>
                    ))}
                    <option value="__custom__">✍️ Escribir ID de modelo manualmente...</option>
                  </select>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => handleTestProviderConnection('gemini')}
                  disabled={testingProvider === 'gemini'}
                  className="px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${testingProvider === 'gemini' ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {testingProvider === 'gemini'
                      ? 'Probando conexión...'
                      : 'Probar Conexión a Gemini API'}
                  </span>
                </button>
                {connectionTestResults.gemini && (
                  <span
                    className={`text-[11px] font-semibold ${
                      connectionTestResults.gemini.connected ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {connectionTestResults.gemini.connected
                      ? `✓ Conectado (${connectionTestResults.gemini.respondedModel} • ${connectionTestResults.gemini.latencyMs}ms)`
                      : '✕ Error de conexión'}
                  </span>
                )}
              </div>
              {connectionTestResults.gemini && !connectionTestResults.gemini.connected && (
                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-950 text-[11px]">
                  {connectionTestResults.gemini.diagnosticAdvice ||
                    connectionTestResults.gemini.errorDetail}
                </div>
              )}
            </div>

            {/* Tarjeta OpenAI GPT */}
            <div className="p-3.5 rounded-xl bg-white border border-stone-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-stone-900">Configuración OpenAI GPT</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      openaiConfigured
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    Prompt: {openaiConfigured ? `Configurado (v${ai?.openaiPromptVersion || 1})` : 'Sin configurar'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      providersStatus?.openaiConfiguredOnServer
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-amber-100 text-amber-900 border border-amber-300'
                    }`}
                  >
                    API: {providersStatus?.openaiConfiguredOnServer ? 'Activa' : 'Respaldo Gemini Activo'}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-semibold text-stone-600">
                    Modelo OpenAI Asignado (Familia GPT-6 / GPT-5 / Manual)
                  </label>
                  <button
                    type="button"
                    onClick={() => setCustomOpenaiModelMode(!customOpenaiModelMode)}
                    className="text-[10px] text-amber-800 hover:underline font-semibold cursor-pointer"
                  >
                    {customOpenaiModelMode ? 'Elegir de lista' : 'Escribir modelo manual'}
                  </button>
                </div>
                {customOpenaiModelMode ? (
                  <input
                    type="text"
                    value={openaiModel}
                    onChange={(e) => setOpenaiModel(e.target.value)}
                    placeholder="Ej. gpt-6-luna, gpt-6-astra, gpt-6.1-sol..."
                    className="w-full px-3 py-2 rounded-lg border border-amber-400 bg-amber-50/40 font-mono text-xs"
                  />
                ) : (
                  <select
                    value={openaiModel}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomOpenaiModelMode(true);
                      } else {
                        setOpenaiModel(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-xs"
                  >
                    {AVAILABLE_OPENAI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} — {m.description}
                      </option>
                    ))}
                    <option value="__custom__">✍️ Escribir ID de modelo manualmente...</option>
                  </select>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => handleTestProviderConnection('openai')}
                  disabled={testingProvider === 'openai'}
                  className="px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${testingProvider === 'openai' ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {testingProvider === 'openai'
                      ? 'Probando conexión...'
                      : 'Probar Conexión a OpenAI API'}
                  </span>
                </button>
                {connectionTestResults.openai && (
                  <span
                    className={`text-[11px] font-semibold ${
                      connectionTestResults.openai.connected ? 'text-emerald-700' : 'text-amber-800'
                    }`}
                  >
                    {connectionTestResults.openai.connected
                      ? `✓ Conectado (${connectionTestResults.openai.respondedModel} • ${connectionTestResults.openai.latencyMs}ms)`
                      : '⚠ Conmutando a Gemini'}
                  </span>
                )}
              </div>
              {connectionTestResults.openai && !connectionTestResults.openai.connected && (
                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-950 text-[11px]">
                  {connectionTestResults.openai.diagnosticAdvice ||
                    connectionTestResults.openai.errorDetail}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveAiConfigAndPrompts}
              disabled={isSavingConfig}
              className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {isSavingConfig ? 'Guardando configuración...' : 'Guardar Motor Conversacional'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* SECCIÓN 2: PERSONALIDAD E INSTRUCCIONES DE IA (PROMPTS INDEPENDIENTES) */}
      {activeTab === 'prompts' && (
        <div className="space-y-5 text-xs">
          {/* Barra de ayuda de variables dinámicas */}
          <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-amber-950">
                Variables Dinámicas Disponibles (clic para insertar en el prompt):
              </span>
              <span className="text-[11px] text-amber-800">
                Si un dato no existe en el PDF del avatar, la variable se omite con elegancia sin inventar información.
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUPPORTED_DYNAMIC_VARIABLES.map((v) => (
                <div
                  key={v.token}
                  className="inline-flex items-center rounded-lg bg-white border border-amber-300 overflow-hidden"
                  title={v.description}
                >
                  <span className="px-2 py-1 font-mono text-[11px] text-stone-800">{v.token}</span>
                  <button
                    type="button"
                    onClick={() => handleInsertVariable('gemini', v.token)}
                    className="px-1.5 py-1 bg-stone-100 hover:bg-stone-200 text-[10px] font-semibold text-stone-700 border-l border-amber-200 cursor-pointer"
                    title="Insertar en Prompt Gemini"
                  >
                    +Gem
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertVariable('openai', v.token)}
                    className="px-1.5 py-1 bg-amber-100 hover:bg-amber-200 text-[10px] font-semibold text-amber-950 border-l border-amber-200 cursor-pointer"
                    title="Insertar en Prompt OpenAI"
                  >
                    +GPT
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* BLOQUE 1: PROMPT PARA GEMINI */}
            <div className="p-4 rounded-xl bg-white border border-stone-200 space-y-3">
              <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                <div>
                  <h4 className="font-serif font-bold text-sm text-stone-900">
                    1. Prompt Independiente para Gemini
                  </h4>
                  <p className="text-[11px] text-stone-500">
                    Versión actual: v{ai?.geminiPromptVersion || 0} •{' '}
                    {geminiPromptContent.length.toLocaleString()} caracteres
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handlePreviewVariables('gemini')}
                    className="px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Vista previa variables</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenSimulator({
                        personId: person.personId,
                        provider: 'gemini',
                        model: geminiModel,
                        draftPromptContent: geminiPromptContent,
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-stone-900 text-amber-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span>Probar Gemini</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Nombre del Prompt Gemini
                  </label>
                  <input
                    type="text"
                    value={geminiPromptName}
                    onChange={(e) => setGeminiPromptName(e.target.value)}
                    placeholder="Ej. Prompt Gemini Cálido y Fiel"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Copiar desde Biblioteca Global (Copia Independiente)
                  </label>
                  <div className="flex gap-1">
                    <select
                      value={selectedLibraryForGemini}
                      onChange={(e) => setSelectedLibraryForGemini(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-stone-300 bg-white text-[11px]"
                    >
                      <option value="">-- Elegir prompt de biblioteca --</option>
                      {promptLibrary
                        .filter(
                          (p) =>
                            p.compatibleProvider === 'gemini' || p.compatibleProvider === 'ambos'
                        )
                        .map((p) => (
                          <option key={p.promptId} value={p.promptId}>
                            {p.name} ({p.category})
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleCopyFromLibrary('gemini')}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold text-[11px] shrink-0 cursor-pointer"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                  Instrucción Completa de Personalidad (Gemini)
                </label>
                <textarea
                  rows={12}
                  value={geminiPromptContent}
                  onChange={(e) => setGeminiPromptContent(e.target.value)}
                  placeholder="Escribe o pega aquí el prompt completo para Gemini (sin límite artificial de extensión; conserva saltos de línea, secciones y reglas)..."
                  className="w-full p-3 rounded-xl border border-stone-300 font-mono text-xs leading-relaxed bg-stone-50/40 focus:bg-white"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setShowVersionHistoryFor(
                      showVersionHistoryFor === 'gemini' ? null : 'gemini'
                    )
                  }
                  className="text-[11px] text-stone-600 hover:text-stone-900 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Historial de versiones Gemini ({geminiVersions.length})</span>
                  {showVersionHistoryFor === 'gemini' ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
                <span className="text-[11px] text-stone-500">
                  {geminiPromptContent.length.toLocaleString()} caracteres
                </span>
              </div>

              {showVersionHistoryFor === 'gemini' && (
                <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200 max-h-44 overflow-y-auto space-y-1.5">
                  {geminiVersions.length === 0 ? (
                    <p className="text-[11px] text-stone-500">
                      Aún no hay versiones guardadas para el prompt Gemini de este avatar.
                    </p>
                  ) : (
                    geminiVersions.map((ver) => (
                      <div
                        key={ver.versionId}
                        className="p-2 rounded bg-white border border-stone-200 flex items-center justify-between gap-2 text-[11px]"
                      >
                        <div>
                          <span className="font-bold text-stone-900">
                            v{ver.versionNumber} — {ver.promptName}
                          </span>
                          <span className="block text-stone-500">
                            {new Date(ver.modifiedAt).toLocaleString('es-MX')} •{' '}
                            {ver.sourceReference || ver.modifiedBy}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRestoreVersion(ver.versionId, ver.versionNumber)}
                          className="px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold shrink-0 cursor-pointer"
                        >
                          Restaurar
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* BLOQUE 2: PROMPT PARA OPENAI GPT */}
            <div className="p-4 rounded-xl bg-white border border-stone-200 space-y-3">
              {/* V5.4.2: each provider has its own prompt; warn when they are not the same text. */}
              {geminiPromptContent.trim() && openaiPromptContent.trim() !== geminiPromptContent.trim() && (
                <div
                  className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-[11px] text-amber-950 flex flex-wrap items-center justify-between gap-2"
                  data-testid="openai-prompt-differs-warning"
                >
                  <span>
                    {openaiPromptContent.trim()
                      ? 'Este prompt de OpenAI GPT es DISTINTO al de Google Gemini. ChatGPT responde con este texto, no con el de Gemini.'
                      : 'OpenAI GPT no tiene prompt propio: usará el de Google Gemini.'}
                  </span>
                  {openaiPromptContent.trim() && (
                    <button
                      type="button"
                      onClick={() => setOpenaiPromptContent(geminiPromptContent)}
                      className="px-2.5 py-1 rounded-lg bg-amber-800 hover:bg-amber-900 text-white font-semibold cursor-pointer"
                    >
                      Usar el mismo prompt que Gemini
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                <div>
                  <h4 className="font-serif font-bold text-sm text-stone-900">
                    2. Prompt Independiente para OpenAI GPT
                  </h4>
                  <p className="text-[11px] text-stone-500">
                    Versión actual: v{ai?.openaiPromptVersion || 0} •{' '}
                    {openaiPromptContent.length.toLocaleString()} caracteres
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handlePreviewVariables('openai')}
                    className="px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Vista previa variables</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenSimulator({
                        personId: person.personId,
                        provider: 'openai',
                        model: openaiModel,
                        draftPromptContent: openaiPromptContent,
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-stone-900 text-amber-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span>Probar OpenAI</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Nombre del Prompt OpenAI GPT
                  </label>
                  <input
                    type="text"
                    value={openaiPromptName}
                    onChange={(e) => setOpenaiPromptName(e.target.value)}
                    placeholder="Ej. Prompt OpenAI GPT Conversacional"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                    Copiar desde Biblioteca Global (Copia Independiente)
                  </label>
                  <div className="flex gap-1">
                    <select
                      value={selectedLibraryForOpenAi}
                      onChange={(e) => setSelectedLibraryForOpenAi(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg border border-stone-300 bg-white text-[11px]"
                    >
                      <option value="">-- Elegir prompt de biblioteca --</option>
                      {promptLibrary
                        .filter(
                          (p) =>
                            p.compatibleProvider === 'openai' || p.compatibleProvider === 'ambos'
                        )
                        .map((p) => (
                          <option key={p.promptId} value={p.promptId}>
                            {p.name} ({p.category})
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleCopyFromLibrary('openai')}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold text-[11px] shrink-0 cursor-pointer"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                  Instrucción Completa de Personalidad (OpenAI GPT)
                </label>
                <textarea
                  rows={12}
                  value={openaiPromptContent}
                  onChange={(e) => setOpenaiPromptContent(e.target.value)}
                  placeholder="Escribe o pega aquí el prompt completo para OpenAI GPT (independiente del prompt de Gemini)..."
                  className="w-full p-3 rounded-xl border border-stone-300 font-mono text-xs leading-relaxed bg-stone-50/40 focus:bg-white"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setShowVersionHistoryFor(
                      showVersionHistoryFor === 'openai' ? null : 'openai'
                    )
                  }
                  className="text-[11px] text-stone-600 hover:text-stone-900 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Historial de versiones OpenAI ({openaiVersions.length})</span>
                  {showVersionHistoryFor === 'openai' ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
                <span className="text-[11px] text-stone-500">
                  {openaiPromptContent.length.toLocaleString()} caracteres
                </span>
              </div>

              {showVersionHistoryFor === 'openai' && (
                <div className="p-2.5 rounded-lg bg-stone-50 border border-stone-200 max-h-44 overflow-y-auto space-y-1.5">
                  {openaiVersions.length === 0 ? (
                    <p className="text-[11px] text-stone-500">
                      Aún no hay versiones guardadas para el prompt OpenAI de este avatar.
                    </p>
                  ) : (
                    openaiVersions.map((ver) => (
                      <div
                        key={ver.versionId}
                        className="p-2 rounded bg-white border border-stone-200 flex items-center justify-between gap-2 text-[11px]"
                      >
                        <div>
                          <span className="font-bold text-stone-900">
                            v{ver.versionNumber} — {ver.promptName}
                          </span>
                          <span className="block text-stone-500">
                            {new Date(ver.modifiedAt).toLocaleString('es-MX')} •{' '}
                            {ver.sourceReference || ver.modifiedBy}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRestoreVersion(ver.versionId, ver.versionNumber)}
                          className="px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold shrink-0 cursor-pointer"
                        >
                          Restaurar
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Vista previa de variables resueltas */}
          {variablePreviewData && (
            <div className="p-4 rounded-xl bg-stone-900 text-stone-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-300">
                  Vista Previa de Variables Dinámicas Resueltas (
                  {variablePreviewData.provider === 'gemini' ? 'Prompt Gemini' : 'Prompt OpenAI GPT'}
                  )
                </span>
                <button
                  type="button"
                  onClick={() => setVariablePreviewData(null)}
                  className="text-stone-400 hover:text-white cursor-pointer"
                >
                  ✕ Cerrar vista previa
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-stone-950 text-stone-200 font-mono text-[11px] whitespace-pre-wrap max-h-56 overflow-y-auto">
                {variablePreviewData.resolvedPrompt}
              </pre>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleSaveAiConfigAndPrompts}
              disabled={isSavingConfig}
              className="px-5 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {isSavingConfig
                  ? 'Guardando y versionando prompts...'
                  : 'Guardar Prompts y Configuración del Avatar'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* SECCIÓN 3: DOCUMENTO DE RECUERDOS (PDF ASOCIADO Y REEMPLAZO ATÓMICO) */}
      {activeTab === 'documento' && (
        <div className="space-y-4 text-xs">
          <div className="p-4 rounded-xl bg-white border border-stone-200 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h4 className="font-serif font-bold text-sm text-stone-900">
                  Documento PDF de Recuerdos Asociado a «{person.fullName}»
                </h4>
                {archivedPdf ? (
                  <>
                    <p className="text-stone-700">
                      Archivo actual: <strong className="font-mono">{archivedPdf.fileName}</strong>{' '}
                      (ID: <span className="font-mono">{archivedPdf.pdfId}</span>)
                    </p>
                    <p className="text-[11px] text-stone-500">
                      Fecha de carga: {new Date(archivedPdf.createdAt).toLocaleString('es-MX')} •
                      Versión documental: <strong>v{ai?.documentVersion || person.version}</strong>{' '}
                      • Bloques indexados exclusivamente para este perfil:{' '}
                      <strong>{testimoniesCount}</strong> • SHA-256:{' '}
                      <span className="font-mono">{archivedPdf.sha256Hash.slice(0, 16)}...</span>
                    </p>
                  </>
                ) : (
                  <p className="text-amber-800">
                    Este perfil aún no tiene un documento PDF de recuerdos asociado.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 ${
                    archivedPdf
                      ? 'bg-emerald-100 text-emerald-900'
                      : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Estado: {archivedPdf ? 'Listo e Indexado' : 'Sin documento'}</span>
                </span>
                {archivedPdf && (
                  <button
                    type="button"
                    onClick={() => onDownloadPdf(archivedPdf.pdfId, archivedPdf.fileName)}
                    className="px-3 py-1.5 rounded-lg bg-stone-900 text-amber-300 font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar PDF Actual</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white border border-stone-200 space-y-3">
            <h5 className="font-bold text-stone-900">
              Reemplazar o Actualizar Documento PDF de Recuerdos (Sustitución Atómica)
            </h5>
            <p className="text-[11px] text-stone-500">
              Al cargar un nuevo documento PDF, el sistema valida su integridad, extrae y reindexa
              automáticamente sus preguntas, respuestas y relaciones familiares, sustituye la base
              documental anterior de este avatar sin mezclarla con otros perfiles e incrementa la
              versión documental.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold text-stone-700">
                  1. Seleccionar archivo PDF (.pdf)
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-700 cursor-pointer">
                  <Upload className="w-4 h-4 text-amber-700" />
                  <span>
                    {replacePdfFileName || 'Seleccionar nuevo archivo PDF de recuerdos...'}
                  </span>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handleReplacePdfFileSelect}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  2. Opcional: Texto compilado de Preguntas y Respuestas literales del PDF
                </label>
                <textarea
                  rows={3}
                  value={replaceRawText}
                  onChange={(e) => setReplaceRawText(e.target.value)}
                  placeholder="### 1. ¿Pregunta literal?&#10;**Respuesta:**&#10;Recuerdo literal del entrevistado..."
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleReplacePdfSubmit}
                disabled={isReplacingPdf}
                className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                {isReplacingPdf ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Procesando y Reindexando PDF...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    <span>Reemplazar PDF y Reindexar Conocimiento del Avatar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
