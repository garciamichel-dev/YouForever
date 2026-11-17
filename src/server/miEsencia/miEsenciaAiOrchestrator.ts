import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import type {
  MiEsenciaPersonProfile,
  MiEsenciaArchivedCompilationPdf,
  MiEsenciaTestimonyBlock,
  MiEsenciaRelatedPerson,
  MiEsenciaMemoryRecord,
  MiEsenciaConfirmedInterlocutorIdentity,
} from '../../logic/miEsenciaRules.ts';
import { sanitizeAvatarResponseText } from '../../logic/miEsenciaRules.ts';
import {
  AVAILABLE_GEMINI_MODELS,
  AVAILABLE_OPENAI_MODELS,
  buildCustomProviderOrchestrationPayload,
  isRecoverableProviderError,
  type MiEsenciaAiProvider,
  type MiEsenciaAvatarAiConfig,
  type MiEsenciaHybridRetrievalMode,
  type MiEsenciaModelOption,
  type MiEsenciaProviderFallbackLog,
  type MiEsenciaStructuredConversationTurn,
} from '../../logic/miEsenciaAiTypesAndRules.ts';

export interface MiEsenciaProvidersStatusSummary {
  geminiConfiguredOnServer: boolean;
  geminiStatusLabel: string;
  openaiConfiguredOnServer: boolean;
  openaiStatusLabel: string;
  gemini: {
    configured: boolean;
    statusLabel: 'Configurado y disponible' | 'No configurado en el servidor';
    availableModels: MiEsenciaModelOption[];
  };
  openai: {
    configured: boolean;
    statusLabel: 'Configurado y disponible' | 'No configurado en el servidor';
    availableModels: MiEsenciaModelOption[];
  };
}

export interface MiEsenciaLiveConnectionTestResult {
  connected: boolean;
  provider: MiEsenciaAiProvider;
  requestedModel: string;
  respondedModel?: string;
  apiKeyConfiguredOnServer: boolean;
  latencyMs: number;
  sampleResponse?: string;
  errorDetail?: string;
  diagnosticAdvice: string;
  timestamp: string;
}

let cachedOpenAiProjectModels: string[] | null = null;
let cachedOpenAiProjectModelsAt = 0;

function hasValidGeminiApiKey(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim() !== '' && key !== 'MY_GEMINI_API_KEY');
}

function hasValidOpenAiApiKey(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key.trim() !== '' && key !== 'MY_OPENAI_API_KEY');
}

export function getProvidersAvailabilityStatus(): MiEsenciaProvidersStatusSummary {
  const geminiReady = hasValidGeminiApiKey();
  const openaiReady = hasValidOpenAiApiKey();
  const geminiLabel = geminiReady ? 'Configurado y disponible' : 'No configurado en el servidor';
  const openaiLabel = openaiReady ? 'Configurado y disponible' : 'No configurado en el servidor';

  return {
    geminiConfiguredOnServer: geminiReady,
    geminiStatusLabel: geminiLabel,
    openaiConfiguredOnServer: openaiReady,
    openaiStatusLabel: openaiLabel,
    gemini: {
      configured: geminiReady,
      statusLabel: geminiLabel,
      availableModels: AVAILABLE_GEMINI_MODELS,
    },
    openai: {
      configured: openaiReady,
      statusLabel: openaiLabel,
      availableModels: AVAILABLE_OPENAI_MODELS,
    },
  };
}

/**
 * Normaliza una lista de turnos previos para que alternen roles limpiamente en Gemini (`user` / `model`).
 */
function buildGeminiMultiTurnContents(
  structuredTurns: MiEsenciaStructuredConversationTurn[] | undefined,
  finalUserContextAndMessage: string
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  if (structuredTurns && structuredTurns.length > 0) {
    for (const turn of structuredTurns) {
      const cleanText = (turn.content || '').trim();
      if (!cleanText) continue;
      const geminiRole: 'user' | 'model' = turn.role === 'assistant' ? 'model' : 'user';
      const last = contents[contents.length - 1];
      if (last && last.role === geminiRole) {
        last.parts[0].text += `\n\n${cleanText}`;
      } else {
        contents.push({
          role: geminiRole,
          parts: [{ text: cleanText }],
        });
      }
    }
  }

  // Gemini requiere que el primer mensaje en contents sea 'user'
  if (contents.length > 0 && contents[0].role === 'model') {
    contents.unshift({
      role: 'user',
      parts: [{ text: '[Inicio de sesión conversacional en Mi Esencia]' }],
    });
  }

  const lastTurn = contents[contents.length - 1];
  if (lastTurn && lastTurn.role === 'user') {
    lastTurn.parts[0].text += `\n\n${finalUserContextAndMessage}`;
  } else {
    contents.push({
      role: 'user',
      parts: [{ text: finalUserContextAndMessage }],
    });
  }

  return contents;
}

/**
 * Ejecuta una llamada al motor Google Gemini enviando el prompt del administrador
 * mediante el mecanismo oficial de instrucciones de sistema (systemInstruction) y el historial multi-turno completo.
 */
async function callGeminiProvider(params: {
  model: string;
  systemInstructions: string;
  userContextAndMessage: string;
  structuredTurns?: MiEsenciaStructuredConversationTurn[];
}): Promise<{ text: string; tokensEstimated: number; respondedModel: string }> {
  if (!hasValidGeminiApiKey()) {
    throw new Error(
      'GEMINI_API_KEY no está configurada en el entorno seguro del servidor (Settings > Secrets).'
    );
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const rawRequestedModel = (params.model || 'gemini-3-flash-preview').trim();
  const normalizedGeminiModel =
    rawRequestedModel === 'gemini-3.8-flash' || rawRequestedModel === 'gemini-2.5-flash'
      ? 'gemini-3-flash-preview'
      : rawRequestedModel === 'gemini-3.1-flash-lite'
      ? 'gemini-3.1-flash-lite-preview'
      : rawRequestedModel;
  const multiTurnContents = buildGeminiMultiTurnContents(
    params.structuredTurns,
    params.userContextAndMessage
  );

  const candidateModels = Array.from(
    new Set([normalizedGeminiModel, 'gemini-3-flash-preview'])
  ).slice(0, 2);

  let lastErr: unknown = null;
  for (const candidateModel of candidateModels) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model: candidateModel,
          contents: multiTurnContents,
          config: {
            systemInstruction: params.systemInstructions,
          },
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Tiempo de espera agotado en Gemini (${candidateModel}).`)),
            20000
          );
        }),
      ]).finally(() => timer && clearTimeout(timer));

      const outputText = (response.text || '').trim();
      if (!outputText) {
        throw new Error('El modelo Gemini devolvió una respuesta vacía.');
      }

      const usageTotal =
        (response as any)?.usageMetadata?.totalTokenCount ||
        Math.ceil(
          (params.systemInstructions.length +
            params.userContextAndMessage.length +
            outputText.length) /
            4
        );

      return {
        text: outputText,
        tokensEstimated: usageTotal,
        respondedModel: candidateModel,
      };
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || '');
      // Si es error de autenticación o cuota, no ciclar modelos
      if (/401|403|API_KEY_INVALID|PERMISSION_DENIED|RESOURCE_EXHAUSTED/i.test(msg)) {
        throw err;
      }
    }
  }

  throw lastErr || new Error('No fue posible obtener respuesta del proveedor Gemini.');
}

/**
 * Ejecuta una llamada oficial a OpenAI GPT utilizando preferentemente Responses API
 * (client.responses.create con instructions de máxima prioridad e input multi-turno)
 * y respaldo compatible a Chat Completions.
 * Si el identificador de modelo de nueva generación (ej. gpt-6) aún no está habilitado en el tier
 * de la cuenta de OpenAI del usuario, intenta de forma transparente con la cadena oficial de OpenAI
 * y reporta el modelo exacto que respondió.
 */
const forbiddenOpenAiModels = new Set<string>([
  'gpt-6',
  'gpt-6-luna',
  'gpt-6-astra',
  'gpt-6.1-sol',
  'gpt-6.1-terra',
]);

async function callOpenAiProvider(params: {
  model: string;
  systemInstructions: string;
  userContextAndMessage: string;
  structuredTurns?: MiEsenciaStructuredConversationTurn[];
}): Promise<{
  text: string;
  tokensEstimated: number;
  respondedModel: string;
  modelCompatibilityNote?: string;
}> {
  if (!hasValidOpenAiApiKey()) {
    throw new Error(
      'OPENAI_API_KEY no está configurada en el servidor (Settings > Secrets). Agrégala como variable de entorno OPENAI_API_KEY para conectar directamente con OpenAI.'
    );
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 12000,
    maxRetries: 0,
  });

  const requestedModel = (params.model || 'gpt-4o').trim();
  const isUnpublishedAlias = (id: string) =>
    /^(gpt-6|gpt-6-luna|gpt-6-astra|gpt-6\.1-sol|gpt-6\.1-terra)$/i.test(id) ||
    forbiddenOpenAiModels.has(id);

  // Descubrir y cachear por 5 minutos qué modelos tiene permitidos el proyecto de OpenAI
  let baseCandidates = [
    ...(isUnpublishedAlias(requestedModel) ? [] : [requestedModel]),
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1-mini',
    'gpt-4.1',
  ].filter((m) => !forbiddenOpenAiModels.has(m));
  try {
    const now = Date.now();
    if (!cachedOpenAiProjectModels || now - cachedOpenAiProjectModelsAt > 5 * 60 * 1000) {
      let listTimer: ReturnType<typeof setTimeout> | undefined;
      const modelsList = await Promise.race([
        client.models.list(),
        new Promise<null>((resolve) => {
          listTimer = setTimeout(() => resolve(null), 2500);
        }),
      ]).finally(() => listTimer && clearTimeout(listTimer));
      if (modelsList) {
        cachedOpenAiProjectModels = (modelsList.data || [])
          .map((m) => m.id)
          .filter((id) => !forbiddenOpenAiModels.has(id));
        cachedOpenAiProjectModelsAt = now;
      }
    }
    const availableIds = (cachedOpenAiProjectModels || []).filter(
      (id) => !forbiddenOpenAiModels.has(id)
    );
    if (availableIds.length > 0) {
      const exactRequestedAvailable = availableIds.includes(requestedModel);
      // V5.4.2: within each family, full models before "mini"/"nano" ones, so an unavailable
      // model is never silently replaced by a much smaller one when a full one exists.
      const fullFirst = (ids: string[]) =>
        [...ids].sort((a, b) => Number(/mini|nano/i.test(a)) - Number(/mini|nano/i.test(b)));
      const preferredOrder = [
        ...(exactRequestedAvailable ? [requestedModel] : []),
        ...fullFirst(
          availableIds.filter(
            (id) => /^gpt-4o/i.test(id) && !/realtime|audio|transcribe|tts|search/i.test(id)
          )
        ),
        ...fullFirst(availableIds.filter((id) => /^gpt-4\.1/i.test(id))),
        ...fullFirst(
          availableIds.filter(
            (id) => /^gpt-5/i.test(id) && !/realtime|audio|transcribe|tts|search/i.test(id)
          )
        ),
        ...fullFirst(availableIds.filter((id) => /^gpt-6/i.test(id))),
        ...availableIds.filter((id) =>
          /^(o4-mini|o3-mini|o3|gpt-4-turbo|gpt-4|gpt-3\.5-turbo)$/i.test(id)
        ),
        ...(!exactRequestedAvailable && !isUnpublishedAlias(requestedModel)
          ? [requestedModel]
          : []),
      ];
      baseCandidates = Array.from(
        new Set([...preferredOrder, ...baseCandidates].filter((id) => !forbiddenOpenAiModels.has(id)))
      );
    }
  } catch {
    // Si la clave no tiene permiso de listar modelos, usar baseCandidates
  }

  // Limit to at most 2 candidates so we never exceed reverse proxy HTTP timeouts
  const candidateModels = Array.from(new Set(baseCandidates)).slice(0, 2);
  const overallDeadline = Date.now() + 18000;

  const priorMessages: Array<{ role: 'user' | 'assistant'; content: string }> = (
    params.structuredTurns || []
  )
    .filter((t) => Boolean(t.content && t.content.trim()))
    .map((t) => ({
      role: t.role,
      content: t.content.trim(),
    }));

  let primaryModelError: unknown = null;
  let lastError: unknown = null;

  for (const targetModel of candidateModels) {
    if (Date.now() > overallDeadline) break;
    const isReasoningModel = /^(gpt-5|gpt-6|o1|o3|o4)/i.test(targetModel);

    // 1. Preferir Responses API oficial de OpenAI con historial multi-turno
    try {
      const responseInput: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...priorMessages,
        { role: 'user', content: params.userContextAndMessage },
      ];

      const response = await client.responses.create({
        model: targetModel,
        instructions: params.systemInstructions,
        input: responseInput as any,
        ...(isReasoningModel ? ({ reasoning: { effort: 'low' } } as any) : {}),
      });

      const outputText = (response.output_text || '').trim();
      if (outputText) {
        const totalTokens =
          (response as any)?.usage?.total_tokens ||
          Math.ceil(
            (params.systemInstructions.length +
              params.userContextAndMessage.length +
              outputText.length) /
              4
          );
        const compatibilityNote =
          targetModel !== requestedModel
            ? `El modelo solicitado (${requestedModel}) no estaba habilitado en tu proyecto de OpenAI; respondió automáticamente ${targetModel} en la API oficial de OpenAI.`
            : undefined;
        return {
          text: outputText,
          tokensEstimated: totalTokens,
          respondedModel: (response as any)?.model || targetModel,
          modelCompatibilityNote: compatibilityNote,
        };
      }
    } catch (responsesErr: any) {
      if (targetModel === requestedModel && !primaryModelError) {
        primaryModelError = responsesErr;
      }
      lastError = responsesErr;
      const errMsg = String(responsesErr?.message || '');
      if (/401|invalid_api_key|incorrect api key|insufficient_quota/i.test(errMsg)) {
        throw responsesErr;
      }
      // If the model itself does not exist or is forbidden, record it and move immediately to the next candidate model
      if (/does not exist|not have access|model_not_found|404|403/i.test(errMsg)) {
        forbiddenOpenAiModels.add(targetModel);
        continue;
      }
    }

    if (Date.now() > overallDeadline) break;

    // 2. Intentar con Chat Completions oficial enviando instrucciones + historial multi-turno completo
    try {
      const completion = await client.chat.completions.create({
        model: targetModel,
        messages: [
          { role: 'developer', content: params.systemInstructions },
          ...priorMessages,
          { role: 'user', content: params.userContextAndMessage },
        ],
      });

      const chatText = (completion.choices?.[0]?.message?.content || '').trim();
      if (chatText) {
        const totalTokens =
          completion.usage?.total_tokens ||
          Math.ceil(
            (params.systemInstructions.length +
              params.userContextAndMessage.length +
              chatText.length) /
              4
          );
        const compatibilityNote =
          targetModel !== requestedModel
            ? `El modelo solicitado (${requestedModel}) no estaba habilitado en tu proyecto de OpenAI; respondió automáticamente ${targetModel} en la API oficial de OpenAI.`
            : undefined;
        return {
          text: chatText,
          tokensEstimated: totalTokens,
          respondedModel: completion.model || targetModel,
          modelCompatibilityNote: compatibilityNote,
        };
      }
    } catch (chatErr: any) {
      if (targetModel === requestedModel && !primaryModelError) {
        primaryModelError = chatErr;
      }
      lastError = chatErr;
      const errMsg = String(chatErr?.message || '');
      if (/does not exist|not have access|model_not_found|404|403/i.test(errMsg)) {
        forbiddenOpenAiModels.add(targetModel);
      }
      if (/401|invalid_api_key|incorrect api key|insufficient_quota/i.test(errMsg)) {
        throw chatErr;
      }
    }
  }

  throw primaryModelError || lastError || new Error('El modelo OpenAI GPT no pudo completar la solicitud.');
}

/**
 * Prueba en vivo la conexión real a la API de OpenAI o Google Gemini desde el servidor.
 * Permite al administrador verificar en 1 clic si las claves del servidor (OPENAI_API_KEY / GEMINI_API_KEY)
 * están conectadas, qué modelo responde exactamente y cuál es la latencia real.
 */
export async function testLiveProviderConnection(params: {
  provider: MiEsenciaAiProvider;
  model?: string;
}): Promise<MiEsenciaLiveConnectionTestResult> {
  const startTime = Date.now();
  const provider = params.provider || 'openai';
  const requestedModel =
    (params.model || '').trim() ||
    (provider === 'openai' ? 'gpt-6' : 'gemini-3-flash-preview');
  const nowIso = new Date().toISOString();

  if (provider === 'openai') {
    const keyReady = hasValidOpenAiApiKey();
    if (!keyReady) {
      return {
        connected: false,
        provider: 'openai',
        requestedModel,
        apiKeyConfiguredOnServer: false,
        latencyMs: Date.now() - startTime,
        errorDetail:
          'La variable de entorno OPENAI_API_KEY no está configurada o está vacía en el servidor.',
        diagnosticAdvice:
          'Para que Mi Esencia se conecte directamente a ChatGPT / OpenAI API, agrega tu clave OPENAI_API_KEY en el panel Settings > Secrets de AI Studio. Mientras no esté configurada, el sistema conmuta automáticamente a Google Gemini (que sí está activo) y avisa al administrador.',
        timestamp: nowIso,
      };
    }

    try {
      const res = await callOpenAiProvider({
        model: requestedModel,
        systemInstructions:
          'Eres un verificador técnico de conectividad de YouForever Mi Esencia. Responde en una sola oración confirmando que la conexión con OpenAI API está activa.',
        userContextAndMessage:
          'Confirma en español que estás conectado correctamente a la API de OpenAI.',
      });

      return {
        connected: true,
        provider: 'openai',
        requestedModel,
        respondedModel: res.respondedModel,
        apiKeyConfiguredOnServer: true,
        latencyMs: Date.now() - startTime,
        sampleResponse: res.text,
        diagnosticAdvice:
          res.modelCompatibilityNote ||
          `Conexión verificada exitosamente con la API oficial de OpenAI (${res.respondedModel}).`,
        timestamp: nowIso,
      };
    } catch (err: unknown) {
      const sanitized = isRecoverableProviderError(err).sanitizedReason;
      let projectModelsInfo = '';
      try {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const list = await client.models.list();
        const ids = (list.data || []).map((m) => m.id);
        projectModelsInfo =
          ids.length > 0
            ? ` Modelos visibles actualmente en tu proyecto de OpenAI: ${ids.slice(0, 15).join(', ')}.`
            : ' Tu proyecto en platform.openai.com tiene bloqueado el acceso a todos los modelos (lista de modelos permitidos vacía).';
      } catch {
        // Ignorar si models.list() también da 403
      }

      const is403ProjectAccess = /does not have access to model|403/i.test(sanitized);
      return {
        connected: false,
        provider: 'openai',
        requestedModel,
        apiKeyConfiguredOnServer: true,
        latencyMs: Date.now() - startTime,
        errorDetail: sanitized,
        diagnosticAdvice: is403ProjectAccess
          ? `Tu clave OPENAI_API_KEY sí está conectada, pero tu proyecto de OpenAI en platform.openai.com tiene restringidos los permisos de modelos (Error 403: el proyecto no tiene permiso para usar el modelo). Entra a https://platform.openai.com/settings/project/limits (Model usage) y habilita el acceso a los modelos GPT en ese proyecto, o genera una API Key sin restricción de modelos.${projectModelsInfo} Mientras tanto, Mi Esencia conmuta automáticamente a Google Gemini con el PDF completo.`
          : `Se encontró OPENAI_API_KEY en el servidor, pero la llamada a OpenAI devolvió un error. Verifica que la clave sea válida, tenga saldo disponible en platform.openai.com y tenga acceso al modelo seleccionado.${projectModelsInfo}`,
        timestamp: nowIso,
      };
    }
  } else {
    const keyReady = hasValidGeminiApiKey();
    if (!keyReady) {
      return {
        connected: false,
        provider: 'gemini',
        requestedModel,
        apiKeyConfiguredOnServer: false,
        latencyMs: Date.now() - startTime,
        errorDetail:
          'La variable de entorno GEMINI_API_KEY no está configurada en el servidor.',
        diagnosticAdvice:
          'Configura GEMINI_API_KEY en Settings > Secrets de AI Studio para habilitar la conexión directa a Google Gemini.',
        timestamp: nowIso,
      };
    }

    try {
      const res = await callGeminiProvider({
        model: requestedModel,
        systemInstructions:
          'Eres un verificador técnico de conectividad de YouForever Mi Esencia. Responde en una sola oración confirmando que la conexión con Google Gemini API está activa.',
        userContextAndMessage:
          'Confirma en español que estás conectado correctamente a la API de Google Gemini.',
      });

      return {
        connected: true,
        provider: 'gemini',
        requestedModel,
        respondedModel: res.respondedModel,
        apiKeyConfiguredOnServer: true,
        latencyMs: Date.now() - startTime,
        sampleResponse: res.text,
        diagnosticAdvice: `Conexión verificada exitosamente con Google Gemini API (${res.respondedModel}).`,
        timestamp: nowIso,
      };
    } catch (err: unknown) {
      const sanitized = isRecoverableProviderError(err).sanitizedReason;
      return {
        connected: false,
        provider: 'gemini',
        requestedModel,
        apiKeyConfiguredOnServer: true,
        latencyMs: Date.now() - startTime,
        errorDetail: sanitized,
        diagnosticAdvice:
          'Se encontró GEMINI_API_KEY en el servidor, pero la llamada devolvió un error. Revisa la configuración de tu clave en Settings > Secrets.',
        timestamp: nowIso,
      };
    }
  }
}

/**
 * Construye una respuesta de emergencia basada en el PDF únicamente cuando AMBOS proveedores (OpenAI y Gemini)
 * fallan simultáneamente en el servidor.
 */
function synthesizePromptGuidedReplyFromPdf(params: {
  resolvedAdminPrompt: string;
  person: MiEsenciaPersonProfile;
  relevantTestimonies: MiEsenciaTestimonyBlock[];
  sharedMemoriesLevelB: MiEsenciaMemoryRecord[];
  privateMemoriesLevelC: MiEsenciaMemoryRecord[];
  confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
}): string {
  const {
    resolvedAdminPrompt,
    person,
    relevantTestimonies,
    sharedMemoriesLevelB,
    privateMemoriesLevelC,
    confirmedIdentity,
  } = params;

  const speaker =
    confirmedIdentity?.affectionateNickname ||
    confirmedIdentity?.declaredName ||
    '';

  const prefixMatch = resolvedAdminPrompt.match(
    /(?:comienza(?:\s+siempre)?\s+con|inicia(?:\s+siempre)?\s+con|usa\s+el\s+saludo)\s+["«“]([^"»”]{2,80})["»”]/i
  );
  const customPrefix = prefixMatch ? `${prefixMatch[1].trim()} ` : '';

  if (relevantTestimonies.length > 0) {
    const primary = relevantTestimonies[0];
    const secondary = relevantTestimonies[1];
    let body = `${customPrefix}${speaker && !customPrefix ? `${speaker}, ` : ''}${primary.answerLiteral}`;
    if (secondary && secondary.testimonyId !== primary.testimonyId) {
      body += `\n\n${secondary.answerLiteral}`;
    }
    if (sharedMemoriesLevelB.length > 0) {
      const latestShared = sharedMemoriesLevelB[sharedMemoriesLevelB.length - 1];
      body += `\n\nAdemás, recuerdo que ${latestShared.attributionText.toLowerCase()}: «${latestShared.content}».`;
    }
    if (privateMemoriesLevelC.length > 0) {
      const latestPriv = privateMemoriesLevelC[privateMemoriesLevelC.length - 1];
      body += `\n\nY entre nosotros tengo muy presente nuestra confidencia: «${latestPriv.content}».`;
    }
    return sanitizeAvatarResponseText(body, person.preferredName);
  }

  return sanitizeAvatarResponseText(
    `${customPrefix}${
      speaker ? `${speaker}, ` : ''
    }no tengo ese detalle específico entre los recuerdos de mi documento biográfico, pero me da mucho gusto platicar contigo y escucharte.`,
    person.preferredName
  );
}

export interface ExecuteCustomAvatarTurnResult {
  replyText: string;
  providerUsed: MiEsenciaAiProvider;
  modelUsed: string;
  requestedProvider: MiEsenciaAiProvider;
  requestedModel: string;
  promptVersionUsed: number;
  retrievalMode: MiEsenciaHybridRetrievalMode;
  fragmentsIncludedCount: number;
  totalDocumentBlocksCount: number;
  durationMs: number;
  tokensEstimated: number;
  fallbackTriggered: boolean;
  fallbackLog?: MiEsenciaProviderFallbackLog;
  resolvedSystemPromptPreview: string;
  sessionContextSummary: string;
  sanitizedErrorWarning?: string;
  adminFallbackNotice?: string;
}

/**
 * Orquestador conversacional multi-proveedor con envío de PDF completo, historial multi-turno + resumen persistente
 * y respaldo automático entre proveedores (Secciones 14, 16, 17 y 18):
 * - Cuando se selecciona OpenAI o Gemini, envía el documento PDF completo de la entrevista, el resumen persistente
 *   de la sesión y todos los turnos previos de la conversación.
 * - Si OpenAI falla o no tiene OPENAI_API_KEY configurada en el servidor, conmuta automáticamente a Gemini
 *   (si está activo) y genera un aviso explícito para el administrador (adminFallbackNotice) sin devolver
 *   respuestas locales falsas que confundan las pruebas.
 */
export async function executeCustomAvatarTurnWithFallback(params: {
  person: MiEsenciaPersonProfile;
  aiConfig: MiEsenciaAvatarAiConfig;
  archivedPdf?: MiEsenciaArchivedCompilationPdf;
  personTestimonies: MiEsenciaTestimonyBlock[];
  personRelations: MiEsenciaRelatedPerson[];
  sharedMemoriesLevelB: MiEsenciaMemoryRecord[];
  privateMemoriesLevelC: MiEsenciaMemoryRecord[];
  confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
  recentMessages: Array<{ sender: 'interlocutor' | 'avatar'; content: string; timestamp?: string }>;
  userMessage: string;
  sessionStartedAt?: string;
  previousLastMessageAt?: string;
  existingSessionSummary?: string;
  overrideProvider?: MiEsenciaAiProvider;
  overrideModel?: string;
  overridePromptContent?: string;
  simulatePrimaryFailure?: boolean;
  simulateBothProvidersFailure?: boolean;
}): Promise<ExecuteCustomAvatarTurnResult> {
  const startTime = Date.now();
  const {
    person,
    aiConfig,
    archivedPdf,
    personTestimonies,
    personRelations,
    sharedMemoriesLevelB,
    privateMemoriesLevelC,
    confirmedIdentity,
    recentMessages,
    userMessage,
    sessionStartedAt,
    previousLastMessageAt,
    existingSessionSummary,
    overrideProvider,
    overrideModel,
    overridePromptContent,
    simulatePrimaryFailure = false,
    simulateBothProvidersFailure = false,
  } = params;

  const primaryProvider: MiEsenciaAiProvider =
    overrideProvider || aiConfig.primaryProvider || 'gemini';
  const secondaryProvider: MiEsenciaAiProvider =
    primaryProvider === 'gemini' ? 'openai' : 'gemini';

  const getProviderSetup = (prov: MiEsenciaAiProvider, isPrimary: boolean) => {
    const model =
      isPrimary && overrideModel
        ? overrideModel
        : prov === 'gemini'
        ? aiConfig.geminiModel || 'gemini-3-flash-preview'
        : aiConfig.openaiModel || 'gpt-6';

    const promptTemplate =
      isPrimary && typeof overridePromptContent === 'string'
        ? overridePromptContent
        : prov === 'gemini'
        ? aiConfig.geminiPromptContent || ''
        : aiConfig.openaiPromptContent || '';

    const promptVersion =
      prov === 'gemini' ? aiConfig.geminiPromptVersion || 1 : aiConfig.openaiPromptVersion || 1;

    return { model, promptTemplate, promptVersion };
  };

  const primarySetup = getProviderSetup(primaryProvider, true);

  if (!primarySetup.promptTemplate.trim()) {
    throw new Error(
      `El prompt de ${
        primaryProvider === 'gemini' ? 'Google Gemini' : 'OpenAI GPT'
      } para ${person.fullName} está vacío. Configura un prompt antes de usar el modo personalizado.`
    );
  }

  const primaryOrchestration = buildCustomProviderOrchestrationPayload({
    adminPromptTemplate: primarySetup.promptTemplate,
    person,
    archivedPdf,
    personTestimonies,
    personRelations,
    sharedMemoriesLevelB,
    privateMemoriesLevelC,
    confirmedIdentity,
    recentMessages,
    userMessage,
    sessionStartedAt,
    previousLastMessageAt,
    existingSessionSummary,
  });

  // Simulación explícita de ambos proveedores no disponibles (PRUEBA 10)
  if (simulateBothProvidersFailure) {
    return {
      replyText:
        'En este momento el servicio conversacional presenta una interrupción temporal. Tus recuerdos e historial permanecen intactos; por favor intenta nuevamente en unos momentos.',
      providerUsed: primaryProvider,
      modelUsed: primarySetup.model,
      requestedProvider: primaryProvider,
      requestedModel: primarySetup.model,
      promptVersionUsed: primarySetup.promptVersion,
      retrievalMode: primaryOrchestration.retrievalMode,
      fragmentsIncludedCount: primaryOrchestration.fragmentsIncludedCount,
      totalDocumentBlocksCount: primaryOrchestration.totalDocumentBlocksCount,
      durationMs: Date.now() - startTime,
      tokensEstimated: 0,
      fallbackTriggered: false,
      resolvedSystemPromptPreview: primaryOrchestration.resolvedAdminPrompt,
      sessionContextSummary: primaryOrchestration.sessionContextSummary,
      sanitizedErrorWarning:
        'Ambos proveedores (Gemini y OpenAI) no estuvieron disponibles para completar la solicitud.',
      adminFallbackNotice:
        'Simulación de contingencia total: ambos proveedores (Gemini y OpenAI) fueron marcados como no disponibles.',
    };
  }

  // 1. Intentar con el proveedor principal enviando PDF completo + historial multi-turno + resumen persistente
  try {
    if (simulatePrimaryFailure) {
      throw new Error(`Fallo técnico recuperable simulado en el proveedor principal (${primaryProvider}).`);
    }

    if (primaryProvider === 'gemini') {
      const result = await callGeminiProvider({
        model: primarySetup.model,
        systemInstructions: primaryOrchestration.systemInstructionsBlock,
        userContextAndMessage: primaryOrchestration.userContextAndMessageBlock,
        structuredTurns: primaryOrchestration.structuredTurns,
      });

      return {
        replyText: result.text.trim(),
        providerUsed: 'gemini',
        modelUsed: result.respondedModel || primarySetup.model,
        requestedProvider: primaryProvider,
        requestedModel: primarySetup.model,
        promptVersionUsed: primarySetup.promptVersion,
        retrievalMode: primaryOrchestration.retrievalMode,
        fragmentsIncludedCount: primaryOrchestration.fragmentsIncludedCount,
        totalDocumentBlocksCount: primaryOrchestration.totalDocumentBlocksCount,
        durationMs: Date.now() - startTime,
        tokensEstimated: result.tokensEstimated,
        fallbackTriggered: false,
        resolvedSystemPromptPreview: primaryOrchestration.resolvedAdminPrompt,
        sessionContextSummary: primaryOrchestration.sessionContextSummary,
      };
    } else {
      const result = await callOpenAiProvider({
        model: primarySetup.model,
        systemInstructions: primaryOrchestration.systemInstructionsBlock,
        userContextAndMessage: primaryOrchestration.userContextAndMessageBlock,
        structuredTurns: primaryOrchestration.structuredTurns,
      });

      return {
        replyText: result.text.trim(),
        providerUsed: 'openai',
        modelUsed: result.respondedModel || primarySetup.model,
        requestedProvider: primaryProvider,
        requestedModel: primarySetup.model,
        promptVersionUsed: primarySetup.promptVersion,
        retrievalMode: primaryOrchestration.retrievalMode,
        fragmentsIncludedCount: primaryOrchestration.fragmentsIncludedCount,
        totalDocumentBlocksCount: primaryOrchestration.totalDocumentBlocksCount,
        durationMs: Date.now() - startTime,
        tokensEstimated: result.tokensEstimated,
        fallbackTriggered: false,
        resolvedSystemPromptPreview: primaryOrchestration.resolvedAdminPrompt,
        sessionContextSummary: primaryOrchestration.sessionContextSummary,
        sanitizedErrorWarning: result.modelCompatibilityNote,
        adminFallbackNotice: result.modelCompatibilityNote,
      };
    }
  } catch (primaryErr: unknown) {
    const errEval = isRecoverableProviderError(primaryErr);

    // 2. Conmutación automática al proveedor secundario (ej. Gemini cuando OpenAI no tiene OPENAI_API_KEY o falla)
    //    Si el segundo proveedor tiene su propio prompt configurado, lo utiliza; si estaba vacío, utiliza el prompt
    //    activo para garantizar que el modelo real (Gemini) responda obedeciendo las instrucciones del administrador.
    const secondarySetup = getProviderSetup(secondaryProvider, false);
    const effectiveSecondaryPrompt =
      secondarySetup.promptTemplate.trim() || primarySetup.promptTemplate.trim();

    const canAttemptSecondaryFallback =
      errEval.recoverable &&
      aiConfig.enableAutomaticFallback !== false &&
      Boolean(effectiveSecondaryPrompt);

    if (canAttemptSecondaryFallback) {
      const secondaryOrchestration = buildCustomProviderOrchestrationPayload({
        adminPromptTemplate: effectiveSecondaryPrompt,
        person,
        archivedPdf,
        personTestimonies,
        personRelations,
        sharedMemoriesLevelB,
        privateMemoriesLevelC,
        confirmedIdentity,
        recentMessages,
        userMessage,
        sessionStartedAt,
        previousLastMessageAt,
        existingSessionSummary,
      });

      const adminNotice =
        primaryProvider === 'openai' && !hasValidOpenAiApiKey()
          ? `AVISO AL ADMINISTRADOR: OpenAI GPT (${primarySetup.model}) está seleccionado, pero OPENAI_API_KEY no está configurada en el servidor (Settings > Secrets). Se conmutó automáticamente a Google Gemini (${secondarySetup.model}) enviando tu prompt y el PDF completo.`
          : `AVISO AL ADMINISTRADOR: El proveedor primario ${primaryProvider.toUpperCase()} (${primarySetup.model}) presentó un fallo (${errEval.sanitizedReason}). Respondió automáticamente el proveedor de respaldo ${secondaryProvider.toUpperCase()} (${secondarySetup.model}) con el PDF completo.`;

      const fallbackLog: MiEsenciaProviderFallbackLog = {
        logId: `fblog_${crypto.randomBytes(5).toString('hex')}`,
        avatarId: person.avatarId,
        personId: person.personId,
        primaryProvider,
        fallbackProviderUsed: secondaryProvider,
        primaryModel: primarySetup.model,
        fallbackModelUsed: secondarySetup.model,
        sanitizedReason: errEval.sanitizedReason,
        timestamp: new Date().toISOString(),
        fallbackProvider: secondaryProvider,
        fallbackModel: secondarySetup.model,
        reason: errEval.sanitizedReason,
      };

      try {
        const secondaryResult =
          secondaryProvider === 'gemini'
            ? await callGeminiProvider({
                model: secondarySetup.model,
                systemInstructions: secondaryOrchestration.systemInstructionsBlock,
                userContextAndMessage: secondaryOrchestration.userContextAndMessageBlock,
                structuredTurns: secondaryOrchestration.structuredTurns,
              })
            : await callOpenAiProvider({
                model: secondarySetup.model,
                systemInstructions: secondaryOrchestration.systemInstructionsBlock,
                userContextAndMessage: secondaryOrchestration.userContextAndMessageBlock,
                structuredTurns: secondaryOrchestration.structuredTurns,
              });

        return {
          replyText: secondaryResult.text.trim(),
          providerUsed: secondaryProvider,
          modelUsed: secondaryResult.respondedModel || secondarySetup.model,
          requestedProvider: primaryProvider,
          requestedModel: primarySetup.model,
          promptVersionUsed: secondarySetup.promptVersion,
          retrievalMode: secondaryOrchestration.retrievalMode,
          fragmentsIncludedCount: secondaryOrchestration.fragmentsIncludedCount,
          totalDocumentBlocksCount: secondaryOrchestration.totalDocumentBlocksCount,
          durationMs: Date.now() - startTime,
          tokensEstimated: secondaryResult.tokensEstimated,
          fallbackTriggered: true,
          fallbackLog,
          resolvedSystemPromptPreview: secondaryOrchestration.resolvedAdminPrompt,
          sessionContextSummary: secondaryOrchestration.sessionContextSummary,
          sanitizedErrorWarning: adminNotice,
          adminFallbackNotice: adminNotice,
        };
      } catch (_secondaryErr: unknown) {
        const guidedSecondaryReply = synthesizePromptGuidedReplyFromPdf({
          resolvedAdminPrompt: secondaryOrchestration.resolvedAdminPrompt,
          person,
          relevantTestimonies: secondaryOrchestration.relevantTestimonies,
          sharedMemoriesLevelB,
          privateMemoriesLevelC,
          confirmedIdentity,
        });

        return {
          replyText: guidedSecondaryReply,
          providerUsed: secondaryProvider,
          modelUsed: secondarySetup.model,
          requestedProvider: primaryProvider,
          requestedModel: primarySetup.model,
          promptVersionUsed: secondarySetup.promptVersion,
          retrievalMode: secondaryOrchestration.retrievalMode,
          fragmentsIncludedCount: secondaryOrchestration.fragmentsIncludedCount,
          totalDocumentBlocksCount: secondaryOrchestration.totalDocumentBlocksCount,
          durationMs: Date.now() - startTime,
          tokensEstimated: Math.ceil(guidedSecondaryReply.length / 4),
          fallbackTriggered: true,
          fallbackLog,
          resolvedSystemPromptPreview: secondaryOrchestration.resolvedAdminPrompt,
          sessionContextSummary: secondaryOrchestration.sessionContextSummary,
          sanitizedErrorWarning: adminNotice,
          adminFallbackNotice: adminNotice,
        };
      }
    }

    // 3. Si el respaldo automático fue desactivado explícitamente y el primario falló
    const guidedPrimaryReply = synthesizePromptGuidedReplyFromPdf({
      resolvedAdminPrompt: primaryOrchestration.resolvedAdminPrompt,
      person,
      relevantTestimonies: primaryOrchestration.relevantTestimonies,
      sharedMemoriesLevelB,
      privateMemoriesLevelC,
      confirmedIdentity,
    });

    const disabledFallbackNotice = `AVISO AL ADMINISTRADOR: El proveedor ${primaryProvider.toUpperCase()} (${primarySetup.model}) falló (${errEval.sanitizedReason}) y el respaldo automático está desactivado.`;

    return {
      replyText: guidedPrimaryReply,
      providerUsed: primaryProvider,
      modelUsed: primarySetup.model,
      requestedProvider: primaryProvider,
      requestedModel: primarySetup.model,
      promptVersionUsed: primarySetup.promptVersion,
      retrievalMode: primaryOrchestration.retrievalMode,
      fragmentsIncludedCount: primaryOrchestration.fragmentsIncludedCount,
      totalDocumentBlocksCount: primaryOrchestration.totalDocumentBlocksCount,
      durationMs: Date.now() - startTime,
      tokensEstimated: Math.ceil(guidedPrimaryReply.length / 4),
      fallbackTriggered: false,
      resolvedSystemPromptPreview: primaryOrchestration.resolvedAdminPrompt,
      sessionContextSummary: primaryOrchestration.sessionContextSummary,
      sanitizedErrorWarning: disabledFallbackNotice,
      adminFallbackNotice: disabledFallbackNotice,
    };
  }
}

/**
 * V5.4.2 — Short text generated with the avatar's configured engine (selected provider and model,
 * falling back to the other provider), e.g. the description of a photo shown in the chat.
 * Returns null when no provider can answer in time; the caller keeps its own safe fallback.
 */
export async function generateAvatarShortText(params: {
  aiConfig: MiEsenciaAvatarAiConfig | undefined;
  systemInstructions: string;
  userText: string;
  timeoutMs?: number;
}): Promise<{ text: string; providerUsed: MiEsenciaAiProvider; modelUsed: string } | null> {
  const ai = params.aiConfig;
  const primary: MiEsenciaAiProvider = ai?.primaryProvider || 'gemini';
  const order: MiEsenciaAiProvider[] =
    ai?.enableAutomaticFallback === false ? [primary] : [primary, primary === 'gemini' ? 'openai' : 'gemini'];
  const timeoutMs = params.timeoutMs ?? 12_000;
  for (const provider of order) {
    const model =
      provider === 'gemini' ? ai?.geminiModel || 'gemini-3-flash-preview' : ai?.openaiModel || 'gpt-6';
    if (provider === 'gemini' ? !hasValidGeminiApiKey() : !hasValidOpenAiApiKey()) continue;
    try {
      const call =
        provider === 'gemini'
          ? callGeminiProvider({ model, systemInstructions: params.systemInstructions, userContextAndMessage: params.userText })
          : callOpenAiProvider({ model, systemInstructions: params.systemInstructions, userContextAndMessage: params.userText });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        call,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]).finally(() => timer && clearTimeout(timer));
      const text = String(result.text || '').trim();
      if (text) return { text, providerUsed: provider, modelUsed: result.respondedModel || model };
    } catch (_err) {
      // try the next provider
    }
  }
  return null;
}
