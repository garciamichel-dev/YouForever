import React, { useState, useEffect } from 'react';
import {
  Play,
  Send,
  RefreshCw,
  Cpu,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Save,
  Trash2,
} from 'lucide-react';
import type { MiEsenciaPersonProfile } from '../../logic/miEsenciaRules';
import {
  AVAILABLE_GEMINI_MODELS,
  AVAILABLE_OPENAI_MODELS,
  type MiEsenciaAiProvider,
  type MiEsenciaLibraryPromptRecord,
} from '../../logic/miEsenciaAiTypesAndRules';

interface SimulatorTurnTelemetry {
  providerUsed: MiEsenciaAiProvider;
  modelUsed: string;
  promptVersionUsed: number;
  documentAccessMode:
    | 'modalidad_a_documento_completo'
    | 'modalidad_a_completo'
    | 'modalidad_b_fragmentos_rag';
  fragmentsCountUsed: number;
  latencyMs: number;
  tokensEstimated: number;
  fallbackActivated: boolean;
  fallbackReason?: string;
  adminFallbackNotice?: string;
  sessionContextSummary?: string;
  pdfAssociatedFileName?: string;
  pdfDocumentStatus?: string;
  resolvedSystemPrompt?: string;
}

interface MiEsenciaSimulatorPanelProps {
  persons: MiEsenciaPersonProfile[];
  promptLibrary: MiEsenciaLibraryPromptRecord[];
  initialPersonId?: string;
  initialProvider?: MiEsenciaAiProvider;
  initialModel?: string;
  initialDraftPrompt?: string;
  adminEmail: string;
  onSavedToAvatar: () => Promise<void>;
  onNotify: (type: 'ok' | 'err', text: string) => void;
}

export const MiEsenciaSimulatorPanel: React.FC<MiEsenciaSimulatorPanelProps> = ({
  persons,
  promptLibrary,
  initialPersonId,
  initialProvider,
  initialModel,
  initialDraftPrompt,
  adminEmail,
  onSavedToAvatar,
  onNotify,
}) => {
  const [selectedPersonId, setSelectedPersonId] = useState<string>(
    initialPersonId || persons[0]?.personId || ''
  );
  const [selectedProvider, setSelectedProvider] = useState<MiEsenciaAiProvider>(
    initialProvider || 'gemini'
  );
  const [selectedModel, setSelectedModel] = useState<string>(
    initialModel || (initialProvider === 'openai' ? 'gpt-6' : 'gemini-3-flash-preview')
  );
  const [customModelMode, setCustomModelMode] = useState<boolean>(false);
  const [draftPrompt, setDraftPrompt] = useState<string>(initialDraftPrompt || '');

  // Interlocutor simulado opcional para probar variables dinámicas
  const [simInterlocutorName, setSimInterlocutorName] = useState<string>('Elena');
  const [simRelationship, setSimRelationship] = useState<string>('Hija');
  const [simNickname, setSimNickname] = useState<string>('mi niña');

  // Historial aislado de simulación
  const [simMessages, setSimMessages] = useState<
    Array<{ sender: 'interlocutor' | 'avatar'; content: string }>
  >([]);
  const [userInput, setUserInput] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isTestingApi, setIsTestingApi] = useState<boolean>(false);
  const [apiConnectionTestResult, setApiConnectionTestResult] = useState<{
    connected: boolean;
    provider: MiEsenciaAiProvider;
    requestedModel: string;
    respondedModel: string;
    latencyMs: number;
    sampleResponse?: string;
    errorDetail?: string;
    diagnosticAdvice?: string;
  } | null>(null);
  const [lastTelemetry, setLastTelemetry] = useState<SimulatorTurnTelemetry | null>(null);
  const [showResolvedPromptInspector, setShowResolvedPromptInspector] = useState<boolean>(false);

  // Cuando cambia el avatar o el proveedor y no hay un borrador explícito inicial, cargar el prompt del avatar
  useEffect(() => {
    const person = persons.find((p) => p.personId === selectedPersonId);
    if (!person) return;
    if (initialDraftPrompt && draftPrompt === initialDraftPrompt) return;

    const ai = person.aiConfig;
    if (selectedProvider === 'openai') {
      const targetModel = ai?.openaiModel || 'gpt-6';
      setSelectedModel(targetModel);
      setCustomModelMode(!AVAILABLE_OPENAI_MODELS.some((m) => m.id === targetModel));
      setDraftPrompt(ai?.openaiPromptContent || '');
    } else {
      const targetModel = ai?.geminiModel || 'gemini-3-flash-preview';
      setSelectedModel(targetModel);
      setCustomModelMode(!AVAILABLE_GEMINI_MODELS.some((m) => m.id === targetModel));
      setDraftPrompt(ai?.geminiPromptContent || '');
    }
  }, [selectedPersonId, selectedProvider]);

  const handleLoadLibraryPromptIntoSimulator = (promptId: string) => {
    const found = promptLibrary.find((p) => p.promptId === promptId);
    if (!found) return;
    setDraftPrompt(found.content);
    onNotify('ok', `Prompt «${found.name}» cargado en el borrador del simulador.`);
  };

  const handleTestLiveApiConnection = async () => {
    setIsTestingApi(true);
    try {
      const res = await fetch('/api/mi-esencia/admin/ai-test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          provider: selectedProvider,
          model: selectedModel,
        }),
      });
      const json = await res.json();
      if (json.data) {
        setApiConnectionTestResult(json.data);
        if (json.data.connected) {
          onNotify(
            'ok',
            `Conexión verificada con ${
              selectedProvider === 'openai' ? 'OpenAI GPT' : 'Google Gemini'
            } (${json.data.respondedModel} • ${json.data.latencyMs} ms).`
          );
        } else {
          onNotify(
            'err',
            json.data.diagnosticAdvice ||
              json.data.errorDetail ||
              'Fallo en la prueba de conexión a la API.'
          );
        }
      }
    } catch (err: any) {
      onNotify('err', err?.message || 'Error al probar conexión con la API.');
    } finally {
      setIsTestingApi(false);
    }
  };

  const handleSendSimulatedTurn = async (options?: {
    simulatePrimaryFailure?: boolean;
    simulateBothProvidersFailure?: boolean;
    presetMessage?: string;
  }) => {
    const messageToSend = (options?.presetMessage ?? userInput).trim();
    if (!messageToSend || !selectedPersonId) return;

    setIsSending(true);
    if (!options?.presetMessage) {
      setUserInput('');
    }

    try {
      const res = await fetch('/api/mi-esencia/admin/simulator/converse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          personId: selectedPersonId,
          provider: selectedProvider,
          model: selectedModel,
          draftPromptContent: draftPrompt,
          userMessage: messageToSend,
          simulatedHistory: simMessages,
          simulatedInterlocutorName: simInterlocutorName,
          simulatedRelationship: simRelationship,
          simulatedNickname: simNickname,
          simulatePrimaryFailure: Boolean(options?.simulatePrimaryFailure),
          simulateBothProvidersFailure: Boolean(options?.simulateBothProvidersFailure),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'Error en la simulación conversacional.');
        return;
      }

      const data = json.data;
      setSimMessages((prev) => [
        ...prev,
        { sender: 'interlocutor', content: messageToSend },
        { sender: 'avatar', content: data.replyText },
      ]);
      setLastTelemetry({
        providerUsed: data.providerUsed,
        modelUsed: data.modelUsed,
        promptVersionUsed: data.promptVersionUsed,
        documentAccessMode: data.documentAccessMode,
        fragmentsCountUsed: data.fragmentsCountUsed,
        latencyMs: data.latencyMs,
        tokensEstimated: data.tokensEstimated,
        fallbackActivated: data.fallbackActivated,
        fallbackReason: data.fallbackReason,
        adminFallbackNotice: data.adminFallbackNotice,
        sessionContextSummary: data.sessionContextSummary,
        pdfAssociatedFileName: data.pdfAssociatedFileName,
        pdfDocumentStatus: data.pdfDocumentStatus,
        resolvedSystemPrompt: data.resolvedSystemPrompt,
      });

      if (data.fallbackActivated && data.adminFallbackNotice) {
        onNotify('err', data.adminFallbackNotice);
      }
    } catch (err: any) {
      onNotify('err', err?.message || 'Error al ejecutar simulación.');
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveDraftToAvatarProduction = async () => {
    if (!selectedPersonId || !draftPrompt.trim()) {
      onNotify('err', 'Selecciona un avatar y asegúrate de que el prompt no esté vacío.');
      return;
    }
    try {
      const bodyPayload: Record<string, any> = {
        personId: selectedPersonId,
        conversationConfigMode: 'modo_personalizado',
        primaryProvider: selectedProvider,
      };
      if (selectedProvider === 'openai') {
        bodyPayload.openaiModel = selectedModel;
        bodyPayload.openaiPromptContent = draftPrompt;
      } else {
        bodyPayload.geminiModel = selectedModel;
        bodyPayload.geminiPromptContent = draftPrompt;
      }

      const res = await fetch('/api/mi-esencia/admin/persons/ai-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify(bodyPayload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo guardar el borrador en el avatar.');
        return;
      }
      onNotify(
        'ok',
        `Prompt probado guardado como configuración activa (${selectedProvider.toUpperCase()}) del avatar.`
      );
      await onSavedToAvatar();
    } catch {
      onNotify('err', 'Error al guardar prompt probado en el avatar.');
    }
  };

  const availableModels =
    selectedProvider === 'openai' ? AVAILABLE_OPENAI_MODELS : AVAILABLE_GEMINI_MODELS;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-amber-800 text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              <span>Entorno Administrativo Aislado</span>
            </div>
            <h3 className="font-serif text-xl text-stone-900 mt-0.5">
              Simulador de Prompts («Probar Conversación»)
            </h3>
            <p className="text-xs text-stone-500 max-w-2xl">
              Prueba cualquier prompt guardado o en borrador enviando el{' '}
              <strong>documento PDF completo con todas las respuestas del entrevistado</strong> y el
              historial multi-turno íntegro. Las pruebas aquí nunca alteran las conversaciones de los
              familiares.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleTestLiveApiConnection}
              disabled={isTestingApi}
              className="px-3.5 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>
                {isTestingApi
                  ? 'Verificando API...'
                  : `Probar Conexión Real a ${selectedProvider === 'openai' ? 'OpenAI' : 'Gemini'}`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSimMessages([]);
                setLastTelemetry(null);
              }}
              className="px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpiar Sesión de Prueba</span>
            </button>
            <button
              type="button"
              onClick={handleSaveDraftToAvatarProduction}
              className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Aplicar este Prompt y Proveedor al Avatar en Producción</span>
            </button>
          </div>
        </div>

        {/* Resultado de prueba en vivo de conexión a la API */}
        {apiConnectionTestResult && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ${
              apiConnectionTestResult.connected
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-amber-50 border-amber-300 text-amber-950'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                {apiConnectionTestResult.connected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                )}
                <span>
                  {apiConnectionTestResult.connected
                    ? `Conexión Real Verificada con ${
                        apiConnectionTestResult.provider === 'openai'
                          ? 'OpenAI API'
                          : 'Google Gemini API'
                      }`
                    : `Atención en Conexión con ${
                        apiConnectionTestResult.provider === 'openai'
                          ? 'OpenAI API'
                          : 'Google Gemini API'
                      }`}
                </span>
              </div>
              <p className="text-[11px]">
                Modelo solicitado: <strong className="font-mono">{apiConnectionTestResult.requestedModel}</strong>{' '}
                • Modelo que respondió:{' '}
                <strong className="font-mono">{apiConnectionTestResult.respondedModel}</strong> •
                Latencia: <strong>{apiConnectionTestResult.latencyMs} ms</strong>
              </p>
              {apiConnectionTestResult.sampleResponse && (
                <p className="text-[11px] font-mono bg-white/80 px-2 py-1 rounded border border-emerald-200">
                  Respuesta de verificación: {apiConnectionTestResult.sampleResponse}
                </p>
              )}
              {apiConnectionTestResult.errorDetail && (
                <p className="text-[11px] text-red-800 font-medium">
                  Detalle técnico: {apiConnectionTestResult.errorDetail}
                </p>
              )}
              {apiConnectionTestResult.diagnosticAdvice && (
                <p className="text-[11px] font-medium">
                  Diagnóstico: {apiConnectionTestResult.diagnosticAdvice}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setApiConnectionTestResult(null)}
              className="text-[11px] underline shrink-0 self-start sm:self-center cursor-pointer"
            >
              Cerrar diagnóstico
            </button>
          </div>
        )}

        {/* Selectores del Simulador */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-stone-100 text-xs">
          <div>
            <label className="block font-semibold text-stone-700 mb-1">1. Avatar y PDF Real</label>
            <select
              value={selectedPersonId}
              onChange={(e) => setSelectedPersonId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
            >
              {persons.map((p) => (
                <option key={p.personId} value={p.personId}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-stone-700 mb-1">
              2. Proveedor a Simular
            </label>
            <select
              value={selectedProvider}
              onChange={(e) => {
                const nextProv = e.target.value as MiEsenciaAiProvider;
                setSelectedProvider(nextProv);
                setCustomModelMode(false);
                setSelectedModel(
                  nextProv === 'openai' ? 'gpt-6' : 'gemini-3-flash-preview'
                );
              }}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white font-semibold"
            >
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI GPT</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="block font-semibold text-stone-700">
                3. Modelo (GPT-6 / GPT-5 / Manual)
              </label>
              <button
                type="button"
                onClick={() => setCustomModelMode(!customModelMode)}
                className="text-[10px] text-amber-800 hover:underline font-semibold cursor-pointer"
              >
                {customModelMode ? 'Elegir de lista' : 'Escribir manual'}
              </button>
            </div>
            {customModelMode ? (
              <input
                type="text"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="Ej. gpt-6, gpt-6-pro, gpt-5..."
                className="w-full px-3 py-2 rounded-xl border border-amber-400 bg-amber-50/40 font-mono text-xs"
              />
            ) : (
              <select
                value={selectedModel}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setCustomModelMode(true);
                  } else {
                    setSelectedModel(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="__custom__">✍️ Escribir ID de modelo manualmente...</option>
              </select>
            )}
          </div>

          <div>
            <label className="block font-semibold text-stone-700 mb-1">
              4. Cargar desde Biblioteca
            </label>
            <select
              onChange={(e) => {
                if (e.target.value) handleLoadLibraryPromptIntoSimulator(e.target.value);
              }}
              defaultValue=""
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
            >
              <option value="">-- Cargar plantilla en borrador --</option>
              {promptLibrary.map((p) => (
                <option key={p.promptId} value={p.promptId}>
                  {p.name} ({p.compatibleProvider.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Datos de interlocutor simulado para probar variables dinámicas */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-stone-600 mb-1">
              Interlocutor Simulado (`{"{{nombre_interlocutor}}"}`)
            </label>
            <input
              type="text"
              value={simInterlocutorName}
              onChange={(e) => setSimInterlocutorName(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-stone-600 mb-1">
              Parentesco Simulado (`{"{{parentesco}}"}`)
            </label>
            <input
              type="text"
              value={simRelationship}
              onChange={(e) => setSimRelationship(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-stone-600 mb-1">
              Apodo Simulado (`{"{{apodo}}"}`)
            </label>
            <input
              type="text"
              value={simNickname}
              onChange={(e) => setSimNickname(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white"
            />
          </div>
        </div>
      </div>

      {/* Área principal dividida: Borrador del Prompt en Vivo + Conversación y Telemetría */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna izquierda: Editor de prompt en borrador */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-stone-200 p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h4 className="font-serif font-bold text-sm text-stone-900">
              Prompt en Prueba (Borrador Editable en Vivo)
            </h4>
            <span className="text-[11px] text-stone-500">
              {draftPrompt.length.toLocaleString()} caracteres
            </span>
          </div>
          <textarea
            rows={16}
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            placeholder="Escribe o edita aquí las instrucciones de personalidad para probar cómo responde el avatar con su PDF real completo..."
            className="w-full p-3 rounded-xl border border-stone-300 font-mono text-xs leading-relaxed bg-stone-50/50 focus:bg-white"
          />
          <p className="text-[11px] text-stone-500">
            Cualquier ajuste en este cuadro se aplica en el siguiente mensaje de prueba enviando el
            PDF completo del avatar junto con el historial multi-turno completo.
          </p>
        </div>

        {/* Columna derecha: Chat de simulación + Telemetría administrativa */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-2xl border border-stone-200 p-5 flex flex-col h-[460px]">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-3">
              <span className="font-serif font-bold text-sm text-stone-900">
                Conversación de Prueba con el Avatar
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    handleSendSimulatedTurn({
                      simulatePrimaryFailure: true,
                      presetMessage:
                        userInput.trim() ||
                        'Cuéntame qué recuerdas de nuestra familia y de tus vivencias.',
                    })
                  }
                  disabled={isSending}
                  className="px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 text-[11px] font-semibold cursor-pointer"
                  title="Simula un error técnico en el proveedor principal para verificar la conmutación automática al proveedor secundario"
                >
                  Probar Respaldo Automático
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSendSimulatedTurn({
                      simulateBothProvidersFailure: true,
                      presetMessage:
                        userInput.trim() || 'Hola, ¿puedes escucharme en este momento?',
                    })
                  }
                  disabled={isSending}
                  className="px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-[11px] font-medium cursor-pointer"
                  title="Simula la caída simultánea de ambos proveedores para verificar el mensaje cálido de contingencia sin exponer detalles técnicos"
                >
                  Probar Contingencia Total
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {simMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-stone-400 text-xs space-y-2">
                  <Play className="w-8 h-8 text-amber-600/60" />
                  <p className="font-medium text-stone-600">
                    Envía un mensaje para probar la respuesta del avatar con el proveedor, modelo y
                    prompt seleccionados.
                  </p>
                  <p className="text-[11px]">
                    El simulador enviará el archivo PDF completo asignado a este avatar con todas
                    las respuestas del entrevistado.
                  </p>
                </div>
              ) : (
                simMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${
                      msg.sender === 'interlocutor' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                        msg.sender === 'interlocutor'
                          ? 'bg-stone-900 text-amber-200'
                          : 'bg-stone-100 text-stone-900 border border-stone-200'
                      }`}
                    >
                      <span className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-0.5">
                        {msg.sender === 'interlocutor'
                          ? `${simRelationship} ${simInterlocutorName}`
                          : 'Avatar (Simulación)'}
                      </span>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendSimulatedTurn();
              }}
              className="pt-3 border-t border-stone-200 flex gap-2 mt-3"
            >
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Escribe una pregunta sobre los recuerdos del PDF del avatar..."
                disabled={isSending}
                className="flex-1 px-3.5 py-2 rounded-xl border border-stone-300 text-xs"
              />
              <button
                type="submit"
                disabled={isSending || !userInput.trim()}
                className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>Enviar</span>
              </button>
            </form>
          </div>

          {/* Telemetría Administrativa del Turno (Sección 19.2) */}
          {lastTelemetry && (
            <div className="bg-stone-900 text-stone-100 rounded-2xl p-4 space-y-3 text-xs border border-stone-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-amber-300 flex items-center gap-1.5">
                  <Cpu className="w-4 h-4" />
                  <span>Telemetría Administrativa de la Respuesta</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowResolvedPromptInspector(!showResolvedPromptInspector)}
                  className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-amber-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3 h-3" />
                  <span>
                    {showResolvedPromptInspector
                      ? 'Ocultar Prompt y PDF Ensamblado'
                      : 'Inspeccionar Prompt + PDF Completo Enviado'}
                  </span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-[11px]">
                <div className="p-2.5 rounded-xl bg-stone-950/80 border border-stone-800">
                  <span className="text-stone-400 block">Proveedor Utilizado</span>
                  <strong className="text-emerald-300 uppercase">
                    {lastTelemetry.providerUsed === 'openai' ? 'OpenAI GPT' : 'Google Gemini'}
                  </strong>
                </div>
                <div className="p-2.5 rounded-xl bg-stone-950/80 border border-stone-800">
                  <span className="text-stone-400 block">Modelo Ejecutado</span>
                  <strong className="text-white font-mono">{lastTelemetry.modelUsed}</strong>
                </div>
                <div className="p-2.5 rounded-xl bg-stone-950/80 border border-stone-800">
                  <span className="text-stone-400 block">Versión del Prompt</span>
                  <strong className="text-white">v{lastTelemetry.promptVersionUsed}</strong>
                </div>
                <div className="p-2.5 rounded-xl bg-stone-950/80 border border-stone-800">
                  <span className="text-stone-400 block">Modalidad Documental PDF</span>
                  <strong className="text-amber-300">
                    {lastTelemetry.documentAccessMode === 'modalidad_a_documento_completo' ||
                    lastTelemetry.documentAccessMode === 'modalidad_a_completo'
                      ? `Modalidad A (PDF Completo • ${lastTelemetry.fragmentsCountUsed} respuestas)`
                      : `Modalidad B (RAG • ${lastTelemetry.fragmentsCountUsed} fragmentos)`}
                  </strong>
                </div>
                <div className="p-2.5 rounded-xl bg-stone-950/80 border border-stone-800">
                  <span className="text-stone-400 block">Tiempo de Respuesta</span>
                  <strong className="text-white">{lastTelemetry.latencyMs} ms</strong>
                </div>
                <div className="p-2.5 rounded-xl bg-stone-950/80 border border-stone-800">
                  <span className="text-stone-400 block">Respaldo Automático</span>
                  <strong
                    className={
                      lastTelemetry.fallbackActivated ? 'text-amber-400' : 'text-emerald-400'
                    }
                  >
                    {lastTelemetry.fallbackActivated
                      ? 'Conmutado a Respaldo (Ver Aviso)'
                      : 'No requerido (Primario OK)'}
                  </strong>
                </div>
              </div>

              {(lastTelemetry.adminFallbackNotice ||
                (lastTelemetry.fallbackActivated && lastTelemetry.fallbackReason)) && (
                <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-[11px] space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Aviso al Administrador — Conmutación Automática de Proveedor:</span>
                  </div>
                  <p>
                    {lastTelemetry.adminFallbackNotice ||
                      `El proveedor primario presentó un fallo (${lastTelemetry.fallbackReason}) y el sistema conmutó automáticamente al proveedor secundario enviando tu prompt y el PDF completo.`}
                  </p>
                </div>
              )}

              {showResolvedPromptInspector && lastTelemetry.resolvedSystemPrompt && (
                <pre className="p-3 rounded-xl bg-stone-950 text-stone-300 font-mono text-[11px] whitespace-pre-wrap max-h-60 overflow-y-auto border border-stone-800">
                  {lastTelemetry.resolvedSystemPrompt}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
