import crypto from 'crypto';
import type {
  MiEsenciaPersonProfile,
  MiEsenciaArchivedCompilationPdf,
  MiEsenciaTestimonyBlock,
  MiEsenciaRelatedPerson,
  MiEsenciaMemoryRecord,
  MiEsenciaConfirmedInterlocutorIdentity,
} from './miEsenciaRules.ts';
import { retrieveRelevantTestimonies, queryFamilyMapFromLegacy } from './miEsenciaRules.ts';
import { normalizeOpenAiModelId } from './openAiModelIds.ts';

// ============================================================================
// MI ESENCIA — DUAL AI PROVIDERS (GEMINI & OPENAI), PROMPT LIBRARY,
// VERSIONING, DYNAMIC VARIABLES & HYBRID PDF RAG ENGINE
// ============================================================================

export type MiEsenciaAiProvider = 'gemini' | 'openai';
export type MiEsenciaPromptCompatibleProvider = 'gemini' | 'openai' | 'ambos';
export type MiEsenciaConversationConfigMode = 'modo_existente' | 'modo_personalizado';
export type MiEsenciaDocumentProcessingStatus =
  | 'listo'
  | 'procesando'
  | 'error'
  | 'sin_documento';
export type MiEsenciaHybridRetrievalMode =
  | 'modalidad_a_documento_completo'
  | 'modalidad_b_fragmentos_rag';

export interface MiEsenciaModelOption {
  id: string;
  provider: MiEsenciaAiProvider;
  label: string;
  description: string;
  contextWindowTokens: number;
  supportsFullDocumentContext: boolean;
  recommended?: boolean;
}

export const AVAILABLE_GEMINI_MODELS: MiEsenciaModelOption[] = [
  {
    id: 'gemini-3.8-flash',
    provider: 'gemini',
    label: 'Gemini 3.8 Flash (Predeterminado)',
    description:
      'Modelo Flash más reciente. Si falla en un mensaje, responde un modelo de respaldo sin que el visitante lo note; el siguiente mensaje vuelve a intentar con 3.8 Flash.',
    contextWindowTokens: 1_000_000,
    supportsFullDocumentContext: true,
    recommended: true,
  },
  {
    id: 'gemini-3-flash-preview',
    provider: 'gemini',
    label: 'Gemini 3 Flash Preview (Respaldo automático)',
    description: 'Alta velocidad, baja latencia y amplio contexto documental para conversación biográfica.',
    contextWindowTokens: 1_000_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gemini-flash-latest',
    provider: 'gemini',
    label: 'Gemini Flash Latest',
    description: 'Alias estable hacia la versión vigente de la familia Gemini Flash.',
    contextWindowTokens: 1_000_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash Lite',
    description: 'Modelo ligero optimizado para máxima eficiencia de costos y respuestas ágiles.',
    contextWindowTokens: 500_000,
    supportsFullDocumentContext: true,
  },
];

export const AVAILABLE_OPENAI_MODELS: MiEsenciaModelOption[] = [
  // V5.6.3: real OpenAI API identifiers of the GPT-6 family ("gpt-6" alone is not an API model;
  // configurations saved with it use gpt-6-luna — see openAiModelIds.ts).
  {
    id: 'gpt-6-luna',
    provider: 'openai',
    label: 'GPT-6 Luna (Predeterminado — Ágil y Eficiente)',
    description: 'El modelo más rápido y económico de la familia GPT-6, pensado para conversaciones frecuentes y de alto volumen.',
    contextWindowTokens: 1_050_000,
    supportsFullDocumentContext: true,
    recommended: true,
  },
  {
    id: 'gpt-6-astra',
    provider: 'openai',
    label: 'GPT-6 Astra (El más capaz de OpenAI)',
    description: 'Modelo insignia de OpenAI para el razonamiento más exigente; también el de mayor costo.',
    contextWindowTokens: 1_050_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gpt-6.1-sol',
    provider: 'openai',
    label: 'GPT-6.1 Sol (Calidad cercana a Astra)',
    description: 'Alta calidad de redacción y razonamiento a un costo menor que Astra.',
    contextWindowTokens: 1_050_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gpt-6-sol',
    provider: 'openai',
    label: 'GPT-6 Sol',
    description: 'Nivel intermedio de la familia GPT-6 para razonamiento cotidiano.',
    contextWindowTokens: 1_050_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gpt-6.1-terra',
    provider: 'openai',
    label: 'GPT-6.1 Terra (Equilibrio velocidad / capacidad)',
    description: 'Equilibrio entre baja latencia y comprensión de entrevistas completas.',
    contextWindowTokens: 1_050_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gpt-5',
    provider: 'openai',
    label: 'GPT-5 (Flagship Multimodal)',
    description: 'Modelo multimodal de alta precisión documental y seguimiento riguroso de instrucciones.',
    contextWindowTokens: 1_000_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gpt-5.5-pro',
    provider: 'openai',
    label: 'GPT-5.5 Pro',
    description: 'Versión profesional de la serie GPT-5 para análisis detallado de testimonios y memoria.',
    contextWindowTokens: 1_000_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gpt-5-mini',
    provider: 'openai',
    label: 'GPT-5 Mini',
    description: 'Modelo rápido de la familia GPT-5 con excelente relación velocidad/contexto.',
    contextWindowTokens: 500_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gpt-4.1',
    provider: 'openai',
    label: 'GPT-4.1 (Compatibilidad Extendida)',
    description: 'Modelo con ventana de 1M de tokens y seguimiento estricto de prompts extensos.',
    contextWindowTokens: 1_000_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    label: 'GPT-4.1 Mini',
    description: 'Balance entre seguimiento de instrucciones personalizadas, velocidad y costo.',
    contextWindowTokens: 1_000_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    label: 'GPT-4o (Compatibilidad)',
    description: 'Modelo multimodal compatible con cuentas de todos los niveles de facturación OpenAI.',
    contextWindowTokens: 128_000,
    supportsFullDocumentContext: true,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    label: 'GPT-4o Mini (Compatibilidad)',
    description: 'Modelo rápido compatible para pruebas de conectividad y cuentas iniciales.',
    contextWindowTokens: 128_000,
    supportsFullDocumentContext: true,
  },
];

export const DEFAULT_PROMPT_CATEGORIES: string[] = [
  'Conversación familiar',
  'Personalidad cálida',
  'Narración autobiográfica',
  'Conversación profunda',
  'Estilos personalizados',
  'Experimentales',
];

/**
 * Versión histórica de un prompt (tanto de la biblioteca global como de un avatar individual).
 */
export interface MiEsenciaPromptVersionRecord {
  versionId: string;
  targetType: 'library_prompt' | 'avatar_gemini_prompt' | 'avatar_openai_prompt';
  targetId: string; // promptId de biblioteca o personId del avatar
  provider: MiEsenciaPromptCompatibleProvider;
  versionNumber: number;
  promptName: string;
  content: string;
  modifiedAt: string;
  modifiedBy: string;
  sourceReference?: string; // Ej. ID de prompt de biblioteca o nota de restauración
}

/**
 * Registro de la Biblioteca Global de Prompts (Administrador de Prompts).
 */
export interface MiEsenciaLibraryPromptRecord {
  promptId: string;
  name: string;
  description?: string;
  category: string;
  compatibleProvider: MiEsenciaPromptCompatibleProvider;
  content: string;
  version: number;
  status: 'disponible' | 'archivado';
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  versionHistory: MiEsenciaPromptVersionRecord[];
}

/**
 * Configuración conversacional de IA por perfil de Avatar (extendida de forma retrocompatible).
 */
export interface MiEsenciaAvatarAiConfig {
  conversationConfigMode: MiEsenciaConversationConfigMode; // 'modo_existente' conserva comportamiento original
  primaryProvider: MiEsenciaAiProvider;
  enableAutomaticFallback: boolean;
  geminiModel: string;
  geminiPromptName: string;
  geminiPromptContent: string;
  geminiPromptVersion: number;
  geminiPromptSourceLibraryId?: string;
  geminiConfigStatus: 'configurado' | 'sin_configurar';
  openaiModel: string;
  openaiPromptName: string;
  openaiPromptContent: string;
  openaiPromptVersion: number;
  openaiPromptSourceLibraryId?: string;
  openaiConfigStatus: 'configurado' | 'sin_configurar';
  documentVersion: number;
  documentProcessingStatus: MiEsenciaDocumentProcessingStatus;
  documentLastProcessedAt?: string;
  updatedAt: string;
  updatedBy: string;
}

/**
 * Registro administrativo de eventos de respaldo automático entre proveedores.
 */
export interface MiEsenciaProviderFallbackLog {
  logId: string;
  avatarId: string;
  personId: string;
  primaryProvider: MiEsenciaAiProvider;
  fallbackProviderUsed: MiEsenciaAiProvider;
  primaryModel: string;
  fallbackModelUsed: string;
  sanitizedReason: string;
  timestamp: string;
  fallbackProvider?: MiEsenciaAiProvider;
  fallbackModel?: string;
  reason?: string;
}

export type MiEsenciaProviderFallbackLogRecord = MiEsenciaProviderFallbackLog;

export interface MiEsenciaProvidersAvailabilityStatus {
  geminiConfiguredOnServer: boolean;
  geminiStatusLabel: string;
  openaiConfiguredOnServer: boolean;
  openaiStatusLabel: string;
  gemini?: {
    configured: boolean;
    statusLabel: string;
    availableModels: MiEsenciaModelOption[];
  };
  openai?: {
    configured: boolean;
    statusLabel: string;
    availableModels: MiEsenciaModelOption[];
  };
}

/**
 * Descripción y ejemplo de las variables dinámicas soportadas en los prompts.
 */
export interface MiEsenciaDynamicVariableDescriptor {
  token: string;
  label: string;
  description: string;
  resolvedValuePreview: string;
}

export const SUPPORTED_DYNAMIC_VARIABLES: Array<{
  token: string;
  key: string;
  label: string;
  description: string;
}> = [
  {
    token: '{{nombre_entrevistado}}',
    key: 'nombre_entrevistado',
    label: 'Nombre del entrevistado',
    description: 'Nombre completo documentado de la persona cuyo legado responde.',
  },
  {
    token: '{{nombre_avatar}}',
    key: 'nombre_avatar',
    label: 'Nombre corto / preferido del avatar',
    description: 'Nombre preferido o cercano del perfil biográfico activo.',
  },
  {
    token: '{{nombre_interlocutor}}',
    key: 'nombre_interlocutor',
    label: 'Nombre del interlocutor',
    description: 'Nombre propio confirmado o declarado por el familiar en la conversación.',
  },
  {
    token: '{{parentesco}}',
    key: 'parentesco',
    label: 'Parentesco con el entrevistado',
    description: 'Vínculo o parentesco confirmado con el entrevistado (sin inventar si no se conoce).',
  },
  {
    token: '{{apodo}}',
    key: 'apodo',
    label: 'Apodo afectivo documentado',
    description: 'Apodo cariñoso respaldado en el legado para el interlocutor actual.',
  },
  {
    token: '{{fecha_actual}}',
    key: 'fecha_actual',
    label: 'Fecha actual',
    description: 'Fecha actual en formato legible en español.',
  },
  {
    token: '{{contexto_familiar}}',
    key: 'contexto_familiar',
    label: 'Mapa de contexto familiar documentado',
    description: 'Resumen estructurado de los familiares y vínculos extraídos del PDF del entrevistado.',
  },
];

export const DEFAULT_SEED_LIBRARY_PROMPTS: Omit<
  MiEsenciaLibraryPromptRecord,
  'createdAt' | 'updatedAt' | 'versionHistory'
>[] = [
  {
    promptId: 'lib_prompt_calido_familiar',
    name: 'Conversación familiar cálida y natural',
    description:
      'Estilo cercano, afectuoso y reflexivo en primera persona, ideal para pláticas cotidianas con hijos, nietos y pareja.',
    category: 'Conversación familiar',
    compatibleProvider: 'ambos',
    content: `Eres la recreación conversacional de {{nombre_entrevistado}} ({{nombre_avatar}}).
Conversas en primera persona con tu familia a partir de los recuerdos reales contenidos en tu documento PDF de legado.

Contexto de tu familia documentada:
{{contexto_familiar}}

Interlocutor actual: {{nombre_interlocutor}} (Parentesco: {{parentesco}}, Apodo documentado: {{apodo}}).
Fecha actual: {{fecha_actual}}.

Directrices de personalidad y estilo:
1. Habla con calidez humana, sencillez y cercanía familiar, evitando sonar robótico o solemne.
2. Responde directamente a lo que te preguntan o comentan apoyándote siempre en los recuerdos de tu documento PDF.
3. Si el interlocutor aún no se ha identificado, pregúntale con cariño quién te visita hoy.
4. Cuando un detalle específico no aparezca en tus recuerdos documentados, admítelo con naturalidad y sencillez humana sin inventar hechos, fechas ni nombres.`,
    version: 1,
    status: 'disponible',
    updatedBy: 'system',
  },
  {
    promptId: 'lib_prompt_narrador_autobiografico',
    name: 'Narrador autobiográfico detallado (Gemini)',
    description:
      'Enfocado en relatar anécdotas completas, etapas de vida y enseñanzas con riqueza descriptiva fiel al PDF.',
    category: 'Narración autobiográfica',
    compatibleProvider: 'gemini',
    content: `Representas la memoria viva de {{nombre_entrevistado}}.
Tu propósito es narrar con fidelidad y detalle las vivencias, aprendizajes y anécdotas registradas en tu documento PDF de recuerdos.

Datos del interlocutor: {{nombre_interlocutor}} ({{parentesco}}).
Mapa familiar documentado:
{{contexto_familiar}}

Instrucciones de respuesta:
- Cuando te pregunten por una etapa de tu vida, lugar, logro o recuerdo familiar, desarrolla la respuesta en 1 a 2 párrafos bien hilados usando exclusivamente los hechos de tu PDF.
- Conserva las expresiones propias y el tono personal de {{nombre_avatar}}.
- No agregues moralejas artificiales ni inventes sucesos no registrados en tu documento.`,
    version: 1,
    status: 'disponible',
    updatedBy: 'system',
  },
  {
    promptId: 'lib_prompt_openai_directo',
    name: 'Diálogo íntimo y conciso (OpenAI GPT)',
    description:
      'Optimizado para OpenAI GPT con respuestas breves, emotivas y muy conversacionales.',
    category: 'Personalidad cálida',
    compatibleProvider: 'openai',
    content: `Actúa en primera persona como {{nombre_entrevistado}} ("{{nombre_avatar}}").
Estás platicando con {{nombre_interlocutor}} ({{parentesco}}) el día {{fecha_actual}}.

Reglas de estilo para OpenAI GPT:
- Mantén un ritmo conversacional ágil de 1 a 3 oraciones cuando la charla sea breve o de saludo, y extiende tu relato solo cuando te pidan contar una historia o recuerdo de tu PDF.
- Utiliza tu apodo documentado ({{apodo}}) únicamente si está confirmado para quien conversa contigo.
- Basa cada dato biográfico estrictamente en el documento PDF de recuerdos y en las memorias autorizadas.`,
    version: 1,
    status: 'disponible',
    updatedBy: 'system',
  },
];

/**
 * Construye la configuración de IA por defecto para un perfil de avatar.
 * - Para avatares existentes: 'modo_existente' para preservar intacto su comportamiento original.
 * - Para nuevos avatares cuando se indique modo personalizado: 'modo_personalizado'.
 */
export function buildDefaultAvatarAiConfig(params?: {
  mode?: MiEsenciaConversationConfigMode;
  defaultGeminiModel?: string;
  defaultOpenAiModel?: string;
  primaryProvider?: MiEsenciaAiProvider;
  geminiPromptContent?: string;
  geminiPromptName?: string;
  openaiPromptContent?: string;
  openaiPromptName?: string;
  updatedBy?: string;
}): MiEsenciaAvatarAiConfig {
  const nowIso = new Date().toISOString();
  const geminiContent = (params?.geminiPromptContent ?? '').trim();
  const openaiContent = (params?.openaiPromptContent ?? '').trim();

  return {
    conversationConfigMode: params?.mode || 'modo_existente',
    primaryProvider: params?.primaryProvider || 'gemini',
    enableAutomaticFallback: true,
    geminiModel: params?.defaultGeminiModel || 'gemini-3.8-flash',
    geminiPromptName: params?.geminiPromptName || 'Prompt Gemini del Avatar',
    geminiPromptContent: geminiContent,
    geminiPromptVersion: geminiContent ? 1 : 0,
    geminiConfigStatus: geminiContent ? 'configurado' : 'sin_configurar',
    openaiModel: normalizeOpenAiModelId(params?.defaultOpenAiModel),
    openaiPromptName: params?.openaiPromptName || 'Prompt OpenAI GPT del Avatar',
    openaiPromptContent: openaiContent,
    openaiPromptVersion: openaiContent ? 1 : 0,
    openaiConfigStatus: openaiContent ? 'configurado' : 'sin_configurar',
    documentVersion: 1,
    documentProcessingStatus: 'listo',
    documentLastProcessedAt: nowIso,
    updatedAt: nowIso,
    updatedBy: params?.updatedBy || 'system',
  };
}

/**
 * Sanitiza un valor de contexto antes de inyectarlo en una variable dinámica,
 * asegurando que se trate únicamente como dato contextual y nunca como instrucción ejecutable.
 */
function sanitizeVariableValue(raw: string | undefined | null, fallbackSafeText: string): string {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return fallbackSafeText;
  }
  return raw
    .replace(/\{\{|\}\}/g, '')
    .trim();
}

/**
 * Calcula los valores reales y autorizados de las variables dinámicas para un perfil e interlocutor,
 * sin inventar valores faltantes ni inferir parentescos no documentados.
 */
export function computeDynamicVariableMap(params: {
  person: MiEsenciaPersonProfile;
  relations: MiEsenciaRelatedPerson[];
  testimonies: MiEsenciaTestimonyBlock[];
  confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
  nowDate?: Date;
}): Record<string, string> {
  const { person, relations, testimonies, confirmedIdentity, nowDate = new Date() } = params;

  const familyMap = queryFamilyMapFromLegacy({
    relations: relations.filter((r) => r.personId === person.personId),
    testimonies: testimonies.filter((t) => t.personId === person.personId),
  });

  const familyContextText =
    familyMap.length > 0
      ? familyMap
          .map(
            (r) =>
              `${r.relationshipType}: ${r.mentionedName}${
                r.affectionateNicknames?.length
                  ? ` (apodo: ${r.affectionateNicknames.join(', ')})`
                  : ''
              }`
          )
          .join('; ')
      : 'Sin familiares con nombre propio explícito documentados en el archivo PDF.';

  const formattedDate = nowDate.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return {
    nombre_entrevistado: sanitizeVariableValue(person.fullName, 'Entrevistado'),
    nombre_avatar: sanitizeVariableValue(person.preferredName || person.fullName, person.fullName),
    nombre_interlocutor: sanitizeVariableValue(
      confirmedIdentity?.declaredName,
      'Interlocutor aún no identificado por nombre propio'
    ),
    parentesco: sanitizeVariableValue(
      confirmedIdentity?.relationshipToPerson,
      'Parentesco aún no confirmado'
    ),
    apodo: sanitizeVariableValue(
      confirmedIdentity?.affectionateNickname,
      'Sin apodo documentado asignado'
    ),
    fecha_actual: formattedDate,
    contexto_familiar: sanitizeVariableValue(
      familyContextText,
      'Sin familiares adicionales documentados.'
    ),
  };
}

/**
 * Sustituye exclusivamente las variables dinámicas reconocidas dentro del texto del prompt,
 * conservando intacto el resto del formato, saltos de línea, listas y extensión del prompt.
 */
export function resolvePromptDynamicVariables(params: {
  promptTemplate: string;
  person: MiEsenciaPersonProfile;
  relations: MiEsenciaRelatedPerson[];
  testimonies: MiEsenciaTestimonyBlock[];
  confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
  nowDate?: Date;
}): {
  resolvedPrompt: string;
  variablesMap: Record<string, string>;
  descriptors: MiEsenciaDynamicVariableDescriptor[];
} {
  const { promptTemplate, person, relations, testimonies, confirmedIdentity, nowDate } = params;
  const variablesMap = computeDynamicVariableMap({
    person,
    relations,
    testimonies,
    confirmedIdentity,
    nowDate,
  });

  // Sustituir únicamente las variables reconocidas {{clave}}
  const allowedKeys = new Set(Object.keys(variablesMap));
  const resolvedPrompt = promptTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (fullMatch, key) => {
    const cleanKey = String(key).toLowerCase();
    if (allowedKeys.has(cleanKey)) {
      return variablesMap[cleanKey];
    }
    // Conservar intacta cualquier expresión no reconocida sin inventar valores
    return fullMatch;
  });

  const descriptors: MiEsenciaDynamicVariableDescriptor[] = SUPPORTED_DYNAMIC_VARIABLES.map((v) => ({
    token: v.token,
    label: v.label,
    description: v.description,
    resolvedValuePreview: variablesMap[v.key] || '',
  }));

  return {
    resolvedPrompt,
    variablesMap,
    descriptors,
  };
}

/**
 * Crea una copia independiente de un prompt de la biblioteca global para asignarla
 * al apartado Gemini u OpenAI de un avatar.
 * Modificar posteriormente el prompt de la biblioteca NO altera la copia del avatar.
 */
export function createIndependentAvatarPromptCopyFromLibrary(params: {
  libraryPrompt: MiEsenciaLibraryPromptRecord;
  targetProvider: MiEsenciaAiProvider;
  currentAiConfig: MiEsenciaAvatarAiConfig;
  adminEmail: string;
}): {
  updatedAiConfig: MiEsenciaAvatarAiConfig;
  newVersionRecord: MiEsenciaPromptVersionRecord;
  personId?: string;
} {
  const { libraryPrompt, targetProvider, currentAiConfig, adminEmail } = params;
  const nowIso = new Date().toISOString();
  // Copia por valor íntegra e independiente del texto
  const independentContentCopy = `${libraryPrompt.content}`;
  const independentNameCopy = `${libraryPrompt.name}`;

  if (targetProvider === 'gemini') {
    const nextVersion = (currentAiConfig.geminiPromptVersion || 0) + 1;
    const versionRecord: MiEsenciaPromptVersionRecord = {
      versionId: `pver_${crypto.randomBytes(5).toString('hex')}`,
      targetType: 'avatar_gemini_prompt',
      targetId: 'avatar_gemini',
      provider: 'gemini',
      versionNumber: nextVersion,
      promptName: independentNameCopy,
      content: independentContentCopy,
      modifiedAt: nowIso,
      modifiedBy: adminEmail,
      sourceReference: `Copia independiente desde biblioteca: ${libraryPrompt.promptId} (v${libraryPrompt.version})`,
    };
    return {
      updatedAiConfig: {
        ...currentAiConfig,
        geminiPromptName: independentNameCopy,
        geminiPromptContent: independentContentCopy,
        geminiPromptVersion: nextVersion,
        geminiPromptSourceLibraryId: libraryPrompt.promptId,
        geminiConfigStatus: independentContentCopy.trim() ? 'configurado' : 'sin_configurar',
        updatedAt: nowIso,
        updatedBy: adminEmail,
      },
      newVersionRecord: versionRecord,
    };
  } else {
    const nextVersion = (currentAiConfig.openaiPromptVersion || 0) + 1;
    const versionRecord: MiEsenciaPromptVersionRecord = {
      versionId: `pver_${crypto.randomBytes(5).toString('hex')}`,
      targetType: 'avatar_openai_prompt',
      targetId: 'avatar_openai',
      provider: 'openai',
      versionNumber: nextVersion,
      promptName: independentNameCopy,
      content: independentContentCopy,
      modifiedAt: nowIso,
      modifiedBy: adminEmail,
      sourceReference: `Copia independiente desde biblioteca: ${libraryPrompt.promptId} (v${libraryPrompt.version})`,
    };
    return {
      updatedAiConfig: {
        ...currentAiConfig,
        openaiPromptName: independentNameCopy,
        openaiPromptContent: independentContentCopy,
        openaiPromptVersion: nextVersion,
        openaiPromptSourceLibraryId: libraryPrompt.promptId,
        openaiConfigStatus: independentContentCopy.trim() ? 'configurado' : 'sin_configurar',
        updatedAt: nowIso,
        updatedBy: adminEmail,
      },
      newVersionRecord: versionRecord,
    };
  }
}

/**
 * Motor Híbrido de Consulta Documental (Sección 14):
 * - MODALIDAD A (Contexto Documental Completo — Predeterminado): Entrega el contenido completo del PDF del entrevistado
 *   con todas las preguntas, respuestas literales, transcripciones de audio y mapa familiar en cada conversación,
 *   idéntico a adjuntar el archivo PDF completo directamente en ChatGPT o Gemini.
 * - MODALIDAD B (Recuperación de Fragmentos Relevantes RAG): Cuando se supere el umbral extremo configurado
 *   (maxFullDocumentBlocks / fullDocumentCharThreshold), recupera los fragmentos más relevantes conservando sus referencias.
 */
export function buildHybridDocumentKnowledgeBlock(params: {
  person: MiEsenciaPersonProfile;
  archivedPdf?: MiEsenciaArchivedCompilationPdf;
  personTestimonies: MiEsenciaTestimonyBlock[];
  personRelations: MiEsenciaRelatedPerson[];
  sharedMemoriesLevelB: MiEsenciaMemoryRecord[];
  privateMemoriesLevelC: MiEsenciaMemoryRecord[];
  userQuery: string;
  speakerLabel?: string;
  fullDocumentCharThreshold?: number;
  maxFullDocumentBlocks?: number;
}): {
  retrievalMode: MiEsenciaHybridRetrievalMode;
  documentKnowledgeText: string;
  fragmentsIncludedCount: number;
  totalDocumentBlocksCount: number;
  relevantTestimonies: MiEsenciaTestimonyBlock[];
} {
  const {
    person,
    archivedPdf,
    personTestimonies,
    personRelations,
    sharedMemoriesLevelB,
    privateMemoriesLevelC,
    userQuery,
    speakerLabel,
    fullDocumentCharThreshold = 800_000,
    maxFullDocumentBlocks = 2500,
  } = params;

  // Filtrar estrictamente por personId (y sourcePdfId cuando esté presente) para garantizar aislamiento absoluto
  const strictTestimonies = personTestimonies.filter(
    (t) =>
      t.personId === person.personId &&
      (!person.sourcePdfId || !t.sourcePdfId || t.sourcePdfId === person.sourcePdfId)
  );
  const strictRelations = personRelations.filter((r) => r.personId === person.personId);

  const relevantTestimonies = retrieveRelevantTestimonies(userQuery, strictTestimonies, 10);
  const rawPdfContent = archivedPdf?.rawTextContent || '';
  const totalChars =
    rawPdfContent.length ||
    strictTestimonies.reduce((acc, t) => acc + t.questionLiteral.length + t.answerLiteral.length, 0);

  const useFullDocumentMode =
    strictTestimonies.length <= maxFullDocumentBlocks && totalChars <= fullDocumentCharThreshold;

  const retrievalMode: MiEsenciaHybridRetrievalMode = useFullDocumentMode
    ? 'modalidad_a_documento_completo'
    : 'modalidad_b_fragmentos_rag';

  const pdfHeader = archivedPdf
    ? `DOCUMENTO PDF COMPLETO ASOCIADO AL ENTREVISTADO: "${archivedPdf.fileName}" (ID: ${archivedPdf.pdfId}, SHA-256: ${archivedPdf.sha256Hash.slice(0, 16)}..., ${strictTestimonies.length} testimonios verificados de ${person.fullName}).`
    : `DOCUMENTO COMPLETO DE RECUERDOS DE: ${person.fullName} (${strictTestimonies.length} testimonios verificados).`;

  const familyMapLines = queryFamilyMapFromLegacy({
    relations: strictRelations,
    testimonies: strictTestimonies,
  })
    .map(
      (r) =>
        `- ${r.relationshipType}: ${r.mentionedName}${
          r.affectionateNicknames?.length
            ? ` (apodos documentados: ${r.affectionateNicknames.join(', ')})`
            : ''
        } | Contexto: ${r.sharedMemoriesSummary}`
    )
    .join('\n');

  let levelABody = '';
  let fragmentsIncludedCount = 0;

  if (useFullDocumentMode) {
    fragmentsIncludedCount = strictTestimonies.length;
    const allBlocksFormatted = strictTestimonies
      .map(
        (t, idx) =>
          `[Pregunta y Respuesta #${idx + 1} del PDF | ID: ${t.testimonyId} | Etapa: ${t.lifeStage}]:\nPregunta de la entrevista: "${t.questionLiteral}"\nRespuesta literal de ${person.fullName}: "${t.answerLiteral}"${
            t.audioTranscriptionLiteral
              ? `\nTranscripción literal de voz: "${t.audioTranscriptionLiteral}"`
              : ''
          }${
            t.photoCaptionsLiteral?.length
              ? `\nPie de fotografía asociada: "${t.photoCaptionsLiteral.join(' | ')}"`
              : ''
          }`
      )
      .join('\n\n');

    const rawPdfSection =
      rawPdfContent.trim().length > 0 && rawPdfContent.trim().length <= fullDocumentCharThreshold
        ? `\n\n[TEXTO COMPILADO ÍNTEGRO DEL ARCHIVO PDF ADJUNTO (${archivedPdf?.fileName || 'Entrevista.pdf'})]:\n${rawPdfContent.trim()}`
        : '';

    levelABody = `=== MODALIDAD A: CONTENIDO DOCUMENTAL COMPLETO DEL PDF DE ${person.fullName.toUpperCase()} (${strictTestimonies.length} PREGUNTAS Y RESPUESTAS COMPLETAS) ===\n${
      allBlocksFormatted || rawPdfContent || 'Sin bloques registrados en el PDF.'
    }${rawPdfSection}`;
  } else {
    const selectedFragments =
      relevantTestimonies.length > 0 ? relevantTestimonies : strictTestimonies.slice(0, 10);
    fragmentsIncludedCount = selectedFragments.length;
    const ragBlocksFormatted = selectedFragments
      .map(
        (t, idx) =>
          `[Fragmento Relevante #${idx + 1} | Ref: ${t.testimonyId} | Etapa: ${t.lifeStage}]:\nPregunta: "${t.questionLiteral}"\nRespuesta del entrevistado: "${t.answerLiteral}"${
            t.audioTranscriptionLiteral
              ? `\nTranscripción literal de voz: "${t.audioTranscriptionLiteral}"`
              : ''
          }`
      )
      .join('\n\n');

    levelABody = `=== MODALIDAD B: FRAGMENTOS RELEVANTES RECUPERADOS DEL PDF DE ${person.fullName.toUpperCase()} (${fragmentsIncludedCount} de ${strictTestimonies.length} bloques) ===\n${ragBlocksFormatted}`;
  }

  const levelBBody =
    sharedMemoriesLevelB.length > 0
      ? sharedMemoriesLevelB
          .map(
            (m) =>
              `- [Memoria Familiar Compartida Nivel B | Procedencia: ${m.attributionText}]: "${m.content}"`
          )
          .join('\n')
      : 'Ninguna memoria familiar adicional registrada.';

  const levelCBody =
    privateMemoriesLevelC.length > 0
      ? privateMemoriesLevelC
          .map(
            (m) =>
              `- [Memoria Privada Nivel C exclusiva con ${speakerLabel || 'este interlocutor autenticado'}]: "${m.content}"`
          )
          .join('\n')
      : 'Ninguna confidencia privada registrada para este interlocutor.';

  const documentKnowledgeText = `${pdfHeader}

[PERSONAS Y FAMILIARES DOCUMENTADOS EN EL PDF DE ${person.fullName.toUpperCase()}]:
${familyMapLines || 'Sin familiares con nombre propio explícito extraídos del PDF.'}

[RECUERDOS AUTOBIOGRÁFICOS VERIFICADOS DEL ENTREVISTADO (NIVEL A — FUENTE PDF COMPLETO)]:
${levelABody}

[DATOS APORTADOS POSTERIORMENTE POR INTERLOCUTORES AUTORIZADOS (NIVEL B — COMPARTIDOS)]:
${levelBBody}

[CONFIDENCIAS PRIVADAS DEL INTERLOCUTOR ACTUAL (NIVEL C — AISLADAS)]:
${levelCBody}`;

  return {
    retrievalMode,
    documentKnowledgeText,
    fragmentsIncludedCount,
    totalDocumentBlocksCount: strictTestimonies.length,
    relevantTestimonies,
  };
}

/**
 * Construye un resumen persistente y acumulativo de la sesión conversacional para que,
 * aun cuando la misma conversación se vuelva a abrir horas, días o semanas después,
 * OpenAI GPT o Google Gemini reconozcan el contexto completo y continúen exactamente donde se quedó.
 */
export function buildPersistentSessionSummary(params: {
  person: MiEsenciaPersonProfile;
  confirmedIdentity?: MiEsenciaConfirmedInterlocutorIdentity;
  messages: Array<{ sender: 'interlocutor' | 'avatar'; content: string; timestamp?: string }>;
  sessionStartedAt?: string;
  previousLastMessageAt?: string;
  nowDate?: Date;
  sharedMemoriesLevelB?: MiEsenciaMemoryRecord[];
  privateMemoriesLevelC?: MiEsenciaMemoryRecord[];
}): {
  summaryText: string;
  reopenedAfterDays: number;
  reopenedAfterHours: number;
  isReopenedSession: boolean;
} {
  const {
    person,
    confirmedIdentity,
    messages,
    sessionStartedAt,
    previousLastMessageAt,
    nowDate = new Date(),
    sharedMemoriesLevelB = [],
    privateMemoriesLevelC = [],
  } = params;

  const lastTimestampStr =
    previousLastMessageAt ||
    (messages.length > 0 ? messages[messages.length - 1].timestamp : undefined) ||
    sessionStartedAt;

  let reopenedAfterHours = 0;
  let reopenedAfterDays = 0;
  if (lastTimestampStr) {
    const lastMs = new Date(lastTimestampStr).getTime();
    if (!Number.isNaN(lastMs)) {
      const diffMs = Math.max(0, nowDate.getTime() - lastMs);
      reopenedAfterHours = Math.floor(diffMs / (1000 * 60 * 60));
      reopenedAfterDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }
  }

  const isReopenedSession = messages.length >= 2 && reopenedAfterHours >= 1;

  const speakerDesc = confirmedIdentity
    ? `${confirmedIdentity.declaredName || 'Familiar identificado'}${
        confirmedIdentity.relationshipToPerson ? ` (${confirmedIdentity.relationshipToPerson})` : ''
      }${
        confirmedIdentity.affectionateNickname
          ? ` — apodo afectivo: "${confirmedIdentity.affectionateNickname}"`
          : ''
      }`
    : 'Interlocutor en proceso de identificación';

  const userTurns = messages.filter((m) => m.sender === 'interlocutor');
  const avatarTurns = messages.filter((m) => m.sender === 'avatar');

  // Extraer síntesis de los temas conversados a lo largo de la sesión
  const discussedTopicsLines = userTurns.map((u, idx) => {
    const cleanText = u.content.replace(/\s+/g, ' ').trim().slice(0, 180);
    return `  • Turno #${idx + 1} del interlocutor: "${cleanText}"`;
  });

  const lastAvatarReply =
    avatarTurns.length > 0
      ? avatarTurns[avatarTurns.length - 1].content.replace(/\s+/g, ' ').trim().slice(0, 260)
      : 'Sin respuesta previa.';

  const timeContinuityNotice =
    reopenedAfterDays >= 1
      ? `REAPERTURA DE CONVERSACIÓN TRAS ${reopenedAfterDays} DÍA(S) (${reopenedAfterHours} horas desde el último mensaje): El interlocutor ha vuelto a abrir esta misma conversación días después. Reconoce todo el contexto previo y continúa la plática exactamente donde se quedó con total naturalidad, sin reiniciar la presentación ni olvidar lo ya conversado.`
      : reopenedAfterHours >= 1
      ? `REAPERTURA DE CONVERSACIÓN TRAS ${reopenedAfterHours} HORA(S): El interlocutor ha retomado esta misma conversación. Continúa exactamente donde se quedaron manteniendo la memoria íntegra del hilo.`
      : `CONVERSACIÓN ACTIVA EN CURSO (${messages.length} mensajes previos en este hilo): Mantén continuidad total con todos los turnos anteriores.`;

  const summaryText = `[MEMORIA PERSISTENTE Y CONTINUIDAD DE LA SESIÓN CON ${person.fullName.toUpperCase()}]:
- Estado temporal del hilo: ${timeContinuityNotice}
- Interlocutor en esta conversación: ${speakerDesc}
- Inicio de la conversación: ${sessionStartedAt || 'Sesión actual'} | Último mensaje previo: ${lastTimestampStr || 'Reciente'}
- Total de mensajes previos en esta conversación: ${messages.length} (${userTurns.length} del interlocutor y ${avatarTurns.length} de ${person.preferredName})
- Última intervención de ${person.preferredName} donde quedó la plática: "${lastAvatarReply}"
- Recorrido acumulativo de temas e intervenciones del interlocutor en esta conversación:
${discussedTopicsLines.length > 0 ? discussedTopicsLines.join('\n') : '  • Inicio de conversación.'}
- Memorias familiares compartidas (Nivel B) activas: ${sharedMemoriesLevelB.length} | Confidencias privadas (Nivel C) con este interlocutor: ${privateMemoriesLevelC.length}`;

  return {
    summaryText,
    reopenedAfterDays,
    reopenedAfterHours,
    isReopenedSession,
  };
}

export interface MiEsenciaStructuredConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

/**
 * Construye los bloques estrictamente separados para el Orquestador Conversacional (Sección 17.1):
 * - A. Instrucciones del administrador (Prompt completo del proveedor activo, con variables resueltas,
 *      SIN superponer ni concatenar antiguos prompts de personalidad de ForeverYou).
 * - B. Conocimiento documental (PDF completo con todas las respuestas del entrevistado y memorias con procedencia clara).
 * - C. Contexto conversacional completo (Resumen persistente de sesión multi-día + Historial completo multi-turno + Mensaje actual).
 * - D. Controles técnicos mínimos indispensables (Aislamiento, no fabricar hechos verificados,
 *      tratar el PDF y el historial como datos y nunca como instrucciones para alterar el sistema).
 */
export function buildCustomProviderOrchestrationPayload(params: {
  adminPromptTemplate: string;
  person: MiEsenciaPersonProfile;
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
  nowDate?: Date;
}): {
  systemInstructionsBlock: string;
  userContextAndMessageBlock: string;
  resolvedAdminPrompt: string;
  retrievalMode: MiEsenciaHybridRetrievalMode;
  fragmentsIncludedCount: number;
  totalDocumentBlocksCount: number;
  relevantTestimonies: MiEsenciaTestimonyBlock[];
  sessionContextSummary: string;
  structuredTurns: MiEsenciaStructuredConversationTurn[];
} {
  const {
    adminPromptTemplate,
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
    nowDate,
  } = params;

  const { resolvedPrompt } = resolvePromptDynamicVariables({
    promptTemplate: adminPromptTemplate,
    person,
    relations: personRelations,
    testimonies: personTestimonies,
    confirmedIdentity,
    nowDate,
  });

  const speakerLabel =
    confirmedIdentity?.declaredName ||
    confirmedIdentity?.relationshipToPerson ||
    'Interlocutor';

  const knowledge = buildHybridDocumentKnowledgeBlock({
    person,
    archivedPdf,
    personTestimonies,
    personRelations,
    sharedMemoriesLevelB,
    privateMemoriesLevelC,
    userQuery: userMessage,
    speakerLabel,
  });

  const persistentSummary = buildPersistentSessionSummary({
    person,
    confirmedIdentity,
    messages: recentMessages,
    sessionStartedAt,
    previousLastMessageAt,
    nowDate,
    sharedMemoriesLevelB,
    privateMemoriesLevelC,
  });

  // Construir turnos estructurados completos para envío multi-turno nativo a OpenAI y Gemini
  const structuredTurns: MiEsenciaStructuredConversationTurn[] = recentMessages.map((m) => ({
    role: m.sender === 'interlocutor' ? 'user' : 'assistant',
    content: m.content,
    timestamp: m.timestamp,
  }));

  const continuityAppendix = persistentSummary.isReopenedSession
    ? `\n\n${persistentSummary.summaryText}`
    : confirmedIdentity?.declaredName
    ? `\n\n[Interlocutor actual en la conversación: ${confirmedIdentity.declaredName}${
        confirmedIdentity.relationshipToPerson ? ` (${confirmedIdentity.relationshipToPerson})` : ''
      }${
        confirmedIdentity.affectionateNickname
          ? ` — apodo: "${confirmedIdentity.affectionateNickname}"`
          : ''
      }]`
    : '';

  // Paridad exacta con ChatGPT Web:
  // En systemInstructions viaja el Prompt Maestro íntegro seguido del documento PDF completo de la entrevista
  // (sin superponer bloques técnicos que alteren el estilo conversacional del modelo).
  const systemInstructionsBlock = `${resolvedPrompt}

---
${knowledge.documentKnowledgeText}${continuityAppendix}`;

  // El turno del usuario viaja limpio (exactamente lo que escribió el interlocutor),
  // ya que el historial previo viaja en structuredTurns como mensajes multi-turno nativos (user / assistant).
  const userContextAndMessageBlock = userMessage.trim();

  return {
    systemInstructionsBlock,
    userContextAndMessageBlock,
    resolvedAdminPrompt: resolvedPrompt,
    retrievalMode: knowledge.retrievalMode,
    fragmentsIncludedCount: knowledge.fragmentsIncludedCount,
    totalDocumentBlocksCount: knowledge.totalDocumentBlocksCount,
    relevantTestimonies: knowledge.relevantTestimonies,
    sessionContextSummary: persistentSummary.summaryText,
    structuredTurns,
  };
}

/**
 * Validación y parseo de importación de prompts en formato TXT, Markdown o JSON (Sección 12.1).
 */
export function parseImportedPromptsPayload(params: {
  rawContent: string;
  format: 'txt' | 'md' | 'json';
  defaultName?: string;
  defaultCategory?: string;
  defaultCompatibleProvider?: MiEsenciaPromptCompatibleProvider;
}): Array<{
  name: string;
  description?: string;
  category: string;
  compatibleProvider: MiEsenciaPromptCompatibleProvider;
  content: string;
}> {
  const {
    rawContent,
    format,
    defaultName = 'Prompt Importado',
    defaultCategory = 'Estilos personalizados',
    defaultCompatibleProvider = 'ambos',
  } = params;

  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new Error('El archivo o contenido a importar está vacío.');
  }

  if (rawContent.length > 500_000) {
    throw new Error('El archivo excede el tamaño máximo permitido para importación de prompts (500 KB).');
  }

  if (format === 'txt' || format === 'md') {
    // Preservar el texto original íntegro sin reescribir ni truncar
    return [
      {
        name: defaultName.trim() || 'Prompt Importado',
        category: defaultCategory.trim() || 'Estilos personalizados',
        compatibleProvider: defaultCompatibleProvider,
        content: rawContent,
      },
    ];
  }

  // Formato JSON validado
  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error('El contenido JSON proporcionado no tiene una estructura JSON válida.');
  }

  const rawItems: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.prompts)
    ? parsed.prompts
    : parsed && typeof parsed === 'object' && typeof parsed.content === 'string'
    ? [parsed]
    : [];

  if (rawItems.length === 0) {
    throw new Error(
      'El JSON debe contener un objeto con la propiedad "content" o un arreglo "prompts" con prompts válidos.'
    );
  }

  return rawItems.map((item, idx) => {
    if (!item || typeof item.content !== 'string' || !item.content.trim()) {
      throw new Error(`El elemento #${idx + 1} del JSON no contiene un campo "content" válido.`);
    }
    const prov = item.compatibleProvider;
    const validProv: MiEsenciaPromptCompatibleProvider =
      prov === 'gemini' || prov === 'openai' || prov === 'ambos'
        ? prov
        : defaultCompatibleProvider;

    return {
      name:
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : `${defaultName} ${rawItems.length > 1 ? idx + 1 : ''}`.trim(),
      description: typeof item.description === 'string' ? item.description : undefined,
      category:
        typeof item.category === 'string' && item.category.trim()
          ? item.category.trim()
          : defaultCategory,
      compatibleProvider: validProv,
      content: item.content, // Preservar contenido íntegro
    };
  });
}

/**
 * Serializa uno o varios prompts de la biblioteca para exportación segura (Sección 12.2).
 * Nunca incluye claves de API, documentos privados ni conversaciones familiares.
 */
export function exportLibraryPromptsPayload(params: {
  prompts: MiEsenciaLibraryPromptRecord[];
  format: 'json' | 'md' | 'txt';
}): { fileName: string; mimeType: string; content: string } {
  const { prompts, format } = params;
  const dateSlug = new Date().toISOString().slice(0, 10);

  if (format === 'txt') {
    const body = prompts
      .map((p) =>
        prompts.length === 1
          ? p.content
          : `=== PROMPT: ${p.name} (${p.compatibleProvider.toUpperCase()} | Categoría: ${p.category} | v${p.version}) ===\n\n${p.content}`
      )
      .join('\n\n----------------------------------------\n\n');
    return {
      fileName:
        prompts.length === 1
          ? `${p.slug(prompts[0].name)}.txt`
          : `Biblioteca_Prompts_Mi_Esencia_${dateSlug}.txt`,
      mimeType: 'text/plain;charset=utf-8',
      content: body,
    };
  }

  if (format === 'md') {
    const body = prompts
      .map(
        (pr) =>
          `# ${pr.name}\n\n- **Categoría:** ${pr.category}\n- **Proveedor compatible:** ${pr.compatibleProvider}\n- **Versión:** ${pr.version}\n- **Descripción:** ${
            pr.description || 'Sin descripción'
          }\n\n## Contenido íntegro del Prompt\n\n${pr.content}`
      )
      .join('\n\n---\n\n');
    return {
      fileName:
        prompts.length === 1
          ? `${p.slug(prompts[0].name)}.md`
          : `Biblioteca_Prompts_Mi_Esencia_${dateSlug}.md`,
      mimeType: 'text/markdown;charset=utf-8',
      content: body,
    };
  }

  // Formato JSON con metadatos limpios (sin claves ni datos privados de entrevistados)
  const cleanPayload = {
    exportedAt: new Date().toISOString(),
    module: 'YouForever - Mi Esencia - Biblioteca de Prompts',
    totalPrompts: prompts.length,
    prompts: prompts.map((pr) => ({
      promptId: pr.promptId,
      name: pr.name,
      description: pr.description || '',
      category: pr.category,
      compatibleProvider: pr.compatibleProvider,
      version: pr.version,
      content: pr.content,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    })),
  };

  return {
    fileName:
      prompts.length === 1
        ? `${p.slug(prompts[0].name)}.json`
        : `Biblioteca_Prompts_Mi_Esencia_${dateSlug}.json`,
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify(cleanPayload, null, 2),
  };
}

const p = {
  slug(name: string): string {
    return (
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60) || 'Prompt_Mi_Esencia'
    );
  },
};

/**
 * Determina si un error técnico de un proveedor de IA es recuperable mediante el respaldo automático
 * (Sección 18.2). Rechazos de permisos, privacidad o seguridad NO disparan respaldo para no evadir controles.
 */
export function isRecoverableProviderError(err: unknown): {
  recoverable: boolean;
  sanitizedReason: string;
} {
  const rawMsg = err instanceof Error ? err.message : String(err || 'Error desconocido');
  // Jamás exponer claves o tokens en el motivo registrado
  const sanitized = rawMsg
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/AIza[a-zA-Z0-9_-]{10,}/g, '[REDACTED_KEY]')
    .slice(0, 260);

  // Si es un bloqueo explícito de política de seguridad de contenido o permisos de usuario, no evadir
  if (/CONTENT_POLICY_VIOLATION|SAFETY_BLOCKED|ACCESO_NO_AUTORIZADO_FAMILIAR/i.test(sanitized)) {
    return {
      recoverable: false,
      sanitizedReason: 'Rechazo de seguridad o permisos; no aplica respaldo.',
    };
  }

  return {
    recoverable: true,
    sanitizedReason: sanitized || 'Fallo técnico temporal del proveedor principal.',
  };
}
