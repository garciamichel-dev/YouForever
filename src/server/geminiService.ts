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
  BookGenerationReasonCode,
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

const PLAIN_INCOMPLETE_DRAFT_USER_NOTICE =
  'Este borrador preliminar todavía necesita una revisión para reunir todos tus recuerdos con total fidelidad y fluidez. Puedes leerlo ahora y volver a intentarlo cuando lo desees; no se guardará como versión definitiva hasta quedar completo.';

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
      const hygieneRepaired = repairManuscriptOmissions({
        manuscript: audited.manuscript,
        answers,
        questions,
        storyMode: interview.storyMode,
        participantNames,
        maxAttempts: 2,
      });
      const preScore = computeManuscriptDefectScore(audited.report, audited.editorialAudit);
      const hygieneScore = computeManuscriptDefectScore(
        hygieneRepaired.report,
        hygieneRepaired.editorialAudit
      );
      if (
        hygieneScore < preScore ||
        (hygieneRepaired.report.passed && hygieneRepaired.editorialAudit.passed)
      ) {
        audited = await auditWithHybridSemantics({
          manuscript: hygieneRepaired.manuscript,
          answers,
          questions,
          provider: configuredProvider,
          model: primaryAdminModel,
          alternateProvider,
          alternateModel,
        });
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
      incompleteDraftNotice: bothPassed ? undefined : PLAIN_INCOMPLETE_DRAFT_USER_NOTICE,
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
      incompleteDraftNotice: PLAIN_INCOMPLETE_DRAFT_USER_NOTICE,
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

interface ParsedAiManuscriptBatchResponse {
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

async function callOpenAiBookModelBatch(params: {
  modelName: string;
  systemInstructionText: string;
  prompt: string;
  multimodalPhotos: MultimodalBookPhotoInput[];
  timeoutMs: number;
  allowBackupModels?: boolean;
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
const manuscriptBatchCheckpoints = new Map<
  string,
  Map<
    number,
    {
      parsed: ParsedAiManuscriptBatchResponse;
      respondedModel: string;
      cachedTokens?: number;
    }
  >
>();

function computeManuscriptDefectScore(
  docReport: DocumentaryAuditReport,
  edReport: EditorialQualityAuditReport
): number {
  return (
    (docReport.blockingDefects?.length || 0) * 10 +
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
}

export interface SemanticJudgmentVerdict {
  unitId: string;
  verdict: 'supported' | 'contradicted' | 'inconclusive';
  rationale: string;
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

  for (let i = 0; i < cases.length; i += BATCH_SIZE) {
    const slice = cases.slice(i, i + BATCH_SIZE);
    const judgePrompt = `Evalúa cuidadosamente cada par (testimonio original vs. fragmento redactado en el manuscrito).
Estilo narrativo del libro: ${narrativeStyle}.
Criterios estrictos de veredicto por unidad:
- "supported": el fragmento redactado conserva el mismo hecho real, sujeto que actúa, polaridad (afirmación/negación) y dudas/incertidumbres aunque utilice paráfrasis literaria o vocabulario distinto.
- "contradicted": el fragmento invierte quién hizo la acción, contradice una negación o afirmación real, convierte un intento en hecho consumado o inventa datos ajenos.
- "inconclusive": el fragmento es demasiado vago o incompleto para confirmar fidelidad testimonial.

Casos a evaluar:
${JSON.stringify(slice, null, 2)}

Responde EXCLUSIVAMENTE con un JSON válido:
{
  "verdicts": [
    { "unitId": "id_de_unidad", "verdict": "supported" | "contradicted" | "inconclusive", "rationale": "explicación breve en español" }
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
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 22000);
        try {
          const resp = await withTimeout(
            openai.chat.completions.create(
              {
                model: resolvedModel,
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
        } finally {
          clearTimeout(timer);
        }
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

    if (sliceVerdicts) {
      for (const v of sliceVerdicts) {
        if (!v || !v.unitId) continue;
        const cleanVerdict: 'supported' | 'contradicted' | 'inconclusive' =
          v.verdict === 'supported'
            ? 'supported'
            : v.verdict === 'contradicted'
            ? 'contradicted'
            : 'inconclusive';
        allVerdicts.push({
          unitId: v.unitId,
          verdict: cleanVerdict,
          rationale: String(v.rationale || '').trim(),
        });
      }
    } else {
      for (const c of slice) {
        allVerdicts.push({
          unitId: c.unitId,
          verdict: 'inconclusive',
          rationale: 'Juez semántico temporalmente no disponible; se conserva revisión pendiente.',
        });
      }
    }
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

  const detResult = auditAndApproveBookManuscript({
    manuscript,
    answers,
    questions,
    repairAttemptsUsed,
    repairedUnitIds,
  });

  const ambiguousIds = detResult.report.semanticAudit?.ambiguousUnitIds || [];
  if (ambiguousIds.length === 0) {
    return detResult;
  }

  const cases: SemanticJudgmentCaseInput[] = [];
  for (const unitId of ambiguousIds) {
    const unit = detResult.inventory.eligibleFactUnits.find((u) => u.unitId === unitId);
    const trace = detResult.report.traceabilityMatrix.find((t) => t.unitId === unitId);
    if (!unit || !trace) continue;
    const ch = detResult.manuscript.chapters.find((c) => c.id === trace.chapterId);
    const pIdx = typeof trace.paragraphIndex === 'number' ? trace.paragraphIndex : 0;
    const paraText = ch?.paragraphs?.[pIdx] || trace.evidenceSnippet || '';
    const nextPara = ch?.paragraphs?.[pIdx + 1] || '';
    cases.push({
      unitId,
      originalTestimony: unit.cleanText,
      candidateExcerpt: [paraText, nextPara].filter(Boolean).join(' ').trim(),
      ambiguityReason: trace.ambiguityReason || 'Paráfrasis literaria o giro conversacional ambiguo.',
    });
  }

  if (cases.length === 0) {
    return detResult;
  }

  const judgeFn = aiJudgeOverride || judgeAmbiguousSemanticUnitsWithAI;
  const verdicts = await judgeFn({
    cases,
    narrativeStyle: manuscript.narrativeStyle || 'first_person_literary',
    provider,
    model,
    alternateProvider,
    alternateModel,
  });

  const verdictMap = new Map(verdicts.map((v) => [v.unitId, v]));

  // Reconcile verdicts strictly into a deep clone of the report
  const updatedReport: DocumentaryAuditReport = structuredClone(detResult.report);
  const missingSet = new Set(updatedReport.coverageAudit?.missingUnitIds || []);
  const remainingAmbiguous: string[] = [];
  let semanticContradictions = (updatedReport.veracityAudit?.semanticContradictionFlags || []).filter(
    (flag) => {
      const m = flag.match(/^\[(trace_[^\]]+)\]/);
      if (!m) return true;
      const v = verdictMap.get(m[1]);
      return v?.verdict !== 'supported';
    }
  );

  let integratedUnits = updatedReport.integratedUnits;

  for (const entry of updatedReport.traceabilityMatrix) {
    if (!ambiguousIds.includes(entry.unitId)) continue;
    const judgeRes = verdictMap.get(entry.unitId);
    if (!judgeRes) {
      remainingAmbiguous.push(entry.unitId);
      continue;
    }

    entry.aiJudgeVerdict = judgeRes.verdict;
    if (judgeRes.verdict === 'supported') {
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
      }
    } else if (judgeRes.verdict === 'contradicted') {
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
    } else {
      if (entry.verified) {
        integratedUnits = Math.max(0, integratedUnits - 1);
      }
      entry.verified = false;
      entry.status = 'missing';
      entry.verificationStatus = 'ambiguous';
      missingSet.add(entry.unitId);
      remainingAmbiguous.push(entry.unitId);
    }
  }

  const totalSourceUnits = updatedReport.totalSourceUnits;
  const updatedCoverage =
    totalSourceUnits > 0 ? Math.floor((integratedUnits / totalSourceUnits) * 100) : updatedReport.coveragePercentage;
  const remainingMissingIds = Array.from(missingSet);

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
    nextBlocking.push(
      `Auditoría semántica inconclusa para ${remainingAmbiguous.length} unidad(es) ambigua(s): ${remainingAmbiguous.slice(0, 6).join(', ')}.`
    );
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
  if (!detResult.editorialAudit.passed) {
    nextBlocking.push(...detResult.editorialAudit.blockingDefects);
  }

  const nextPassed = nextBlocking.length === 0;
  updatedReport.integratedUnits = integratedUnits;
  updatedReport.coveragePercentage = updatedCoverage;
  updatedReport.passed = nextPassed;
  updatedReport.approved = nextPassed;
  updatedReport.status = nextPassed ? 'approved' : 'failed_audit';
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
    updatedReport.semanticAudit.passed =
      semanticContradictions.length === 0 &&
      (updatedReport.veracityAudit?.inventedDataFlags || []).length === 0 &&
      (updatedReport.veracityAudit?.unsupportedAdditionFlags || []).length === 0 &&
      remainingAmbiguous.length === 0;
  }

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
  } = params;

  const autoTasks = (tasks || []).filter((t) => t.autoRepairable !== false);
  if (autoTasks.length === 0) return null;

  const beforeAudit = await auditWithHybridSemantics({
    manuscript,
    answers,
    questions,
    provider,
    model,
    alternateProvider,
    alternateModel,
    repairAttemptsUsed: manuscript.documentaryAudit?.repairAttemptsUsed || 0,
    aiJudgeOverride,
  });
  const beforeScore = computeManuscriptDefectScore(beforeAudit.report, beforeAudit.editorialAudit);

  const styleReminder =
    narrativeStyle === 'third_person_biography'
      ? `ESTILO C OBLIGATORIO: Reescribe el 100% de cada capítulo corregido en TERCERA PERSONA biográfica ("él", "ella", "${authors}"). CERO primera persona fuera de citas textuales.`
      : narrativeStyle === 'first_person_simple'
      ? `ESTILO A OBLIGATORIO: Reescribe en primera persona ("yo"/"nosotros") sencilla, natural y bien estructurada.`
      : `ESTILO B OBLIGATORIO: Reescribe en primera persona literaria, emotiva y fluida, conservando todos los hechos.`;

  const repairSystemPrompt = `${activeLiteraryPrompt}\n\n${styleReminder}\n\nEres el editor literario corrector de YouForever. Corrige ÚNICAMENTE los capítulos indicados integrando fluidamente cualquier recuerdo faltante, corrigiendo contradicciones de sentido (quién realizó la acción, negaciones, dudas), eliminando muletillas/exclusiones/repeticiones, corrigiendo títulos y conservando intactos todos los datos verdaderos.`;

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
        missingTestimonialUnits: t.missingUnits.map((u) => ({
          unitId: u.unitId,
          speaker: u.participantName,
          question: u.questionText,
          testimony: u.cleanText,
          uncertainties: u.uncertaintyExpressions,
        })),
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
  batchesCompleted?: number;
  totalBatches?: number;
}> {
  hydrateManuscriptCacheFromDisk();

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
    userMessage: 'Reuniendo y ordenando tus recuerdos y fotografías...',
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

  if (!forceRefresh) {
    // If an approved canonical manuscript was passed in lockedPreviewManuscript for this same style, verify BOTH documentary and editorial audits
    if (
      lockedPreviewManuscript &&
      lockedPreviewManuscript.narrativeStyle === narrativeStyle &&
      Array.isArray(lockedPreviewManuscript.chapters) &&
      lockedPreviewManuscript.chapters.length > 0 &&
      lockedPreviewManuscript.documentaryAudit?.auditVersion === CANONICAL_AUDIT_RULES_VERSION &&
      lockedPreviewManuscript.generationStatus === 'approved'
    ) {
      const auditedLocked = auditAndApproveBookManuscript({
        manuscript: lockedPreviewManuscript,
        answers,
        questions,
      });
      if (auditedLocked.report.passed && auditedLocked.editorialAudit.passed) {
        return {
          manuscript: {
            ...auditedLocked.manuscript,
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
      hit.manuscript.editorialAudit?.passed === true
    ) {
      return {
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

    // Reuse in-flight generation if another request for the same canonicalKey is already running
    const existingInFlight = inFlightBookGenerations.get(canonicalKey);
    if (existingInFlight) {
      const sharedResult = await existingInFlight;
      return {
        ...sharedResult,
        scope,
      };
    }
  } else {
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

    // Group chapter segments into safe batches so each call stays well within output token & timeout limits
    const totalUnitsCount = chapterSegmentsToRedact.reduce(
      (acc, seg) => acc + seg.unidadesTestimonialesOriginales.length,
      0
    );
    const MAX_SEGMENTS_PER_BATCH = totalUnitsCount > 24 ? 2 : 5;
    const chapterBatches: Array<typeof chapterSegmentsToRedact> = [];
    for (let i = 0; i < chapterSegmentsToRedact.length; i += MAX_SEGMENTS_PER_BATCH) {
      chapterBatches.push(chapterSegmentsToRedact.slice(i, i + MAX_SEGMENTS_PER_BATCH));
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
    if (!manuscriptBatchCheckpoints.has(canonicalKey)) {
      manuscriptBatchCheckpoints.set(canonicalKey, new Map());
    }
    const batchCheckpointMap = manuscriptBatchCheckpoints.get(canonicalKey)!;
    if (initialBatchCheckpoints && !forceRefresh) {
      for (const [k, cp] of Object.entries(initialBatchCheckpoints)) {
        const bIdxNum = Number(k);
        if (!Number.isNaN(bIdxNum) && cp?.parsed && !batchCheckpointMap.has(bIdxNum)) {
          batchCheckpointMap.set(bIdxNum, cp);
        }
      }
    }

    let completedBatchesCount = 0;

    try {
      for (let batchIdx = 0; batchIdx < chapterBatches.length; batchIdx++) {
        if (isCancelled?.()) {
          throw new Error('Generación cancelada por solicitud del usuario.');
        }
        onProgress?.({
          phase: 'drafting_batches',
          currentBatch: batchIdx + 1,
          totalBatches: chapterBatches.length,
          completedBatches: completedBatchesCount,
          userMessage: `Escribiendo los capítulos de tu historia (parte ${batchIdx + 1} de ${chapterBatches.length})...`,
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

        let batchResult = batchCheckpointMap.get(batchIdx) || null;

        if (!batchResult) {
          const isReasoningModel = /^gpt-6|^gpt-5|^o1|^o3|^o4/i.test(effectiveModel);
          const timeoutMs = isReasoningModel ? 65000 : 38000;

          try {
            if (effectiveProvider === 'openai') {
              batchResult = await callOpenAiBookModelBatch({
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
                  chapterBatches.length === 1 && batchIdx === 0
                    ? compilationPdfRecord?.pdfBase64
                    : undefined,
                timeoutMs,
              });
            }
          } catch (primaryErr: any) {
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

            if (effectiveProvider === 'openai') {
              batchResult = await callOpenAiBookModelBatch({
                modelName: effectiveModel,
                systemInstructionText: systemInstructionWithActivePrompt,
                prompt: batchPrompt,
                multimodalPhotos: batchMultimodalPhotos,
                timeoutMs,
                allowBackupModels: true,
              });
            } else {
              batchResult = await callGeminiBookModelBatch({
                modelName: effectiveModel,
                systemInstructionText: systemInstructionWithActivePrompt,
                prompt: batchPrompt,
                multimodalPhotos: batchMultimodalPhotos,
                pdfBase64:
                  chapterBatches.length === 1 && batchIdx === 0
                    ? compilationPdfRecord?.pdfBase64
                    : undefined,
                timeoutMs,
              });
            }
          }

          if (batchResult?.parsed) {
            batchCheckpointMap.set(batchIdx, batchResult);
            onBatchCheckpoint?.(batchIdx, batchResult);
          }
        }

        if (batchResult?.parsed) {
          completedBatchesCount++;
          effectiveModel = batchResult.respondedModel || effectiveModel;
          if ((batchResult.cachedTokens || 0) > 0) {
            anyProviderCachedTokens = true;
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
                const offsetPlacements = ch.photoPlacements.map((pl) => ({
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

      onProgress?.({
        phase: 'auditing_semantics',
        currentBatch: chapterBatches.length,
        totalBatches: chapterBatches.length,
        completedBatches: completedBatchesCount,
        userMessage: 'Verificando que cada recuerdo, nombre y detalle esté fielmente conservado...',
      });

      // Run mandatory server-side Hybrid Dual Audit (Deterministic Propositional + Selective AI Judge + Editorial)
      let auditedResult = await auditWithHybridSemantics({
        manuscript: rawCandidateManuscript,
        answers,
        questions,
        provider: effectiveProvider,
        model: effectiveModel,
        alternateProvider,
        alternateModel,
      });

      let repairPassesUsed = 0;
      for (let aiRepairPass = 1; aiRepairPass <= maxRepairPasses; aiRepairPass++) {
        if (auditedResult.report.passed && auditedResult.editorialAudit.passed) break;
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
        if (tasks.length === 0) break;

        repairPassesUsed = aiRepairPass;
        onProgress?.({
          phase: 'repairing_chapters',
          currentBatch: chapterBatches.length,
          totalBatches: chapterBatches.length,
          completedBatches: completedBatchesCount,
          repairPass: aiRepairPass,
          repairedChapters: 0,
          totalRepairChapters: tasks.length,
          userMessage: `Puliendo y revisando ${tasks.length} capítulo(s) para asegurar fidelidad completa...`,
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
          onRepairProgress: (done, total) => {
            onProgress?.({
              phase: 'repairing_chapters',
              currentBatch: chapterBatches.length,
              totalBatches: chapterBatches.length,
              completedBatches: completedBatchesCount,
              repairPass: aiRepairPass,
              repairedChapters: done,
              totalRepairChapters: total,
              userMessage: `Puliendo capítulos (${done} de ${total} revisados)...`,
            });
          },
        });
        if (aiRepaired && aiRepaired.improved) {
          auditedResult = {
            ...auditedResult,
            manuscript: aiRepaired.audited.manuscript,
            report: aiRepaired.audited.report,
            editorialAudit: aiRepaired.audited.editorialAudit,
          };
        } else {
          break;
        }
      }

      // Deterministic post-AI hygiene pass ONLY if small structural/editorial defects remain
      if (!auditedResult.report.passed || !auditedResult.editorialAudit.passed) {
        const hygieneRepaired = repairManuscriptOmissions({
          manuscript: auditedResult.manuscript,
          answers,
          questions,
          storyMode: interview.storyMode,
          participantNames,
          maxAttempts: 2,
        });
        const hygieneScore = computeManuscriptDefectScore(
          hygieneRepaired.report,
          hygieneRepaired.editorialAudit
        );
        const preScore = computeManuscriptDefectScore(
          auditedResult.report,
          auditedResult.editorialAudit
        );
        if (
          hygieneScore < preScore ||
          (hygieneRepaired.report.passed && hygieneRepaired.editorialAudit.passed)
        ) {
          auditedResult = await auditWithHybridSemantics({
            manuscript: hygieneRepaired.manuscript,
            answers,
            questions,
            provider: effectiveProvider,
            model: effectiveModel,
            alternateProvider,
            alternateModel,
            repairAttemptsUsed: repairPassesUsed,
          });
        }
      }

      onProgress?.({
        phase: 'finalizing',
        currentBatch: chapterBatches.length,
        totalBatches: chapterBatches.length,
        completedBatches: completedBatchesCount,
        userMessage: 'Finalizando la edición de tu libro...',
      });

      const fullyVerified = auditedResult.report.passed && auditedResult.editorialAudit.passed;
      const finalGenerationStatus = fullyVerified ? 'approved' : 'incomplete_draft';
      const failureDiag = fullyVerified
        ? null
        : classifyBookFailureReasonCode({
            report: auditedResult.report,
            editorialAudit: auditedResult.editorialAudit,
            completedBatches: completedBatchesCount,
            totalBatches: chapterBatches.length,
            repairPassesAttempted: repairPassesUsed,
          });

      const finalManuscript: DemoManuscript = {
        ...auditedResult.manuscript,
        aiGenerated: true,
        isPartialMemoir: fallbackResult.editorialPlan.isPartialMemoir,
        documentedStages: fallbackResult.editorialPlan.documentedStages,
        generationStatus: finalGenerationStatus,
        status: finalGenerationStatus,
        incompleteDraftNotice: fullyVerified ? undefined : PLAIN_INCOMPLETE_DRAFT_USER_NOTICE,
        internalReasonCode: failureDiag?.code,
        diagnosticSummary: failureDiag?.summary,
      };

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

      // Store in Context & Style Cache ONLY if BOTH Documentary and Editorial audits passed
      if (fullyVerified && finalManuscript.generationStatus === 'approved') {
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
        persistManuscriptCacheToDisk();
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
        batchesCompleted: completedBatchesCount,
        totalBatches: chapterBatches.length,
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
        incompleteDraftNotice: PLAIN_INCOMPLETE_DRAFT_USER_NOTICE,
        internalReasonCode: failureDiag.code,
        diagnosticSummary: failureDiag.summary,
      };

      return {
        manuscript: incompleteDraftManuscript,
        chapterPhotos: fallbackResult.chapterPhotos,
        allPhotosById: fallbackResult.allPhotosById,
        scope,
        providerUsed: effectiveProvider,
        modelUsed: effectiveModel,
        providerFallbackNotice: PLAIN_INCOMPLETE_DRAFT_USER_NOTICE,
        compilationPdfId: compilationPdfRecord?.pdfId,
        compilationPdfSha256: compilationPdfRecord?.sha256Hash,
        cachedContextUsed: false,
        internalReasonCode: failureDiag.code,
        diagnosticSummary: failureDiag.summary,
        batchesCompleted: completedBatchesCount,
        totalBatches: chapterBatches.length,
      };
    }
  };

  const genPromise = executeGenerationPipeline();
  inFlightBookGenerations.set(canonicalKey, genPromise);
  try {
    return await genPromise;
  } finally {
    inFlightBookGenerations.delete(canonicalKey);
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



