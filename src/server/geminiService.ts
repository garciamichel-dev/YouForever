import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';
import {
  AnswerRecord,
  BookAiProvider,
  BookStructureMode,
  DEFAULT_LITERARY_PROMPTS_TEXT,
  InterviewRecord,
  ParticipantRecord,
  QuestionRecord,
  SufficiencyStatus,
  ensurePhotosPlacedInManuscript,
  formatPhotoMarkdownBlock,
} from '../logic/interviewRules.ts';
import {
  MiEsenciaArchivedCompilationPdf,
} from '../logic/miEsenciaRules.ts';
import {
  computeBookBatchSignature,
  computeBookGenerationFingerprint,
  computeBookSourceFingerprint,
  issueBookApprovalEvidence,
  verifyBookApprovalEvidence,
} from './bookApproval.ts';
import {
  BookFailureCategory,
  BookGenerationReasonCode,
  DELIVERY_MIN_COVERAGE_PERCENT,
  buildIncompleteDraftUserNotice,
  createUnitEvidenceRetriever,
  evaluateBookDeliveryEligibility,
  finalizeGlobalAuditDecision,
  type BookDeliveryDecision,
  type PreviewFidelityReport,
  resolveBookFailureCategory,
  BOOK_GENERATION_ENGINE_VERSION,
  CANONICAL_AUDIT_RULES_VERSION,
  ComposedChapterSectionBlock,
  ContextualRepairTask,
  DEMO_NARRATIVE_STYLES,
  DemoChapterManuscript,
  DemoChapterPhotoPlacement,
  DemoInMemoryPhoto,
  DemoManuscript,
  DemoNarrativeStyleId,
  DocumentaryAuditReport,
  DocumentaryInventory,
  EditorialQualityAuditReport,
  StructuredChapterTestimonyUnit,
  TraceabilityMatrixEntry,
  auditAndApproveBookManuscript,
  auditBookEditorialQuality,
  buildContextualRepairTasks,
  buildDocumentaryInventory,
  buildEditorialChapterPlan,
  buildParticipantInitialManuscriptFromAnswers,
  cleanSpanishOralText,
  computeCanonicalManuscriptCacheKey,
  ensureParagraphConformsToStyle,
  extractCleanParticipantAnswerText,
  formatPhotoEditorialCaption,
  repairManuscriptOmissions,
  resolveAnswerExclusionReason,
  resolveCanonicalAnswerSource,
  resolveDocumentaryPhotoChapterAndParagraph,
  sanitizeAndRepairBookManuscript,
  splitAnswerTextIntoIncludedAndExcludedSentences,
  stripInlinePhotoMarkers,
} from '../logic/demoStoryRules.ts';

export interface SufficiencyEvaluationResult {
  sufficiencyStatus: SufficiencyStatus;
  coveredTopics: string[];
  missingTopics: string[];
  limitations: string[];
  suggestedNextQuestions: string[];
  rationale: string;
  evaluatedAt: string;
}

export interface AdaptiveQuestionResult {
  suggested: boolean;
  questionText?: string;
  reason?: string;
}

export interface BookGenerationProgressEvent {
  phase:
    | 'preparing_sources'
    | 'drafting_batches'
    | 'auditing_semantics'
    | 'repairing_chapters'
    | 'finalizing';
  currentBatch?: number;
  totalBatches?: number;
  completedBatches?: number;
  repairPass?: number;
  repairedChapters?: number;
  totalRepairChapters?: number;
  userMessage: string;
}

export interface BookBatchCheckpointPayload {
  parsed: any;
  respondedModel: string;
  cachedTokens?: number;
  /**
   * V5.1: fingerprint of the sources/configuration this batch was drafted from. A checkpoint is
   * only reused when it matches the fingerprint of the generation that wants to resume from it.
   */
  sourceFingerprint?: string;
  /**
   * V5.2: fingerprint of HOW the batch was drafted (provider, model, engine, structure mode and
   * literary prompt on top of the sources) and signature of the chapter segments it covered.
   * Reuse requires both to match: a batch drafted by another model or for another plan is redrafted.
   */
  generationFingerprint?: string;
  batchSignature?: string;
}

export interface ManuscriptDraftResult {
  title: string;
  summary: string;
  chapters: Array<{
    title: string;
    lifeStage: string;
    content: string;
    participantAttributions: string[];
  }>;
  compiledMarkdown: string;
  generatedAt: string;
  isFallbackDraft?: boolean;
  generationStatus?: 'approved' | 'generated' | 'failed_audit' | 'incomplete_draft';
  isPartialMemoir?: boolean;
  incompleteDraftNotice?: string;
  internalReasonCode?: BookGenerationReasonCode;
  diagnosticSummary?: string;
  documentaryAudit?: DocumentaryAuditReport;
  editorialAudit?: EditorialQualityAuditReport;
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});
export const TEXT_MODEL = 'gemini-3.8-flash';
const TEXT_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
];

/**
 * Executes a promise with a hard timeout to prevent server request freezes.
 * Safely catches synchronous throws inside fallbackVal so they reject the returned promise
 * instead of crashing the Node.js event loop.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallbackVal: () => T
): Promise<T> {
  let timer: any;
  // Prevent unhandled rejection if the underlying promise rejects after the timeout wins
  promise.catch(() => {});
  const timeoutPromise = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolve(fallbackVal());
      } catch (err) {
        reject(err);
      }
    }, ms);
  });
  try {
    return await Promise.race([
      promise.then((res) => {
        clearTimeout(timer);
        return res;
      }),
      timeoutPromise,
    ]);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Calls Gemini generateContent across multiple fallback models so temporary 503/429 spikes
 * on a single model automatically recover without failing the request.
 */
async function generateJsonWithFallback(params: {
  prompt: string;
  systemInstruction?: string;
  responseSchema: any;
  timeoutMsPerModel?: number;
  models?: string[];
}): Promise<string | null> {
  const {
    prompt,
    systemInstruction,
    responseSchema,
    timeoutMsPerModel = 8500,
    models = TEXT_FALLBACK_MODELS,
  } = params;

  for (const modelName of models) {
    try {
      const callPromise = ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      const response = await withTimeout(callPromise, timeoutMsPerModel, () => null);
      if (response && response.text && response.text.trim().length > 0) {
        return response.text.trim();
      }
    } catch (_err) {
      // Try next model in fallback chain silently on 503 / 429 / transient error
    }
  }
  return null;
}

/**
 * Safely extracts and parses JSON from model responses, handling code fences,
 * preamble text, and empty responses without crashing.
 */
export function safeJsonExtract<T>(rawText: string | undefined | null, fallback: T): T {
  if (!rawText || typeof rawText !== 'string') {
    return fallback;
  }
  let cleaned = rawText.trim();
  // Strip ```json and ``` code blocks if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (_e1) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        const sliced = cleaned.slice(firstBrace, lastBrace + 1);
        return JSON.parse(sliced) as T;
      } catch (_e2) {
        // Fallback below
      }
    }
    return fallback;
  }
}

/**
 * Context-aware autonomous fallback generator that analyzes the interviewee's response
 * and generates a relevant deepening question when the AI service is offline or throttled.
 */
export function buildAutonomousDeepeningFallback(params: {
  currentQuestion: QuestionRecord;
  currentAnswerText: string;
  currentFollowUpCount: number;
  previousFollowUps?: string[];
}): AdaptiveQuestionResult {
  const { currentQuestion, currentAnswerText, currentFollowUpCount, previousFollowUps = [] } = params;
  const text = currentAnswerText.trim();
  const lower = text.toLowerCase();

  // Detect negative / non-applicable responses ("No tuve hijos", "No aplica")
  if (
    /^no\b/.test(lower) ||
    /\bno tuve\b/.test(lower) ||
    /\bno tengo\b/.test(lower) ||
    /\bsin hijos\b/.test(lower) ||
    /\bno aplica\b/.test(lower)
  ) {
    return {
      suggested: false,
      reason: 'El participante indicó que este aspecto no aplica a su historia.',
    };
  }

  // Extract a meaningful snippet or entity from the user's answer to personalize the deepening question
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  const firstSnippet = sentences[0]
    ? sentences[0].length > 75
      ? `${sentences[0].substring(0, 75)}...`
      : sentences[0]
    : text;

  const candidatesByStage: Record<string, Array<{ q: string; reason: string }>> = {
    infancia: [
      {
        q: `Al recordar aquello que mencionas («${firstSnippet}»), ¿qué imagen, sonido o emoción viene con más fuerza a tu memoria y qué significó para ti en esa etapa?`,
        reason: 'Profundización sensorial y afectiva sobre el recuerdo de infancia compartido.',
      },
      {
        q: `Sobre ese entorno de tu niñez que describes, ¿recuerdas alguna anécdota puntual o conversación familiar que haya dejado una huella duradera en tu forma de ser?`,
        reason: 'Exploración de anécdotas específicas a partir del testimonio inicial.',
      },
    ],
    juventud: [
      {
        q: `Respecto a lo que comentas («${firstSnippet}»), ¿hubo algún momento concreto o persona en esa etapa que influyera decisivamente en tus decisiones posteriores?`,
        reason: 'Profundización sobre las influencias y aprendizajes de la juventud.',
      },
      {
        q: `Mirando en retrospectiva esa etapa que describes, ¿qué sentías en aquel momento y cómo transformó tu manera de ver el futuro?`,
        reason: 'Exploración emocional de los proyectos y vivencias juveniles.',
      },
    ],
    adultez: [
      {
        q: `A propósito de lo que compartes («${firstSnippet}»), ¿cuál fue el mayor reto o la mayor satisfacción que viviste en esa experiencia y qué aprendizaje te dejó?`,
        reason: 'Profundización en las vivencias y aprendizajes clave de la vida adulta.',
      },
      {
        q: `¿Recuerdas algún episodio o detalle en particular sobre esto que hoy valores con especial gratitud al mirar atrás?`,
        reason: 'Rescate de episodios significativos vinculados a la respuesta del entrevistado.',
      },
    ],
    madurez: [
      {
        q: `Al reflexionar sobre lo que mencionas («${firstSnippet}»), ¿de qué manera cambió tu perspectiva de la vida a partir de esa experiencia?`,
        reason: 'Profundización reflexiva sobre momentos decisivos y resiliencia.',
      },
      {
        q: `Si pudieras compartir una enseñanza nacida directamente de esa vivencia con quienes lean tu historia, ¿cuál sería?`,
        reason: 'Vinculación de la experiencia narrada con el legado vital.',
      },
    ],
    legado_general: [
      {
        q: `Sobre esta convicción que expresas («${firstSnippet}»), ¿recuerdas algún momento de tu vida donde ese principio o valor se puso a prueba o te guio para tomar una decisión?`,
        reason: 'Profundización biográfica para ilustrar los valores con ejemplos reales de vida.',
      },
      {
        q: `¿Qué te gustaría que sintieran o recordaran tus seres queridos cada vez que piensen en este mensaje que les dejas?`,
        reason: 'Enriquecimiento emotivo del mensaje de legado familiar.',
      },
    ],
  };

  // Topic-specific overrides (e.g., hijos)
  if (
    currentQuestion.topic.includes('hijos') ||
    currentQuestion.flowId === 'hijos' ||
    /\bhij(o|a|os|as)\b/.test(lower)
  ) {
    const childFollowUps = [
      {
        q: `A partir de lo que cuentas sobre tus hijos («${firstSnippet}»), ¿hay algún momento cotidiano o conversación con ellos que recuerdes con especial emoción?`,
        reason: 'El sistema detectó menciones sobre la maternidad/paternidad que enriquecen el capítulo familiar.',
      },
      {
        q: `¿Qué rasgo o gesto ves hoy en tus hijos que te hace sentir que una parte de tus valores y amor sigue viva en ellos?`,
        reason: 'Profundización sobre la trascendencia y vínculo afectivo con los hijos.',
      },
    ];
    const chosen = childFollowUps[currentFollowUpCount % childFollowUps.length];
    if (!previousFollowUps.includes(chosen.q)) {
      return {
        suggested: true,
        questionText: chosen.q,
        reason: chosen.reason,
      };
    }
  }

  const stageList =
    candidatesByStage[currentQuestion.lifeStage] || candidatesByStage.adultez;
  const candidate = stageList[currentFollowUpCount % stageList.length];

  return {
    suggested: true,
    questionText: candidate.q,
    reason: candidate.reason,
  };
}

/**
 * Perform AI narrative sufficiency evaluation using Gemini with structured schema.
 */
export async function evaluateNarrativeSufficiency(params: {
  interview: InterviewRecord;
  answers: AnswerRecord[];
  questions: QuestionRecord[];
}): Promise<SufficiencyEvaluationResult> {
  const { interview, answers, questions } = params;

  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const summaryItems = answers.map((a) => {
    const q = questionMap.get(a.questionId);
    return {
      stage: q?.lifeStage || (a.isFollowUp ? 'profundizacion' : 'adicional'),
      topic: q?.topic || 'general',
      question: a.questionText || q?.text || 'Información adicional',
      participant: a.participantName,
      answer: a.notRecalled ? '[El participante indicó que no lo recuerda]' : a.answerText,
      isFollowUp: a.isFollowUp,
      isAdditional: a.isAdditionalMemory,
    };
  });

  const prompt = `Eres un asesor biográfico experto en narrativa y preservación de legado vital.
Evalúa la cobertura narrativa y suficiencia testimonial de esta entrevista de historia de vida:
- Modalidad: ${interview.storyMode} (${interview.storyMode === 'compartida' ? 'Múltiples participantes aportando recuerdos' : 'Historia individual'})
- Tipo: ${interview.storyType}
- Preguntas respondidas: ${answers.length}
- Umbral configurado: ${interview.sufficiencyThreshold}

Testimonios recopilados:
${JSON.stringify(summaryItems, null, 2)}

Directrices de evaluación:
1. Revisa las áreas vitales: Infancia y entorno familiar, Educación, Relaciones y afectos, Hijos y crianza (si aplica), Trabajo y proyectos, Momentos decisivos, Dificultades y aprendizajes, Valores y convicciones, Anécdotas vivas, Reflexiones y Legado a transmitir.
2. NO exijas forzosamente todas las categorías si la historia es de un tipo focalizado o si los relatos ya tienen profundidad genuina.
3. Clasifica estrictamente el estado en:
   - "sufficient": Si hay suficiente riqueza testimonial, recuerdos significativos y valores para componer un legado coherente.
   - "sufficient_with_limitations": Si es suficiente para un manuscrito valioso, pero presenta ciertas lagunas o áreas no exploradas que convendría conocer.
   - "insufficient": Si aún faltan elementos nucleares de la vida o la mayoría de respuestas son escuetas o sin recuerdo.
4. Redacta observaciones respetuosas, honestas y constructivas.`;

  try {
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sufficiencyStatus: {
              type: Type.STRING,
              enum: ['insufficient', 'sufficient', 'sufficient_with_limitations'],
              description: 'Estado de suficiencia narrativa',
            },
            coveredTopics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Temas o facetas de vida adecuadamente cubiertos',
            },
            missingTopics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Temas relevantes aún no explorados',
            },
            limitations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Limitaciones o lagunas identificadas en los recuerdos',
            },
            suggestedNextQuestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Preguntas recomendadas para enriquecer el relato',
            },
            rationale: {
              type: Type.STRING,
              description: 'Explicación detallada y respetuosa del dictamen',
            },
          },
          required: [
            'sufficiencyStatus',
            'coveredTopics',
            'missingTopics',
            'limitations',
            'suggestedNextQuestions',
            'rationale',
          ],
        },
      },
    });

    const parsed = safeJsonExtract<SufficiencyEvaluationResult>(response.text, {
      sufficiencyStatus: 'insufficient',
      coveredTopics: [],
      missingTopics: [],
      limitations: [],
      suggestedNextQuestions: [],
      rationale: '',
      evaluatedAt: new Date().toISOString(),
    });
    return {
      ...parsed,
      evaluatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error evaluating narrative sufficiency via Gemini:', error);
    const completedCount = answers.filter((a) => !a.notRecalled && a.answerText.trim().length > 10).length;
    const fallbackStatus: SufficiencyStatus =
      completedCount >= interview.sufficiencyThreshold
        ? 'sufficient_with_limitations'
        : 'insufficient';

    return {
      sufficiencyStatus: fallbackStatus,
      coveredTopics: ['Recuerdos aportados hasta la fecha'],
      missingTopics: ['Áreas complementarias de profundización'],
      limitations: ['Evaluación automática basada en registros actuales'],
      suggestedNextQuestions: ['¿Hay algún otro acontecimiento significativo que quisieras compartir?'],
      rationale: `Se han completado ${answers.length} registros testimoniales. El participante puede continuar explorando o decidir finalizar.`,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Autonomously generate a deepening follow-up question based on the interviewee's response.
 */
export async function generateAdaptiveFollowUp(params: {
  currentQuestion: QuestionRecord;
  currentAnswerText: string;
  notRecalled: boolean;
  branchChoice?: 'yes' | 'no' | null;
  currentFollowUpCount: number;
  maxFollowUps: number;
  storyMode: string;
  previousFollowUps?: string[];
}): Promise<AdaptiveQuestionResult> {
  const {
    currentQuestion,
    currentAnswerText,
    notRecalled,
    branchChoice,
    currentFollowUpCount,
    maxFollowUps,
    storyMode,
    previousFollowUps = [],
  } = params;

  // Rule 1: If participant stated they don't recall or selected 'no' on a branch gateway, do not press further
  if (notRecalled || branchChoice === 'no') {
    return {
      suggested: false,
      reason: 'El participante indicó que no lo recuerda o no aplica; se respeta y se avanza.',
    };
  }

  // Rule 2: Do not exceed configured max follow-ups per base question
  if (currentFollowUpCount >= maxFollowUps) {
    return {
      suggested: false,
      reason: `Se alcanzó el máximo configurado de preguntas de profundización (${maxFollowUps}).`,
    };
  }

  // Rule 3: Answer must have minimal content (at least 5 characters)
  const trimmed = (currentAnswerText || '').trim();
  if (trimmed.length < 5) {
    return {
      suggested: false,
      reason: 'Respuesta demasiado breve para generar profundización.',
    };
  }

  // Check if explicit negative response ("No tuve hijos", "No aplica")
  const lower = trimmed.toLowerCase();
  if (
    /^no\b/.test(lower) ||
    /\bno tuve\b/.test(lower) ||
    /\bno tengo\b/.test(lower) ||
    /\bsin hijos\b/.test(lower) ||
    /\bno aplica\b/.test(lower)
  ) {
    return {
      suggested: false,
      reason: 'Respuesta negativa o no aplicable.',
    };
  }

  const prompt = `Eres un entrevistador biográfico empático, perspicaz y respetuoso (${storyMode}).
El entrevistado acaba de responder a la siguiente pregunta clave del cuestionario:
- Pregunta original: "${currentQuestion.text}" (Etapa: ${currentQuestion.lifeStage}, Tema: ${currentQuestion.topic}, Prioridad: ${currentQuestion.priority || 'alta'}, Flujo: ${currentQuestion.flowId || 'principal'})
- Respuesta del entrevistado: "${trimmed}"
${previousFollowUps.length > 0 ? `- Preguntas de profundización ya realizadas en este turno: ${JSON.stringify(previousFollowUps)}` : ''}

Tu tarea:
Genera de forma autónoma UNA pregunta de profundización que permita explorar un aspecto relevante o significativo que el entrevistado haya mencionado (una persona, un lugar, una emoción, una enseñanza, un detalle sensorial o una vivencia que merezca ampliarse).
REGLAS:
1. Si el entrevistado dio una respuesta válida con personas, lugares, vivencias, hijos, logros, recuerdos o emociones (o si dio una respuesta breve en una pregunta importante que conviene desglosar), establece "suggested": true y formula "questionText" y "reason".
2. En "reason", explica brevemente en una frase qué aspecto relevante detectaste en su respuesta (ej. "Mencionaste el patio de tu casa familiar y a tus padres; vale la pena profundizar en las vivencias cotidianas de ese lugar").
3. En "questionText", redacta la pregunta de profundización en español cálido, cercano y directo al entrevistado. No repitas preguntas anteriores.`;

  const fallbackFn = () =>
    buildAutonomousDeepeningFallback({
      currentQuestion,
      currentAnswerText: trimmed,
      currentFollowUpCount,
      previousFollowUps,
    });

  try {
    const rawJsonText = await generateJsonWithFallback({
      prompt,
      timeoutMsPerModel: 8000,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggested: { type: Type.BOOLEAN },
          questionText: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ['suggested', 'questionText', 'reason'],
      },
    });

    if (!rawJsonText) {
      return fallbackFn();
    }

    const parsed = safeJsonExtract<AdaptiveQuestionResult>(rawJsonText, {
      suggested: false,
    });
    if (parsed.suggested && parsed.questionText && parsed.questionText.trim().length > 5) {
      return {
        suggested: true,
        questionText: parsed.questionText.trim(),
        reason:
          parsed.reason?.trim() ||
          'El sistema identificó elementos biográficos relevantes para profundizar en este recuerdo.',
      };
    }

    if (currentFollowUpCount === 0) {
      return fallbackFn();
    }

    return parsed;
  } catch (_error) {
    return fallbackFn();
  }
}

/**
 * Generate a complete, faithful draft manuscript without fabricating biographic data.
 */
export async function generateManuscriptDraft(params: {
  interview: InterviewRecord;
  participants: ParticipantRecord[];
  answers: AnswerRecord[];
  questions: QuestionRecord[];
  literaryPromptText?: string;
  configuredProvider?: BookAiProvider;
  geminiModel?: string;
  openaiModel?: string;
  bookStructureMode?: BookStructureMode;
}): Promise<ManuscriptDraftResult> {
  const {
    interview,
    participants,
    answers,
    questions,
    literaryPromptText,
    configuredProvider = 'gemini',
    geminiModel = 'gemini-3-flash-preview',
    openaiModel = 'gpt-4o',
    bookStructureMode = 'prompt_autonomous',
  } = params;

  const participantNames = participants.map((p) => p.name).filter(Boolean);
  const effectiveNarrativeStyle: DemoNarrativeStyleId = 'first_person_literary';
  const activeLiteraryPrompt =
    literaryPromptText && literaryPromptText.trim().length > 0
      ? literaryPromptText.trim()
      : DEFAULT_LITERARY_PROMPTS_TEXT[effectiveNarrativeStyle];

  const editorialPlan = buildEditorialChapterPlan({
    interviewTitle: interview.title,
    storyMode: interview.storyMode,
    participantNames,
    answers,
    questions,
    bookStructureMode,
  });

  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const structuredEntries = answers
    .filter((a) => resolveAnswerExclusionReason(a as any) === 'none')
    .map((a) => {
      const q = questionMap.get(a.questionId);
      const parentQ = a.parentQuestionId ? questionMap.get(a.parentQuestionId) : undefined;
      const etapa = q?.lifeStage || parentQ?.lifeStage || 'legado_general';
      const tema =
        q?.topic ||
        parentQ?.topic ||
        (a.isAdditionalMemory ? 'informacion_adicional' : 'profundizacion');
      const pregunta =
        a.questionText ||
        q?.text ||
        (a.isAdditionalMemory
          ? 'Información adicional incorporada por el entrevistado'
          : 'Pregunta de profundización');
      const canonicalSource = resolveCanonicalAnswerSource(a);

      return {
        answerId: a.id,
        etapa,
        tema,
        pregunta,
        autor: a.participantName,
        texto: a.notRecalled ? '[No recordado]' : canonicalSource.text,
        notaDiscrepanciaAudio:
          canonicalSource.hasWrittenText && canonicalSource.hasAudioTranscription
            ? 'Respuesta escrita final priorizada sobre transcripción de audio.'
            : undefined,
        esProfundizacion: a.isFollowUp,
        esRecuerdoAdicional: a.isAdditionalMemory,
        fotografias: (a.photos || []).map((p) => ({
          id: p.id,
          url: p.imageUrl || `/api/photos/${p.id}`,
          descripcionContexto: p.caption,
          autor: p.participantName,
          etapa: p.lifeStage || etapa,
        })),
      };
    })
    .filter((entry) => entry.texto.length > 0 || entry.fotografias.length > 0);

  const plannedOutlineSummary = editorialPlan.chapters
    .map(
      (c) =>
        `- Capítulo ${c.partNumber} (${c.stageKey}): "${c.suggestedTitleIndividual}" | Respuestas asignadas: ${c.assignedAnswerIds.join(', ')}`
    )
    .join('\n');

  const partialMemoirRule = editorialPlan.isPartialMemoir
    ? `\nENTREVISTA PARCIAL DETECTADA (ETAPAS DOCUMENTADAS: ${(editorialPlan.documentedStages || []).join(', ')}):
- Presenta la obra honestamente como "${editorialPlan.partialMemoirSubtitle || 'Un libro parcial de memorias'}".
- PROHIBIDO inventar infancia, adolescencia, adultez o vejez si no constan en los testimonios recibidos.\n`
    : '';

  const systemInstructionForDraft = `${activeLiteraryPrompt}\n\nEres el biógrafo y editor de legado personal y memorias familiares de YouForever. Devuelve un objeto JSON con: "title", "summary", "chapters" (array de {title, lifeStage, content, participantAttributions}) y "compiledMarkdown".`.trim();

  const prompt = `Debes componer el LIBRO COMPLETO DE HISTORIA DE VIDA Y LEGADO a partir EXCLUSIVAMENTE de los testimonios reales recopilados:
Título de la obra: "${interview.title}"
Modalidad: ${interview.storyMode === 'compartida' ? 'Historia Compartida (múltiples perspectivas familiares)' : 'Historia Individual y Testimonial'}
Protagonista y Participantes: ${participantNames.join(', ')}
${partialMemoirRule}
Plan editorial temático y cronológico sugerido (NO crees un capítulo por cada pregunta):
${plannedOutlineSummary}

Testimonios reales recopilados (con prioridad absoluta de la respuesta escrita final sobre transcripciones de voz):
${JSON.stringify(structuredEntries, null, 2)}

DIRECTRICES PARA LA CREACIÓN DEL LIBRO COMPLETO DE HISTORIA Y LEGADO:
1. ESTRUCTURA EDITORIAL DE LIBRO COMPLETO:
   - Portada con Título y Subtítulo${editorialPlan.isPartialMemoir ? ' ("Un libro parcial de memorias")' : ' inspirador'}.
   - Prólogo y Semblanza: Introducción que presenta a la persona entrevistada, su época, sus raíces y el propósito trascendente de este libro.
   - Capítulos:
     * UNA PREGUNTA RESPONDIDA NUNCA EQUIVALE A UN CAPÍTULO: sigue el plan editorial agrupando múltiples recuerdos afines en capítulos narrativos fluidos con títulos únicos sin sufijos "(2)" ni signos de pregunta.
     * Si el modo es autónomo ("prompt_autonomous"), organiza los capítulos según la riqueza temática y cronológica real de la historia.
     * Si es por etapas fijas, respeta únicamente las etapas que tengan testimonios reales sin inventar ni dejar capítulos vacíos.
   - Epílogo: Mensaje a la Posteridad y Legado para las Futuras Generaciones.

2. FIDELIDAD ESTRICTA A LOS HECHOS:
   - NUNCA inventes nombres, edades, lugares, fechas ni diálogos que no figuren en los testimonios.
   - Conserva exactamente quién realizó cada acción, las negaciones y los matices de incertidumbre ("creo que", "tal vez", "no estoy seguro").
   - Si existen versiones divergentes en historias compartidas, consérvalas con respeto como miradas complementarias.
   - Si existe "notaDiscrepanciaAudio", respeta la respuesta escrita final como fuente autorizada.

3. INTEGRACIÓN PERFECTA DE FOTOGRAFÍAS:
   - Cuando un testimonio incluya "fotografias", inserta cada fotografía en el pasaje narrativo que le corresponde con la sintaxis:
     ![Descripción o contexto de la foto | Aportada por Autor (Etapa)](/api/photos/ID_DE_LA_FOTO)
   - Integra la descripción y contexto aportado por el entrevistado dentro de la prosa narrativa.

4. ESTILO Y EXTENSIÓN:
   - Desarrolla una prosa fluida, cálida, digna y emotiva en español, limpia de muletillas orales y sin formato pregunta-respuesta.`;

  const renderMarkdownFromAuditedManuscript = (manu: DemoManuscript): string => {
    const mdLines: string[] = [
      `# ${manu.title}`,
      `*${manu.subtitle}*`,
      `\n## Prólogo\n`,
      manu.introduction,
    ];
    for (const ch of manu.chapters) {
      mdLines.push(`\n## Capítulo ${ch.partNumber}: ${ch.title}\n`);
      ch.paragraphs.forEach((para, pIdx) => {
        mdLines.push(`${para}\n`);
        const matchingPlacements = (ch.photoPlacements || []).filter(
          (pl) => pl.paragraphIndex === pIdx
        );
        for (const pl of matchingPlacements) {
          mdLines.push(
            formatPhotoMarkdownBlock({
              id: pl.photoId,
              interviewId: interview.id,
              questionId: pl.questionId || '',
              questionText: pl.shortCaption,
              lifeStage: (ch.dimensionKey as any) || 'adultez',
              topic: ch.title,
              participantId: '',
              participantName: manu.authors,
              fileName: '',
              mimeType: 'image/jpeg',
              caption: pl.originalDescription || pl.shortCaption,
              imageUrl: `/api/photos/${pl.photoId}`,
              createdAt: new Date().toISOString(),
            })
          );
        }
      });
    }
    if (manu.closingMessage) {
      mdLines.push(`\n## Epílogo\n`);
      mdLines.push(manu.closingMessage);
    }
    return ensurePhotosPlacedInManuscript({
      compiledMarkdown: mdLines.join('\n'),
      answers,
      questions,
    });
  };

  try {
    let rawJsonText: string | null = null;
    if (configuredProvider === 'openai' && process.env.OPENAI_API_KEY) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const modelToUse = openaiModel || 'gpt-4o';
        const completion = await openai.chat.completions.create({
          model: modelToUse,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: systemInstructionForDraft,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        });
        rawJsonText = completion.choices?.[0]?.message?.content || null;
      } catch (openAiErr) {
        console.warn('OpenAI error in generateManuscriptDraft, falling back to Gemini:', openAiErr);
      }
    }

    if (!rawJsonText) {
      rawJsonText = await generateJsonWithFallback({
        prompt,
        systemInstruction: systemInstructionForDraft,
        models: [geminiModel, 'gemini-3-flash-preview', 'gemini-2.5-flash'],
        timeoutMsPerModel: 25000,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  lifeStage: { type: Type.STRING },
                  content: { type: Type.STRING },
                  participantAttributions: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: ['title', 'lifeStage', 'content', 'participantAttributions'],
              },
            },
            compiledMarkdown: { type: Type.STRING },
          },
          required: ['title', 'summary', 'chapters', 'compiledMarkdown'],
        },
      });
    }

    if (!rawJsonText) {
      throw new Error('No response from Gemini manuscript models');
    }

    const parsed = safeJsonExtract<ManuscriptDraftResult>(rawJsonText, {
      title: interview.title,
      summary: '',
      chapters: [],
      compiledMarkdown: '',
      generatedAt: new Date().toISOString(),
    });

    const baseDraftSkeleton = buildParticipantInitialManuscriptFromAnswers({
      interviewTitle: interview.title,
      storyMode: interview.storyMode,
      participantNames,
      answers,
      questions,
      narrativeStyle: effectiveNarrativeStyle,
      bookStructureMode,
    });

    const parsedAiChapters: DemoChapterManuscript[] = (parsed.chapters || [])
      .map((ch, idx) => {
        const cleanParas = String(ch.content || '')
          .split(/\n{2,}/)
          .map((p) => stripInlinePhotoMarkers(p.trim()))
          .filter((p) => p.length > 0);
        const planMatch =
          editorialPlan.chapters[idx] ||
          editorialPlan.chapters.find((p) => p.stageKey === ch.lifeStage);
        return {
          id: planMatch?.chapterId || `admin_cap_${idx + 1}`,
          partNumber: idx + 1,
          dimensionKey: (planMatch?.dimensionKey || ch.lifeStage || 'adultez') as any,
          title:
            stripInlinePhotoMarkers(ch.title || planMatch?.suggestedTitleIndividual || '').trim() ||
            `Capítulo ${idx + 1}`,
          paragraphs: cleanParas,
          paragraphIds: cleanParas.map((_, pIdx) => `admin_cap_${idx + 1}_p_${pIdx + 1}`),
          sourceAnswerIds: planMatch?.assignedAnswerIds,
          sourceQuestionIds: planMatch?.assignedQuestionIds,
        };
      })
      .filter((ch) => ch.paragraphs.length > 0);

    let candidateManuscript: DemoManuscript = {
      ...baseDraftSkeleton.manuscript,
      title: (parsed.title || baseDraftSkeleton.manuscript.title).trim(),
      subtitle: editorialPlan.isPartialMemoir
        ? editorialPlan.partialMemoirSubtitle || 'Un libro parcial de memorias'
        : baseDraftSkeleton.manuscript.subtitle,
      introduction: (parsed.summary || baseDraftSkeleton.manuscript.introduction).trim(),
      chapters:
        parsedAiChapters.length > 0 ? parsedAiChapters : baseDraftSkeleton.manuscript.chapters,
      aiGenerated: true,
      isPartialMemoir: editorialPlan.isPartialMemoir,
      documentedStages: editorialPlan.documentedStages,
    };

    // Re-anchor photos across audited chapters
    for (const origCh of baseDraftSkeleton.manuscript.chapters) {
      for (const pl of origCh.photoPlacements || []) {
        const targetLoc = resolveDocumentaryPhotoChapterAndParagraph({
          chapters: candidateManuscript.chapters,
          photoId: pl.photoId,
          shortCaption: pl.shortCaption,
          originalDescription: pl.originalDescription || pl.shortCaption,
          answerId: pl.answerId,
          questionId: pl.questionId,
          dimensionKey: origCh.dimensionKey as any,
          preferredChapterId: origCh.id,
          preferredParagraphIndex: pl.paragraphIndex,
        });
        const tCh = candidateManuscript.chapters[targetLoc.chapterIndex];
        if (tCh) {
          tCh.photoPlacements = [
            ...(tCh.photoPlacements || []),
            {
              ...pl,
              chapterId: tCh.id,
              paragraphIndex: targetLoc.paragraphIndex,
              paragraphId: targetLoc.paragraphId,
            },
          ];
        }
      }
    }

    // Mandatory Hybrid Dual Audit + Contextual AI Repair Loop (unlimited chapters, bounded passes)
    const alternateProvider: BookAiProvider =
      configuredProvider === 'openai' ? 'gemini' : 'openai';
    const alternateModel = configuredProvider === 'openai' ? geminiModel : openaiModel;
    const primaryAdminModel = configuredProvider === 'openai' ? openaiModel : geminiModel;

    let audited = await auditWithHybridSemantics({
      manuscript: candidateManuscript,
      answers,
      questions,
      provider: configuredProvider,
      model: primaryAdminModel,
      alternateProvider,
      alternateModel,
    });

    for (let repairPass = 1; repairPass <= 4; repairPass++) {
      if (audited.report.passed && audited.editorialAudit.passed) break;
      const tasks = buildContextualRepairTasks({
        manuscript: audited.manuscript,
        report: audited.report,
        editorialAudit: audited.editorialAudit,
        inventory: audited.inventory,
        editorialPlan,
      }).filter((t) => t.autoRepairable);
      if (tasks.length === 0) break;

      const aiRepaired = await repairChaptersContextuallyWithAI({
        manuscript: audited.manuscript,
        tasks,
        activeLiteraryPrompt,
        narrativeStyle: effectiveNarrativeStyle,
        authors: participantNames.join(', ') || interview.title,
        isCouple: interview.storyMode === 'compartida' && participantNames.length >= 2,
        answers,
        questions,
        provider: configuredProvider,
        model: primaryAdminModel,
        alternateProvider,
        alternateModel,
      });
      if (aiRepaired && aiRepaired.improved) {
        audited = aiRepaired.audited;
      } else {
        break;
      }
    }

    if (!audited.report.passed || !audited.editorialAudit.passed) {
      // V5.1: hygiene only (no mechanical pasting of testimony) and judged by the hybrid policy.
      const hygieneRepaired = repairManuscriptOmissions({
        manuscript: audited.manuscript,
        answers,
        questions,
        storyMode: interview.storyMode,
        participantNames,
        maxAttempts: 2,
        integrateMissingUnits: false,
      });
      const hygieneAudited = await auditWithHybridSemantics({
        manuscript: hygieneRepaired.manuscript,
        answers,
        questions,
        provider: configuredProvider,
        model: primaryAdminModel,
        alternateProvider,
        alternateModel,
      });
      const preScore = computeManuscriptDefectScore(audited.report, audited.editorialAudit);
      const hygieneScore = computeManuscriptDefectScore(
        hygieneAudited.report,
        hygieneAudited.editorialAudit
      );
      if (
        hygieneScore < preScore ||
        (hygieneAudited.report.passed && hygieneAudited.editorialAudit.passed)
      ) {
        audited = hygieneAudited;
      }
    }

    const bothPassed = audited.report.passed && audited.editorialAudit.passed;
    const finalGenerationStatus = bothPassed ? 'approved' : 'incomplete_draft';
    const failureDiag = bothPassed
      ? null
      : classifyBookFailureReasonCode({
          report: audited.report,
          editorialAudit: audited.editorialAudit,
          repairPassesAttempted: audited.report.repairAttemptsUsed || 0,
        });
    const finalManuscript: DemoManuscript = {
      ...audited.manuscript,
      generationStatus: finalGenerationStatus,
      status: finalGenerationStatus,
      incompleteDraftNotice: failureDiag
        ? buildIncompleteDraftUserNotice(failureDiag.category)
        : undefined,
      failureCategory: failureDiag?.category,
      internalReasonCode: failureDiag?.code,
      diagnosticSummary: failureDiag?.summary,
    };

    const compiledMd = renderMarkdownFromAuditedManuscript(finalManuscript);

    return {
      title: finalManuscript.title,
      summary: finalManuscript.introduction,
      chapters: finalManuscript.chapters.map((ch) => ({
        title: ch.title,
        lifeStage: ch.dimensionKey,
        content: ch.paragraphs.join('\n\n'),
        participantAttributions: participantNames,
      })),
      compiledMarkdown: compiledMd,
      generatedAt: new Date().toISOString(),
      isFallbackDraft: false,
      generationStatus: finalGenerationStatus,
      isPartialMemoir: editorialPlan.isPartialMemoir,
      incompleteDraftNotice: finalManuscript.incompleteDraftNotice,
      internalReasonCode: failureDiag?.code,
      diagnosticSummary: failureDiag?.summary,
      documentaryAudit: audited.report,
      editorialAudit: audited.editorialAudit,
    };
  } catch (err: any) {
    const narrativeFallback = buildParticipantInitialManuscriptFromAnswers({
      interviewTitle: interview.title,
      storyMode: interview.storyMode,
      participantNames,
      answers,
      questions,
      narrativeStyle: effectiveNarrativeStyle,
      bookStructureMode,
    });

    const auditedFallback = auditAndApproveBookManuscript({
      manuscript: {
        ...narrativeFallback.manuscript,
        aiGenerated: false,
      },
      answers,
      questions,
    });

    const failureDiag = classifyBookFailureReasonCode({
      error: err,
      report: auditedFallback.report,
      editorialAudit: auditedFallback.editorialAudit,
    });

    const draftChapters: ManuscriptDraftResult['chapters'] =
      auditedFallback.manuscript.chapters.map((ch) => ({
        title: ch.title,
        lifeStage: ch.dimensionKey,
        content: ch.paragraphs.join('\n\n'),
        participantAttributions: participantNames,
      }));

    const fallbackMd = renderMarkdownFromAuditedManuscript(auditedFallback.manuscript);

    return {
      title: auditedFallback.manuscript.title,
      summary: auditedFallback.manuscript.introduction,
      chapters: draftChapters,
      compiledMarkdown: fallbackMd,
      generatedAt: new Date().toISOString(),
      isFallbackDraft: true,
      generationStatus: 'incomplete_draft',
      isPartialMemoir: narrativeFallback.editorialPlan.isPartialMemoir,
      incompleteDraftNotice: buildIncompleteDraftUserNotice(failureDiag.category),
      internalReasonCode: failureDiag.code,
      diagnosticSummary: failureDiag.summary,
      documentaryAudit: auditedFallback.report,
      editorialAudit: auditedFallback.editorialAudit,
    };
  }
}

export type AudioQualityStatus = 'clear' | 'noisy' | 'unintelligible' | 'silent';

export interface AudioTranscriptionDiagnosis {
  transcription: string;
  audioQuality: AudioQualityStatus;
  hasLegibleSpeech: boolean;
  qualityWarning?: string;
  suggestion?: string;
}

const HALLUCINATION_PATTERNS = [
  /^\[?\s*(silencio|ruido|inaudible|m[uú]sica|sin audio|no se escucha|audio ininteligible)\s*\]?\.?$/i,
  /subt[ií]tulos realizados por/i,
  /amara\.org/i,
  /gracias por ver el video/i,
  /suscr[ií]bete al canal/i,
];

/**
 * Strictly analyzes and transcribes user voice recording without question context
 * to prevent any hallucinated or invented stories when audio is noisy, low-quality, or silent.
 */
export async function analyzeAndTranscribeAudioWithGemini(params: {
  audioBase64: string;
  mimeType?: string;
}): Promise<AudioTranscriptionDiagnosis> {
  const { audioBase64, mimeType = 'audio/webm' } = params;

  const unintelligibleDefault: AudioTranscriptionDiagnosis = {
    transcription: '',
    audioQuality: 'unintelligible',
    hasLegibleSpeech: false,
    qualityWarning:
      'No hemos logrado escucharte correctamente ni identificar palabras legibles en tu grabación.',
    suggestion:
      'Si hay ruido de fondo, te sugerimos moverte a un lugar sin ruido y revisar tu micrófono. Recuerda que también tienes la opción de escribir tu respuesta por tu cuenta usando el teclado.',
  };

  try {
    let cleanBase64 = audioBase64 || '';
    if (cleanBase64.startsWith('data:')) {
      const commaIdx = cleanBase64.indexOf(',');
      if (commaIdx !== -1) {
        cleanBase64 = cleanBase64.substring(commaIdx + 1);
      }
    }
    cleanBase64 = cleanBase64.replace(/\s+/g, '');

    // If payload is empty or too small to contain any human speech frame
    if (cleanBase64.length < 1200) {
      return {
        transcription: '',
        audioQuality: 'silent',
        hasLegibleSpeech: false,
        qualityWarning:
          'No hemos logrado escuchar tu voz ni identificar ninguna palabra legible en la grabación.',
        suggestion:
          'Por favor revisa que tu micrófono funcione correctamente y acércate un poco más al hablar, o escribe tu respuesta por tu cuenta usando el teclado.',
      };
    }

    let normalizedMime = mimeType || 'audio/webm';
    if (normalizedMime.includes(';')) {
      normalizedMime = normalizedMime.split(';')[0].trim();
    }

    // IMPORTANT: Do NOT pass question text or participant name to the transcription model.
    // Providing the interview question when audio is noisy/inaudible causes the model to invent a story answering the question.
    const strictAcousticPrompt = `Eres un transcriptor acústico forense estricto en español.
Tu única tarea es escuchar el archivo de audio adjunto, evaluar su calidad acústica y transcribir EXCLUSIVAMENTE las palabras reales que pronuncie la persona.

REGLAS ESTRICTAS CONTRA INVENCIONES (CERO ALUCINACIONES):
1. NUNCA inventes historias, nombres, lugares, fechas ni frases que no se escuchen claramente en el audio.
2. NUNCA intentes adivinar, completar ni suponer lo que la persona quiso decir si el audio es confuso, muy bajo o tiene interferencia.
3. Clasifica el campo "audioQuality" en uno de estos 4 valores:
   - "silent": Solo hay silencio, soplidos al micrófono o volumen tan bajo que no se distingue voz humana. En este caso establece "hasLegibleSpeech": false y "transcription": "".
   - "unintelligible": Se percibe ruido, murmullos lejanos o distorsión, pero NO se logra comprender ninguna palabra legible con certeza. En este caso establece "hasLegibleSpeech": false y "transcription": "".
   - "noisy": Hay mucho ruido de fondo (televisión, calle, viento, eco o interferencia), pero SÍ se logran comprender algunas palabras o frases reales con certeza. En este caso establece "hasLegibleSpeech": true y escribe en "transcription" ÚNICAMENTE las palabras que realmente escuchaste sin inventar el resto.
   - "clear": La voz del participante se escucha clara y comprensible. Establece "hasLegibleSpeech": true y transcribe con fidelidad todo lo expresado en español con puntuación adecuada.
4. No incluyas etiquetas como "[Ruido]", "[Inaudible]" ni explicaciones dentro de "transcription".`;

    const AUDIO_TIMEOUT_MS = 90000;
    let parsedResult: {
      audioQuality?: AudioQualityStatus;
      hasLegibleSpeech?: boolean;
      transcription?: string;
    } | null = null;

    for (const modelName of TEXT_FALLBACK_MODELS) {
      if (parsedResult) break;
      try {
        const callPromise = ai.models.generateContent({
          model: modelName,
          contents: [
            {
              inlineData: {
                mimeType: normalizedMime,
                data: cleanBase64,
              },
            },
            {
              text: strictAcousticPrompt,
            },
          ],
          config: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                audioQuality: {
                  type: Type.STRING,
                  enum: ['clear', 'noisy', 'unintelligible', 'silent'],
                },
                hasLegibleSpeech: {
                  type: Type.BOOLEAN,
                },
                transcription: {
                  type: Type.STRING,
                },
              },
              required: ['audioQuality', 'hasLegibleSpeech', 'transcription'],
            },
          },
        });

        const response = await withTimeout(callPromise, AUDIO_TIMEOUT_MS, () => null);
        if (response && response.text) {
          const extracted = safeJsonExtract<{
            audioQuality?: AudioQualityStatus;
            hasLegibleSpeech?: boolean;
            transcription?: string;
          } | null>(response.text, null);
          if (extracted && extracted.audioQuality) {
            parsedResult = extracted;
          }
        }
      } catch (_err) {
        // Proceed to next model in fallback chain silently
      }
    }

    if (!parsedResult) {
      return unintelligibleDefault;
    }

    let cleanedText = (parsedResult.transcription || '')
      .replace(/^[\*\#\s]*transcripci[oó]n[\:\s\-]*/i, '')
      .replace(/\[(?:inaudible|ruido|silencio|m[uú]sica)\]/gi, '')
      .replace(/^\"+|\"+$/g, '')
      .trim();

    // Check against known non-speech hallucination phrases
    if (HALLUCINATION_PATTERNS.some((regex) => regex.test(cleanedText))) {
      cleanedText = '';
    }

    // Count actual legible words (at least 2 letters)
    const legibleWords = cleanedText
      .split(/\s+/)
      .map((w) => w.replace(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ]/g, ''))
      .filter((w) => w.length >= 2);

    const hasValidWords = legibleWords.length > 0 && parsedResult.hasLegibleSpeech !== false;
    const rawQuality = parsedResult.audioQuality || 'unintelligible';

    if (!hasValidWords || rawQuality === 'silent' || rawQuality === 'unintelligible') {
      const finalQuality: AudioQualityStatus = rawQuality === 'silent' ? 'silent' : 'unintelligible';
      return {
        transcription: '',
        audioQuality: finalQuality,
        hasLegibleSpeech: false,
        qualityWarning:
          finalQuality === 'silent'
            ? 'No hemos logrado escuchar tu voz ni identificar ninguna palabra legible en la grabación.'
            : 'No hemos logrado escucharte correctamente ni identificar palabras legibles debido al ruido o la calidad del audio.',
        suggestion:
          finalQuality === 'silent'
            ? 'Por favor revisa que tu micrófono esté encendido y sin obstrucciones, o acércate un poco más al hablar. Recuerda que también tienes la opción de escribir tu respuesta por tu cuenta usando el teclado.'
            : 'Si hay mucho ruido de fondo, te sugerimos moverte a un lugar tranquilo sin ruido y volver a intentarlo. Recuerda que también tienes la opción de escribir tu respuesta por tu cuenta usando el teclado.',
      };
    }

    if (rawQuality === 'noisy') {
      return {
        transcription: cleanedText,
        audioQuality: 'noisy',
        hasLegibleSpeech: true,
        qualityWarning:
          'Detectamos bastante ruido de fondo en tu grabación. Se transcribieron únicamente las palabras que lograron escucharse con claridad.',
        suggestion:
          'Te sugerimos moverte a un lugar sin ruido de fondo para que tu voz se escuche con mayor nitidez, o bien revisar y complementar tu texto directamente usando el teclado.',
      };
    }

    return {
      transcription: cleanedText,
      audioQuality: 'clear',
      hasLegibleSpeech: true,
    };
  } catch (_err) {
    return unintelligibleDefault;
  }
}

/**
 * Backwards-compatible wrapper that returns only the faithful transcription string
 * (or empty string if unintelligible/silent).
 */
export async function transcribeAudioWithGemini(params: {
  audioBase64: string;
  mimeType?: string;
  questionContext?: string;
  participantName?: string;
}): Promise<string> {
  const result = await analyzeAndTranscribeAudioWithGemini({
    audioBase64: params.audioBase64,
    mimeType: params.mimeType,
  });
  return result.transcription;
}

interface MultimodalBookPhotoInput {
  id: string;
  caption: string;
  questionText?: string;
  lifeStage?: string;
  participantName?: string;
  mimeType: string;
  dataUrl: string;
  base64Data: string;
}

export interface ParsedAiManuscriptBatchResponse {
  title?: string;
  subtitle?: string;
  introduction?: string;
  closingMessage?: string;
  chapters?: Array<{
    id: string;
    partNumber: number;
    dimensionKey: any;
    title: string;
    paragraphs: string[];
    pullQuote?: string;
    photoPlacements?: Array<{
      photoId: string;
      paragraphIndex: number;
      shortCaption: string;
    }>;
  }>;
}

interface CachedAiManuscriptEntry {
  cacheKey: string;
  interviewId: string;
  narrativeStyle: DemoNarrativeStyleId;
  scope: 'preview' | 'full';
  manuscript: DemoManuscript;
  providerUsed: BookAiProvider;
  modelUsed: string;
  providerFallbackNotice?: string;
  createdAt: string;
}

const manuscriptAiMemoryCache = new Map<string, CachedAiManuscriptEntry>();
let openAiModelsCache: { models: string[]; fetchedAt: number } | null = null;

function getManuscriptCacheDiskPath(): string {
  return path.join(process.cwd(), 'data', 'ai_manuscript_cache.json');
}

function hydrateManuscriptCacheFromDisk(): void {
  if (manuscriptAiMemoryCache.size > 0) return;
  try {
    const p = getManuscriptCacheDiskPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (item && item.cacheKey && item.manuscript) {
            manuscriptAiMemoryCache.set(item.cacheKey, item);
          }
        }
      }
    }
  } catch (_e) {
    // Non-fatal
  }
}

function persistManuscriptCacheToDisk(): void {
  try {
    const dir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const entries = Array.from(manuscriptAiMemoryCache.values()).slice(-60);
    fs.writeFileSync(getManuscriptCacheDiskPath(), JSON.stringify(entries, null, 2), 'utf-8');
  } catch (_e) {
    // Non-fatal
  }
}

async function getAvailableOpenAiModels(apiKey: string): Promise<string[]> {
  if (openAiModelsCache && Date.now() - openAiModelsCache.fetchedAt < 5 * 60 * 1000) {
    return openAiModelsCache.models;
  }
  const openai = new OpenAI({ apiKey });
  try {
    const listPromise = openai.models.list();
    const listResp = await withTimeout(listPromise, 4500, () => {
      throw new Error('Timeout consultando lista de modelos en OpenAI.');
    });
    const ids = (listResp.data || [])
      .map((m: any) => String(m.id || '').trim())
      .filter(Boolean)
      .sort();
    if (ids.length > 0) {
      openAiModelsCache = { models: ids, fetchedAt: Date.now() };
    }
    return ids;
  } catch (_e) {
    return openAiModelsCache?.models || [];
  }
}

function extractCleanDataUrlParts(rawUrl?: string, defaultMime = 'image/jpeg'): {
  mimeType: string;
  dataUrl: string;
  base64Data: string;
} | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith('data:image/') || trimmed.startsWith('data:image/svg')) return null;
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) return null;
  const header = trimmed.slice(5, commaIdx);
  const mime = header.split(';')[0]?.trim() || defaultMime;
  const base64Data = trimmed.slice(commaIdx + 1).replace(/\s+/g, '');
  if (base64Data.length < 64) return null;
  return {
    mimeType: mime,
    dataUrl: `data:${mime};base64,${base64Data}`,
    base64Data,
  };
}

async function callGeminiBookModelBatch(params: {
  modelName: string;
  systemInstructionText: string;
  prompt: string;
  multimodalPhotos: MultimodalBookPhotoInput[];
  pdfBase64?: string;
  timeoutMs: number;
}): Promise<{ parsed: ParsedAiManuscriptBatchResponse; respondedModel: string; cachedTokens?: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY no está configurada en el servidor.');
  }

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      subtitle: { type: Type.STRING },
      introduction: { type: Type.STRING },
      closingMessage: { type: Type.STRING },
      chapters: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            partNumber: { type: Type.NUMBER },
            dimensionKey: { type: Type.STRING },
            title: { type: Type.STRING },
            paragraphs: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            pullQuote: { type: Type.STRING },
            photoPlacements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  photoId: { type: Type.STRING },
                  paragraphIndex: { type: Type.NUMBER },
                  shortCaption: { type: Type.STRING },
                },
                required: ['photoId', 'paragraphIndex', 'shortCaption'],
              },
            },
          },
          required: ['id', 'partNumber', 'dimensionKey', 'title', 'paragraphs'],
        },
      },
    },
    required: ['title', 'subtitle', 'introduction', 'chapters'],
  };

  const candidateModels = Array.from(
    new Set(
      [params.modelName, 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-flash-latest'].filter(
        Boolean
      )
    )
  );

  let lastError: any = null;
  for (const candidateModel of candidateModels) {
    try {
      const contentParts: any[] = [];
      if (params.pdfBase64 && params.pdfBase64.length > 100 && params.pdfBase64.length < 1_500_000) {
        contentParts.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: params.pdfBase64,
          },
        });
      }
      for (const ph of params.multimodalPhotos.slice(0, 4)) {
        if (ph.base64Data && ph.base64Data.length < 750_000) {
          contentParts.push({
            inlineData: {
              mimeType: ph.mimeType || 'image/jpeg',
              data: ph.base64Data,
            },
          });
        }
      }
      contentParts.push({ text: params.prompt });

      const callPromise = ai.models.generateContent({
        model: candidateModel,
        contents: contentParts.length === 1 ? params.prompt : contentParts,
        config: {
          systemInstruction: params.systemInstructionText,
          responseMimeType: 'application/json',
          responseSchema,
        },
      });

      const response = await withTimeout(callPromise, params.timeoutMs, () => {
        throw new Error(`Tiempo de espera agotado en Gemini (${candidateModel}).`);
      });

      const rawText = response?.text?.trim() || '';
      const parsed = safeJsonExtract<ParsedAiManuscriptBatchResponse | null>(rawText, null);
      if (parsed && Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
        const cachedTokens = (response as any)?.usageMetadata?.cachedContentTokenCount || 0;
        return { parsed, respondedModel: candidateModel, cachedTokens };
      }
      throw new Error(`Respuesta JSON vacía o incompleta del modelo Gemini (${candidateModel}).`);
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error(`Fallo al generar manuscrito con Google Gemini (${params.modelName}).`);
}

// =============================================================================================
// V5.3.3 — Time and token budget of book generation
// =============================================================================================
/** The 5-page editorial sample must be on screen within 60 s (budget leaves margin for the PDF view). */
export let PREVIEW_TIME_BUDGET_MS = Number(process.env.BOOK_PREVIEW_TIME_BUDGET_MS) || 50_000;
/** Tests only. */
export function __setPreviewTimeBudgetForTests(ms: number | null): void {
  PREVIEW_TIME_BUDGET_MS = ms ?? (Number(process.env.BOOK_PREVIEW_TIME_BUDGET_MS) || 50_000);
}
/** Shortest model call worth starting inside the sample budget. */
export const PREVIEW_MIN_CALL_MS = 8_000;
/** A second provider is only tried for the sample if at least this much budget is left. */
export const PREVIEW_FAILOVER_MIN_MS = 18_000;

export type BookReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
const parseEffort = (raw: string | undefined, fallback: BookReasoningEffort): BookReasoningEffort =>
  raw === 'minimal' || raw === 'low' || raw === 'medium' || raw === 'high' ? raw : fallback;
/**
 * Reasoning models (gpt-5/gpt-6/o-series) spend most of their completion tokens "thinking". Book
 * drafting follows explicit instructions and does not need deep reasoning: a low effort keeps the
 * same instructions while cutting latency and completion tokens. Configurable per scope.
 */
export const BOOK_REASONING_EFFORT_PREVIEW = parseEffort(process.env.BOOK_REASONING_EFFORT_PREVIEW, 'low');
export const BOOK_REASONING_EFFORT_FULL = parseEffort(process.env.BOOK_REASONING_EFFORT_FULL, 'low');
export const BOOK_REASONING_EFFORT_AUDIT = parseEffort(process.env.BOOK_REASONING_EFFORT_AUDIT, 'low');

export function isReasoningBookModel(model: string): boolean {
  return /^gpt-6|^gpt-5|^o1|^o3|^o4/i.test(String(model || ''));
}

/** Models that rejected the `reasoning_effort` parameter (they are called without it afterwards). */
const modelsRejectingReasoningEffort = new Set<string>();
export function reasoningEffortParams(model: string, effort?: BookReasoningEffort): Record<string, unknown> {
  if (!effort || !isReasoningBookModel(model) || modelsRejectingReasoningEffort.has(model)) return {};
  return { reasoning_effort: effort };
}
export function noteReasoningEffortRejection(model: string, err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  if (/reasoning_effort|reasoning effort|unrecognized request argument|unsupported.*parameter|unsupported_parameter/i.test(msg)) {
    if (!modelsRejectingReasoningEffort.has(model)) {
      modelsRejectingReasoningEffort.add(model);
      return true;
    }
  }
  return false;
}

async function callOpenAiBookModelBatch(params: {
  modelName: string;
  systemInstructionText: string;
  prompt: string;
  multimodalPhotos: MultimodalBookPhotoInput[];
  timeoutMs: number;
  allowBackupModels?: boolean;
  reasoningEffort?: BookReasoningEffort;
}): Promise<{ parsed: ParsedAiManuscriptBatchResponse; respondedModel: string; cachedTokens?: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_OPENAI_API_KEY') {
    throw new Error('OPENAI_API_KEY no está configurada en el servidor.');
  }

  // Fast pre-flight check against enabled OpenAI models so non-existent models like 'gpt-6-luna'
  // fail immediately (<200ms) with a clear diagnostic message instead of hanging until AbortController aborts.
  const availableModels = await getAvailableOpenAiModels(apiKey);
  if (
    !params.allowBackupModels &&
    availableModels.length > 0 &&
    !availableModels.includes(params.modelName)
  ) {
    const suggested = availableModels
      .filter((m) => /^gpt-4o|^gpt-4\.1|^o3|^o4/i.test(m))
      .slice(0, 4)
      .join(', ');
    throw new Error(
      `El modelo '${params.modelName}' no existe o no está habilitado en la cuenta de OpenAI conectada${
        suggested ? ` (modelos disponibles recomendados: ${suggested})` : ''
      }.`
    );
  }

  const openai = new OpenAI({ apiKey });
  const candidateModels = params.allowBackupModels
    ? Array.from(new Set([params.modelName, 'gpt-4o', 'gpt-4o-mini'].filter(Boolean)))
    : [params.modelName].filter(Boolean);

  let lastError: any = null;
  for (const candidateModel of candidateModels) {
    if (
      params.allowBackupModels &&
      availableModels.length > 0 &&
      !availableModels.includes(candidateModel)
    ) {
      continue;
    }
    try {
      const userContent: any[] = [
        {
          type: 'text',
          text: `${params.prompt}\n\nIMPORTANTE: Responde EXCLUSIVAMENTE con un objeto JSON válido con las propiedades "title", "subtitle", "introduction" y "chapters" (cada capítulo con "id", "partNumber", "dimensionKey", "title", "paragraphs", "pullQuote" y "photoPlacements" con [{"photoId", "paragraphIndex", "shortCaption"}]).`,
        },
      ];

      for (const ph of params.multimodalPhotos.slice(0, 4)) {
        if (ph.dataUrl && ph.dataUrl.length < 750_000) {
          userContent.push({
            type: 'image_url',
            image_url: {
              url: ph.dataUrl,
              detail: 'low',
            },
          });
        }
      }

      const abortController = new AbortController();
      const abortTimer = setTimeout(() => abortController.abort(), params.timeoutMs);
      let completion: any;
      try {
        const callPromise = openai.chat.completions.create(
          {
            model: candidateModel,
            ...reasoningEffortParams(candidateModel, params.reasoningEffort),
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: `${params.systemInstructionText}\n\nEres el motor editorial biográfico de YouForever. Redactas libros autobiográficos respetando fielmente el Compilado Testimonial Fidedigno (PDF fuente), las fotografías adjuntas y el Prompt Literario activo configurado para el estilo seleccionado. Devuelves únicamente JSON válido.`,
              },
              {
                role: 'user',
                content: userContent,
              },
            ],
          },
          { signal: abortController.signal }
        );

        completion = await withTimeout(callPromise, params.timeoutMs, () => {
          abortController.abort();
          throw new Error(`Tiempo de espera agotado en OpenAI (${candidateModel}).`);
        });
      } finally {
        clearTimeout(abortTimer);
      }

      const rawText = completion.choices?.[0]?.message?.content?.trim() || '';
      const parsed = safeJsonExtract<ParsedAiManuscriptBatchResponse | null>(rawText, null);
      if (parsed && Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
        const cachedTokens = completion?.usage?.prompt_tokens_details?.cached_tokens || 0;
        return { parsed, respondedModel: completion.model || candidateModel, cachedTokens };
      }
      throw new Error(`Respuesta JSON vacía o incompleta del modelo OpenAI (${candidateModel}).`);
    } catch (err: any) {
      lastError = err;
      // V5.3.3: a model that does not accept `reasoning_effort` is retried once without it.
      if (noteReasoningEffortRejection(candidateModel, err)) {
        candidateModels.splice(candidateModels.indexOf(candidateModel) + 1, 0, candidateModel);
        continue;
      }
      const errMsg = String(err?.message || '');
      const isInvalidModelOrTimeout =
        /model_not_found|does not exist|no existe|Tiempo de espera agotado|aborted/i.test(errMsg);
      if (params.multimodalPhotos.length > 0 && !isInvalidModelOrTimeout) {
        const textAbortController = new AbortController();
        const textAbortTimer = setTimeout(() => textAbortController.abort(), params.timeoutMs);
        try {
          const textOnlyPromise = openai.chat.completions.create(
            {
              model: candidateModel,
              ...reasoningEffortParams(candidateModel, params.reasoningEffort),
              response_format: { type: 'json_object' },
              messages: [
                {
                  role: 'system',
                  content: `${params.systemInstructionText}\n\nEres el motor editorial biográfico de YouForever. Devuelves únicamente JSON válido con "title", "subtitle", "introduction" y "chapters".`,
                },
                {
                  role: 'user',
                  content: `${params.prompt}\n\nIMPORTANTE: Responde EXCLUSIVAMENTE con un objeto JSON válido con las propiedades "title", "subtitle", "introduction" y "chapters".`,
                },
              ],
            },
            { signal: textAbortController.signal }
          );
          const completion = await withTimeout(textOnlyPromise, params.timeoutMs, () => {
            textAbortController.abort();
            throw new Error(`Tiempo de espera agotado en OpenAI (${candidateModel}).`);
          });
          const rawText = completion.choices?.[0]?.message?.content?.trim() || '';
          const parsed = safeJsonExtract<ParsedAiManuscriptBatchResponse | null>(rawText, null);
          if (parsed && Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
            return { parsed, respondedModel: completion.model || candidateModel };
          }
        } catch (innerErr: any) {
          lastError = innerErr;
        } finally {
          clearTimeout(textAbortTimer);
        }
      }
    }
  }

  throw lastError || new Error(`Fallo al generar manuscrito con OpenAI (${params.modelName}).`);
}

// In-flight deduplication and batch checkpoint caches for book generation
const inFlightBookGenerations = new Map<string, Promise<any>>();
const manuscriptBatchCheckpoints = new Map<string, Map<number, BookBatchCheckpointPayload>>();

// =============================================================================================
// V5.3 — Operational metrics, repair summary and the fast 5-page editorial sample
// =============================================================================================

/**
 * Measured operational data of one generation (admin-only). Only what was actually observed is
 * recorded: token counts stay null when the provider did not report them, and no cost is ever
 * estimated without real token data.
 */
export interface BookGenerationMetrics {
  startedAtMs: number;
  totalMs: number;
  draftMs: number;
  auditMs: number;
  repairMs: number;
  draftCalls: number;
  judgeInvocations: number;
  judgeCasesSent: number;
  judgeCasesFromCache: number;
  judgeCasesDeferred: number;
  repairRounds: number;
  repairCalls: number;
  batchesTotal: number;
  batchesGenerated: number;
  batchesReused: number;
  retries: number;
  providerFailovers: number;
  technicalErrors: string[];
  tokens: { input: number | null; output: number | null; cachedInput: number | null };
  estimatedCostUsd: number | null;
  callsByOperation: Array<{ operation: string; provider: string; model: string; batchIdx?: number }>;
  servedFromCache?: boolean;
  fullyVerified?: boolean;
}

export function createEmptyGenerationMetrics(): BookGenerationMetrics {
  return {
    startedAtMs: Date.now(),
    totalMs: 0,
    draftMs: 0,
    auditMs: 0,
    repairMs: 0,
    draftCalls: 0,
    judgeInvocations: 0,
    judgeCasesSent: 0,
    judgeCasesFromCache: 0,
    judgeCasesDeferred: 0,
    repairRounds: 0,
    repairCalls: 0,
    batchesTotal: 0,
    batchesGenerated: 0,
    batchesReused: 0,
    retries: 0,
    providerFailovers: 0,
    technicalErrors: [],
    tokens: { input: null, output: null, cachedInput: null },
    estimatedCostUsd: null,
    callsByOperation: [],
  };
}

function recordJudgeStats(metrics: BookGenerationMetrics, report: DocumentaryAuditReport): void {
  const st = report.semanticAudit?.judgeStats;
  if (!st) return;
  metrics.judgeInvocations += st.invocations;
  metrics.judgeCasesSent += st.casesSent;
  metrics.judgeCasesFromCache += st.casesFromCache;
  metrics.judgeCasesDeferred = st.casesDeferred;
}

/** What the repair stage did for one generation (admin-only). */
export interface BookRepairSummary {
  roundsPlanned: number;
  roundsExecuted: number;
  chaptersReviewed: number;
  repairsAccepted: number;
  repairsRejected: number;
  unitsRecovered: number;
  remainingIncidents: number;
  coverageBeforeRepair: number;
  coverageAfterRepair: number;
  stopReason:
    | 'not_needed'
    | 'fully_verified'
    | 'eligible_minimum_reached'
    | 'no_repairable_incidents'
    | 'no_improvement'
    | 'max_rounds';
  rounds: Array<{
    round: number;
    chaptersReviewed: number;
    chapterIds: string[];
    accepted: boolean;
    repairedChapters: number;
    verifiedUnitsBefore: number;
    verifiedUnitsAfter: number;
  }>;
}

/** Drafted samples, keyed by the sample's generation fingerprint (sources + settings). */
const previewSampleCache = new Map<string, any>();

/** Test-only: forgets cached samples. */
export function __clearPreviewSampleCacheForTests(): void {
  previewSampleCache.clear();
}

/** Testimony units drafted for the 5-page sample (enough for pages 3..5 of the sample). */
export const PREVIEW_SAMPLE_MAX_UNITS = 8;

/**
 * V5.3 — Opening segments of the editorial plan used for the sample: the plan already orders
 * chapters by life stage, so the first segments are the beginning of the book. Takes whole
 * segments until `PREVIEW_SAMPLE_MAX_UNITS` testimony units (at least one segment, at most two
 * chapters), so the model writes only what the 5 pages can show.
 */
export function selectPreviewSampleSegments<T extends { id: string; unidadesTestimonialesOriginales: unknown[] }>(
  segments: T[]
): T[] {
  const selected: T[] = [];
  const chapterIds = new Set<string>();
  let units = 0;
  for (const seg of segments) {
    if (selected.length > 0 && units >= PREVIEW_SAMPLE_MAX_UNITS) break;
    if (!chapterIds.has(seg.id) && chapterIds.size >= 2) break;
    chapterIds.add(seg.id);
    selected.push(seg);
    units += seg.unidadesTestimonialesOriginales.length;
  }
  return selected;
}

/**
 * V5.3 — Local fidelity of the sample: ONLY the memories it uses are checked, with the
 * deterministic rules (names, dates, places, figures, actions, family relations, invented data,
 * excluded content). No global coverage, no semantic judge, no repair call. A sample chapter
 * with an invented or contradictory fact, or with excluded content, is replaced by the faithful
 * rule-based redaction of the same memories.
 */
export function finalizePreviewSample(params: {
  candidate: DemoManuscript;
  fallback: DemoManuscript;
  sampleChapterIds: string[];
  answers: AnswerRecord[] | any[];
  questions: QuestionRecord[] | any[];
}): DemoManuscript {
  const { candidate, fallback, sampleChapterIds, answers, questions } = params;
  const idSet = new Set(sampleChapterIds);
  let chapters = candidate.chapters.filter((c) => idSet.has(c.id));
  if (chapters.length === 0) chapters = fallback.chapters.filter((c) => idSet.has(c.id));
  const usedAnswerIds = new Set(chapters.flatMap((c) => c.sourceAnswerIds || []));
  const usedAnswers = (answers as any[]).filter((a) => usedAnswerIds.has(a.id));
  const issues: string[] = [];
  const replacedChapterIds: string[] = [];
  const local = auditAndApproveBookManuscript({
    manuscript: { ...candidate, chapters, introduction: candidate.introduction, closingMessage: '' },
    answers: usedAnswers,
    questions,
  });
  const ver = local.report.veracityAudit;
  const badFlags = [
    ...(ver?.inventedDataFlags || []),
    ...(ver?.leakedExcludedContentFlags || []),
    ...(ver?.semanticContradictionFlags || []),
  ];
  const contradictedChapterIds = new Set(
    local.report.traceabilityMatrix
      .filter((t) => (t.semanticIssues || []).length > 0 && t.chapterId)
      .map((t) => t.chapterId as string)
  );
  chapters = chapters.map((ch) => {
    const flagged =
      contradictedChapterIds.has(ch.id) || badFlags.some((f) => f.includes(`"${ch.title}"`));
    if (!flagged) return ch;
    const safe = fallback.chapters.find((c) => c.id === ch.id);
    if (!safe) return ch;
    replacedChapterIds.push(ch.id);
    issues.push(`Capítulo "${ch.title}": dato incompatible con los testimonios usados; se usó la redacción fiel.`);
    return { ...safe };
  });
  const introInvented = (ver?.inventedDataFlags || []).some((f) => f.includes('"Introducción"'));
  const fidelity: PreviewFidelityReport = {
    checkedAnswerIds: Array.from(usedAnswerIds),
    checkedUnits: local.report.totalSourceUnits,
    verifiedUnits: local.report.integratedUnits,
    replacedChapterIds,
    issues,
  };
  return {
    ...candidate,
    introduction: introInvented ? fallback.introduction : candidate.introduction,
    chapters,
    generationStatus: 'preview_sample',
    status: 'preview_sample',
    isPreviewSample: true,
    previewFidelity: fidelity,
    approvalEvidence: undefined,
    documentaryAudit: undefined,
    editorialAudit: undefined,
    deliveryDecision: undefined,
  };
}

/** V5.1: the chapter each answer is linked to (first chapter that lists it among its sources). */
function buildAnswerHomeChapterMap(manuscript: DemoManuscript): Map<string, string> {
  const home = new Map<string, string>();
  for (const ch of manuscript.chapters || []) {
    for (const answerId of ch.sourceAnswerIds || []) {
      if (!home.has(answerId)) home.set(answerId, ch.id);
    }
  }
  return home;
}

/**
 * V5.1: unresolved defects attributed to each chapter id — unverified testimony units whose best
 * location is that chapter plus editorial defects that name the chapter's title.
 */
function countUnresolvedDefectsByChapter(
  audit: {
    manuscript: DemoManuscript;
    report: DocumentaryAuditReport;
    editorialAudit: EditorialQualityAuditReport;
  },
  answerHomeChapter: Map<string, string> = buildAnswerHomeChapterMap(audit.manuscript)
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of audit.report.traceabilityMatrix || []) {
    if (entry.verified !== false || entry.exclusionReason !== 'none') continue;
    // A missing memory belongs to the chapter its answer was planned for. The audit's
    // "best matching paragraph" of an absent memory can sit in any chapter and would blame
    // the wrong one.
    const chId =
      answerHomeChapter.get(entry.answerId) || entry.chapterId || entry.assignedChapterId || '';
    if (!chId || chId === 'none') continue;
    counts.set(chId, (counts.get(chId) || 0) + 1);
  }
  for (const ch of audit.manuscript.chapters || []) {
    const titleNeedle = `"${ch.title}"`;
    const editorialHits = (audit.editorialAudit.blockingDefects || []).filter((d) =>
      d.includes(titleNeedle)
    ).length;
    if (editorialHits > 0) counts.set(ch.id, (counts.get(ch.id) || 0) + editorialHits);
  }
  return counts;
}

function computeManuscriptDefectScore(
  docReport: DocumentaryAuditReport,
  edReport: EditorialQualityAuditReport
): number {
  // V5.2: defects are weighted by severity instead of counted as equal lines. Otherwise a
  // repair that removes several harmless editorial bridges (each an "unsupported addition"
  // line) while inventing dates or breaking titles would look like an improvement.
  const blocking = docReport.blockingDefects || [];
  const ver = docReport.veracityAudit;
  const severe = new Set<string>([
    ...(ver?.inventedDataFlags || []),
    ...(ver?.semanticContradictionFlags || []),
    ...(ver?.leakedExcludedContentFlags || []),
    ...(ver?.coupleAttributionViolations || []),
  ]);
  const inventedSet = new Set(ver?.inventedDataFlags || []);
  const mild = new Set<string>(
    (ver?.unsupportedAdditionFlags || []).filter((f) => !inventedSet.has(f))
  );
  let blockingScore = 0;
  for (const line of blocking) {
    if (severe.has(line)) blockingScore += 15;
    else if (mild.has(line)) blockingScore += 3;
    else if (/^Fragmentaci[oó]n editorial inv[aá]lida/.test(line)) blockingScore += 15;
    else blockingScore += 10;
  }
  return (
    blockingScore +
    (docReport.coverageAudit?.missingUnitIds?.length || 0) * 5 +
    (docReport.semanticAudit?.ambiguousUnitsCount || 0) * 3 +
    (edReport.blockingDefects?.length || 0) * 4
  );
}

export interface SemanticJudgmentCaseInput {
  unitId: string;
  originalTestimony: string;
  candidateExcerpt: string;
  ambiguityReason: string;
  /** V5.1: names, places, dates or figures of the testimony that the rules could not locate literally. */
  detailsToConfirm?: string[];
  /**
   * V5.2: what the judge is asked.
   * - testimony_fidelity (default): is this testimony unit faithfully told in the excerpt?
   * - unsupported_addition: does `sentenceToVerify` add a biographical fact that no testimony
   *   supports ("supported" = harmless editorial bridge or supported fact; anything else blocks)?
   */
  checkKind?: 'testimony_fidelity' | 'unsupported_addition';
  sentenceToVerify?: string;
  /** V5.2: protagonists of the book; naming them is never an invented fact. */
  protagonistNames?: string[];
}

export interface SemanticJudgmentVerdict {
  unitId: string;
  /**
   * - supported: same fact, agent, polarity, modality and details, however it is worded.
   * - contradicted: the excerpt states something incompatible with the testimony.
   * - omitted (V5.1): the excerpt does not contradict the testimony but leaves out the memory or
   *   one of its concrete details. It is a real omission and goes to narrative repair.
   * - inconclusive: the judge could not decide.
   */
  verdict: 'supported' | 'contradicted' | 'omitted' | 'inconclusive';
  rationale: string;
  /** V5.1: set when no provider could be reached. A technical condition, not a judgement. */
  unavailable?: boolean;
}

/**
 * V5.1 — Semantic verdict cache. The hybrid audit runs many times over mostly identical text
 * (before and after every repair pass, and again when saving). A verdict depends only on the
 * testimony, the excerpt it was compared with and the rule version, so it is memoized by that
 * triple: unchanged chapters are never re-judged, and the audit performed when saving returns
 * exactly what the audit performed during generation returned.
 */
const SEMANTIC_VERDICT_CACHE_MAX_ENTRIES = 6000;
const semanticVerdictCache = new Map<string, Omit<SemanticJudgmentVerdict, 'unitId'>>();

function buildSemanticVerdictCacheKey(
  narrativeStyle: DemoNarrativeStyleId,
  c: SemanticJudgmentCaseInput
): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        CANONICAL_AUDIT_RULES_VERSION,
        narrativeStyle,
        c.originalTestimony,
        c.candidateExcerpt,
        (c.detailsToConfirm || []).slice().sort(),
        c.checkKind || 'testimony_fidelity',
        c.sentenceToVerify || '',
      ])
    )
    .digest('hex');
}

function rememberSemanticVerdict(key: string, verdict: SemanticJudgmentVerdict): void {
  // Only decisive verdicts are cached: an inconclusive or unavailable result must be retried.
  if (verdict.unavailable || verdict.verdict === 'inconclusive') return;
  if (semanticVerdictCache.size >= SEMANTIC_VERDICT_CACHE_MAX_ENTRIES) {
    const oldest = semanticVerdictCache.keys().next().value;
    if (oldest !== undefined) semanticVerdictCache.delete(oldest);
  }
  semanticVerdictCache.set(key, { verdict: verdict.verdict, rationale: verdict.rationale });
}

/** Test hook: clears memoized semantic verdicts. */
export function clearSemanticVerdictCache(): void {
  semanticVerdictCache.clear();
}

export type SemanticJudgeFunction = (params: {
  cases: SemanticJudgmentCaseInput[];
  narrativeStyle: DemoNarrativeStyleId;
  provider: BookAiProvider;
  model: string;
  alternateProvider: BookAiProvider;
  alternateModel: string;
}) => Promise<SemanticJudgmentVerdict[]>;

/**
 * Invokes the configured AI provider ONLY on units marked 'ambiguous' by deterministic propositional rules,
 * classifying each literary paraphrase or conversational negation edge case with a structured JSON verdict.
 */
export async function judgeAmbiguousSemanticUnitsWithAI(params: {
  cases: SemanticJudgmentCaseInput[];
  narrativeStyle: DemoNarrativeStyleId;
  provider: BookAiProvider;
  model: string;
  alternateProvider: BookAiProvider;
  alternateModel: string;
}): Promise<SemanticJudgmentVerdict[]> {
  const { cases, narrativeStyle, provider, model, alternateProvider, alternateModel } = params;
  if (!cases || cases.length === 0) return [];

  const allVerdicts: SemanticJudgmentVerdict[] = [];
  const BATCH_SIZE = 12;
  const MAX_PARALLEL_JUDGE_BATCHES = 3;

  const personNote =
    narrativeStyle === 'third_person_biography'
      ? 'El libro está escrito en TERCERA PERSONA: que "yo/me/mi" del testimonio aparezca como "él/ella/le/su" es la conversión correcta y NO es una contradicción ni una inversión de quién actúa.'
      : 'El libro está escrito en primera persona.';

  const judgeBatch = async (slice: SemanticJudgmentCaseInput[]): Promise<SemanticJudgmentVerdict[]> => {
    const judgePrompt = `Evalúa cada par (testimonio original vs. fragmento del manuscrito). Decide por el SIGNIFICADO, no por las palabras.
Estilo narrativo del libro: ${narrativeStyle}. ${personNote}

Veredicto por unidad (elige exactamente uno):
- "supported": el fragmento conserva el mismo hecho, quién realiza la acción, la polaridad (afirmación/negación), la modalidad (hecho consumado vs. intento) y las dudas del testimonio, aunque use paráfrasis, sinónimos, otro orden o vocabulario más literario. Ejemplo: "Mi padre me salvó de caer al río" y "Gracias a mi padre, conseguí evitar caer al agua" son equivalentes.
- "contradicted": el fragmento afirma algo INCOMPATIBLE con el testimonio: invierte quién hizo la acción, niega lo afirmado o afirma lo negado, convierte un intento en hecho consumado (o al revés) o cambia un dato concreto por otro distinto. Ejemplo: "Mi padre me empujó al río" contradice "Mi padre me salvó de caer al río".
- "omitted": el fragmento no contradice el testimonio, pero NO contiene ese recuerdo o le falta algún dato concreto suyo (un nombre, lugar, fecha, cifra o hecho). Cuando el caso incluye "detailsToConfirm", cada detalle debe estar presente con el mismo valor, aunque esté escrito de otra forma ("1975" = "mil novecientos setenta y cinco"; "mamá" = "madre"). Indica en "rationale" qué falta exactamente.
- "inconclusive": úsalo solo si de verdad no es posible decidir.

No penalices la limpieza de muletillas orales, repeticiones o titubeos del testimonio. No exijas las mismas palabras.
El fragmento puede llegar en varias partes etiquetadas con su capítulo y párrafo (incluidos el párrafo anterior y el siguiente o un capítulo relacionado): un recuerdo repartido entre esas partes está "supported".

Casos con "checkKind": "unsupported_addition": "originalTestimony" reúne los testimonios del capítulo y "sentenceToVerify" es una oración del libro que no comparte palabras con ellos. Responde "supported" si la oración es un puente editorial o reflexivo que no afirma hechos nuevos de la vida del protagonista, o si su contenido sí está respaldado por los testimonios; responde "contradicted" si contradice un testimonio y "omitted" si afirma un hecho biográfico (acontecimiento, lugar, persona, fecha, logro) que ningún testimonio respalda. Nombrar a los protagonistas ("protagonistNames") nunca es un dato inventado.

Casos a evaluar:
${JSON.stringify(slice, null, 2)}

Responde EXCLUSIVAMENTE con un JSON válido:
{
  "verdicts": [
    { "unitId": "id_de_unidad", "verdict": "supported" | "contradicted" | "omitted" | "inconclusive", "rationale": "explicación breve en español" }
  ]
}`;

    const tryProvider = async (prov: BookAiProvider, mdl: string): Promise<SemanticJudgmentVerdict[] | null> => {
      if (prov === 'openai') {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey === 'MY_OPENAI_API_KEY') return null;
        const available = await getAvailableOpenAiModels(apiKey);
        const resolvedModel =
          available.length === 0 || available.includes(mdl)
            ? mdl
            : available.find((m) => /^gpt-4o|^gpt-4\.1/.test(m)) || 'gpt-4o';
        const openai = new OpenAI({ apiKey });
        // V5.3.3: one retry without `reasoning_effort` if the model does not accept it.
        for (let attempt = 0; attempt < 2; attempt++) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 22000);
          try {
            const resp = await withTimeout(
              openai.chat.completions.create(
                {
                  model: resolvedModel,
                  // The judge classifies short cases; deep reasoning only multiplies tokens.
                  ...reasoningEffortParams(resolvedModel, BOOK_REASONING_EFFORT_AUDIT),
                  response_format: { type: 'json_object' },
                  messages: [
                    {
                      role: 'system',
                      content:
                        'Eres un auditor semántico documental estricto de biografías. Evalúas fidelidad factual sin tolerar invenciones ni inversiones de sentido. Devuelves únicamente JSON.',
                    },
                    { role: 'user', content: judgePrompt },
                  ],
                },
                { signal: ctrl.signal }
              ),
              22000,
              () => {
                ctrl.abort();
                return null;
              }
            );
            const raw = resp?.choices?.[0]?.message?.content || '';
            const parsed = safeJsonExtract<{ verdicts?: SemanticJudgmentVerdict[] } | null>(raw, null);
            return Array.isArray(parsed?.verdicts) ? parsed!.verdicts : null;
          } catch (err) {
            if (attempt === 0 && noteReasoningEffortRejection(resolvedModel, err)) continue;
            throw err;
          } finally {
            clearTimeout(timer);
          }
        }
        return null;
      } else {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
        const raw = await generateJsonWithFallback({
          prompt: judgePrompt,
          systemInstruction:
            'Eres un auditor semántico documental estricto de biografías. Evalúas fidelidad factual sin tolerar invenciones ni inversiones de sentido.',
          models: Array.from(new Set([mdl, 'gemini-3-flash-preview', 'gemini-2.5-flash'].filter(Boolean))),
          timeoutMsPerModel: 15000,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              verdicts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    unitId: { type: Type.STRING },
                    verdict: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                  },
                  required: ['unitId', 'verdict', 'rationale'],
                },
              },
            },
            required: ['verdicts'],
          },
        });
        const parsed = safeJsonExtract<{ verdicts?: SemanticJudgmentVerdict[] } | null>(raw, null);
        return Array.isArray(parsed?.verdicts) ? parsed!.verdicts : null;
      }
    };

    let sliceVerdicts: SemanticJudgmentVerdict[] | null = null;
    try {
      sliceVerdicts = await tryProvider(provider, model);
    } catch (_e1) {
      sliceVerdicts = null;
    }
    if (!sliceVerdicts) {
      try {
        sliceVerdicts = await tryProvider(alternateProvider, alternateModel);
      } catch (_e2) {
        sliceVerdicts = null;
      }
    }

    const batchVerdicts: SemanticJudgmentVerdict[] = [];
    if (sliceVerdicts) {
      const answered = new Set<string>();
      for (const v of sliceVerdicts) {
        if (!v || !v.unitId) continue;
        const cleanVerdict: SemanticJudgmentVerdict['verdict'] =
          v.verdict === 'supported'
            ? 'supported'
            : v.verdict === 'contradicted'
            ? 'contradicted'
            : v.verdict === 'omitted'
            ? 'omitted'
            : 'inconclusive';
        answered.add(v.unitId);
        batchVerdicts.push({
          unitId: v.unitId,
          verdict: cleanVerdict,
          rationale: String(v.rationale || '').trim(),
        });
      }
      // A unit the model skipped in its answer was not judged: report it as such, not as approved.
      for (const c of slice) {
        if (!answered.has(c.unitId)) {
          batchVerdicts.push({
            unitId: c.unitId,
            verdict: 'inconclusive',
            rationale: 'El juez semántico no devolvió veredicto para esta unidad.',
            unavailable: true,
          });
        }
      }
    } else {
      for (const c of slice) {
        batchVerdicts.push({
          unitId: c.unitId,
          verdict: 'inconclusive',
          rationale: 'Juez semántico temporalmente no disponible; se conserva revisión pendiente.',
          unavailable: true,
        });
      }
    }
    return batchVerdicts;
  };

  // V5.1: judge batches run with bounded parallelism so long interviews do not accumulate
  // sequential provider latency (the main source of audit-stage timeouts).
  const slices: SemanticJudgmentCaseInput[][] = [];
  for (let i = 0; i < cases.length; i += BATCH_SIZE) {
    slices.push(cases.slice(i, i + BATCH_SIZE));
  }
  for (let i = 0; i < slices.length; i += MAX_PARALLEL_JUDGE_BATCHES) {
    const settled = await Promise.all(
      slices.slice(i, i + MAX_PARALLEL_JUDGE_BATCHES).map((slice) => judgeBatch(slice))
    );
    for (const group of settled) allVerdicts.push(...group);
  }

  return allVerdicts;
}

/**
 * Hybrid Semantic & Editorial Audit (`auditWithHybridSemantics`):
 * 1. Runs fast deterministic propositional + editorial audit (`auditAndApproveBookManuscript`).
 * 2. Invokes `judgeAmbiguousSemanticUnitsWithAI` ONLY when genuine `ambiguous` units remain.
 * 3. Recomputes matrix statuses, coverage, and `passed` strictly from verified verdicts without auto-approving inconclusive or contradicted units.
 */
export async function auditWithHybridSemantics(params: {
  manuscript: DemoManuscript;
  answers: AnswerRecord[] | any[];
  questions: QuestionRecord[] | any[];
  provider: BookAiProvider;
  model: string;
  alternateProvider: BookAiProvider;
  alternateModel: string;
  repairAttemptsUsed?: number;
  repairedUnitIds?: string[];
  aiJudgeOverride?: SemanticJudgeFunction;
  /**
   * V5.1: reuse memoized verdicts for identical (testimony, excerpt) pairs. Defaults to true with
   * the real judge and to false when a judge override is injected (so injected judges are always
   * consulted unless the caller opts in).
   */
  useVerdictCache?: boolean;
  /**
   * V5.3 — How many cases go to the semantic judge.
   * - 'priority' (default): high-risk cases always (suspected contradictions, changed actions,
   *   concrete details to confirm, possibly invented facts); low-risk paraphrases only when the
   *   delivery decision cannot be reached without them. Unsent units stay PENDING (never covered).
   * - 'exhaustive': every case is judged (V5.2 behaviour, for strict administrative audits).
   */
  judgePolicy?: 'priority' | 'exhaustive';
}): Promise<{
  manuscript: DemoManuscript;
  report: DocumentaryAuditReport;
  editorialAudit: EditorialQualityAuditReport;
  inventory: DocumentaryInventory;
}> {
  const {
    manuscript,
    answers,
    questions,
    provider,
    model,
    alternateProvider,
    alternateModel,
    repairAttemptsUsed = 0,
    repairedUnitIds = [],
    aiJudgeOverride,
  } = params;
  const useVerdictCache = params.useVerdictCache ?? !aiJudgeOverride;

  const detResult = auditAndApproveBookManuscript({
    manuscript,
    answers,
    questions,
    repairAttemptsUsed,
    repairedUnitIds,
  });

  // V5.1 — Arbitration set. Every unit the deterministic rules could not settle on their own
  // (paraphrase below the lexical threshold, a facet not found literally, or a SUSPECTED
  // contradiction) is reviewed in context. The rules only decide the two cases they can prove:
  // literally present (supported) and nothing resembling it anywhere (missing).
  const ambiguousIds = Array.from(
    new Set([
      ...(detResult.report.semanticAudit?.reviewCandidateUnitIds || []),
      ...(detResult.report.semanticAudit?.ambiguousUnitIds || []),
    ])
  );
  if (
    ambiguousIds.length === 0 &&
    (detResult.report.veracityAudit?.unsupportedAdditionCandidates || []).length === 0
  ) {
    detResult.report.auditPolicy = 'hybrid_arbitrated';
    return detResult;
  }

  const describeFacetGaps = (facets: string[] | undefined): string[] => {
    const labels: Record<string, string> = {
      yearsOrNumbers: 'fecha o cifra',
      properNames: 'persona o parentesco',
      places: 'lugar',
      emotions: 'emoción expresada (raíz de la palabra)',
    };
    const out: string[] = [];
    for (const facet of facets || []) {
      const sepIdx = facet.indexOf(':');
      if (sepIdx < 0) continue;
      const label = labels[facet.slice(0, sepIdx)];
      if (!label) continue;
      for (const value of facet.slice(sepIdx + 1).split(',')) {
        if (value.trim()) out.push(`${label}: ${value.trim()}`);
      }
    }
    return out;
  };

  // V5.2 — Evidence for each case is RETRIEVED from the whole book: the best match, the
  // paragraphs before and after it (a memory split in two) and related paragraphs from other
  // chapters, each labeled with its chapter and paragraph. A long paragraph is cut around the
  // sentences that match, never by keeping a prefix, so the verifiable fact is not left out.
  const retrieveEvidence = createUnitEvidenceRetriever(detResult.manuscript.chapters);
  const formatFragments = (
    fragments: Array<{ chapterTitle: string; paragraphIndex: number; text: string }>
  ): string =>
    fragments
      .map((f) => `[Capítulo «${f.chapterTitle}», párrafo ${f.paragraphIndex + 1}] ${f.text}`)
      .join('\n');
  const cases: SemanticJudgmentCaseInput[] = [];
  for (const unitId of ambiguousIds) {
    const unit = detResult.inventory.eligibleFactUnits.find((u) => u.unitId === unitId);
    const trace = detResult.report.traceabilityMatrix.find((t) => t.unitId === unitId);
    if (!unit || !trace) continue;
    const evidence = retrieveEvidence({
      unit,
      chapterId: trace.chapterId,
      paragraphIndex: typeof trace.paragraphIndex === 'number' ? trace.paragraphIndex : 0,
    });
    const detailsToConfirm = describeFacetGaps(trace.missingFacets);
    cases.push({
      unitId,
      checkKind: 'testimony_fidelity',
      originalTestimony: unit.cleanText,
      candidateExcerpt: formatFragments(evidence.fragments) || trace.evidenceSnippet || '',
      ambiguityReason:
        trace.semanticReviewReason ||
        trace.ambiguityReason ||
        'Paráfrasis literaria o giro conversacional ambiguo.',
      ...(detailsToConfirm.length > 0 ? { detailsToConfirm } : {}),
    });
  }

  // V5.2 — Direction-B arbitration: sentences sharing no word with any testimony.
  const additionCandidates = detResult.report.veracityAudit?.unsupportedAdditionCandidates || [];
  const protagonistNames = Array.from(
    new Set(
      [
        ...detResult.inventory.eligibleFactUnits.map((u) => u.participantName),
        ...String(detResult.manuscript.authors || '').split(/\s*(?:,|\by\b|&)\s*/),
      ]
        .map((n) => String(n || '').trim())
        .filter((n) => n.length > 1)
    )
  );
  const additionCaseByFlag = new Map<string, string>();
  additionCandidates.forEach((cand, idx) => {
    const ch = detResult.manuscript.chapters.find((c) => c.id === cand.chapterId);
    const chapterAnswerIds = new Set(ch?.sourceAnswerIds || []);
    const chapterTestimony = detResult.inventory.eligibleFactUnits
      .filter((u) => chapterAnswerIds.size === 0 || chapterAnswerIds.has(u.answerId))
      .map((u) => u.cleanText);
    const testimonyContext: string[] = [];
    let used = 0;
    for (const t of chapterTestimony) {
      if (used + t.length > 4000) break;
      testimonyContext.push(t);
      used += t.length;
    }
    const caseId = `addition::${cand.chapterId}::${cand.paragraphIndex}::${idx}`;
    additionCaseByFlag.set(cand.flag, caseId);
    cases.push({
      unitId: caseId,
      checkKind: 'unsupported_addition',
      originalTestimony: testimonyContext.join(' '),
      candidateExcerpt: `[Capítulo «${cand.chapterTitle}», párrafo ${cand.paragraphIndex + 1}] ${
        ch?.paragraphs?.[cand.paragraphIndex] || cand.sentence
      }`,
      sentenceToVerify: cand.sentence,
      protagonistNames,
      ambiguityReason: 'Oración sin palabras compartidas con los testimonios: posible dato biográfico inventado.',
    });
  });

  if (cases.length === 0) {
    detResult.report.auditPolicy = 'hybrid_arbitrated';
    return detResult;
  }

  const activeStyle = manuscript.narrativeStyle || 'first_person_literary';
  const verdictMap = new Map<string, SemanticJudgmentVerdict>();
  const cacheKeyByUnitId = new Map<string, string>();
  const judgePolicy = params.judgePolicy || 'priority';
  const traceByUnitId = new Map(detResult.report.traceabilityMatrix.map((t) => [t.unitId, t]));
  // V5.3 — risk-based priority of each case.
  const isHighPriorityCase = (c: SemanticJudgmentCaseInput): boolean => {
    if (c.checkKind === 'unsupported_addition') return true;
    const tr = traceByUnitId.get(c.unitId);
    if ((tr?.semanticIssues || []).length > 0) return true;
    if (/acción del testimonio no se localizó/.test(tr?.semanticReviewReason || '')) return true;
    if ((c.detailsToConfirm || []).length > 0) return true;
    return false;
  };
  const pendingHigh: SemanticJudgmentCaseInput[] = [];
  const pendingLow: SemanticJudgmentCaseInput[] = [];
  let judgeCacheHits = 0;
  for (const c of cases) {
    const key = buildSemanticVerdictCacheKey(activeStyle, c);
    cacheKeyByUnitId.set(c.unitId, key);
    const cached = useVerdictCache ? semanticVerdictCache.get(key) : undefined;
    if (cached) {
      verdictMap.set(c.unitId, { unitId: c.unitId, ...cached });
      judgeCacheHits++;
    } else if (judgePolicy === 'exhaustive' || isHighPriorityCase(c)) {
      pendingHigh.push(c);
    } else {
      pendingLow.push(c);
    }
  }

  let judgeInvocations = 0;
  let judgeCasesSent = 0;
  const runJudge = async (batch: SemanticJudgmentCaseInput[]) => {
    if (batch.length === 0) return;
    const judgeFn = aiJudgeOverride || judgeAmbiguousSemanticUnitsWithAI;
    judgeInvocations++;
    judgeCasesSent += batch.length;
    let freshVerdicts: SemanticJudgmentVerdict[] = [];
    try {
      freshVerdicts = await judgeFn({
        cases: batch,
        narrativeStyle: activeStyle,
        provider,
        model,
        alternateProvider,
        alternateModel,
      });
    } catch (_judgeErr) {
      // A failing judge is a technical condition: leave the units unresolved, never approved.
      freshVerdicts = [];
    }
    for (const v of freshVerdicts) {
      if (!v || !v.unitId || verdictMap.has(v.unitId)) continue;
      verdictMap.set(v.unitId, v);
      const key = cacheKeyByUnitId.get(v.unitId);
      if (key && useVerdictCache) rememberSemanticVerdict(key, v);
    }
  };

  await runJudge(pendingHigh);

  // Low-priority paraphrases are judged only when the delivery threshold cannot be reached
  // without them; otherwise they stay pending for the administrator (honestly unverified).
  const deferredUnitIds = new Set<string>();
  if (pendingLow.length > 0) {
    const totalUnits = detResult.report.totalSourceUnits || 0;
    const supportedSoFar = cases.filter(
      (c) => c.checkKind !== 'unsupported_addition' && verdictMap.get(c.unitId)?.verdict === 'supported'
    ).length;
    const provisionalVerified = detResult.report.integratedUnits + supportedSoFar;
    const thresholdReached =
      totalUnits > 0 && provisionalVerified * 100 >= DELIVERY_MIN_COVERAGE_PERCENT * totalUnits;
    if (thresholdReached) {
      for (const c of pendingLow) deferredUnitIds.add(c.unitId);
    } else {
      pendingLow.sort(
        (a, b) =>
          (traceByUnitId.get(b.unitId)?.semanticMatchScore || 0) -
          (traceByUnitId.get(a.unitId)?.semanticMatchScore || 0)
      );
      await runJudge(pendingLow);
    }
  }

  // Reconcile verdicts strictly into a deep clone of the report
  const updatedReport: DocumentaryAuditReport = structuredClone(detResult.report);
  const missingSet = new Set(updatedReport.coverageAudit?.missingUnitIds || []);
  const remainingAmbiguous: string[] = [];
  const judgeResolvedUnitIds: string[] = [];
  const judgeUnavailableUnitIds: string[] = [];
  const reviewedUnitIdSet = new Set(cases.map((c) => c.unitId));
  // A rule-based contradiction flag on a reviewed unit was only a suspicion: it is dropped here
  // and re-added below exclusively when the judge confirms a real contradiction.
  let semanticContradictions = (updatedReport.veracityAudit?.semanticContradictionFlags || []).filter(
    (flag) => {
      const m = flag.match(/^\[([^\]]+)\]/);
      if (!m) return true;
      return !reviewedUnitIdSet.has(m[1]);
    }
  );

  let integratedUnits = updatedReport.integratedUnits;

  for (const entry of updatedReport.traceabilityMatrix) {
    if (!reviewedUnitIdSet.has(entry.unitId)) continue;
    const judgeRes = verdictMap.get(entry.unitId);
    if (!judgeRes && deferredUnitIds.has(entry.unitId)) {
      // V5.3: not sent to the judge (decision already reached). Pending, not covered.
      entry.judgeDeferred = true;
      missingSet.add(entry.unitId);
      continue;
    }
    if (!judgeRes) {
      entry.aiJudgeUnavailable = true;
      entry.verificationStatus = 'ambiguous';
      entry.semanticIssues = [];
      missingSet.add(entry.unitId);
      remainingAmbiguous.push(entry.unitId);
      judgeUnavailableUnitIds.push(entry.unitId);
      continue;
    }

    entry.aiJudgeVerdict = judgeRes.verdict;
    entry.aiJudgeRationale = judgeRes.rationale;
    if (judgeRes.verdict === 'supported') {
      judgeResolvedUnitIds.push(entry.unitId);
      if (!entry.verified) {
        integratedUnits++;
      }
      entry.verified = true;
      entry.status = 'integrated';
      entry.verificationStatus = 'supported';
      entry.semanticIssues = [];
      missingSet.delete(entry.unitId);
      if (entry.chapterId && entry.chapterId !== 'none') {
        entry.assignedParagraphIds = entry.paragraphId ? [entry.paragraphId] : [];
        const supportingCh = detResult.manuscript.chapters.find((c) => c.id === entry.chapterId);
        if (supportingCh) {
          if (!supportingCh.sourceUnitIds) supportingCh.sourceUnitIds = [];
          if (!supportingCh.sourceUnitIds.includes(entry.unitId)) {
            supportingCh.sourceUnitIds.push(entry.unitId);
          }
          if (!supportingCh.sourceAnswerIds) supportingCh.sourceAnswerIds = [];
          if (entry.answerId && !supportingCh.sourceAnswerIds.includes(entry.answerId)) {
            supportingCh.sourceAnswerIds.push(entry.answerId);
          }
        }
      }
    } else if (judgeRes.verdict === 'contradicted') {
      judgeResolvedUnitIds.push(entry.unitId);
      if (entry.verified) {
        integratedUnits = Math.max(0, integratedUnits - 1);
      }
      entry.verified = false;
      entry.status = 'missing';
      entry.verificationStatus = 'contradicted';
      const issueMsg = `[${entry.unitId}] Juez semántico detectó contradicción: ${judgeRes.rationale}`;
      entry.semanticIssues = [judgeRes.rationale || 'Contradicción semántica confirmada.'];
      if (!semanticContradictions.some((f) => f.includes(`[${entry.unitId}]`))) {
        semanticContradictions.push(issueMsg);
      }
      missingSet.add(entry.unitId);
    } else if (judgeRes.verdict === 'omitted') {
      // Confirmed omission (not a contradiction): a real coverage defect for narrative repair.
      judgeResolvedUnitIds.push(entry.unitId);
      if (entry.verified) {
        integratedUnits = Math.max(0, integratedUnits - 1);
      }
      entry.verified = false;
      entry.status = 'missing';
      entry.verificationStatus = 'partially_supported';
      entry.semanticIssues = [];
      missingSet.add(entry.unitId);
    } else {
      if (entry.verified) {
        integratedUnits = Math.max(0, integratedUnits - 1);
      }
      entry.verified = false;
      entry.status = 'missing';
      entry.verificationStatus = 'ambiguous';
      entry.semanticIssues = [];
      entry.aiJudgeUnavailable = Boolean(judgeRes.unavailable);
      missingSet.add(entry.unitId);
      remainingAmbiguous.push(entry.unitId);
      if (judgeRes.unavailable) judgeUnavailableUnitIds.push(entry.unitId);
    }
  }

  const totalSourceUnits = updatedReport.totalSourceUnits;
  const updatedCoverage =
    totalSourceUnits > 0 ? Math.floor((integratedUnits / totalSourceUnits) * 100) : updatedReport.coveragePercentage;
  const remainingMissingIds = Array.from(missingSet);

  // V5.2 — Reconcile Direction-B (unsupported addition) verdicts. Only an explicit "supported"
  // clears a sentence; an unavailable, inconclusive or adverse verdict keeps it blocking.
  const inventedFlagSet = new Set(updatedReport.veracityAudit?.inventedDataFlags || []);
  const remainingAdditionFlags: string[] = [];
  for (const cand of updatedReport.veracityAudit?.unsupportedAdditionCandidates || []) {
    if (inventedFlagSet.has(cand.flag)) continue;
    const caseId = additionCaseByFlag.get(cand.flag);
    const verdict = caseId ? verdictMap.get(caseId) : undefined;
    if (verdict?.verdict === 'supported') {
      judgeResolvedUnitIds.push(caseId!);
      continue;
    }
    if (verdict && !verdict.unavailable && verdict.verdict !== 'inconclusive') {
      judgeResolvedUnitIds.push(caseId!);
    } else if (caseId) {
      judgeUnavailableUnitIds.push(caseId);
    }
    remainingAdditionFlags.push(
      verdict?.verdict === 'omitted' || verdict?.verdict === 'contradicted'
        ? `${cand.flag} Confirmado por verificación contextual: ${verdict.rationale || 'afirmación sin respaldo.'}`
        : cand.flag
    );
  }
  if (updatedReport.veracityAudit) {
    updatedReport.veracityAudit.unsupportedAdditionFlags = [
      ...(updatedReport.veracityAudit.inventedDataFlags || []),
      ...remainingAdditionFlags,
    ];
    updatedReport.veracityAudit.unsupportedAdditionCandidates = (
      updatedReport.veracityAudit.unsupportedAdditionCandidates || []
    ).filter((cand) => {
      const caseId = additionCaseByFlag.get(cand.flag);
      return verdictMap.get(caseId || '')?.verdict !== 'supported';
    });
  }

  // Rebuild blockingDefects coherently
  const nextBlocking: string[] = [];
  if (detResult.manuscript.chapters.length === 0) {
    nextBlocking.push('El manuscrito no contiene capítulos válidos.');
  }
  if (answers.length > 0 && totalSourceUnits === 0) {
    nextBlocking.push(
      'La entrevista no contiene testimonios elegibles para publicar (todas las respuestas fueron omitidas o excluidas).'
    );
  }
  if (updatedReport.structuralAudit && !detResult.report.structuralAudit?.oneQuestionPerChapterDetected) {
    // keep structural defect if present
  }
  if (detResult.report.structuralAudit?.oneQuestionPerChapterDetected) {
    nextBlocking.push(
      'Fragmentación editorial inválida: se detectó estructura de una pregunta/respuesta por capítulo o títulos en formato de pregunta.'
    );
  }
  if (remainingMissingIds.length > 0 || updatedCoverage < 100) {
    nextBlocking.push(
      `Cobertura documental incompleta (${updatedCoverage}%: ${integratedUnits}/${totalSourceUnits} unidades verificadas; faltan: ${remainingMissingIds.slice(0, 8).join(', ')}).`
    );
  }
  if (remainingAmbiguous.length > 0) {
    const undecided = remainingAmbiguous.filter((id) => !judgeUnavailableUnitIds.includes(id));
    if (judgeUnavailableUnitIds.length > 0) {
      nextBlocking.push(
        `Verificación semántica no disponible para ${judgeUnavailableUnitIds.length} unidad(es) (proveedor de IA inaccesible): ${judgeUnavailableUnitIds.slice(0, 6).join(', ')}.`
      );
    }
    if (undecided.length > 0) {
      nextBlocking.push(
        `Auditoría semántica inconclusa para ${undecided.length} unidad(es) ambigua(s): ${undecided.slice(0, 6).join(', ')}.`
      );
    }
  }
  if (!updatedReport.uncertaintiesPreserved && (updatedReport.veracityAudit?.uncertaintyViolations || []).length > 0) {
    nextBlocking.push(...(updatedReport.veracityAudit?.uncertaintyViolations || []));
  }
  if (semanticContradictions.length > 0) {
    nextBlocking.push(...semanticContradictions);
  }
  if ((updatedReport.veracityAudit?.inventedDataFlags || []).length > 0) {
    nextBlocking.push(...(updatedReport.veracityAudit?.inventedDataFlags || []));
  }
  if ((updatedReport.veracityAudit?.leakedExcludedContentFlags || []).length > 0) {
    nextBlocking.push(...(updatedReport.veracityAudit?.leakedExcludedContentFlags || []));
  }
  if ((updatedReport.veracityAudit?.coupleAttributionViolations || []).length > 0) {
    nextBlocking.push(...(updatedReport.veracityAudit?.coupleAttributionViolations || []));
  }
  if (updatedReport.totalUploadedPhotos > 0 && updatedReport.totalPlacedPhotos < updatedReport.totalUploadedPhotos) {
    nextBlocking.push(
      `Fotografías sin ubicar en el manuscrito (${updatedReport.totalPlacedPhotos}/${updatedReport.totalUploadedPhotos}).`
    );
  }
  if (remainingAdditionFlags.length > 0) {
    nextBlocking.push(...remainingAdditionFlags);
  }
  if (!detResult.editorialAudit.passed) {
    nextBlocking.push(...detResult.editorialAudit.blockingDefects);
  }

  updatedReport.auditPolicy = 'hybrid_arbitrated';
  updatedReport.integratedUnits = integratedUnits;
  updatedReport.coveragePercentage = updatedCoverage;
  updatedReport.blockingDefects = nextBlocking;
  updatedReport.coverageAudit = {
    passed: remainingMissingIds.length === 0 && (answers.length === 0 || totalSourceUnits > 0),
    totalValidUnits: totalSourceUnits,
    coveredUnitsCount: integratedUnits,
    missingUnitIds: remainingMissingIds,
    repairedUnitIds: updatedReport.coverageAudit?.repairedUnitIds || [],
  };
  if (updatedReport.veracityAudit) {
    updatedReport.veracityAudit.semanticContradictionFlags = semanticContradictions;
    updatedReport.veracityAudit.passed =
      updatedReport.uncertaintiesPreserved &&
      semanticContradictions.length === 0 &&
      (updatedReport.veracityAudit.inventedDataFlags || []).length === 0 &&
      (updatedReport.veracityAudit.leakedExcludedContentFlags || []).length === 0 &&
      (updatedReport.veracityAudit.coupleAttributionViolations || []).length === 0;
  }
  if (updatedReport.semanticAudit) {
    updatedReport.semanticAudit.contradictionsDetected = semanticContradictions;
    updatedReport.semanticAudit.ambiguousUnitsCount = remainingAmbiguous.length;
    updatedReport.semanticAudit.ambiguousUnitIds = remainingAmbiguous;
    updatedReport.semanticAudit.judgeResolvedUnitIds = judgeResolvedUnitIds;
    updatedReport.semanticAudit.judgeUnavailableUnitIds = judgeUnavailableUnitIds;
    updatedReport.semanticAudit.unsupportedAdditions =
      updatedReport.veracityAudit?.unsupportedAdditionFlags || [];
    updatedReport.semanticAudit.pendingVerificationUnitIds = Array.from(deferredUnitIds);
    updatedReport.semanticAudit.judgeStats = {
      policy: judgePolicy,
      casesTotal: cases.length,
      casesSent: judgeCasesSent,
      casesFromCache: judgeCacheHits,
      casesDeferred: deferredUnitIds.size,
      invocations: judgeInvocations,
    };
    // A unit that was not verified is not verified: the strict gate stays honest.
    updatedReport.semanticAudit.passed =
      semanticContradictions.length === 0 &&
      (updatedReport.veracityAudit?.inventedDataFlags || []).length === 0 &&
      (updatedReport.veracityAudit?.unsupportedAdditionFlags || []).length === 0 &&
      remainingAmbiguous.length === 0 &&
      deferredUnitIds.size === 0;
  }

  // V5.2 — The SAME global decision as the deterministic audit: every mandatory gate
  // (coverage, veracity, semantic, structural, photo, editorial) must pass. Resolving a
  // paraphrase through the judge can clear THAT unit, never an unrelated defect.
  const globalDecision = finalizeGlobalAuditDecision({
    report: updatedReport,
    editorialAudit: detResult.editorialAudit,
    includeEditorialAudit: true,
  });
  const nextPassed = globalDecision.passed;
  updatedReport.passed = nextPassed;
  updatedReport.approved = nextPassed;
  updatedReport.status = nextPassed ? 'approved' : 'failed_audit';
  updatedReport.blockingDefects = globalDecision.blockingDefects;

  const finalManu: DemoManuscript = {
    ...detResult.manuscript,
    status: nextPassed ? 'approved' : 'failed_audit',
    generationStatus: nextPassed ? 'approved' : 'failed_audit',
    auditReport: updatedReport,
    documentaryAudit: updatedReport,
  };

  return {
    manuscript: finalManu,
    report: updatedReport,
    editorialAudit: detResult.editorialAudit,
    inventory: detResult.inventory,
  };
}

/**
 * Classifies a failed or incomplete manuscript generation into a granular internal reason code
 * and human-readable diagnostic summary exclusively for administrators (Bitácora + ManuscriptsView).
 */
export function classifyBookFailureReasonCode(params: {
  error?: any;
  report?: DocumentaryAuditReport | null;
  editorialAudit?: EditorialQualityAuditReport | null;
  completedBatches?: number;
  totalBatches?: number;
  repairPassesAttempted?: number;
}): { code: BookGenerationReasonCode; summary: string; category: BookFailureCategory } {
  const core = classifyBookFailureReasonCodeCore(params);
  return { ...core, category: resolveBookFailureCategory(core.code) };
}

function classifyBookFailureReasonCodeCore(params: {
  error?: any;
  report?: DocumentaryAuditReport | null;
  editorialAudit?: EditorialQualityAuditReport | null;
  completedBatches?: number;
  totalBatches?: number;
  repairPassesAttempted?: number;
}): { code: BookGenerationReasonCode; summary: string } {
  const { error, report, editorialAudit, completedBatches, totalBatches, repairPassesAttempted = 0 } = params;

  if (error) {
    const msg = String(error?.message || error || '');
    if (/Tiempo de espera agotado|timeout|aborted|ETIMEDOUT/i.test(msg)) {
      if (typeof totalBatches === 'number' && typeof completedBatches === 'number' && completedBatches > 0 && completedBatches < totalBatches) {
        return {
          code: 'PARTIAL_BATCH_GENERATION',
          summary: `Tiempo agotado tras completar ${completedBatches}/${totalBatches} lotes de redacción (${msg}).`,
        };
      }
      return {
        code: 'MODEL_TIMEOUT',
        summary: `El proveedor de IA excedió el tiempo máximo de respuesta (${msg}).`,
      };
    }
    if (/JSON|vacía o incompleta|parse|SyntaxError/i.test(msg)) {
      return {
        code: 'INVALID_MODEL_RESPONSE',
        summary: `La respuesta del modelo no produjo capítulos JSON válidos (${msg}).`,
      };
    }
    if (typeof totalBatches === 'number' && typeof completedBatches === 'number' && completedBatches > 0 && completedBatches < totalBatches) {
      return {
        code: 'PARTIAL_BATCH_GENERATION',
        summary: `Generación parcial: completados ${completedBatches}/${totalBatches} lotes antes de error de proveedor (${msg}).`,
      };
    }
    return {
      code: 'PROVIDER_ERROR',
      summary: `Fallo en proveedor principal y alterno (${msg}).`,
    };
  }

  if (typeof totalBatches === 'number' && typeof completedBatches === 'number' && completedBatches < totalBatches) {
    return {
      code: 'PARTIAL_BATCH_GENERATION',
      summary: `Solo se completaron ${completedBatches} de ${totalBatches} lotes de capítulos.`,
    };
  }

  if (report) {
    const leaked = report.veracityAudit?.leakedExcludedContentFlags || [];
    if (leaked.length > 0) {
      return {
        code: 'PRIVACY_VALIDATION_FAILURE',
        summary: `${leaked.length} fuga(s) de contenido excluido/confidencial: ${leaked[0]}`,
      };
    }
    const semanticContradictions = report.veracityAudit?.semanticContradictionFlags || [];
    const invented = report.veracityAudit?.inventedDataFlags || [];
    const coupleAttr = report.veracityAudit?.coupleAttributionViolations || [];
    const unplacedPhotos = report.photoAudit?.unplacedPhotoIds || [];

    if (semanticContradictions.length > 0 || invented.length > 0 || coupleAttr.length > 0) {
      const sample = semanticContradictions[0] || invented[0] || coupleAttr[0];
      return {
        code: repairPassesAttempted > 0 ? 'REPAIR_EXHAUSTED' : 'SEMANTIC_CONTRADICTION',
        summary: `${repairPassesAttempted > 0 ? `Persiste tras ${repairPassesAttempted} ronda(s) de reparación: ` : ''}${semanticContradictions.length} contradicción(es), ${invented.length} dato(s) sin respaldo, ${coupleAttr.length} atribución(es). Ej.: ${sample}`,
      };
    }
    if (unplacedPhotos.length > 0) {
      return {
        code: 'PHOTO_PLACEMENT_FAILURE',
        summary: `${unplacedPhotos.length} fotografía(s) sin ubicación válida (${unplacedPhotos.slice(0, 4).join(', ')}).`,
      };
    }
    const ambiguousCount = report.semanticAudit?.ambiguousUnitsCount || 0;
    const missingIds = report.coverageAudit?.missingUnitIds || [];
    // V5.1: the semantic judge could not be reached. That is a provider problem, not a defect of
    // the manuscript, so it is reported as technical and a retry only needs to re-run the judge.
    const judgeUnavailableIds = report.semanticAudit?.judgeUnavailableUnitIds || [];
    if (
      judgeUnavailableIds.length > 0 &&
      missingIds.every((id) => judgeUnavailableIds.includes(id))
    ) {
      return {
        code: 'SEMANTIC_JUDGE_UNAVAILABLE',
        summary: `El juez semántico no estuvo disponible para ${judgeUnavailableIds.length} unidad(es) pendientes de confirmación (${judgeUnavailableIds.slice(0, 4).join(', ')}); el manuscrito no presenta otros defectos documentales.`,
      };
    }
    if (ambiguousCount > 0 && missingIds.length <= ambiguousCount) {
      return {
        code: 'AUDIT_INCONCLUSIVE',
        summary: `${ambiguousCount} unidad(es) ambigua(s) no pudieron confirmarse semánticamente (${(report.semanticAudit?.ambiguousUnitIds || []).slice(0, 4).join(', ')}).`,
      };
    }
    if (missingIds.length > 0 || report.coveragePercentage < 100) {
      return {
        code: repairPassesAttempted > 0 ? 'REPAIR_EXHAUSTED' : 'DOCUMENTARY_COVERAGE_FAILURE',
        summary: `Cobertura documental del ${report.coveragePercentage}% (${report.integratedUnits}/${report.totalSourceUnits} unidades; faltan: ${missingIds.slice(0, 5).join(', ')})${repairPassesAttempted > 0 ? ` tras ${repairPassesAttempted} ronda(s) de reparación` : ''}.`,
      };
    }
  }

  if (editorialAudit && !editorialAudit.passed) {
    return {
      code: repairPassesAttempted > 0 ? 'REPAIR_EXHAUSTED' : 'EDITORIAL_QUALITY_FAILURE',
      summary: `${editorialAudit.blockingDefects.length} defecto(s) editorial(es): ${editorialAudit.blockingDefects[0] || 'Calidad editorial pendiente'}`,
    };
  }

  return {
    code: 'AUDIT_INCONCLUSIVE',
    summary: 'La verificación integral no pudo aprobar el manuscrito automáticamente.',
  };
}

/**
 * Contextual AI-guided narrative repair (`repairChaptersContextuallyWithAI`):
 * Sends ALL affected chapters in controlled multi-chapter batches (no 6-chapter truncation!),
 * including all 16 audit defect categories, verifies post-repair quality via Hybrid Semantic
 * + Editorial audits, and rejects regressions that break valid coverage.
 */
export async function repairChaptersContextuallyWithAI(params: {
  manuscript: DemoManuscript;
  tasks: ContextualRepairTask[];
  activeLiteraryPrompt: string;
  narrativeStyle: DemoNarrativeStyleId;
  authors: string;
  isCouple: boolean;
  answers: AnswerRecord[];
  questions: QuestionRecord[];
  provider: BookAiProvider;
  model: string;
  alternateProvider: BookAiProvider;
  alternateModel: string;
  batchCallerOverride?: (batchPrompt: string, systemPrompt: string, batchTaskIds: string[]) => Promise<ParsedAiManuscriptBatchResponse | null>;
  aiJudgeOverride?: SemanticJudgeFunction;
  onRepairProgress?: (done: number, total: number) => void;
  /**
   * V5.1: the hybrid audit of `manuscript` the caller already holds. Passing it avoids auditing
   * the same text twice per repair pass.
   */
  precomputedBeforeAudit?: {
    manuscript: DemoManuscript;
    report: DocumentaryAuditReport;
    editorialAudit: EditorialQualityAuditReport;
    inventory: DocumentaryInventory;
  };
}): Promise<{
  improved: boolean;
  repairedChaptersCount: number;
  audited: {
    manuscript: DemoManuscript;
    report: DocumentaryAuditReport;
    editorialAudit: EditorialQualityAuditReport;
    inventory: DocumentaryInventory;
  };
} | null> {
  const {
    manuscript,
    tasks,
    activeLiteraryPrompt,
    narrativeStyle,
    authors,
    isCouple,
    answers,
    questions,
    provider,
    model,
    alternateProvider,
    alternateModel,
    batchCallerOverride,
    aiJudgeOverride,
    onRepairProgress,
    precomputedBeforeAudit,
  } = params;

  const autoTasks = (tasks || []).filter((t) => t.autoRepairable !== false);
  if (autoTasks.length === 0) return null;

  const beforeAudit =
    precomputedBeforeAudit ||
    (await auditWithHybridSemantics({
      manuscript,
      answers,
      questions,
      provider,
      model,
      alternateProvider,
      alternateModel,
      repairAttemptsUsed: manuscript.documentaryAudit?.repairAttemptsUsed || 0,
      aiJudgeOverride,
    }));
  const beforeScore = computeManuscriptDefectScore(beforeAudit.report, beforeAudit.editorialAudit);

  const styleReminder =
    narrativeStyle === 'third_person_biography'
      ? `ESTILO C OBLIGATORIO: Reescribe el 100% de cada capítulo corregido en TERCERA PERSONA biográfica ("él", "ella", "${authors}"). CERO primera persona fuera de citas textuales.`
      : narrativeStyle === 'first_person_simple'
      ? `ESTILO A OBLIGATORIO: Reescribe en primera persona ("yo"/"nosotros") sencilla, natural y bien estructurada.`
      : `ESTILO B OBLIGATORIO: Reescribe en primera persona literaria, emotiva y fluida, conservando todos los hechos.`;

  const repairSystemPrompt = `${activeLiteraryPrompt}\n\n${styleReminder}\n\nEres el editor literario corrector de YouForever. Corrige ÚNICAMENTE los capítulos indicados integrando fluidamente cualquier recuerdo faltante, corrigiendo contradicciones de sentido (quién realizó la acción, negaciones, dudas), eliminando muletillas/exclusiones/repeticiones, corrigiendo títulos y conservando intactos todos los datos verdaderos.

REGLAS DE REPARACIÓN NARRATIVA (obligatorias):
1. Cada recuerdo de "missingTestimonialUnits" se TEJE dentro del párrafo donde corresponde por tema y cronología, con transiciones naturales. Está prohibido pegarlo como oración suelta al final, copiarlo literalmente o añadir un párrafo que solo repita el testimonio.
2. No repitas un episodio que ya esté narrado en "currentParagraphs": si el recuerdo ya aparece, complétalo con el detalle que falte ("auditorNote" indica cuál) en lugar de volver a contarlo.
3. Devuelve el capítulo COMPLETO: todos los hechos, nombres, lugares, fechas y emociones que ya estaban en "currentParagraphs" deben seguir presentes. Reparar un recuerdo nunca puede eliminar otro.
4. No inventes hechos, fechas, nombres ni diálogos, y conserva las expresiones de duda del testimonio.
5. Párrafos de extensión natural (aproximadamente 3 a 8 oraciones); divide los excesivamente largos.`;

  // Process ALL affected chapters in batches of 4 without slicing off chapters >= 7!
  const REPAIR_BATCH_SIZE = 4;
  const repairedChaptersById = new Map<string, any>();
  let repairedIntroCandidate: string | null = null;
  let repairedChaptersCount = 0;

  for (let bStart = 0; bStart < autoTasks.length; bStart += REPAIR_BATCH_SIZE) {
    const batchTasks = autoTasks.slice(bStart, bStart + REPAIR_BATCH_SIZE);
    const taskPayload = batchTasks.map((t) => {
      const ch = manuscript.chapters.find((c) => c.id === t.chapterId);
      return {
        chapterId: t.chapterId,
        chapterTitle: ch?.title || t.chapterTitle,
        currentParagraphs: ch?.paragraphs || [],
        categories: t.categories,
        repairStrategy: t.repairStrategy,
        missingTestimonialUnits: t.missingUnits.map((u) => {
          const trace = beforeAudit.report.traceabilityMatrix.find((tr) => tr.unitId === u.unitId);
          const auditorNote = trace?.aiJudgeRationale || trace?.semanticReviewReason;
          return {
            unitId: u.unitId,
            speaker: u.participantName,
            question: u.questionText,
            testimony: u.cleanText,
            uncertainties: u.uncertaintyExpressions,
            ...(auditorNote ? { auditorNote } : {}),
          };
        }),
        semanticContradictionsToCorrect: t.contradictionDetails,
        styleLeaksToRewrite: t.styleLeakDetails,
        excludedInformationToRemoveWithoutTouchingAuthorizedFacts: t.excludedLeakDetails,
        unsupportedInventionsToRemove: [...t.inventedDetails, ...(t.unsupportedAdditionDetails || [])],
        oralFillersToClean: t.oralFillerDetails,
        duplicateEpisodesToConsolidate: t.duplicateEpisodeDetails || [],
        titleQualityFixes: t.titleQualityDetails || [],
        truncatedFragmentsToCompleteFromTestimony: t.truncatedFragmentDetails || [],
        unbalancedMarkdownToFix: t.unbalancedMarkdownDetails || [],
        uncertaintyExpressionsToPreserve: t.uncertaintyDetails || [],
        coupleAttributionFixes: t.coupleAttributionDetails || [],
      };
    });

    const repairUserPrompt = `Corrige los siguientes capítulos (${bStart + 1}-${Math.min(bStart + REPAIR_BATCH_SIZE, autoTasks.length)} de ${autoTasks.length}) manteniendo intactos todos los recuerdos que ya estaban correctamente narrados e integrando con prosa natural cada elemento pendiente:

${JSON.stringify(taskPayload, null, 2)}

Devuelve EXCLUSIVAMENTE un objeto JSON con:
{
  "title": "${manuscript.title.replace(/"/g, '\\"')}",
  "subtitle": "${(manuscript.subtitle || '').replace(/"/g, '\\"')}",
  "introduction": ${JSON.stringify(manuscript.introduction || '')},
  "chapters": [
    {
      "id": "id_exacto_del_capitulo",
      "partNumber": 1,
      "dimensionKey": "raices_infancia",
      "title": "Título limpio sin preguntas ni sufijos numéricos",
      "paragraphs": ["párrafo cohesionado 1", "párrafo cohesionado 2"]
    }
  ]
}`;

    let repairedResponse: ParsedAiManuscriptBatchResponse | null = null;
    if (batchCallerOverride) {
      repairedResponse = await batchCallerOverride(
        repairUserPrompt,
        repairSystemPrompt,
        batchTasks.map((t) => t.chapterId)
      );
    } else {
      const invokeProvider = async (prov: BookAiProvider, mdl: string) => {
        const timeoutMs = /^gpt-6|^gpt-5|^o1|^o3|^o4/i.test(mdl) ? 65000 : 45000;
        if (prov === 'openai') {
          const res = await callOpenAiBookModelBatch({
            modelName: mdl,
            systemInstructionText: repairSystemPrompt,
            prompt: repairUserPrompt,
            multimodalPhotos: [],
            timeoutMs,
            allowBackupModels: true,
          });
          return res.parsed;
        }
        const res = await callGeminiBookModelBatch({
          modelName: mdl,
          systemInstructionText: repairSystemPrompt,
          prompt: repairUserPrompt,
          multimodalPhotos: [],
          timeoutMs,
        });
        return res.parsed;
      };

      try {
        repairedResponse = await invokeProvider(provider, model);
      } catch (_primaryRepairErr) {
        try {
          repairedResponse = await invokeProvider(alternateProvider, alternateModel);
        } catch (_altRepairErr) {
          repairedResponse = null;
        }
      }
    }

    if (repairedResponse && Array.isArray(repairedResponse.chapters)) {
      if (!repairedIntroCandidate && repairedResponse.introduction) {
        repairedIntroCandidate = repairedResponse.introduction;
      }
      for (const ch of repairedResponse.chapters) {
        if (ch && ch.id && Array.isArray(ch.paragraphs) && ch.paragraphs.length > 0) {
          repairedChaptersById.set(ch.id, ch);
          repairedChaptersCount++;
        }
      }
    }

    onRepairProgress?.(
      Math.min(bStart + REPAIR_BATCH_SIZE, autoTasks.length),
      autoTasks.length
    );
  }

  if (repairedChaptersById.size === 0) {
    return null;
  }

  const nextChapters: DemoChapterManuscript[] = manuscript.chapters.map((origCh) => {
    const patch = repairedChaptersById.get(origCh.id);
    if (!patch || !Array.isArray(patch.paragraphs) || patch.paragraphs.length === 0) {
      return origCh;
    }
    const cleanParas = patch.paragraphs
      .map((p: string) => stripInlinePhotoMarkers(String(p || '').trim()))
      .filter((p: string) => p.length > 0);
    if (cleanParas.length === 0) return origCh;

    const updatedParagraphIds = cleanParas.map((_: string, idx: number) => `${origCh.id}_p_${idx + 1}`);
    const updatedPlacements = (origCh.photoPlacements || []).map((pl) => {
      const clampedIdx = Math.min(Math.max(0, pl.paragraphIndex), cleanParas.length - 1);
      return {
        ...pl,
        paragraphIndex: clampedIdx,
        paragraphId: updatedParagraphIds[clampedIdx],
      };
    });

    return {
      ...origCh,
      title: stripInlinePhotoMarkers(patch.title || origCh.title).trim() || origCh.title,
      paragraphs: cleanParas,
      paragraphIds: updatedParagraphIds,
      photoPlacements: updatedPlacements.length > 0 ? updatedPlacements : origCh.photoPlacements,
    };
  });

  const candidateManu: DemoManuscript = {
    ...manuscript,
    introduction: repairedIntroCandidate
      ? ensureParagraphConformsToStyle({
          paragraph: stripInlinePhotoMarkers(repairedIntroCandidate.trim()),
          narrativeStyle,
          speakerName: authors,
          isCouple,
        }) || manuscript.introduction
      : manuscript.introduction,
    chapters: nextChapters,
  };

  const afterAudit = await auditWithHybridSemantics({
    manuscript: candidateManu,
    answers,
    questions,
    provider,
    model,
    alternateProvider,
    alternateModel,
    repairAttemptsUsed: (manuscript.documentaryAudit?.repairAttemptsUsed || 0) + 1,
    aiJudgeOverride,
  });

  const afterScore = computeManuscriptDefectScore(afterAudit.report, afterAudit.editorialAudit);

  // Reject regressions: do not overwrite valid narrative prose if repairs broke coverage or added defects
  const improved = afterScore < beforeScore || (afterAudit.report.passed && afterAudit.editorialAudit.passed);
  const fullyApprovedAfter = afterAudit.report.passed && afterAudit.editorialAudit.passed;

  // V5.1 — Selective acceptance, judged chapter by chapter.
  // (1) Rejecting the whole pass because ONE rewritten chapter regressed threw away the chapters
  //     that were genuinely fixed and left the manuscript stuck.
  // (2) Accepting the whole pass because the TOTAL improved let a chapter that lost memories
  //     ride along with the ones that were fixed.
  // So whenever some patched chapter got worse, keep only the patches that did not regress
  // (that strictly improved, when the pass as a whole did not) and re-audit that mixed text once.
  const patchedIds = Array.from(repairedChaptersById.keys()).filter((id) =>
    manuscript.chapters.some((c) => c.id === id)
  );
  if (!fullyApprovedAfter && patchedIds.length > 1) {
    const answerHomeChapter = buildAnswerHomeChapterMap(manuscript);
    const beforeByChapter = countUnresolvedDefectsByChapter(beforeAudit, answerHomeChapter);
    const afterByChapter = countUnresolvedDefectsByChapter(afterAudit, answerHomeChapter);
    const regressedIds = patchedIds.filter(
      (id) => (afterByChapter.get(id) || 0) > (beforeByChapter.get(id) || 0)
    );
    if (!improved || regressedIds.length > 0) {
      const keepIds = new Set(
        patchedIds.filter((id) => {
          const beforeCount = beforeByChapter.get(id) || 0;
          const afterCount = afterByChapter.get(id) || 0;
          return improved ? afterCount <= beforeCount : afterCount < beforeCount;
        })
      );
      if (keepIds.size > 0 && keepIds.size < patchedIds.length) {
        const mixedManu: DemoManuscript = {
          ...manuscript,
          chapters: manuscript.chapters.map((origCh, idx) =>
            keepIds.has(origCh.id) ? nextChapters[idx] : origCh
          ),
        };
        const mixedAudit = await auditWithHybridSemantics({
          manuscript: mixedManu,
          answers,
          questions,
          provider,
          model,
          alternateProvider,
          alternateModel,
          repairAttemptsUsed: (manuscript.documentaryAudit?.repairAttemptsUsed || 0) + 1,
          aiJudgeOverride,
        });
        const mixedScore = computeManuscriptDefectScore(mixedAudit.report, mixedAudit.editorialAudit);
        const mixedApproved = mixedAudit.report.passed && mixedAudit.editorialAudit.passed;
        if (
          mixedApproved ||
          (mixedScore < beforeScore && (!improved || mixedScore <= afterScore))
        ) {
          return {
            improved: true,
            repairedChaptersCount: keepIds.size,
            audited: {
              manuscript: mixedAudit.manuscript,
              report: mixedAudit.report,
              editorialAudit: mixedAudit.editorialAudit,
              inventory: mixedAudit.inventory,
            },
          };
        }
      }
    }
  }

  if (!improved) {
    return {
      improved: false,
      repairedChaptersCount: 0,
      audited: {
        manuscript: beforeAudit.manuscript,
        report: beforeAudit.report,
        editorialAudit: beforeAudit.editorialAudit,
        inventory: beforeAudit.inventory,
      },
    };
  }

  return {
    improved: true,
    repairedChaptersCount,
    audited: {
      manuscript: afterAudit.manuscript,
      report: afterAudit.report,
      editorialAudit: afterAudit.editorialAudit,
      inventory: afterAudit.inventory,
    },
  };
}

/**
 * Generates an editorial book manuscript (`DemoManuscript`) and chapter photo map from a participant's
 * completed interview answers and the mandatory Compilado Testimonial Fidedigno PDF in the selected narrative style (A, B, or C).
 * Includes Context & Style Caching, in-flight request deduplication, persistent batch checkpointing,
 * step-by-step progress hooks, hybrid semantic audit + unlimited batched repair loop, and granular admin reason classification.
 */
export async function generateParticipantBookManuscriptWithAI(params: {
  interview: InterviewRecord;
  participants: ParticipantRecord[];
  answers: AnswerRecord[];
  questions: QuestionRecord[];
  narrativeStyle?: DemoNarrativeStyleId;
  closingDedicationText?: string;
  scope?: 'preview' | 'full';
  forceRefresh?: boolean;
  lockedPreviewManuscript?: DemoManuscript | null;
  lockedPreviewGroups?: ComposedChapterSectionBlock[][] | null;
  compilationPdfRecord?: MiEsenciaArchivedCompilationPdf | null;
  photosWithDataUrl?: Array<{
    id: string;
    caption: string;
    questionText?: string;
    lifeStage?: string;
    participantName?: string;
    mimeType?: string;
    dataUrl?: string;
  }>;
  customLiteraryPromptText?: string;
  configuredProvider?: BookAiProvider;
  geminiModel?: string;
  openaiModel?: string;
  bookStructureMode?: BookStructureMode;
  onProgress?: (event: BookGenerationProgressEvent) => void;
  initialBatchCheckpoints?: Record<string, BookBatchCheckpointPayload>;
  onBatchCheckpoint?: (batchIdx: number, checkpoint: BookBatchCheckpointPayload) => void;
  isCancelled?: () => boolean;
  maxRepairPasses?: number;
  /**
   * V5.1 — Injection points used ONLY by automated tests to run the complete pipeline
   * (draft -> hybrid audit -> repair -> approval evidence) without calling a real AI provider
   * and without touching the on-disk manuscript cache. Production callers never set this.
   */
  pipelineOverrides?: {
    draftBatch?: (ctx: {
      batchIdx: number;
      totalBatches: number;
      batchChapters: any[];
      narrativeStyle: DemoNarrativeStyleId;
    }) => Promise<BookBatchCheckpointPayload>;
    aiJudge?: SemanticJudgeFunction;
    repairBatchCaller?: (
      batchPrompt: string,
      systemPrompt: string,
      batchTaskIds: string[]
    ) => Promise<ParsedAiManuscriptBatchResponse | null>;
    skipDiskCache?: boolean;
  };
}): Promise<{
  manuscript: DemoManuscript;
  chapterPhotos: Record<string, DemoInMemoryPhoto | null>;
  allPhotosById?: Record<string, DemoInMemoryPhoto>;
  scope: 'preview' | 'full';
  providerUsed: BookAiProvider;
  modelUsed: string;
  providerFallbackNotice?: string;
  compilationPdfId?: string;
  compilationPdfSha256?: string;
  cachedContextUsed?: boolean;
  internalReasonCode?: BookGenerationReasonCode;
  diagnosticSummary?: string;
  failureCategory?: BookFailureCategory;
  /** V5.1: fingerprint of the sources and configuration this result was generated from. */
  sourceFingerprint?: string;
  /** V5.2: fingerprint of the generation configuration (batch identity). */
  generationFingerprint?: string;
  /**
   * V5.1: batch indexes whose drafted chapters still carry confirmed defects. They must be
   * regenerated on the next attempt instead of being replayed from a checkpoint.
   */
  invalidatedBatchIndexes?: number[];
  batchesCompleted?: number;
  totalBatches?: number;
  /** V5.3: server-computed delivery decision of the returned manuscript. */
  deliveryDecision?: BookDeliveryDecision;
  /** V5.3: measured operational data of this generation (admin-only). */
  generationMetrics?: BookGenerationMetrics;
  /** V5.3: what the repair stage did (admin-only). */
  repairSummary?: BookRepairSummary;
}> {
  const pipelineOverrides = params.pipelineOverrides || {};
  const metrics = createEmptyGenerationMetrics();
  const timeIt = async <T>(bucket: 'draftMs' | 'auditMs' | 'repairMs', fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      metrics[bucket] += Date.now() - t0;
    }
  };
  if (!pipelineOverrides.skipDiskCache) {
    hydrateManuscriptCacheFromDisk();
  }

  const {
    interview,
    participants,
    answers,
    questions,
    narrativeStyle = 'first_person_literary',
    closingDedicationText = '',
    scope = 'full',
    forceRefresh = false,
    lockedPreviewManuscript = null,
    compilationPdfRecord = null,
    photosWithDataUrl = [],
    customLiteraryPromptText,
    configuredProvider = 'gemini',
    geminiModel = 'gemini-3-flash-preview',
    openaiModel = 'gpt-4o',
    bookStructureMode = 'prompt_autonomous',
    onProgress,
    initialBatchCheckpoints,
    onBatchCheckpoint,
    isCancelled,
    maxRepairPasses = 4,
  } = params;

  onProgress?.({
    phase: 'preparing_sources',
    userMessage:
      params.scope === 'preview'
        ? 'Preparando tu muestra editorial...'
        : 'Organizando tus recuerdos...',
  });

  const primaryProvider: BookAiProvider = configuredProvider === 'openai' ? 'openai' : 'gemini';
  const primaryModel = primaryProvider === 'openai' ? openaiModel : geminiModel;
  const alternateProvider: BookAiProvider = primaryProvider === 'openai' ? 'gemini' : 'openai';
  const alternateModel = alternateProvider === 'openai' ? openaiModel : geminiModel;

  const participantNames = participants.map((p) => p.name);
  const fallbackResult = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: interview.title,
    storyMode: interview.storyMode,
    participantNames,
    answers,
    questions,
    narrativeStyle,
    closingDedicationText,
    bookStructureMode,
  });

  const validAnswers = answers.filter(
    (a) =>
      resolveAnswerExclusionReason(a as any) === 'none' &&
      (extractCleanParticipantAnswerText(a).length > 0 || (a.photos && a.photos.length > 0))
  );
  if (validAnswers.length === 0) {
    return {
      ...fallbackResult,
      scope,
      providerUsed: primaryProvider,
      modelUsed: primaryModel,
      compilationPdfId: compilationPdfRecord?.pdfId,
      compilationPdfSha256: compilationPdfRecord?.sha256Hash,
      cachedContextUsed: false,
    };
  }

  const styleSpec =
    DEMO_NARRATIVE_STYLES.find((s) => s.id === narrativeStyle) || DEMO_NARRATIVE_STYLES[1];
  const isCouple = interview.storyMode === 'compartida' && participantNames.length >= 2;
  const styleTitle = isCouple ? styleSpec.coupleTitle : styleSpec.individualTitle;
  const styleDesc = isCouple ? styleSpec.coupleDescription : styleSpec.individualDescription;

  // Retrieve and apply the active Literary Prompt configured for the selected style
  const activeLiteraryPrompt =
    customLiteraryPromptText && customLiteraryPromptText.trim().length > 0
      ? customLiteraryPromptText.trim()
      : DEFAULT_LITERARY_PROMPTS_TEXT[narrativeStyle];

  // Build deterministic Context & Style Cache key (interview + answers/PDF hash + style + structureMode + prompt hash + engine version)
  const promptHash = crypto
    .createHash('sha256')
    .update(`${narrativeStyle}::${bookStructureMode}::${activeLiteraryPrompt}`)
    .digest('hex')
    .slice(0, 16);
  const contentHash = crypto
    .createHash('sha256')
    .update(
      `${closingDedicationText}::` +
        answers
          .map(
            (a) =>
              `${a.id}:${a.updatedAt || ''}:${a.notRecalled ? '1' : '0'}:${a.answerText}:${(
                a.photos || []
              )
                .map((p) => `${p.id}:${p.caption || ''}`)
                .join(',')}`
          )
          .join('|')
    )
    .digest('hex')
    .slice(0, 16);
  const canonicalKey = computeCanonicalManuscriptCacheKey({
    interviewId: interview.id,
    narrativeStyle,
    bookStructureMode,
    customStylePrompt: activeLiteraryPrompt,
    closingDedicationText,
    answers,
  });
  const fullCacheKey = `${interview.id}::${contentHash}::${promptHash}::${CANONICAL_AUDIT_RULES_VERSION}::${BOOK_GENERATION_ENGINE_VERSION}::canonical`;
  const scopeCacheKey = `${canonicalKey}::${fullCacheKey}`;
  // V5.3: a running sample and a running full book never share their in-flight promise.
  const inFlightKey = scope === 'preview' ? `${canonicalKey}::preview-sample` : canonicalKey;

  // V5.1: one cryptographic fingerprint ties drafted batches, the approved manuscript and its
  // approval evidence to the exact testimony and configuration they were produced from.
  const sourceFingerprint = computeBookSourceFingerprint({
    interviewId: interview.id,
    narrativeStyle,
    bookStructureMode,
    literaryPromptText: activeLiteraryPrompt,
    closingDedicationText,
    answers,
    questions,
  });
  // V5.2: separate identity for drafted batches. Changing the model, provider, prompt or
  // structure invalidates checkpoints (they would yield a different text) but NOT approvals.
  const fullGenerationFingerprint = computeBookGenerationFingerprint({
    sourceFingerprint,
    provider: primaryProvider,
    model: primaryModel,
    bookStructureMode,
    literaryPromptText: activeLiteraryPrompt,
  });
  // V5.3: the 5-page sample is drafted with its own identity, so a sample batch is never replayed
  // as a batch of the full book (and vice versa).
  const generationFingerprint =
    scope === 'preview'
      ? crypto.createHash('sha256').update(`${fullGenerationFingerprint}::preview-sample`).digest('hex')
      : fullGenerationFingerprint;
  // V5.3: signs the DELIVERY AUTHORIZATION of an eligible manuscript (fully verified or with
  // observations). Not eligible -> no evidence.
  const attachApprovalEvidence = (
    approved: DemoManuscript,
    report: DocumentaryAuditReport,
    editorialAudit: EditorialQualityAuditReport,
    decision: BookDeliveryDecision
  ): DemoManuscript => ({
    ...approved,
    failureCategory: undefined,
    deliveryDecision: decision,
    approvalEvidence: decision.eligible
      ? issueBookApprovalEvidence({
          interviewId: interview.id,
          manuscript: approved,
          sourceFingerprint,
          report,
          editorialAuditPassed: editorialAudit.passed,
          deliveryDecision: decision,
        })
      : undefined,
  });

  if (!forceRefresh) {
    // If an approved canonical manuscript was passed in lockedPreviewManuscript for this same style, verify BOTH documentary and editorial audits
    if (
      lockedPreviewManuscript &&
      lockedPreviewManuscript.narrativeStyle === narrativeStyle &&
      Array.isArray(lockedPreviewManuscript.chapters) &&
      lockedPreviewManuscript.chapters.length > 0 &&
      lockedPreviewManuscript.aiGenerated !== false &&
      lockedPreviewManuscript.generationStatus === 'approved'
    ) {
      // V5.1: a manuscript the browser already holds is accepted through the SAME policy used
      // everywhere else. Valid server-signed evidence for these exact sources is enough; without
      // it the hybrid audit decides (never the deterministic rules alone, which used to reject
      // judge-confirmed paraphrases and trigger a full, costly regeneration).
      const lockedEvidence = verifyBookApprovalEvidence({
        manuscript: lockedPreviewManuscript,
        interviewId: interview.id,
        narrativeStyle,
        currentSourceFingerprint: sourceFingerprint,
      });
      if (lockedEvidence.valid) {
        return {
          manuscript: {
            ...lockedPreviewManuscript,
            generationStatus: 'approved',
            status: 'approved',
            narrativeStyle,
            canonicalCacheKey: canonicalKey,
          },
          chapterPhotos: fallbackResult.chapterPhotos,
          allPhotosById: fallbackResult.allPhotosById,
          scope,
          providerUsed: primaryProvider,
          modelUsed: primaryModel,
          compilationPdfId: compilationPdfRecord?.pdfId,
          compilationPdfSha256: compilationPdfRecord?.sha256Hash,
          cachedContextUsed: true,
          sourceFingerprint,
        };
      }
      const auditedLocked = await auditWithHybridSemantics({
        manuscript: { ...lockedPreviewManuscript, approvalEvidence: undefined },
        answers,
        questions,
        provider: primaryProvider,
        model: primaryModel,
        alternateProvider,
        alternateModel,
        aiJudgeOverride: pipelineOverrides.aiJudge,
      });
      const lockedDecision = evaluateBookDeliveryEligibility({
        report: auditedLocked.report,
        editorialAudit: auditedLocked.editorialAudit,
        manuscript: auditedLocked.manuscript,
      });
      if (lockedDecision.eligible) {
        return {
          sourceFingerprint,
          deliveryDecision: lockedDecision,
          manuscript: attachApprovalEvidence(
            {
              ...auditedLocked.manuscript,
              generationStatus: 'approved',
              status: 'approved',
              narrativeStyle,
              canonicalCacheKey: canonicalKey,
            },
            auditedLocked.report,
            auditedLocked.editorialAudit,
            lockedDecision
          ),
          chapterPhotos: fallbackResult.chapterPhotos,
          allPhotosById: fallbackResult.allPhotosById,
          scope,
          providerUsed: primaryProvider,
          modelUsed: primaryModel,
          compilationPdfId: compilationPdfRecord?.pdfId,
          compilationPdfSha256: compilationPdfRecord?.sha256Hash,
          cachedContextUsed: true,
        };
      }
    }

    // Both 'preview' and 'full' read from the single canonical manuscript cache entry ONLY when verified approved
    const hit =
      manuscriptAiMemoryCache.get(canonicalKey) ||
      manuscriptAiMemoryCache.get(fullCacheKey) ||
      manuscriptAiMemoryCache.get(scopeCacheKey);
    if (
      hit &&
      hit.manuscript &&
      Array.isArray(hit.manuscript.chapters) &&
      hit.manuscript.chapters.length > 0 &&
      hit.manuscript.generationStatus === 'approved' &&
      hit.manuscript.documentaryAudit?.auditVersion === CANONICAL_AUDIT_RULES_VERSION &&
      // V5.3: a cached book is served when it was AUTHORIZED for delivery (fully verified or
      // with observations) and its signed authorization still verifies.
      hit.manuscript.deliveryDecision?.eligible === true &&
      // V5.1: a cached manuscript is only served while its approval evidence still verifies
      // against the CURRENT answers, style and rules.
      verifyBookApprovalEvidence({
        manuscript: hit.manuscript,
        interviewId: interview.id,
        narrativeStyle,
        currentSourceFingerprint: sourceFingerprint,
      }).valid
    ) {
      return {
        sourceFingerprint,
        deliveryDecision: hit.manuscript.deliveryDecision,
        generationMetrics: { ...metrics, servedFromCache: true },
        manuscript: {
          ...hit.manuscript,
          narrativeStyle,
          canonicalCacheKey: canonicalKey,
        },
        chapterPhotos: fallbackResult.chapterPhotos,
        allPhotosById: fallbackResult.allPhotosById,
        scope,
        providerUsed: hit.providerUsed,
        modelUsed: hit.modelUsed,
        providerFallbackNotice: hit.providerFallbackNotice,
        compilationPdfId: compilationPdfRecord?.pdfId,
        compilationPdfSha256: compilationPdfRecord?.sha256Hash,
        cachedContextUsed: true,
      };
    }

    // V5.3: a sample already drafted for these sources and settings is reused as is.
    if (scope === 'preview') {
      const cachedSample = previewSampleCache.get(generationFingerprint);
      if (cachedSample) {
        return {
          ...cachedSample,
          scope,
          cachedContextUsed: true,
          generationMetrics: { ...createEmptyGenerationMetrics(), servedFromCache: true },
        };
      }
    }

    // Reuse in-flight generation if another request for the same canonicalKey is already running
    const existingInFlight = inFlightBookGenerations.get(inFlightKey);
    if (existingInFlight) {
      const sharedResult = await existingInFlight;
      return {
        ...sharedResult,
        scope,
      };
    }
  } else if (scope !== 'preview') {
    manuscriptBatchCheckpoints.delete(canonicalKey);
  }

  const executeGenerationPipeline = async () => {
    // Build chapter segments to redact:
    // If a planned chapter has > 12 testimony units, split its units into sub-segments of <= 10 units
    // that preserve the same chapter id, partNumber, dimensionKey, and title, and merge upon completion.
    const MAX_UNITS_PER_CHAPTER_SEGMENT = 10;
    const chapterSegmentsToRedact: Array<{
      id: string;
      partNumber: number;
      dimensionKey: string;
      title: string;
      segmentIndex: number;
      totalSegmentsForChapter: number;
      expectedParagraphCount: number;
      unidadesTestimonialesOriginales: Array<{
        unitId?: string;
        sourceAnswerIds?: string[];
        sourceQuestionIds?: string[];
        uncertaintyExpressions?: string[];
        preguntaPrincipal?: string;
        respuestaPrincipal?: string;
        profundizaciones?: Array<{ pregunta?: string; respuesta: string }>;
        fotografiasAsociadas?: Array<{
          photoId: string;
          descripcionOriginal: string;
          preguntaAsociada?: string;
        }>;
      }>;
    }> = [];

    for (const ch of fallbackResult.manuscript.chapters) {
      const chUnits = (fallbackResult.chapterStructuredUnits?.[ch.id] || []).map((u: any) => ({
        unitId: u.unitId,
        sourceAnswerIds: u.sourceAnswerIds,
        sourceQuestionIds: u.sourceQuestionIds,
        uncertaintyExpressions: u.uncertaintyExpressions,
        preguntaPrincipal: u.preguntaPrincipal,
        respuestaPrincipal: u.respuestaPrincipal,
        profundizaciones: u.profundizaciones,
        fotografiasAsociadas: u.fotografiasAsociadas,
      }));

      if (ch.paragraphs.length > 0 && chUnits.length > 0) {
        const totalSegs = Math.max(1, Math.ceil(chUnits.length / MAX_UNITS_PER_CHAPTER_SEGMENT));
        for (let sIdx = 0; sIdx < totalSegs; sIdx++) {
          const segUnits = chUnits.slice(
            sIdx * MAX_UNITS_PER_CHAPTER_SEGMENT,
            (sIdx + 1) * MAX_UNITS_PER_CHAPTER_SEGMENT
          );
          chapterSegmentsToRedact.push({
            id: ch.id,
            partNumber: ch.partNumber,
            dimensionKey: ch.dimensionKey,
            title: ch.title,
            segmentIndex: sIdx + 1,
            totalSegmentsForChapter: totalSegs,
            expectedParagraphCount: segUnits.length,
            unidadesTestimonialesOriginales: segUnits,
          });
        }
      }
    }

    // Prepare multimodal photographs and complete photograph catalog with descriptions
    const allMultimodalPhotos: MultimodalBookPhotoInput[] = [];
    const photoMetadataSummary: Array<{
      photoId: string;
      etapa: string;
      preguntaAsociada: string;
      descripcionOriginalFotografia: string;
      aportadaPor: string;
    }> = [];

    const seenPhotoIds = new Set<string>();
    for (const ph of photosWithDataUrl) {
      if (!ph || !ph.id || seenPhotoIds.has(ph.id)) continue;
      seenPhotoIds.add(ph.id);
      photoMetadataSummary.push({
        photoId: ph.id,
        etapa: ph.lifeStage || 'legado_general',
        preguntaAsociada: ph.questionText || 'Testimonio biográfico',
        descripcionOriginalFotografia: ph.caption || 'Sin descripción adicional',
        aportadaPor: ph.participantName || fallbackResult.manuscript.authors,
      });
      const decoded = extractCleanDataUrlParts(ph.dataUrl, ph.mimeType || 'image/jpeg');
      if (decoded) {
        allMultimodalPhotos.push({
          id: ph.id,
          caption: ph.caption || '',
          questionText: ph.questionText,
          lifeStage: ph.lifeStage,
          participantName: ph.participantName,
          mimeType: decoded.mimeType,
          dataUrl: decoded.dataUrl,
          base64Data: decoded.base64Data,
        });
      }
    }

    for (const ans of validAnswers) {
      for (const p of ans.photos || []) {
        if (!p || !p.id || seenPhotoIds.has(p.id)) continue;
        seenPhotoIds.add(p.id);
        photoMetadataSummary.push({
          photoId: p.id,
          etapa: p.lifeStage || 'legado_general',
          preguntaAsociada: p.questionText || ans.questionText || 'Testimonio biográfico',
          descripcionOriginalFotografia: p.caption || 'Sin descripción adicional',
          aportadaPor:
            p.participantName || ans.participantName || fallbackResult.manuscript.authors,
        });
        const decoded = extractCleanDataUrlParts(
          (p as any).dataUrl || p.imageUrl,
          p.mimeType || 'image/jpeg'
        );
        if (decoded) {
          allMultimodalPhotos.push({
            id: p.id,
            caption: p.caption || '',
            questionText: p.questionText || ans.questionText,
            lifeStage: p.lifeStage,
            participantName: p.participantName || ans.participantName,
            mimeType: decoded.mimeType,
            dataUrl: decoded.dataUrl,
            base64Data: decoded.base64Data,
          });
        }
      }
    }

    // V5.3 — The 5-page sample drafts ONLY the opening of the book: the first planned chapter
    // segments (earliest life stages, in the plan's order) until a small budget of testimony
    // units is reached, in a single model call. Nothing else is drafted or audited.
    const segmentsForThisRun =
      scope === 'preview' ? selectPreviewSampleSegments(chapterSegmentsToRedact) : chapterSegmentsToRedact;

    // Group chapter segments into safe batches so each call stays well within output token & timeout limits
    const totalUnitsCount = segmentsForThisRun.reduce(
      (acc, seg) => acc + seg.unidadesTestimonialesOriginales.length,
      0
    );
    const MAX_SEGMENTS_PER_BATCH =
      scope === 'preview' ? Math.max(1, segmentsForThisRun.length) : totalUnitsCount > 24 ? 2 : 5;
    const chapterBatches: Array<typeof chapterSegmentsToRedact> = [];
    for (let i = 0; i < segmentsForThisRun.length; i += MAX_SEGMENTS_PER_BATCH) {
      chapterBatches.push(segmentsForThisRun.slice(i, i + MAX_SEGMENTS_PER_BATCH));
    }

    // Compact global editorial outline (replaces sending duplicate fullCompilationPdfContent on every batch)
    const globalBookOutlineSummary = fallbackResult.editorialPlan.chapters
      .map(
        (c) =>
          `Capítulo ${c.partNumber} (${c.chapterId}): "${c.thematicAxis}" [${c.assignedAnswerIds.length} testimonios]`
      )
      .join(' | ');

    const styleDifferentiationDirective =
      narrativeStyle === 'third_person_biography'
        ? `DIRECTRIZ CRÍTICA DE ESTILO (TERCERA PERSONA BIOGRÁFICA - ${styleTitle}):
- Redacta OBLIGATORIAMENTE toda la introducción, títulos y el 100% de los párrafos en TERCERA PERSONA gramatical ("él", "ella", "ellos", o nombrando a ${fallbackResult.manuscript.authors}).
- PROHIBIDO usar primera persona ("yo", "mi", "recuerdo que", "nací", "viví"). Transforma cada testimonio a voz de biógrafo literario y documental (ej. "En su infancia, ${fallbackResult.manuscript.authors} vivió...", "Aquel episodio marcó su camino...").`
        : narrativeStyle === 'first_person_simple'
        ? `DIRECTRIZ CRÍTICA DE ESTILO (PRIMERA PERSONA SENCILLA Y DIRECTA - ${styleTitle}):
- Redacta en PRIMERA PERSONA ("yo" / "nosotros") con un lenguaje SENCILLO, DIRECTO, CLARO, COTIDIANO y NATURAL, sin metáforas rebuscadas ni adornos poéticos.
- Usa oraciones ágiles, cercanas y transparentes que suenen exactamente a una conversación honesta y ordenada en familia.`
        : `DIRECTRIZ CRÍTICA DE ESTILO (PRIMERA PERSONA LITERARIA Y EMOTIVA - ${styleTitle}):
- Redacta en PRIMERA PERSONA ("yo" / "nosotros") con una PROSA LITERARIA CÁLIDA, EVOCADORA, SENSORIAL y EMOTIVA, digna de un libro de memorias de alta edición.
- Cuida el ritmo narrativo, las transiciones entre recuerdos y la riqueza expresiva sin alterar ni un solo hecho real.`;

    // SINGLE TRANSMISSION OF ACTIVE LITERARY PROMPT: passed once in systemInstructionWithActivePrompt
    const systemInstructionWithActivePrompt = `${activeLiteraryPrompt}\n\n${styleDifferentiationDirective}`;

    let effectiveProvider: BookAiProvider = primaryProvider;
    let effectiveModel: string = primaryModel;
    let providerFallbackNotice: string | undefined = undefined;
    let anyProviderCachedTokens = false;

    const aggregatedAiChapters = new Map<
      string,
      {
        id: string;
        partNumber: number;
        dimensionKey: any;
        title: string;
        paragraphs: string[];
        pullQuote?: string;
        photoPlacements?: Array<{
          photoId: string;
          paragraphIndex: number;
          shortCaption: string;
        }>;
      }
    >();
    let aiTitle = '';
    let aiSubtitle = '';
    let aiIntroduction = '';
    let aiClosingMessage = '';

    const isAutonomousStructure = bookStructureMode !== 'fixed_five_stages';
    // V5.3: the sample keeps its own checkpoint space (it must never overwrite full-book batches).
    const checkpointSpaceKey = scope === 'preview' ? `${canonicalKey}::preview-sample` : canonicalKey;
    if (!manuscriptBatchCheckpoints.has(checkpointSpaceKey)) {
      manuscriptBatchCheckpoints.set(checkpointSpaceKey, new Map());
    }
    const batchCheckpointMap = manuscriptBatchCheckpoints.get(checkpointSpaceKey)!;
    if (initialBatchCheckpoints && !forceRefresh) {
      for (const [k, cp] of Object.entries(initialBatchCheckpoints)) {
        const bIdxNum = Number(k);
        // V5.1: a persisted batch is reused only when it was drafted from these exact sources,
        // style, prompt and settings. Checkpoints from an edited interview, another style or an
        // older engine (no fingerprint) are discarded and that batch is drafted again.
        // V5.2: ...and only when it was drafted with the same provider, model, engine, prompt
        // and structure (generation fingerprint). The chapter plan is checked per batch below.
        if (
          !Number.isNaN(bIdxNum) &&
          cp?.parsed &&
          cp.sourceFingerprint === sourceFingerprint &&
          cp.generationFingerprint === generationFingerprint &&
          !batchCheckpointMap.has(bIdxNum)
        ) {
          batchCheckpointMap.set(bIdxNum, cp);
        }
      }
    }

    let completedBatchesCount = 0;
    const draftStartedAt = Date.now();

    try {
      // V5.3.3 — Batches of the full book are drafted IN PARALLEL (bounded concurrency) and merged
      // afterwards in their original order, so the result is identical to sequential drafting but
      // takes roughly the time of the slowest batch instead of the sum of all of them.
      const draftConcurrency =
        scope === 'preview' ? 1 : Math.max(1, Math.min(4, Number(process.env.BOOK_DRAFT_CONCURRENCY) || 3));
      const draftedBatchResults: Array<BookBatchCheckpointPayload | null> = new Array(chapterBatches.length).fill(null);
      let draftingFailed = false;
      const draftSingleBatch = async (batchIdx: number): Promise<BookBatchCheckpointPayload | null> => {
        if (isCancelled?.()) {
          throw new Error('Generación cancelada por solicitud del usuario.');
        }
        onProgress?.({
          phase: 'drafting_batches',
          currentBatch: batchIdx + 1,
          totalBatches: chapterBatches.length,
          completedBatches: completedBatchesCount,
          userMessage:
            scope === 'preview'
              ? 'Organizando los primeros recuerdos y aplicando el estilo elegido...'
              : 'Redactando los capítulos...',
        });
        const batchChapters = chapterBatches[batchIdx];

        // Filter multimodal photos to those relevant to this batch (avoiding re-sending unrelated image bytes on every batch)
        const batchPhotoIds = new Set(
          batchChapters.flatMap((bc) =>
            bc.unidadesTestimonialesOriginales.flatMap((u) =>
              (u.fotografiasAsociadas || []).map((f) => f.photoId)
            )
          )
        );
        const batchMultimodalPhotos = allMultimodalPhotos.filter((mp) =>
          batchPhotoIds.has(mp.id)
        );
        const batchPhotoCatalog = photoMetadataSummary.filter((pm) =>
          batchPhotoIds.has(pm.photoId)
        );

        const partialFramingNote = fallbackResult.editorialPlan.isPartialMemoir
          ? `\n- ENCUADRE EDITORIAL DE ENTREVISTA PARCIAL (Etapas documentadas: ${(fallbackResult.editorialPlan.documentedStages || []).join(', ')}):
  Presenta el subtítulo como "${fallbackResult.editorialPlan.partialMemoirSubtitle || 'Un libro parcial de memorias'}". NO inventes ni completes otras etapas de vida sin testimonios reales.`
          : '';

        const structureInstructions = isAutonomousStructure
          ? `MODO DE ESTRUCTURA EDITORIAL ACTIVO (OPCIÓN 1 — OBEDIENCIA 100% AUTÓNOMA AL PROMPT LITERARIO ACTIVO):
1. REGLA DE AGRUPACIÓN EN CAPÍTULOS:
   - UNA PREGUNTA RESPONDIDA NUNCA EQUIVALE A UN CAPÍTULO.
   - Redacta exactamente los capítulos planificados en este lote ("batchChapters"), conservando el "id" y "partNumber" de cada capítulo e integrando TODAS sus "unidadesTestimonialesOriginales" como párrafos narrativos continuos y cohesionados.
   - Usa la respuesta escrita final como fuente prioritaria; nunca dupliques contenido por aparecer en audio y escrito.
   - Si varias respuestas o profundizaciones narran el mismo episodio, consolídalas sin repetir el episodio dos veces.
   - Si el entrevistado expresa duda ("creo que", "no recuerdo bien", "tal vez", "aproximadamente"), conserva ese matiz de incertidumbre en la prosa y jamás inventes hechos, fechas ni diálogos no testimoniados.${partialFramingNote}
2. UBICACIÓN DOCUMENTAL EXACTA DE FOTOGRAFÍAS ("photoPlacements"):
   - Integra el contexto narrativo de "descripcionOriginal" dentro de la prosa del párrafo exacto donde se narra ese acontecimiento. NUNCA escribas "[FOTO:...]" dentro del párrafo.
   - En "photoPlacements" del capítulo, incluye un objeto por cada fotografía con "photoId", "paragraphIndex" (base 0) y "shortCaption" (máximo 85 caracteres).`
          : `MODO DE ESTRUCTURA EDITORIAL ACTIVO (OPCIÓN 2 — CAPÍTULOS POR ETAPAS DOCUMENTADAS):
1. UNA PREGUNTA RESPONDIDA NUNCA EQUIVALE A UN CAPÍTULO: cada etapa agrupa todas sus respuestas y profundizaciones como párrafos narrativos continuos dentro del capítulo.
2. Conserva quién realizó la acción, negaciones y matices de incertidumbre sin inventar hechos ni fechas.${partialFramingNote}
3. En "photoPlacements" del capítulo, incluye cada fotografía asociada con "photoId", "paragraphIndex" (base 0) y "shortCaption" (máximo 85 caracteres).
4. Conserva exactamente el mismo "id", "partNumber" y "dimensionKey" de cada uno de los capítulos.`;

        // De-duplicated batch prompt: contains the global book outline + the exact structured testimony units for this batch
        const batchPrompt = `================================================================================
CONTEXTO EDITORIAL GLOBAL DE LA OBRA
================================================================================
- Título base de la entrevista: "${interview.title}"
- Modalidad: ${isCouple ? 'Historia compartida / pareja' : 'Historia individual'}
- Protagonista(s): ${fallbackResult.manuscript.authors}
- Estilo Literario Seleccionado: ${styleTitle} (${narrativeStyle}) — ${styleDesc}
- Mapa General de Capítulos de la Obra: ${globalBookOutlineSummary}

CATÁLOGO DE FOTOGRAFÍAS DE ESTE LOTE:
${batchPhotoCatalog.length > 0 ? JSON.stringify(batchPhotoCatalog, null, 2) : 'Sin fotografías adjuntas en este lote.'}

================================================================================
UNIDADES TESTIMONIALES A REDACTAR EN ESTE LOTE (LOTE ${batchIdx + 1}/${chapterBatches.length})
================================================================================
${JSON.stringify(batchChapters, null, 2)}

REGLAS OBLIGATORIAS DE SALIDA JSON:
${structureInstructions}`;

        // V5.2: a checkpoint (persisted OR held in this process's memory) is replayed only when it
        // belongs to these sources, this generation configuration and this exact chapter plan.
        const batchSignature = computeBookBatchSignature(batchChapters);
        const storedCheckpoint = batchCheckpointMap.get(batchIdx) || null;
        let batchResult =
          storedCheckpoint &&
          storedCheckpoint.sourceFingerprint === sourceFingerprint &&
          storedCheckpoint.generationFingerprint === generationFingerprint &&
          storedCheckpoint.batchSignature === batchSignature
            ? storedCheckpoint
            : null;
        if (storedCheckpoint && !batchResult) batchCheckpointMap.delete(batchIdx);
        if (batchResult) metrics.batchesReused++;

        if (!batchResult && pipelineOverrides.draftBatch) {
          metrics.draftCalls++;
          metrics.callsByOperation.push({ operation: 'draft_batch', provider: 'simulated', model: 'override', batchIdx });
          const overrideCall = pipelineOverrides.draftBatch({
            batchIdx,
            totalBatches: chapterBatches.length,
            batchChapters,
            narrativeStyle,
          });
          // V5.3.3: the sample's time budget applies to every drafter, real or injected.
          batchResult =
            scope === 'preview'
              ? await withTimeout(
                  overrideCall,
                  Math.max(1, PREVIEW_TIME_BUDGET_MS - (Date.now() - metrics.startedAtMs)),
                  () => {
                    throw new Error('Tiempo de espera agotado en la muestra (presupuesto de 60 s).');
                  }
                )
              : await overrideCall;
          if (batchResult?.parsed) {
            const stampedOverrideCheckpoint: BookBatchCheckpointPayload = {
              ...batchResult,
              sourceFingerprint,
              generationFingerprint,
              batchSignature,
            };
            batchCheckpointMap.set(batchIdx, stampedOverrideCheckpoint);
            onBatchCheckpoint?.(batchIdx, stampedOverrideCheckpoint);
          } else {
            // V5.2: an injected drafter never falls back to a real provider; an empty or
            // malformed response is handled exactly like a provider's invalid JSON.
            throw new Error(
              `La respuesta del modelo no produjo capítulos JSON válidos (respuesta vacía o incompleta en el lote ${batchIdx + 1}).`
            );
          }
        }

        if (!batchResult && !pipelineOverrides.draftBatch) {
          const isReasoningModel = isReasoningBookModel(effectiveModel);
          // V5.3.3: the editorial sample must be ready within a minute, whatever the model.
          const remainingPreviewMs =
            scope === 'preview' ? PREVIEW_TIME_BUDGET_MS - (Date.now() - metrics.startedAtMs) : Number.POSITIVE_INFINITY;
          if (scope === 'preview' && remainingPreviewMs < PREVIEW_MIN_CALL_MS) {
            throw new Error('Presupuesto de tiempo de la muestra agotado antes de redactar.');
          }
          const timeoutMs =
            scope === 'preview'
              ? Math.max(PREVIEW_MIN_CALL_MS, Math.min(isReasoningModel ? 45000 : 35000, remainingPreviewMs - 3000))
              : isReasoningModel
              ? 65000
              : 38000;

          try {
            metrics.draftCalls++;
            metrics.callsByOperation.push({ operation: 'draft_batch', provider: effectiveProvider, model: effectiveModel, batchIdx });
            if (effectiveProvider === 'openai') {
              batchResult = await callOpenAiBookModelBatch({
                reasoningEffort: scope === 'preview' ? BOOK_REASONING_EFFORT_PREVIEW : BOOK_REASONING_EFFORT_FULL,
                modelName: effectiveModel,
                systemInstructionText: systemInstructionWithActivePrompt,
                prompt: batchPrompt,
                multimodalPhotos: batchMultimodalPhotos,
                timeoutMs,
                allowBackupModels: effectiveProvider !== primaryProvider,
              });
            } else {
              batchResult = await callGeminiBookModelBatch({
                modelName: effectiveModel,
                systemInstructionText: systemInstructionWithActivePrompt,
                prompt: batchPrompt,
                multimodalPhotos: batchMultimodalPhotos,
                pdfBase64:
                  scope !== 'preview' && chapterBatches.length === 1 && batchIdx === 0
                    ? compilationPdfRecord?.pdfBase64
                    : undefined,
                timeoutMs,
              });
            }
          } catch (primaryErr: any) {
            // V5.3.3: no time left for a second provider inside the sample budget → the sample
            // falls back to the faithful rule-based redaction (handled by the caller).
            const remainingAfterPrimaryMs =
              scope === 'preview' ? PREVIEW_TIME_BUDGET_MS - (Date.now() - metrics.startedAtMs) : Number.POSITIVE_INFINITY;
            if (scope === 'preview' && remainingAfterPrimaryMs < PREVIEW_FAILOVER_MIN_MS) throw primaryErr;
            const failoverTimeoutMs =
              scope === 'preview' ? Math.max(PREVIEW_MIN_CALL_MS, remainingAfterPrimaryMs - 3000) : timeoutMs;
            const primaryErrorMsg =
              primaryErr?.message || 'Error de conexión con el proveedor principal';
            const primaryLabel =
              primaryProvider === 'openai' ? 'OpenAI (ChatGPT)' : 'Google (Gemini)';
            const alternateLabel =
              alternateProvider === 'openai' ? 'OpenAI (ChatGPT)' : 'Google (Gemini)';

            console.warn(
              `[BookAI Failover] Proveedor principal ${primaryLabel} (${primaryModel}) falló: ${primaryErrorMsg}. Conmutando temporalmente a ${alternateLabel} (${alternateModel}).`
            );

            providerFallbackNotice = `Aviso: El proveedor principal configurado (${primaryLabel} · ${primaryModel}) presentó un fallo (${primaryErrorMsg}). Se conmutó automáticamente de forma temporal al proveedor alterno (${alternateLabel} · ${alternateModel}) únicamente durante esta generación. En la siguiente generación se regresará automáticamente al proveedor principal configurado.`;
            effectiveProvider = alternateProvider;
            effectiveModel = alternateModel;
            metrics.retries++;
            metrics.providerFailovers++;
            metrics.technicalErrors.push(String(primaryErrorMsg).slice(0, 200));
            metrics.draftCalls++;
            metrics.callsByOperation.push({ operation: 'draft_batch_failover', provider: effectiveProvider, model: effectiveModel, batchIdx });

            if (effectiveProvider === 'openai') {
              batchResult = await callOpenAiBookModelBatch({
                reasoningEffort: scope === 'preview' ? BOOK_REASONING_EFFORT_PREVIEW : BOOK_REASONING_EFFORT_FULL,
                modelName: effectiveModel,
                systemInstructionText: systemInstructionWithActivePrompt,
                prompt: batchPrompt,
                multimodalPhotos: batchMultimodalPhotos,
                timeoutMs: failoverTimeoutMs,
                allowBackupModels: true,
              });
            } else {
              batchResult = await callGeminiBookModelBatch({
                modelName: effectiveModel,
                systemInstructionText: systemInstructionWithActivePrompt,
                prompt: batchPrompt,
                multimodalPhotos: batchMultimodalPhotos,
                pdfBase64:
                  scope !== 'preview' && chapterBatches.length === 1 && batchIdx === 0
                    ? compilationPdfRecord?.pdfBase64
                    : undefined,
                timeoutMs: failoverTimeoutMs,
              });
            }
          }

          if (batchResult?.parsed) {
            const stampedCheckpoint: BookBatchCheckpointPayload = {
              ...batchResult,
              sourceFingerprint,
              generationFingerprint,
              batchSignature,
            };
            batchCheckpointMap.set(batchIdx, stampedCheckpoint);
            onBatchCheckpoint?.(batchIdx, stampedCheckpoint);
          }
        }
        return batchResult;
      };
      let nextBatchToDraft = 0;
      let firstDraftingError: unknown = null;
      // On a failure no NEW batch is started, but the ones already in flight are allowed to finish:
      // they are counted and checkpointed, so a resumption only drafts what is really missing.
      await Promise.allSettled(
        Array.from({ length: Math.min(draftConcurrency, chapterBatches.length) }, async () => {
          for (;;) {
            const batchIdx = nextBatchToDraft++;
            if (batchIdx >= chapterBatches.length || draftingFailed) return;
            try {
              const drafted = await draftSingleBatch(batchIdx);
              draftedBatchResults[batchIdx] = drafted;
              if (drafted?.parsed) completedBatchesCount++;
            } catch (err) {
              draftingFailed = true;
              if (!firstDraftingError) firstDraftingError = err;
              return;
            }
          }
        })
      );
      if (firstDraftingError) throw firstDraftingError;
      for (let batchIdx = 0; batchIdx < chapterBatches.length; batchIdx++) {
        const batchChapters = chapterBatches[batchIdx];
        const batchResult = draftedBatchResults[batchIdx];
        if (batchResult?.parsed) {
          effectiveModel = batchResult.respondedModel || effectiveModel;
          if ((batchResult.cachedTokens || 0) > 0) {
            anyProviderCachedTokens = true;
            metrics.tokens.cachedInput = (metrics.tokens.cachedInput || 0) + (batchResult.cachedTokens || 0);
          }
          if (!aiTitle && batchResult.parsed.title) {
            aiTitle = batchResult.parsed.title;
          }
          if (!aiSubtitle && batchResult.parsed.subtitle) {
            aiSubtitle = batchResult.parsed.subtitle;
          }
          if (!aiIntroduction && batchResult.parsed.introduction) {
            aiIntroduction = batchResult.parsed.introduction;
          }
          if (!aiClosingMessage && batchResult.parsed.closingMessage) {
            aiClosingMessage = batchResult.parsed.closingMessage;
          }
          for (let chIdx = 0; chIdx < (batchResult.parsed.chapters || []).length; chIdx++) {
            const ch = batchResult.parsed.chapters![chIdx];
            if (!ch) continue;
            const matchingBatchRef = batchChapters[chIdx] || batchChapters[0];
            const resolvedId = ch.id || matchingBatchRef?.id || `cap_${batchIdx * 10 + chIdx + 1}`;
            const existing = aggregatedAiChapters.get(resolvedId);
            if (existing) {
              // Merge chapter segments that share the same chapter ID instead of overwriting!
              const paraOffset = existing.paragraphs.length;
              const incomingParas = Array.isArray(ch.paragraphs) ? ch.paragraphs : [];
              existing.paragraphs = [...existing.paragraphs, ...incomingParas];
              if (Array.isArray(ch.photoPlacements) && ch.photoPlacements.length > 0) {
                const offsetPlacements = ch.photoPlacements.map((pl: any) => ({
                  ...pl,
                  paragraphIndex: (Number(pl.paragraphIndex) || 0) + paraOffset,
                }));
                existing.photoPlacements = [
                  ...(existing.photoPlacements || []),
                  ...offsetPlacements,
                ];
              }
            } else {
              aggregatedAiChapters.set(resolvedId, {
                ...ch,
                id: resolvedId,
                partNumber:
                  Number(ch.partNumber) ||
                  matchingBatchRef?.partNumber ||
                  aggregatedAiChapters.size + 1,
                dimensionKey:
                  ch.dimensionKey || matchingBatchRef?.dimensionKey || 'raices_infancia',
                paragraphs: Array.isArray(ch.paragraphs) ? [...ch.paragraphs] : [],
                photoPlacements: Array.isArray(ch.photoPlacements)
                  ? [...ch.photoPlacements]
                  : undefined,
              });
            }
          }
        }
      }

      metrics.draftMs += Date.now() - draftStartedAt;
      metrics.batchesTotal = chapterBatches.length;
      metrics.batchesGenerated = Math.max(0, completedBatchesCount - metrics.batchesReused);
      let mergedChapters: DemoManuscript['chapters'] = [];

      if (isAutonomousStructure && aggregatedAiChapters.size > 0) {
        const seenPlacementIds = new Set<string>();
        const validDimensions = [
          'raices_infancia',
          'juventud_busqueda',
          'amor_vida_compartida',
          'hogar_familia_crianza',
          'vocacion_trabajo_caminos',
          'pruebas_momentos_decisivos',
          'aprendizajes_valores',
          'presente_legado_futuro',
          'raices',
          'transformacion',
          'personas_amadas',
          'esencia',
          'legado',
        ];

        const aiChapterList = Array.from(aggregatedAiChapters.values());
        for (let i = 0; i < aiChapterList.length; i++) {
          const aiCh = aiChapterList[i];
          const cleanAiParas = Array.isArray(aiCh.paragraphs)
            ? aiCh.paragraphs
                .map((p) => stripInlinePhotoMarkers(String(p || '').trim()))
                .filter((p) => p.length > 0)
            : [];
          if (cleanAiParas.length === 0) continue;

          const chId = aiCh.id || `cap_autonomo_${i + 1}`;
          const origPlanCh = fallbackResult.manuscript.chapters.find((c) => c.id === chId);
          const paragraphIds = cleanAiParas.map((_, pIdx) => `${chId}_p_${pIdx + 1}`);
          const resolvedPlacements: DemoChapterPhotoPlacement[] = [];
          if (Array.isArray(aiCh.photoPlacements)) {
            for (const aiPl of aiCh.photoPlacements) {
              if (!aiPl || !aiPl.photoId || seenPlacementIds.has(aiPl.photoId)) continue;
              if (!fallbackResult.allPhotosById?.[aiPl.photoId]) continue;
              seenPlacementIds.add(aiPl.photoId);
              const clampedParaIdx = Math.min(
                Math.max(0, Number(aiPl.paragraphIndex) || 0),
                Math.max(0, cleanAiParas.length - 1)
              );
              resolvedPlacements.push({
                photoId: aiPl.photoId,
                paragraphIndex: clampedParaIdx,
                shortCaption: formatPhotoEditorialCaption(
                  aiPl.shortCaption || fallbackResult.allPhotosById[aiPl.photoId]?.caption || ''
                ),
                chapterId: chId,
                paragraphId: paragraphIds[clampedParaIdx],
              });
            }
          }

          const rawPullQuote = stripInlinePhotoMarkers((aiCh.pullQuote || '').trim());
          const dimKey = validDimensions.includes(String(aiCh.dimensionKey))
            ? aiCh.dimensionKey
            : origPlanCh?.dimensionKey || validDimensions[i % validDimensions.length];

          mergedChapters.push({
            id: chId,
            partNumber: mergedChapters.length + 1,
            dimensionKey: dimKey as any,
            title:
              stripInlinePhotoMarkers(aiCh.title || origPlanCh?.title || `Capítulo ${i + 1}`).trim() ||
              `Capítulo ${i + 1}`,
            paragraphs: cleanAiParas,
            paragraphIds,
            sourceAnswerIds: origPlanCh?.sourceAnswerIds,
            sourceQuestionIds: origPlanCh?.sourceQuestionIds,
            sourceUnitIds: origPlanCh?.sourceUnitIds,
            pullQuote: rawPullQuote || undefined,
            photoPlacements: resolvedPlacements.length > 0 ? resolvedPlacements : undefined,
          });
        }

        // Ensure any active photos that the AI didn't explicitly list in photoPlacements are anchored
        // to the exact chapter and paragraph that narrates their event
        const allFallbackPlacements = fallbackResult.manuscript.chapters.flatMap((ch) =>
          (ch.photoPlacements || []).map((pl) => ({
            ...pl,
            dimensionKey: ch.dimensionKey,
            preferredChapterId: ch.id,
          }))
        );
        if (mergedChapters.length > 0 && allFallbackPlacements.length > 0) {
          for (const origPl of allFallbackPlacements) {
            if (seenPlacementIds.has(origPl.photoId)) continue;
            seenPlacementIds.add(origPl.photoId);

            const matchingAns = validAnswers.find(
              (a) =>
                a.id === origPl.answerId ||
                (a.photos || []).some((p) => p.id === origPl.photoId)
            );
            const resolvedLoc = resolveDocumentaryPhotoChapterAndParagraph({
              chapters: mergedChapters,
              photoId: origPl.photoId,
              shortCaption: origPl.shortCaption,
              originalDescription: origPl.originalDescription || origPl.shortCaption,
              answerId: origPl.answerId || matchingAns?.id,
              questionId: origPl.questionId || matchingAns?.questionId,
              answerText: matchingAns ? extractCleanParticipantAnswerText(matchingAns) : '',
              questionText: matchingAns?.questionText || '',
              dimensionKey: origPl.dimensionKey as any,
              preferredChapterId: origPl.preferredChapterId,
              preferredParagraphIndex: origPl.paragraphIndex,
            });

            const targetCh = mergedChapters[resolvedLoc.chapterIndex] || mergedChapters[0];
            const existingList = targetCh.photoPlacements || [];
            targetCh.photoPlacements = [
              ...existingList,
              {
                photoId: origPl.photoId,
                paragraphIndex: resolvedLoc.paragraphIndex,
                shortCaption: origPl.shortCaption,
                originalDescription: origPl.originalDescription,
                answerId: origPl.answerId || matchingAns?.id,
                questionId: origPl.questionId || matchingAns?.questionId,
                chapterId: targetCh.id,
                paragraphId: resolvedLoc.paragraphId,
              },
            ];
          }
        }
      }

      if (mergedChapters.length === 0) {
        mergedChapters = fallbackResult.manuscript.chapters.map((origCh) => {
          const aiCh = aggregatedAiChapters.get(origCh.id);
          const cleanAiParas = Array.isArray(aiCh?.paragraphs)
            ? aiCh!.paragraphs
                .map((p) => stripInlinePhotoMarkers(p.trim()))
                .filter((p) => p.length > 0)
            : [];

          const effectiveParas =
            cleanAiParas.length >= origCh.paragraphs.length
              ? cleanAiParas
              : [...cleanAiParas, ...origCh.paragraphs.slice(cleanAiParas.length)];
          const paragraphIds = effectiveParas.map((_, pIdx) => `${origCh.id}_p_${pIdx + 1}`);

          const resolvedPlacements: DemoChapterPhotoPlacement[] = [];
          const seenPlacementIds = new Set<string>();
          const validPhotoIdsInStage = new Set(
            (origCh.photoPlacements || []).map((pl) => pl.photoId)
          );
          if (Array.isArray(aiCh?.photoPlacements)) {
            for (const aiPl of aiCh!.photoPlacements) {
              if (!aiPl || !aiPl.photoId || seenPlacementIds.has(aiPl.photoId)) continue;
              if (
                validPhotoIdsInStage.size > 0 &&
                !validPhotoIdsInStage.has(aiPl.photoId) &&
                !fallbackResult.allPhotosById?.[aiPl.photoId]
              ) {
                continue;
              }
              seenPlacementIds.add(aiPl.photoId);
              const clampedIdx = Math.min(
                Math.max(0, Number(aiPl.paragraphIndex) || 0),
                Math.max(0, effectiveParas.length - 1)
              );
              resolvedPlacements.push({
                photoId: aiPl.photoId,
                paragraphIndex: clampedIdx,
                shortCaption: formatPhotoEditorialCaption(aiPl.shortCaption || ''),
                chapterId: origCh.id,
                paragraphId: paragraphIds[clampedIdx],
              });
            }
          }
          for (const origPl of origCh.photoPlacements || []) {
            if (!seenPlacementIds.has(origPl.photoId)) {
              seenPlacementIds.add(origPl.photoId);
              const clampedIdx = Math.min(
                Math.max(0, origPl.paragraphIndex || 0),
                Math.max(0, effectiveParas.length - 1)
              );
              resolvedPlacements.push({
                ...origPl,
                paragraphIndex: clampedIdx,
                chapterId: origCh.id,
                paragraphId: paragraphIds[clampedIdx],
              });
            }
          }

          const rawFullPullQuote = stripInlinePhotoMarkers(
            (aiCh?.pullQuote || origCh.pullQuote || '').trim()
          );

          return {
            ...origCh,
            title: (
              stripInlinePhotoMarkers(aiCh?.title || '').trim() || origCh.title
            ).trim(),
            paragraphs: effectiveParas,
            paragraphIds,
            pullQuote: rawFullPullQuote || undefined,
            photoPlacements:
              resolvedPlacements.length > 0 ? resolvedPlacements : origCh.photoPlacements,
          };
        });
      }

      const rawCandidateManuscript: DemoManuscript = {
        ...fallbackResult.manuscript,
        narrativeStyle,
        bookStructureMode,
        aiGenerated: true,
        isPartialMemoir: fallbackResult.editorialPlan.isPartialMemoir,
        documentedStages: fallbackResult.editorialPlan.documentedStages,
        title: (
          stripInlinePhotoMarkers(aiTitle || '').trim() || fallbackResult.manuscript.title
        ).trim(),
        subtitle: fallbackResult.editorialPlan.isPartialMemoir
          ? fallbackResult.editorialPlan.partialMemoirSubtitle || 'Un libro parcial de memorias'
          : (
              stripInlinePhotoMarkers(aiSubtitle || '').trim() ||
              fallbackResult.manuscript.subtitle
            ).trim(),
        introduction: (
          stripInlinePhotoMarkers(aiIntroduction || '').trim() ||
          fallbackResult.manuscript.introduction
        ).trim(),
        closingMessage: (
          stripInlinePhotoMarkers(aiClosingMessage || '').trim() ||
          fallbackResult.manuscript.closingMessage
        ).trim(),
        chapters: mergedChapters,
        generatedAt: new Date().toISOString(),
        useOfficialForeverYouLogo: true,
        canonicalCacheKey: canonicalKey,
      };

      if (isCancelled?.()) {
        throw new Error('Generación cancelada por solicitud del usuario.');
      }

      if (scope === 'preview') {
        const sample = finalizePreviewSample({
          candidate: rawCandidateManuscript,
          fallback: fallbackResult.manuscript,
          sampleChapterIds: Array.from(new Set(segmentsForThisRun.map((seg) => seg.id))),
          answers,
          questions,
        });
        metrics.totalMs = Date.now() - metrics.startedAtMs;
        const previewResult = {
          manuscript: sample,
          chapterPhotos: fallbackResult.chapterPhotos,
          allPhotosById: fallbackResult.allPhotosById,
          scope,
          providerUsed: effectiveProvider,
          modelUsed: effectiveModel,
          providerFallbackNotice,
          compilationPdfId: compilationPdfRecord?.pdfId,
          compilationPdfSha256: compilationPdfRecord?.sha256Hash,
          cachedContextUsed: anyProviderCachedTokens,
          sourceFingerprint,
          generationFingerprint,
          batchesCompleted: completedBatchesCount,
          totalBatches: chapterBatches.length,
          generationMetrics: metrics,
        };
        previewSampleCache.set(generationFingerprint, previewResult);
        if (previewSampleCache.size > 200) {
          const oldest = previewSampleCache.keys().next().value;
          if (oldest !== undefined) previewSampleCache.delete(oldest);
        }
        return previewResult;
      }

      onProgress?.({
        phase: 'auditing_semantics',
        currentBatch: chapterBatches.length,
        totalBatches: chapterBatches.length,
        completedBatches: completedBatchesCount,
        userMessage: 'Preparando tus capítulos...',
      });

      // Run mandatory server-side Hybrid Dual Audit (Deterministic Propositional + Selective AI Judge + Editorial)
      let auditedResult = await timeIt('auditMs', () =>
        auditWithHybridSemantics({
          manuscript: rawCandidateManuscript,
          answers,
          questions,
          provider: effectiveProvider,
          model: effectiveModel,
          alternateProvider,
          alternateModel,
          aiJudgeOverride: pipelineOverrides.aiJudge,
        })
      );
      recordJudgeStats(metrics, auditedResult.report);

      // V5.3 — Repair policy. The writer always aims at 100 %, but the delivery decision is the
      // 60 % policy: a fully verified book is not repaired; an eligible book with observations
      // gets at most ONE focused repair round; a book below the minimum gets focused rounds
      // until it becomes eligible or a round stops improving. The best manuscript is kept.
      let deliveryDecision = evaluateBookDeliveryEligibility({
        report: auditedResult.report,
        editorialAudit: auditedResult.editorialAudit,
        manuscript: auditedResult.manuscript,
      });
      const repairSummary: BookRepairSummary = {
        roundsPlanned: 0,
        roundsExecuted: 0,
        chaptersReviewed: 0,
        repairsAccepted: 0,
        repairsRejected: 0,
        unitsRecovered: 0,
        remainingIncidents: 0,
        coverageBeforeRepair: deliveryDecision.coverageExactPercent,
        coverageAfterRepair: deliveryDecision.coverageExactPercent,
        stopReason: 'not_needed',
        rounds: [],
      };
      const fullyVerifiedAtStart =
        auditedResult.report.passed && auditedResult.editorialAudit.passed;
      const repairRoundsAllowed = fullyVerifiedAtStart
        ? 0
        : deliveryDecision.eligible
        ? Math.min(1, maxRepairPasses)
        : maxRepairPasses;
      repairSummary.roundsPlanned = repairRoundsAllowed;
      if (fullyVerifiedAtStart) repairSummary.stopReason = 'fully_verified';

      let repairPassesUsed = 0;
      const repairStartedAt = Date.now();
      for (let aiRepairPass = 1; aiRepairPass <= repairRoundsAllowed; aiRepairPass++) {
        if (auditedResult.report.passed && auditedResult.editorialAudit.passed) {
          repairSummary.stopReason = 'fully_verified';
          break;
        }
        if (aiRepairPass > 1 && deliveryDecision.eligible) {
          repairSummary.stopReason = 'eligible_minimum_reached';
          break;
        }
        if (isCancelled?.()) {
          throw new Error('Generación cancelada por solicitud del usuario.');
        }

        const tasks = buildContextualRepairTasks({
          manuscript: auditedResult.manuscript,
          report: auditedResult.report,
          editorialAudit: auditedResult.editorialAudit,
          inventory: auditedResult.inventory,
          editorialPlan: fallbackResult.editorialPlan,
        }).filter((t) => t.autoRepairable !== false);
        if (tasks.length === 0) {
          repairSummary.stopReason = 'no_repairable_incidents';
          break;
        }

        repairPassesUsed = aiRepairPass;
        repairSummary.roundsExecuted = aiRepairPass;
        repairSummary.chaptersReviewed += tasks.length;
        metrics.repairRounds = aiRepairPass;
        onProgress?.({
          phase: 'repairing_chapters',
          currentBatch: chapterBatches.length,
          totalBatches: chapterBatches.length,
          completedBatches: completedBatchesCount,
          repairPass: aiRepairPass,
          repairedChapters: 0,
          totalRepairChapters: tasks.length,
          userMessage: 'Preparando la edición final...',
        });

        const aiRepaired = await repairChaptersContextuallyWithAI({
          manuscript: auditedResult.manuscript,
          tasks,
          activeLiteraryPrompt,
          narrativeStyle,
          authors: fallbackResult.manuscript.authors,
          isCouple,
          answers,
          questions,
          provider: effectiveProvider,
          model: effectiveModel,
          alternateProvider,
          alternateModel,
          precomputedBeforeAudit: auditedResult,
          aiJudgeOverride: pipelineOverrides.aiJudge,
          batchCallerOverride: pipelineOverrides.repairBatchCaller,
          onRepairProgress: (done, total) => {
            onProgress?.({
              phase: 'repairing_chapters',
              currentBatch: chapterBatches.length,
              totalBatches: chapterBatches.length,
              completedBatches: completedBatchesCount,
              repairPass: aiRepairPass,
              repairedChapters: done,
              totalRepairChapters: total,
              userMessage: 'Preparando la edición final...',
            });
          },
        });
        metrics.repairCalls += Math.max(1, Math.ceil(tasks.length / 2));
        const coverageBeforeRound = auditedResult.report.integratedUnits;
        // Never lose a more complete manuscript to a later repair: an "improvement" that lowers
        // the number of verified memories is a regression and is discarded.
        const acceptedRound =
          Boolean(aiRepaired && aiRepaired.improved) &&
          (aiRepaired!.audited.report.integratedUnits >= coverageBeforeRound);
        repairSummary.rounds.push({
          round: aiRepairPass,
          chaptersReviewed: tasks.length,
          chapterIds: tasks.map((t) => t.chapterId),
          accepted: acceptedRound,
          repairedChapters: acceptedRound ? aiRepaired!.repairedChaptersCount : 0,
          verifiedUnitsBefore: coverageBeforeRound,
          verifiedUnitsAfter: acceptedRound ? aiRepaired!.audited.report.integratedUnits : coverageBeforeRound,
        });
        if (acceptedRound) {
          repairSummary.repairsAccepted += aiRepaired!.repairedChaptersCount;
          repairSummary.repairsRejected += Math.max(0, tasks.length - aiRepaired!.repairedChaptersCount);
          auditedResult = {
            ...auditedResult,
            manuscript: aiRepaired!.audited.manuscript,
            report: aiRepaired!.audited.report,
            editorialAudit: aiRepaired!.audited.editorialAudit,
          };
          deliveryDecision = evaluateBookDeliveryEligibility({
            report: auditedResult.report,
            editorialAudit: auditedResult.editorialAudit,
            manuscript: auditedResult.manuscript,
          });
          repairSummary.stopReason = deliveryDecision.eligible ? 'eligible_minimum_reached' : 'max_rounds';
        } else {
          repairSummary.repairsRejected += tasks.length;
          repairSummary.stopReason = 'no_improvement';
          break;
        }
      }
      metrics.repairMs += Date.now() - repairStartedAt;

      // Deterministic post-AI hygiene pass ONLY if small structural/editorial defects remain.
      // V5.1: (1) it never pastes rule-rewritten testimony into AI prose (`integrateMissingUnits:
      // false`) — omissions are repaired narratively above or reported honestly; (2) its result is
      // judged by the SAME hybrid policy as everything else, instead of comparing a deterministic
      // score against a hybrid one.
      // V5.3: only when the book is still below the delivery minimum (it costs another audit).
      if (!deliveryDecision.eligible && (!auditedResult.report.passed || !auditedResult.editorialAudit.passed)) {
        const hygieneRepaired = repairManuscriptOmissions({
          manuscript: auditedResult.manuscript,
          answers,
          questions,
          storyMode: interview.storyMode,
          participantNames,
          maxAttempts: 2,
          integrateMissingUnits: false,
        });
        const hygieneAudited = await timeIt('auditMs', () =>
          auditWithHybridSemantics({
            manuscript: hygieneRepaired.manuscript,
            answers,
            questions,
            provider: effectiveProvider,
            model: effectiveModel,
            alternateProvider,
            alternateModel,
            repairAttemptsUsed: repairPassesUsed,
            aiJudgeOverride: pipelineOverrides.aiJudge,
          })
        );
        recordJudgeStats(metrics, hygieneAudited.report);
        const hygieneScore = computeManuscriptDefectScore(
          hygieneAudited.report,
          hygieneAudited.editorialAudit
        );
        const preScore = computeManuscriptDefectScore(
          auditedResult.report,
          auditedResult.editorialAudit
        );
        if (
          (hygieneScore < preScore ||
            (hygieneAudited.report.passed && hygieneAudited.editorialAudit.passed)) &&
          hygieneAudited.report.integratedUnits >= auditedResult.report.integratedUnits
        ) {
          auditedResult = hygieneAudited;
          deliveryDecision = evaluateBookDeliveryEligibility({
            report: auditedResult.report,
            editorialAudit: auditedResult.editorialAudit,
            manuscript: auditedResult.manuscript,
          });
        }
      }

      onProgress?.({
        phase: 'finalizing',
        currentBatch: chapterBatches.length,
        totalBatches: chapterBatches.length,
        completedBatches: completedBatchesCount,
        userMessage: 'Finalizando tu libro...',
      });

      const fullyVerified = auditedResult.report.passed && auditedResult.editorialAudit.passed;
      // V5.3: the participant-facing status follows DELIVERY eligibility, not the strict audit.
      const deliverable = deliveryDecision.eligible;
      repairSummary.coverageAfterRepair = deliveryDecision.coverageExactPercent;
      repairSummary.unitsRecovered = Math.max(
        0,
        deliveryDecision.verifiedUnits -
          Math.round((repairSummary.coverageBeforeRepair / 100) * deliveryDecision.eligibleUnits)
      );
      repairSummary.remainingIncidents =
        deliveryDecision.observations.contradictions +
        deliveryDecision.observations.omittedUnits +
        deliveryDecision.observations.pendingVerificationUnits;
      const finalGenerationStatus = deliverable ? 'approved' : 'incomplete_draft';
      const failureDiag = deliverable
        ? null
        : classifyBookFailureReasonCode({
            report: auditedResult.report,
            editorialAudit: auditedResult.editorialAudit,
            completedBatches: completedBatchesCount,
            totalBatches: chapterBatches.length,
            repairPassesAttempted: repairPassesUsed,
          });

      const unsignedFinalManuscript: DemoManuscript = {
        ...auditedResult.manuscript,
        aiGenerated: true,
        isPartialMemoir: fallbackResult.editorialPlan.isPartialMemoir,
        documentedStages: fallbackResult.editorialPlan.documentedStages,
        generationStatus: finalGenerationStatus,
        status: finalGenerationStatus,
        // V5.1: the participant reads a message that matches the real cause of the incomplete draft.
        incompleteDraftNotice: failureDiag
          ? buildIncompleteDraftUserNotice(failureDiag.category)
          : undefined,
        failureCategory: failureDiag?.category,
        internalReasonCode: failureDiag?.code,
        diagnosticSummary: failureDiag?.summary,
        approvalEvidence: undefined,
        deliveryDecision,
      };
      // V5.1/V5.3: the delivery authorization is recorded once, here, as server-signed evidence
      // bound to this exact text and these exact sources. Saving verifies it instead of auditing again.
      const finalManuscript: DemoManuscript = deliverable
        ? attachApprovalEvidence(
            unsignedFinalManuscript,
            auditedResult.report,
            auditedResult.editorialAudit,
            deliveryDecision
          )
        : unsignedFinalManuscript;

      // V5.1: when the draft fails for reasons in its CONTENT, replaying the same drafted batches
      // on the next attempt reproduces the same manuscript and the same failure. Batches holding
      // chapters with confirmed defects are discarded so only those chapters are written again.
      // Technical failures keep every batch: the text was never the problem.
      // V5.3: a delivered book keeps every batch; only an undeliverable draft discards the
      // batches whose chapters carry the confirmed defects.
      let invalidatedBatchIndexes: number[] = [];
      if (!deliverable && failureDiag && failureDiag.category !== 'technical') {
        const defectiveChapterIds = new Set(
          Array.from(
            countUnresolvedDefectsByChapter(
              auditedResult,
              buildAnswerHomeChapterMap(rawCandidateManuscript)
            ).keys()
          )
        );
        invalidatedBatchIndexes = chapterBatches
          .map((batch, idx) => ({ batch, idx }))
          .filter(
            ({ batch }) =>
              defectiveChapterIds.size === 0 ||
              batch.some((seg) => defectiveChapterIds.has(seg.id))
          )
          .map(({ idx }) => idx);
        for (const idx of invalidatedBatchIndexes) batchCheckpointMap.delete(idx);
      }

      // Update chapterPhotos captions with the audited shortCaption when available, and map custom chapter IDs
      const updatedChapterPhotos: Record<string, DemoInMemoryPhoto | null> = {
        ...fallbackResult.chapterPhotos,
      };
      const updatedAllPhotosById: Record<string, DemoInMemoryPhoto> = {
        ...(fallbackResult.allPhotosById || {}),
      };
      for (const ch of finalManuscript.chapters) {
        for (const pl of ch.photoPlacements || []) {
          if (pl.shortCaption && updatedAllPhotosById[pl.photoId]) {
            updatedAllPhotosById[pl.photoId] = {
              ...updatedAllPhotosById[pl.photoId],
              caption: pl.shortCaption,
            };
          }
          const chPh = updatedChapterPhotos[ch.id];
          if (chPh && chPh.id === pl.photoId && pl.shortCaption) {
            updatedChapterPhotos[ch.id] = {
              ...chPh,
              caption: pl.shortCaption,
            };
          } else if (!updatedChapterPhotos[ch.id] && updatedAllPhotosById[pl.photoId]) {
            updatedChapterPhotos[ch.id] = updatedAllPhotosById[pl.photoId];
          }
        }
      }

      // Store in Context & Style Cache when the book was AUTHORIZED for delivery (V5.3)
      if (deliverable && finalManuscript.generationStatus === 'approved') {
        const cacheEntry = {
          cacheKey: canonicalKey,
          interviewId: interview.id,
          narrativeStyle,
          scope: 'full' as const,
          manuscript: finalManuscript,
          providerUsed: effectiveProvider,
          modelUsed: effectiveModel,
          providerFallbackNotice,
          createdAt: new Date().toISOString(),
        };
        manuscriptAiMemoryCache.set(canonicalKey, cacheEntry);
        manuscriptAiMemoryCache.set(fullCacheKey, cacheEntry);
        manuscriptAiMemoryCache.set(scopeCacheKey, cacheEntry);
        if (!pipelineOverrides.skipDiskCache) {
          persistManuscriptCacheToDisk();
        }
        manuscriptBatchCheckpoints.delete(canonicalKey);
      }

      return {
        manuscript: finalManuscript,
        chapterPhotos: updatedChapterPhotos,
        allPhotosById: updatedAllPhotosById,
        scope,
        providerUsed: effectiveProvider,
        modelUsed: effectiveModel,
        providerFallbackNotice,
        compilationPdfId: compilationPdfRecord?.pdfId,
        compilationPdfSha256: compilationPdfRecord?.sha256Hash,
        cachedContextUsed: anyProviderCachedTokens,
        internalReasonCode: failureDiag?.code,
        diagnosticSummary: failureDiag?.summary,
        failureCategory: failureDiag?.category,
        sourceFingerprint,
        generationFingerprint,
        invalidatedBatchIndexes,
        batchesCompleted: completedBatchesCount,
        totalBatches: chapterBatches.length,
        deliveryDecision,
        generationMetrics: { ...metrics, totalMs: Date.now() - metrics.startedAtMs, fullyVerified },
        repairSummary,
      };
    } catch (bothFailedErr: any) {
      const failureDiag = classifyBookFailureReasonCode({
        error: bothFailedErr,
        completedBatches: completedBatchesCount,
        totalBatches: chapterBatches.length,
      });
      console.warn(
        `[BookAI] Incomplete draft returned (${failureDiag.code}): ${failureDiag.summary}`
      );
      metrics.technicalErrors.push(String(bothFailedErr?.message || bothFailedErr).slice(0, 200));
      metrics.totalMs = Date.now() - metrics.startedAtMs;

      // V5.3.3 — The editorial SAMPLE never ends as an "incomplete draft": when the model does not
      // answer within the sample's time budget (or fails), the participant receives the faithful
      // rule-based redaction of the same first memories, in the chosen style's structure. The
      // technical cause is recorded for administrators only. It is not cached, so the next request
      // tries the model again.
      if (scope === 'preview' && !isCancelled?.()) {
        const sampleChapterIds = Array.from(new Set(segmentsForThisRun.map((seg) => seg.id)));
        const ruleBasedSample = finalizePreviewSample({
          candidate: { ...fallbackResult.manuscript, narrativeStyle, canonicalCacheKey: canonicalKey },
          fallback: fallbackResult.manuscript,
          sampleChapterIds,
          answers,
          questions,
        });
        return {
          manuscript: {
            ...ruleBasedSample,
            aiGenerated: false,
            previewSource: 'rule_based_fallback',
          } as DemoManuscript,
          chapterPhotos: fallbackResult.chapterPhotos,
          allPhotosById: fallbackResult.allPhotosById,
          scope,
          providerUsed: effectiveProvider,
          modelUsed: effectiveModel,
          compilationPdfId: compilationPdfRecord?.pdfId,
          compilationPdfSha256: compilationPdfRecord?.sha256Hash,
          cachedContextUsed: false,
          // Admin-only diagnostics (stripped from every participant response).
          internalReasonCode: failureDiag.code,
          diagnosticSummary: `Muestra servida con la redacción fiel basada en reglas: ${failureDiag.summary}`,
          sourceFingerprint,
          batchesCompleted: completedBatchesCount,
          totalBatches: chapterBatches.length,
          generationMetrics: { ...metrics, previewSource: 'rule_based_fallback' },
        };
      }

      const auditedFallback = auditAndApproveBookManuscript({
        manuscript: {
          ...fallbackResult.manuscript,
          narrativeStyle,
          bookStructureMode,
          aiGenerated: false,
          isPartialMemoir: fallbackResult.editorialPlan.isPartialMemoir,
          documentedStages: fallbackResult.editorialPlan.documentedStages,
          canonicalCacheKey: canonicalKey,
        },
        answers,
        questions,
      });

      const incompleteDraftManuscript: DemoManuscript = {
        ...auditedFallback.manuscript,
        aiGenerated: false,
        generationStatus: 'incomplete_draft',
        status: 'incomplete_draft',
        incompleteDraftNotice: buildIncompleteDraftUserNotice(failureDiag.category),
        failureCategory: failureDiag.category,
        internalReasonCode: failureDiag.code,
        diagnosticSummary: failureDiag.summary,
        approvalEvidence: undefined,
      };

      return {
        manuscript: incompleteDraftManuscript,
        chapterPhotos: fallbackResult.chapterPhotos,
        allPhotosById: fallbackResult.allPhotosById,
        scope,
        providerUsed: effectiveProvider,
        modelUsed: effectiveModel,
        providerFallbackNotice: buildIncompleteDraftUserNotice(failureDiag.category),
        compilationPdfId: compilationPdfRecord?.pdfId,
        compilationPdfSha256: compilationPdfRecord?.sha256Hash,
        cachedContextUsed: false,
        internalReasonCode: failureDiag.code,
        diagnosticSummary: failureDiag.summary,
        failureCategory: failureDiag.category,
        sourceFingerprint,
        batchesCompleted: completedBatchesCount,
        totalBatches: chapterBatches.length,
        generationMetrics: metrics,
      };
    }
  };

  const genPromise = executeGenerationPipeline();
  inFlightBookGenerations.set(inFlightKey, genPromise);
  try {
    return await genPromise;
  } finally {
    inFlightBookGenerations.delete(inFlightKey);
  }
}

export interface SingleAiEngineDiagnosticResult {
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
}

export async function testConfiguredBookAiEngines(params: {
  primaryProvider: BookAiProvider;
  geminiModel: string;
  openaiModel: string;
}): Promise<{
  testedAt: string;
  primaryProvider: BookAiProvider;
  gemini: SingleAiEngineDiagnosticResult;
  openai: SingleAiEngineDiagnosticResult;
}> {
  const {
    primaryProvider = 'gemini',
    geminiModel = 'gemini-3-flash-preview',
    openaiModel = 'gpt-4o',
  } = params;

  const testGemini = async (): Promise<SingleAiEngineDiagnosticResult> => {
    const startMs = Date.now();
    const apiKey = process.env.GEMINI_API_KEY;
    const knownGeminiModels = [
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ];
    if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
      return {
        provider: 'gemini',
        providerLabel: 'Google (Gemini)',
        configuredModel: geminiModel,
        respondedModel: '—',
        ok: false,
        latencyMs: Date.now() - startMs,
        sampleResponse: '',
        availableModels: knownGeminiModels,
        isConfiguredModelAvailable: false,
        contextCachingSupported: true,
        contextCachingExplanation:
          'Google Gemini 2.5/3 aplica Context Caching implícito de prefijos largos y caché de manuscrito por estilo en YouForever.',
        diagnosticMessage: 'La clave GEMINI_API_KEY no está configurada en el servidor.',
        errorDetail: 'GEMINI_API_KEY ausente',
      };
    }

    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: geminiModel,
          contents:
            'Responde en español en una sola oración breve confirmando que la conexión con el motor editorial de YouForever está activa y lista para redactar memorias.',
        }),
        10000,
        () => {
          throw new Error(`Tiempo de espera agotado (10s) al conectar con ${geminiModel}.`);
        }
      );
      const latencyMs = Date.now() - startMs;
      const text = (response?.text || '').trim();
      return {
        provider: 'gemini',
        providerLabel: 'Google (Gemini)',
        configuredModel: geminiModel,
        respondedModel: geminiModel,
        ok: true,
        latencyMs,
        sampleResponse: text || 'Conexión verificada correctamente con Google Gemini.',
        availableModels: Array.from(new Set([geminiModel, ...knownGeminiModels])),
        isConfiguredModelAvailable: true,
        contextCachingSupported: true,
        contextCachingExplanation:
          'Activo: Caché de contexto implícito de Gemini + Caché de Manuscritos por Estilo y Prompt de YouForever.',
        diagnosticMessage: `Conexión exitosa con ${geminiModel} en ${latencyMs} ms.`,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startMs;
      const errMsg = err?.message || 'Error desconocido al conectar con Gemini';
      // Also check if fallback gemini-3-flash-preview is reachable if the user typed a custom model name
      let fallbackNote = '';
      if (geminiModel !== 'gemini-3-flash-preview') {
        try {
          const fbRes = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: 'Responde "OK" si estás activo.',
            }),
            6000,
            () => {
              throw new Error('Timeout');
            }
          );
          if (fbRes?.text) {
            fallbackNote = ` La cuenta de Gemini sí tiene acceso activo al modelo oficial "gemini-3-flash-preview".`;
          }
        } catch (_e) {
          // Ignore
        }
      }
      return {
        provider: 'gemini',
        providerLabel: 'Google (Gemini)',
        configuredModel: geminiModel,
        respondedModel: '—',
        ok: false,
        latencyMs,
        sampleResponse: '',
        availableModels: knownGeminiModels,
        isConfiguredModelAvailable: false,
        contextCachingSupported: true,
        contextCachingExplanation:
          'Google Gemini 2.5/3 aplica Context Caching implícito de prefijos largos y caché de manuscrito por estilo en YouForever.',
        diagnosticMessage: `El modelo configurado "${geminiModel}" presentó un error: ${errMsg}.${fallbackNote}`,
        errorDetail: errMsg,
      };
    }
  };

  const testOpenAi = async (): Promise<SingleAiEngineDiagnosticResult> => {
    const startMs = Date.now();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_OPENAI_API_KEY') {
      return {
        provider: 'openai',
        providerLabel: 'OpenAI (ChatGPT)',
        configuredModel: openaiModel,
        respondedModel: '—',
        ok: false,
        latencyMs: Date.now() - startMs,
        sampleResponse: '',
        availableModels: [],
        isConfiguredModelAvailable: false,
        contextCachingSupported: true,
        contextCachingExplanation:
          'OpenAI aplica Prompt Prefix Caching automático y caché de manuscritos por estilo en YouForever.',
        diagnosticMessage: 'La clave OPENAI_API_KEY no está configurada en el servidor.',
        errorDetail: 'OPENAI_API_KEY ausente',
      };
    }

    const availableModels = await getAvailableOpenAiModels(apiKey);
    const recommendedModels = availableModels.filter((m) =>
      /^gpt-6|^gpt-5|^gpt-4o|^gpt-4\.1|^gpt-4-turbo|^o3|^o4|^gpt-3\.5/i.test(m)
    );
    const displayModels =
      recommendedModels.length > 0 ? recommendedModels.slice(0, 18) : availableModels.slice(0, 18);
    const isModelInList =
      availableModels.length === 0 || availableModels.includes(openaiModel);

    if (!isModelInList) {
      const latencyMs = Date.now() - startMs;
      return {
        provider: 'openai',
        providerLabel: 'OpenAI (ChatGPT)',
        configuredModel: openaiModel,
        respondedModel: '—',
        ok: false,
        latencyMs,
        sampleResponse: '',
        availableModels: displayModels,
        isConfiguredModelAvailable: false,
        contextCachingSupported: true,
        contextCachingExplanation:
          'Activo: Prompt Prefix Caching de OpenAI + Caché de Manuscritos por Estilo y Prompt de YouForever.',
        diagnosticMessage: `La conexión con OpenAI es válida, pero el modelo configurado "${openaiModel}" NO existe en la API de OpenAI de tu cuenta. Por eso ocurre el aviso de conmutación automática a Gemini. Selecciona un modelo disponible de la lista inferior.`,
        errorDetail: `Modelo "${openaiModel}" no encontrado en la cuenta de OpenAI.`,
      };
    }

    const openai = new OpenAI({ apiKey });
    try {
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), 22000);
      let completion: any;
      try {
        completion = await openai.chat.completions.create(
          {
            model: openaiModel,
            messages: [
              {
                role: 'system',
                content:
                  'Eres el motor editorial de YouForever. Esta es una prueba de diagnóstico de conexión iniciada por el administrador.',
              },
              {
                role: 'user',
                content:
                  'Escribe una sola oración breve y cálida en español confirmando que has recibido esta prueba de conexión y estás listo para redactar memorias biográficas.',
              },
            ],
            max_completion_tokens: 250,
          },
          { signal: abortController.signal }
        );
      } finally {
        clearTimeout(timer);
      }
      const latencyMs = Date.now() - startMs;
      const sampleText = completion.choices?.[0]?.message?.content?.trim() || '';
      const respondedModel = completion.model || openaiModel;
      return {
        provider: 'openai',
        providerLabel: 'OpenAI (ChatGPT)',
        configuredModel: openaiModel,
        respondedModel,
        ok: true,
        latencyMs,
        sampleResponse: sampleText || 'Conexión verificada correctamente con OpenAI.',
        availableModels: displayModels,
        isConfiguredModelAvailable: true,
        contextCachingSupported: true,
        contextCachingExplanation:
          'Activo: Prompt Prefix Caching de OpenAI + Caché de Manuscritos por Estilo y Prompt de YouForever.',
        diagnosticMessage: `Conexión exitosa con ${respondedModel} en ${latencyMs} ms.`,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startMs;
      const errMsg = err?.message || 'Error al invocar OpenAI';
      return {
        provider: 'openai',
        providerLabel: 'OpenAI (ChatGPT)',
        configuredModel: openaiModel,
        respondedModel: '—',
        ok: false,
        latencyMs,
        sampleResponse: '',
        availableModels: displayModels,
        isConfiguredModelAvailable: false,
        contextCachingSupported: true,
        contextCachingExplanation:
          'Activo: Prompt Prefix Caching de OpenAI + Caché de Manuscritos por Estilo y Prompt de YouForever.',
        diagnosticMessage: `Fallo al conectar con el modelo "${openaiModel}" en OpenAI: ${errMsg}.`,
        errorDetail: errMsg,
      };
    }
  };

  const [gemini, openai] = await Promise.all([testGemini(), testOpenAi()]);
  return {
    testedAt: new Date().toISOString(),
    primaryProvider,
    gemini,
    openai,
  };
}



