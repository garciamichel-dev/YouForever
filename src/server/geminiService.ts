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

const ai = new GoogleGenAI();
export const TEXT_MODEL = 'gemini-3.1-flash-lite';

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
      console.warn(`[Gemini Timeout] Operation exceeded ${ms}ms limit, using fallback.`);
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
El entrevistado acaba de responder a la siguiente pregunta del cuestionario:
- Pregunta original: "${currentQuestion.text}" (Etapa: ${currentQuestion.lifeStage}, Tema: ${currentQuestion.topic}, Flujo: ${currentQuestion.flowId || 'principal'})
- Respuesta del entrevistado: "${trimmed}"
${previousFollowUps.length > 0 ? `- Preguntas de profundización ya realizadas en este turno: ${JSON.stringify(previousFollowUps)}` : ''}

Tu tarea:
Genera de forma autónoma UNA pregunta de profundización que permita explorar un aspecto relevante que el entrevistado haya mencionado (una persona, un lugar, una emoción, una enseñanza, un detalle sensorial o una vivencia que merezca ampliarse).
REGLAS:
1. Si el entrevistado dio una respuesta válida con personas, lugares, vivencias, hijos, logros o emociones (o si dio una respuesta breve que conviene desglosar), establece "suggested": true y formula "questionText" y "reason".
2. En "reason", explica brevemente en una frase qué aspecto relevante detectaste en su respuesta (ej. "Mencionaste el patio de naranjos en Quiroga y a tus padres; vale la pena profundizar en las vivencias cotidianas de ese lugar").
3. En "questionText", redacta la pregunta de profundización en español cálido, cercano y directo al entrevistado. No repitas preguntas anteriores.`;

  try {
    const fallbackFn = () =>
      buildAutonomousDeepeningFallback({
        currentQuestion,
        currentAnswerText: trimmed,
        currentFollowUpCount,
        previousFollowUps,
      });

    const callPromise = ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggested: { type: Type.BOOLEAN },
            questionText: { type: Type.STRING },
            reason: { type: Type.STRING },
          },
          required: ['suggested', 'questionText', 'reason'],
        },
      },
    });

    const response = await withTimeout(callPromise, 3500, () => null);
    if (!response || !response.text) {
      return fallbackFn();
    }

    const parsed = safeJsonExtract<AdaptiveQuestionResult>(response.text, {
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
  } catch (error) {
    console.warn('Using autonomous context analyzer for deepening question:', error instanceof Error ? error.message : error);
    return buildAutonomousDeepeningFallback({
      currentQuestion,
      currentAnswerText: trimmed,
      currentFollowUpCount,
      previousFollowUps,
    });
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
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
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
      },
    });

    const parsed = safeJsonExtract<ManuscriptDraftResult>(response.text, {
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
  } catch (error) {
    console.error('Error generating manuscript via Gemini:', error);
    const stageTitles: Record<string, string> = {
      infancia: 'Capítulo: Infancia y Raíces Familiares',
      juventud: 'Capítulo: Juventud y Vocación',
      adultez: 'Capítulo: Adultez, Familia e Hijos',
      madurez: 'Capítulo: Madurez y Aprendizajes',
      legado_general: 'Capítulo: Legado, Valores e Información Adicional',
    };

    const markdownLines: string[] = [
      `# ${interview.title}`,
      `*Manuscrito de Legado Digital - Compilación Fidedigna*`,
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

/**
 * Transcribes user voice recording with Gemini Multimodal Audio model.
 * Returns faithful Spanish transcription with proper punctuation and accents.
 */
export async function transcribeAudioWithGemini(params: {
  audioBase64: string;
  mimeType?: string;
  questionContext?: string;
  participantName?: string;
}): Promise<string> {
  const { audioBase64, mimeType = 'audio/webm', questionContext, participantName } = params;

  try {
    let cleanBase64 = audioBase64;
    if (cleanBase64.startsWith('data:')) {
      const commaIdx = cleanBase64.indexOf(',');
      if (commaIdx !== -1) {
        cleanBase64 = cleanBase64.substring(commaIdx + 1);
      }
    }
    cleanBase64 = cleanBase64.replace(/\s+/g, '');

    // Clean mimeType string (e.g. "audio/webm;codecs=opus" -> "audio/webm")
    let normalizedMime = mimeType || 'audio/webm';
    if (normalizedMime.includes(';')) {
      normalizedMime = normalizedMime.split(';')[0].trim();
    }

    const transcribePrompt = `Eres un asistente especializado en transcripción fidedigna e íntegra de archivos de voz para historias de vida y legados biográficos en español.
El audio fue grabado por el entrevistado "${participantName || 'Participante'}" en respuesta a: "${questionContext || 'Pregunta sobre su historia de vida y recuerdos'}".

Instrucciones de transcripción obligatorias:
1. Transcribe la totalidad de lo que el entrevistado expresa en el audio de principio a fin, sin resumir, sin omitir tramos y sin truncar el contenido, incluso en grabaciones largas de 5 minutos o más.
2. Emplea ortografía, acentuación y puntuación natural y adecuada en español (puntos, comas, signos de interrogación o exclamación).
3. Devuelve ÚNICAMENTE el texto transcrito.
4. No agregues introducciones, prefacios, explicaciones, timestamps ni etiquetas como "Transcripción:".
5. Si no se escucha voz perceptible o solo hay silencio/ruido ininteligible, responde con una cadena vacía.`;

    // Audio transcription timeout: 180 seconds (3 minutes) to comfortably handle long 5-10 minute recordings
    const AUDIO_TIMEOUT_MS = 180000;

    let rawText = '';
    // 1. Primary dedicated transcription model: gemini-3.5-transcribe
    try {
      const callPromise = ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: [
          {
            inlineData: {
              mimeType: normalizedMime,
              data: cleanBase64,
            },
          },
          {
            text: transcribePrompt,
          },
        ],
      });

      const response = await withTimeout(callPromise, AUDIO_TIMEOUT_MS, () => null);
      if (response && response.text) {
        rawText = response.text.trim();
      }
    } catch (primaryErr) {
      console.warn('gemini-3.5-transcribe error, trying fallback to gemini-3.8-flash:', primaryErr);
    }

    // 2. Fallback model: gemini-3.8-flash
    if (!rawText) {
      try {
        const fallbackCall = ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [
            {
              inlineData: {
                mimeType: normalizedMime,
                data: cleanBase64,
              },
            },
            {
              text: transcribePrompt,
            },
          ],
        });
        const fallbackRes = await withTimeout(fallbackCall, AUDIO_TIMEOUT_MS, () => null);
        if (fallbackRes && fallbackRes.text) {
          rawText = fallbackRes.text.trim();
        }
      } catch (fbErr) {
        console.warn('Fallback gemini-3.8-flash error, trying gemini-flash-latest:', fbErr);
      }
    }

    // 3. Fallback model: gemini-flash-latest
    if (!rawText) {
      try {
        const fallback2Call = ai.models.generateContent({
          model: 'gemini-flash-latest',
          contents: [
            {
              inlineData: {
                mimeType: normalizedMime,
                data: cleanBase64,
              },
            },
            {
              text: transcribePrompt,
            },
          ],
        });
        const fallback2Res = await withTimeout(fallback2Call, AUDIO_TIMEOUT_MS, () => null);
        if (fallback2Res && fallback2Res.text) {
          rawText = fallback2Res.text.trim();
        }
      } catch (fb2Err) {
        console.warn('Fallback gemini-flash-latest error:', fb2Err);
      }
    }

    if (!rawText) {
      return '';
    }

    // Strip any accidental markdown formatting or prefixes like "Transcripción:"
    const cleaned = rawText
      .replace(/^[\*\#\s]*transcripci[oó]n[\:\s\-]*/i, '')
      .replace(/^\"+|\"+$/g, '')
      .trim();

    return cleaned;
  } catch (err) {
    console.warn('Gemini audio transcription error:', err);
    return '';
  }
}

