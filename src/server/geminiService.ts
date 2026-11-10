import { GoogleGenAI, Type } from '@google/genai';
import {
  AnswerRecord,
  InterviewRecord,
  ParticipantRecord,
  QuestionRecord,
  SufficiencyStatus,
  ensurePhotosPlacedInManuscript,
  formatPhotoMarkdownBlock,
} from '../logic/interviewRules.ts';
import {
  ComposedChapterSectionBlock,
  DEMO_NARRATIVE_STYLES,
  DemoInMemoryPhoto,
  DemoManuscript,
  DemoNarrativeStyleId,
  StructuredChapterTestimonyUnit,
  buildParticipantInitialManuscriptFromAnswers,
  cleanSpanishOralText,
  ensureParagraphConformsToStyle,
  extractCleanParticipantAnswerText,
  sanitizeAndRepairBookManuscript,
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
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallbackVal: () => T
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallbackVal());
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
  responseSchema: any;
  timeoutMsPerModel?: number;
}): Promise<string | null> {
  const { prompt, responseSchema, timeoutMsPerModel = 8500 } = params;

  for (const modelName of TEXT_FALLBACK_MODELS) {
    try {
      const callPromise = ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
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
}): Promise<ManuscriptDraftResult> {
  const { interview, participants, answers, questions } = params;

  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const structuredEntries = answers.map((a) => {
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

    return {
      etapa,
      tema,
      pregunta,
      autor: a.participantName,
      texto: a.notRecalled ? '[No recordado]' : a.answerText,
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
  });

  const prompt = `Eres un biógrafo y editor de legado personal y memorias familiares de máximo rigor ético y literario.
Debes componer el LIBRO COMPLETO DE HISTORIA DE VIDA Y LEGADO a partir EXCLUSIVAMENTE de los testimonios reales recopilados:
Título de la obra: "${interview.title}"
Modalidad: ${interview.storyMode === 'compartida' ? 'Historia Compartida (múltiples perspectivas familiares)' : 'Historia Individual y Testimonial'}
Protagonista y Participantes: ${participants.map((p) => `${p.name} (${p.relationship})`).join(', ')}

Testimonios reales recopilados (incluye preguntas base, ramificaciones condicionales, preguntas de profundización autónoma, recuerdos libres y fotografías con contexto):
${JSON.stringify(structuredEntries, null, 2)}

DIRECTRICES PARA LA CREACIÓN DEL LIBRO COMPLETO DE HISTORIA Y LEGADO:
1. ESTRUCTURA EDITORIAL DE LIBRO COMPLETO:
   - Portada con Título y Subtítulo inspirador.
   - Prólogo y Semblanza: Introducción que presenta a la persona entrevistada, su época, sus raíces y el propósito trascendente de este libro.
   - Capítulos por Etapas de Vida:
     * Capítulo I: Raíces Familiares, Infancia y Primeros Recuerdos.
     * Capítulo II: Juventud, Vocación, Estudios y Primeros Desafíos.
     * Capítulo III: Adultez, Matrimonio / Pareja, Creación de Hogar e Hijos.
     * Capítulo IV: Madurez, Trayectoria Vital y Grandes Decisiones.
     * Capítulo V: Momentos Inolvidables, Anécdotas y Memorias Adicionales.
     * Capítulo VI: Filosofía de Vida, Valores Morales y Lecciones de Vida.
   - Epílogo: Mensaje a la Posteridad y Legado para las Futuras Generaciones.

2. FIDELIDAD ESTRICTA A LOS HECHOS:
   - NUNCA inventes nombres, lugares, fechas ni hechos que no figuren en los testimonios.
   - Si existen versiones divergentes en historias compartidas, consérvalas con respeto como miradas complementarias ("Mientras Don Fernando recuerda..., su hija evoca...").
   - Distingue con claridad lo recordado con certeza de aquello que el protagonista declaró no recordar.

3. INTEGRACIÓN PERFECTA DE FOTOGRAFÍAS:
   - Cuando un testimonio incluya "fotografias", inserta cada fotografía exactamente en el pasaje narrativo que le corresponde con la sintaxis:
     ![Descripción o contexto de la foto | Aportada por Autor (Etapa)](/api/photos/ID_DE_LA_FOTO)
   - Integra la descripción y contexto aportado por el entrevistado dentro de la prosa narrativa.

4. ESTILO Y EXTENSIÓN:
   - Desarrolla una prosa fluida, cálida, digna y emotiva en español, que honre la voz real del entrevistado sin mutilar sus vivencias.`;

  try {
    const rawJsonText = await generateJsonWithFallback({
      prompt,
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
    const enrichedMarkdown = ensurePhotosPlacedInManuscript({
      compiledMarkdown: parsed.compiledMarkdown || '',
      answers,
      questions,
    });

    return {
      ...parsed,
      compiledMarkdown: enrichedMarkdown,
      generatedAt: new Date().toISOString(),
    };
  } catch (_error) {
    const stageTitles: Record<string, string> = {
      infancia: 'Capítulo: Infancia y Raíces Familiares',
      juventud: 'Capítulo: Juventud y Vocación',
      adultez: 'Capítulo: Adultez, Familia e Hijos',
      madurez: 'Capítulo: Madurez y Aprendizajes',
      legado_general: 'Capítulo: Legado, Valores e Información Adicional',
    };

    const markdownLines: string[] = [
      `# ${interview.title}`,
      `*Manuscrito de YouForever - Compilación Fidedigna*`,
      `\n## Introducción y Participantes\n`,
      ...participants.map((p) => `- **${p.name}** (${p.relationship})`),
    ];

    const stagesOrder = ['infancia', 'juventud', 'adultez', 'madurez', 'legado_general'];
    for (const stageKey of stagesOrder) {
      const entriesForStage = structuredEntries.filter((e) => e.etapa === stageKey);
      if (entriesForStage.length === 0) continue;

      markdownLines.push(`\n## ${stageTitles[stageKey] || stageKey}\n`);
      for (const item of entriesForStage) {
        if (item.texto !== '[No recordado]' || item.fotografias.length > 0) {
          markdownLines.push(`### ${item.pregunta}`);
          markdownLines.push(`*Aportado por ${item.autor} (${item.etapa} - ${item.tema})*:\n`);
          if (item.texto && item.texto !== '[No recordado]') {
            markdownLines.push(`> "${item.texto}"\n`);
          }
          for (const foto of item.fotografias) {
            markdownLines.push(
              formatPhotoMarkdownBlock({
                id: foto.id,
                interviewId: interview.id,
                questionId: '',
                questionText: item.pregunta,
                lifeStage: foto.etapa,
                topic: item.tema,
                participantId: '',
                participantName: foto.autor,
                fileName: '',
                mimeType: 'image/jpeg',
                caption: foto.descripcionContexto,
                imageUrl: foto.url,
                createdAt: new Date().toISOString(),
              })
            );
          }
        }
      }
    }

    const fallbackMd = ensurePhotosPlacedInManuscript({
      compiledMarkdown: markdownLines.join('\n'),
      answers,
      questions,
    });

    return {
      title: interview.title,
      summary: `Compilación fidedigna de los testimonios y fotografías aportados por ${participants.map((p) => p.name).join(', ')}.`,
      chapters: [
        {
          title: 'Compilación Testimonial',
          lifeStage: 'general',
          content: fallbackMd,
          participantAttributions: participants.map((p) => p.name),
        },
      ],
      compiledMarkdown: fallbackMd,
      generatedAt: new Date().toISOString(),
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

/**
 * Generates an editorial book manuscript (`DemoManuscript`) and chapter photo map from a participant's
 * completed interview answers in the selected narrative style (A, B, or C).
 *
 * Supports two scopes:
 * - `'preview'`: Fast redaction of only the leading paragraphs needed for the 5-page sample preview in Layout Studio.
 * - `'full'`: Complete redaction of the entire life story when saving the PDF version, preserving verbatim the paragraphs
 *   already displayed on Pages 3..5 of the 5-page preview (`lockedPreviewGroups` / `lockedPreviewManuscript`) and ensuring
 *   100% of main answers, deepening follow-ups, and additional memories are included without summarizing or omitting any.
 */
export async function generateParticipantBookManuscriptWithAI(params: {
  interview: InterviewRecord;
  participants: ParticipantRecord[];
  answers: AnswerRecord[];
  questions: QuestionRecord[];
  narrativeStyle?: DemoNarrativeStyleId;
  closingDedicationText?: string;
  scope?: 'preview' | 'full';
  lockedPreviewManuscript?: DemoManuscript | null;
  lockedPreviewGroups?: ComposedChapterSectionBlock[][] | null;
}): Promise<{
  manuscript: DemoManuscript;
  chapterPhotos: Record<string, DemoInMemoryPhoto | null>;
  scope: 'preview' | 'full';
}> {
  const {
    interview,
    participants,
    answers,
    questions,
    narrativeStyle = 'first_person_literary',
    closingDedicationText = '',
    scope = 'full',
    lockedPreviewManuscript = null,
    lockedPreviewGroups = null,
  } = params;

  const participantNames = participants.map((p) => p.name);
  const fallbackResult = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: interview.title,
    storyMode: interview.storyMode,
    participantNames,
    answers,
    questions,
    narrativeStyle,
    closingDedicationText,
  });

  const validAnswers = answers.filter(
    (a) => !a.notRecalled && extractCleanParticipantAnswerText(a).length > 0
  );
  if (validAnswers.length === 0) {
    return { ...fallbackResult, scope };
  }

  const styleSpec =
    DEMO_NARRATIVE_STYLES.find((s) => s.id === narrativeStyle) || DEMO_NARRATIVE_STYLES[1];
  const isCouple = interview.storyMode === 'compartida' && participantNames.length >= 2;
  const styleTitle = isCouple ? styleSpec.coupleTitle : styleSpec.individualTitle;
  const styleDesc = isCouple ? styleSpec.coupleDescription : styleSpec.individualDescription;

  // Determine how many leading paragraphs per chapter are locked from the 5-page preview when generating the full book
  const effectiveLockedGroups =
    scope === 'full'
      ? lockedPreviewGroups || lockedPreviewManuscript?.lockedPreviewGroups || null
      : null;

  const lockedParasByChapter = new Map<string, string[]>();
  if (effectiveLockedGroups && effectiveLockedGroups.length > 0) {
    for (const group of effectiveLockedGroups) {
      for (const sec of group) {
        const prev = lockedParasByChapter.get(sec.chapterId) || [];
        lockedParasByChapter.set(sec.chapterId, [...prev, ...(sec.paragraphs || [])]);
      }
    }
  }

  // Build the chapters and paragraphs to send to AI according to `scope`
  const MAX_PREVIEW_PARAGRAPHS = 6;
  let previewBudgetRemaining = MAX_PREVIEW_PARAGRAPHS;

  const chaptersToRedact: Array<{
    id: string;
    partNumber: number;
    dimensionKey: string;
    title: string;
    rawTestimonies: string[];
    unidadesConContextoDePregunta?: StructuredChapterTestimonyUnit[];
  }> = [];

  for (const ch of fallbackResult.manuscript.chapters) {
    const chUnits = fallbackResult.chapterStructuredUnits?.[ch.id] || [];
    if (scope === 'preview') {
      if (previewBudgetRemaining <= 0) break;
      const sliceParas = ch.paragraphs.slice(0, previewBudgetRemaining);
      const sliceUnits = chUnits.slice(0, sliceParas.length);
      previewBudgetRemaining -= sliceParas.length;
      if (sliceParas.length > 0) {
        chaptersToRedact.push({
          id: ch.id,
          partNumber: ch.partNumber,
          dimensionKey: ch.dimensionKey,
          title: ch.title,
          rawTestimonies: sliceParas,
          unidadesConContextoDePregunta: sliceUnits,
        });
      }
    } else {
      const lockedCount = (lockedParasByChapter.get(ch.id) || []).length;
      const remainingParas = ch.paragraphs.slice(lockedCount);
      const remainingUnits = chUnits.slice(lockedCount);
      if (remainingParas.length > 0) {
        chaptersToRedact.push({
          id: ch.id,
          partNumber: ch.partNumber,
          dimensionKey: ch.dimensionKey,
          title: ch.title,
          rawTestimonies: remainingParas,
          unidadesConContextoDePregunta: remainingUnits,
        });
      }
    }
  }

  // If in 'full' mode all paragraphs were already redacted in the 5-page preview, return immediately preserving locked preview
  if (chaptersToRedact.length === 0 && lockedPreviewManuscript) {
    return {
      manuscript: sanitizeAndRepairBookManuscript({
        ...fallbackResult.manuscript,
        title: lockedPreviewManuscript.title || fallbackResult.manuscript.title,
        subtitle: lockedPreviewManuscript.subtitle || fallbackResult.manuscript.subtitle,
        introduction: lockedPreviewManuscript.introduction || fallbackResult.manuscript.introduction,
        chapters: fallbackResult.manuscript.chapters.map((origCh) => {
          const lockedParas = lockedParasByChapter.get(origCh.id);
          const previewCh = lockedPreviewManuscript.chapters.find((c) => c.id === origCh.id);
          if (lockedParas && lockedParas.length > 0) {
            return {
              ...origCh,
              title: previewCh?.title || origCh.title,
              pullQuote: previewCh?.pullQuote || origCh.pullQuote,
              paragraphs: [
                ...lockedParas,
                ...origCh.paragraphs.slice(lockedParas.length),
              ],
            };
          }
          return previewCh || origCh;
        }),
        lockedPreviewGroups: effectiveLockedGroups || undefined,
        generatedAt: new Date().toISOString(),
      }),
      chapterPhotos: fallbackResult.chapterPhotos,
      scope,
    };
  }

  const specificStyleRules =
    narrativeStyle === 'first_person_simple'
      ? `REGLA ESPECÍFICA DEL ESTILO A (Primera persona — Relato personal formal y estructurado):
- Redacta en primera persona (${isCouple ? '"nosotros" o identificando la voz de cada integrante' : '"yo"'}), pero REESCRIBE las frases con un lenguaje más formal, claro, ordenado y bien estructurado.
- Usa el contexto de "preguntaPrincipal" y "profundizaciones" en "unidadesConContextoDePregunta" para dar coherencia y sentido completo a cada oración sin jamás usar frases robóticas o muletillas introductorias fijas ("En lo que respecta a esta etapa de mi vida...", "Asimismo, cabe señalar en torno a esta vivencia que...").
- Corrige TODAS las faltas de ortografía, tildes omitidas, errores gramaticales, discordancias y puntuación defectuosa.
- Elimina por completo muletillas orales ("este...", "eh", "pues", "o sea", "bueno", "digamos", "como te decía") y suprime repeticiones innecesarias de palabras o ideas.`
      : narrativeStyle === 'third_person_biography'
      ? `REGLA ESPECÍFICA DEL ESTILO C (Tercera persona — Biografía narrativa completa):
- CONVIERTE EL 100% DEL RELATO A TERCERA PERSONA en todas las oraciones (incluyendo respuestas principales y respuestas de profundización).
- PROHIBIDO dejar verbos, pronombres o posesivos en primera persona ("yo", "me", "mi", "mis", "nosotros", "nos", "nuestro", "nací", "recuerdo", "viví", "fui", "estudié", "trabajé", "siento"). Todo debe narrarse desde un biógrafo cálido hablando sobre ${fallbackResult.manuscript.authors} ("nació", "recuerda", "vivió", "su infancia", "sus padres", etc.).
- Usa sujeto tácito en oraciones consecutivas para no repetir el nombre de ${fallbackResult.manuscript.authors} de forma artificial en cada frase, y jamás uses frases robóticas fijas como "En consonancia con este recuerdo, X refiere que...".
- Corrige TODAS las faltas de ortografía, tildes, gramática, muletillas orales y repeticiones innecesarias.`
      : `REGLA ESPECÍFICA DEL ESTILO B (Primera persona — Narrativa literaria y emotiva):
- Redacta en primera persona (${isCouple ? '"nosotros"' : '"yo"'}) con una prosa literaria, cálida, emotiva y envolvente, como un libro de memorias cuidadosamente editado.
- Usa el contexto de cada pregunta ("unidadesConContextoDePregunta") para que las respuestas breves o directas fluyan como prosa autobiográfica natural, sin anteponer frases fijas repetitivas.
- Corrige TODAS las faltas de ortografía, tildes, gramática, muletillas orales y repeticiones innecesarias, elevando la fluidez literaria de cada párrafo.`;

  const prompt = `Eres un escritor biográfico, corrector de estilo y editor literario senior de YouForever.
Debes redactar y revisar integralmente los capítulos del libro autobiográfico a partir EXCLUSIVAMENTE de las respuestas reales del entrevistado y del contexto de las preguntas realizadas.

DATOS DE LA OBRA:
- Título base: "${interview.title}"
- Modalidad: ${isCouple ? 'Historia compartida / pareja' : 'Historia individual'}
- Protagonista(s): ${fallbackResult.manuscript.authors}
- Estilo narrativo elegido: ${styleTitle}
  * Descripción del estilo: ${styleDesc}
  * Ejemplo del tono esperado: "${isCouple ? styleSpec.coupleExample : styleSpec.individualExample}"

${specificStyleRules}

TESTIMONIOS Y CONTEXTO DE PREGUNTAS POR CAPÍTULO:
${JSON.stringify(chaptersToRedact, null, 2)}

AUDITORÍA OBLIGATORIA DE ORTOGRAFÍA, GRAMÁTICA, CONGRUENCIA LÓGICA Y FIDELIDAD (100% DE LOS HECHOS):
1. FIDELIDAD 100% A LOS HECHOS REALES: Respeta el 100% de los hechos, nombres, apodos, lugares, fechas y vivencias reales del entrevistado. NUNCA inventes datos ni episodios no mencionados.
2. INTEGRACIÓN CON EL CONTEXTO DE LA PREGUNTA SIN FRASES ROBÓTICAS: Analiza "preguntaPrincipal", "respuestaPrincipal" y "profundizaciones" en cada unidad. Si el entrevistado respondió de forma breve o elíptica (ej. "En Guadalajara", "Sí, con mis abuelos", "Ingeniería civil"), utiliza el contexto de la pregunta para construir una oración completa, natural y congruente (ej. "Nací en Guadalajara...", "Crecí junto a mis abuelos..."). PROHIBIDO usar plantillas robóticas repetitivas.
3. REVISIÓN INTEGRAL DE ORTOGRAFÍA, GRAMÁTICA Y CONGRUENCIA LÓGICA:
   - Verifica que cada oración tenga sentido lógico completo, sintaxis impecable y concordancia de género, número y tiempo verbal.
   - Corrige todas las faltas ortográficas (uso de b/v, c/s/z, g/j, h, ll/y), tildes (agudas, graves, esdrújulas, hiatos como "tenía/vivía/había", pretéritos como "nací/nació/viví/vivió/estudié/estudió" y tildes diacríticas como "más/tú/él/mí/sí/sé/qué/cómo/dónde/cuándo") y signos de puntuación.
   - Verifica que no falten preposiciones necesarias ("a", "de", "en", "con", "por", "para") ni queden palabras truncas o incongruentes.
4. PROHIBIDO RESUMIR U OMITIR RESPUESTAS: Debes devolver EXACTAMENTE la misma cantidad de párrafos en "paragraphs" que elementos hay en "rawTestimonies" (relación 1 a 1), integrando cada respuesta principal con sus profundizaciones sin omitir ningún recuerdo.
5. Conserva exactamente el mismo "id", "partNumber" y "dimensionKey" de cada capítulo de entrada.
6. Incluye una frase destacada breve, emotiva y gramaticalmente impecable en "pullQuote" (máximo 150 caracteres, acorde al estilo elegido) para cada capítulo.`;

  try {
    const rawJson = await generateJsonWithFallback({
      prompt,
      timeoutMsPerModel: scope === 'preview' ? 12000 : 18000,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          subtitle: { type: Type.STRING },
          introduction: { type: Type.STRING },
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
              },
              required: ['id', 'partNumber', 'dimensionKey', 'title', 'paragraphs'],
            },
          },
        },
        required: ['title', 'subtitle', 'introduction', 'chapters'],
      },
    });

    const parsed = rawJson
      ? safeJsonExtract<{
          title?: string;
          subtitle?: string;
          introduction?: string;
          chapters?: Array<{
            id: string;
            partNumber: number;
            dimensionKey: any;
            title: string;
            paragraphs: string[];
            pullQuote?: string;
          }>;
        } | null>(rawJson, null)
      : null;

    const mergedChapters = fallbackResult.manuscript.chapters.map((origCh) => {
      const targetReq = chaptersToRedact.find((c) => c.id === origCh.id);
      const aiCh = parsed?.chapters?.find((c) => c.id === origCh.id);
      const cleanAiParas = Array.isArray(aiCh?.paragraphs)
        ? aiCh!.paragraphs
            .map((p) =>
              ensureParagraphConformsToStyle(
                p.trim(),
                narrativeStyle,
                fallbackResult.manuscript.authors,
                isCouple
              )
            )
            .filter((p) => p.length > 0)
        : [];

      if (scope === 'preview') {
        if (!targetReq) {
          return origCh;
        }
        const previewCount = targetReq.rawTestimonies.length;
        // Ensure every single testimony in the preview slice is preserved (if AI returned fewer, fill remaining from origCh)
        const ensuredPreviewParas =
          cleanAiParas.length >= previewCount
            ? cleanAiParas
            : [
                ...cleanAiParas,
                ...origCh.paragraphs.slice(cleanAiParas.length, previewCount),
              ];
        const rawPullQuote = (aiCh?.pullQuote || origCh.pullQuote || '').trim();
        const styledPullQuote = rawPullQuote
          ? ensureParagraphConformsToStyle(
              rawPullQuote,
              narrativeStyle,
              fallbackResult.manuscript.authors,
              isCouple
            )
          : undefined;
        return {
          ...origCh,
          title: cleanSpanishOralText(aiCh?.title || origCh.title) || origCh.title,
          paragraphs: [
            ...ensuredPreviewParas,
            ...origCh.paragraphs.slice(previewCount),
          ],
          pullQuote: styledPullQuote,
        };
      }

      // scope === 'full': preserve locked preview paragraphs verbatim at the start of the chapter,
      // and append AI-redacted remaining paragraphs (with 100% fallback guarantee for any missing items)
      const lockedParas = lockedParasByChapter.get(origCh.id) || [];
      const previewCh = lockedPreviewManuscript?.chapters.find((c) => c.id === origCh.id);
      const expectedRemaining = origCh.paragraphs.slice(lockedParas.length);

      const ensuredRemainingParas =
        cleanAiParas.length >= expectedRemaining.length
          ? cleanAiParas
          : [
              ...cleanAiParas,
              ...expectedRemaining.slice(cleanAiParas.length),
            ];

      const rawFullPullQuote = (
        previewCh?.pullQuote ||
        aiCh?.pullQuote ||
        origCh.pullQuote ||
        ''
      ).trim();

      return {
        ...origCh,
        title: (previewCh?.title || cleanSpanishOralText(aiCh?.title || '') || origCh.title).trim(),
        paragraphs: [...lockedParas, ...ensuredRemainingParas],
        pullQuote: rawFullPullQuote
          ? ensureParagraphConformsToStyle(
              rawFullPullQuote,
              narrativeStyle,
              fallbackResult.manuscript.authors,
              isCouple
            )
          : undefined,
      };
    });

    return {
      manuscript: {
        ...fallbackResult.manuscript,
        title: (
          lockedPreviewManuscript?.title ||
          cleanSpanishOralText(parsed?.title || '') ||
          fallbackResult.manuscript.title
        ).trim(),
        subtitle: (
          lockedPreviewManuscript?.subtitle ||
          cleanSpanishOralText(parsed?.subtitle || '') ||
          fallbackResult.manuscript.subtitle
        ).trim(),
        introduction: (
          lockedPreviewManuscript?.introduction ||
          (parsed?.introduction
            ? ensureParagraphConformsToStyle(
                parsed.introduction,
                narrativeStyle,
                fallbackResult.manuscript.authors,
                isCouple
              )
            : '') ||
          fallbackResult.manuscript.introduction
        ).trim(),
        chapters: mergedChapters,
        lockedPreviewGroups: effectiveLockedGroups || undefined,
        generatedAt: new Date().toISOString(),
      },
      chapterPhotos: fallbackResult.chapterPhotos,
      scope,
    };
  } catch (_err) {
    if (scope === 'full' && lockedPreviewManuscript) {
      const mergedFallbackChapters = fallbackResult.manuscript.chapters.map((origCh) => {
        const lockedParas = lockedParasByChapter.get(origCh.id) || [];
        const previewCh = lockedPreviewManuscript.chapters.find((c) => c.id === origCh.id);
        return {
          ...origCh,
          title: previewCh?.title || origCh.title,
          pullQuote: previewCh?.pullQuote || origCh.pullQuote,
          paragraphs: [
            ...lockedParas,
            ...origCh.paragraphs.slice(lockedParas.length),
          ],
        };
      });
      return {
        manuscript: {
          ...fallbackResult.manuscript,
          title: lockedPreviewManuscript.title || fallbackResult.manuscript.title,
          subtitle: lockedPreviewManuscript.subtitle || fallbackResult.manuscript.subtitle,
          introduction: lockedPreviewManuscript.introduction || fallbackResult.manuscript.introduction,
          chapters: mergedFallbackChapters,
          lockedPreviewGroups: effectiveLockedGroups || undefined,
          generatedAt: new Date().toISOString(),
        },
        chapterPhotos: fallbackResult.chapterPhotos,
        scope,
      };
    }
    return { ...fallbackResult, scope };
  }
}


