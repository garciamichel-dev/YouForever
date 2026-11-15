/**
 * V5.2 — Offline test doubles for the book engine.
 *
 * Nothing here calls Gemini or OpenAI. These doubles stand in for the AI providers so that the
 * REAL YouForever code (generation pipeline, hybrid audit, approval evidence, save, persistence and
 * PDF composition) can be exercised with valid, incomplete, contradictory, malformed and failing
 * provider responses. The judge decides per scenario from the content it receives; it never
 * approves blindly, so a test cannot pass by masking a real defect.
 */
import type { BookBatchCheckpointPayload, SemanticJudgeFunction, SemanticJudgmentCaseInput } from '../../../server/geminiService.ts';
import type { DemoManuscript } from '../../demoStoryRules.ts';

export const fold = (text: string): string =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// ---------------------------------------------------------------------------------------------
// Synthetic interviews
// ---------------------------------------------------------------------------------------------

export type SyntheticAnswerKind = 'base' | 'follow_up' | 'additional';

export interface SyntheticAnswerSpec {
  kind: SyntheticAnswerKind;
  /** Index of the questionnaire's base question this answer belongs to (base and follow-ups). */
  baseIndex: number;
  /** Question text for follow-ups and additional memories. */
  questionText?: string;
  text: string;
  photoCaption?: string;
}

const TOWNS = [
  'Mitla', 'Tlacolula', 'Etla', 'Zaachila', 'Ocotlán', 'Miahuatlán', 'Tehuacán', 'Cholula',
  'Huatulco', 'Tuxtepec', 'Juchitán', 'Tehuantepec', 'Pinotepa', 'Tlaxiaco', 'Nochixtlán',
  'Ixtlán', 'Guelatao', 'Teotitlán', 'Zimatlán', 'Ejutla', 'Sola', 'Putla', 'Jamiltepec',
  'Coixtlahuaca', 'Huajuapan', 'Tamazulápam', 'Yanhuitlán', 'Tilantongo', 'Achiutla', 'Peñoles',
];
const NAMES = [
  'Andrés', 'Beatriz', 'Cristóbal', 'Dolores', 'Ernesto', 'Felipa', 'Gonzalo', 'Hortensia',
  'Ignacio', 'Josefina', 'Leandro', 'Marcela', 'Norberto', 'Ofelia', 'Pascual', 'Quintina',
  'Rodolfo', 'Silvia', 'Teodoro', 'Úrsula', 'Valentín', 'Wenceslao', 'Ximena', 'Yolanda',
  'Zacarías', 'Abundio', 'Benita', 'Cirilo', 'Delfina', 'Eustaquio',
];
const RELATIVES = ['primo', 'tía', 'padrino', 'prima', 'tío', 'madrina', 'amigo', 'amiga', 'vecino', 'vecina'];
const DISHES = [
  'el chocolate de agua', 'el pan de yema', 'el quesillo fresco', 'la nieve de tuna', 'el mole negro',
  'el tejate frío', 'las memelas con asiento', 'los camotes dulces', 'el pescado a la talla',
  'el caldo de piedra', 'los totopos de horno', 'el guisado de res', 'el pozole de puerco',
  'el atole de granillo', 'las tortillas de trigo',
];

const pick = <T>(list: T[], idx: number): T => list[idx % list.length];

/** Varied base answer: short, long, negations with different subjects, uncertainty. */
function baseAnswerText(idx: number): string {
  const town = pick(TOWNS, idx);
  const name = pick(NAMES, idx);
  const rel = pick(RELATIVES, idx);
  const year = 1950 + idx * 2;
  switch (idx % 6) {
    case 0:
      return `Nací en ${town} en ${year}. Mi casa era de adobe y tenía un patio grande.`;
    case 1:
      return `Creo que fue en ${year}, aunque no lo recuerdo bien, cuando mi ${rel} ${name} me llevó a ${town}. No teníamos coche, así que caminamos desde temprano. Al llegar sentí una alegría enorme.`;
    case 2:
      return `Mi madre no quería que me fuera a ${town}, pero mi padre sí me dejó ir con ${name}. Ella lloró en la estación y él me dio su bendición.`;
    case 3:
      return `Trabajé en una panadería de ${town} con el dueño ${name}. Amasaba el pan desde la madrugada y aprendí el valor del esfuerzo.`;
    case 4:
      return `En ${year} conocí a ${name} en una fiesta de ${town}. Bailamos toda la noche en el salón municipal. Nunca olvidé aquella música.`;
    default:
      return `Quiero que mi familia recuerde a ${name} y nuestras tardes en ${town}. Les dejo mis cuadernos y mis fotografías con todo mi cariño.`;
  }
}

function followUpText(baseIdx: number, k: number): string {
  const town = pick(TOWNS, baseIdx * 3 + k + 7);
  const name = pick(NAMES, baseIdx * 5 + k + 3);
  const dish = pick(DISHES, baseIdx + k);
  const year = 1955 + ((baseIdx * 7 + k * 3) % 50);
  switch (k % 4) {
    case 0:
      return `En ${year} visité ${town} con ${name}. Allí probé ${dish} por primera vez.`;
    case 1:
      return `Sobre ese recuerdo agrego que ${name} cantaba durante el camino a ${town}.`;
    case 2:
      return `No recuerdo el día exacto, pero sé que fue en ${town} y que ${name} estaba conmigo.`;
    default:
      return `Ya lo conté antes: en ${town} ${name} me enseñó a preparar ${dish}.`;
  }
}

function additionalMemoryText(k: number): string {
  const town = pick(TOWNS, k + 11);
  const name = pick(NAMES, k + 17);
  const rel = pick(RELATIVES, k + 2);
  const year = 1960 + (k % 45);
  return k % 3 === 0
    ? `En ${year} mi ${rel} ${name} y yo plantamos un árbol en ${town}.`
    : k % 3 === 1
    ? `Mi ${rel} ${name} no sabía leer, pero contaba historias de ${town} cada noche.`
    : `Recuerdo que en ${town} ${name} arreglaba relojes y nunca cobraba a los vecinos.`;
}

/**
 * Builds the answers of a synthetic interview of the requested size over the 20 base questions
 * of the default questionnaire: base answers, deepening follow-ups and additional memories.
 */
export function buildSyntheticInterviewSpecs(
  size: 'small' | 'medium' | 'large',
  options: { withPhotos?: boolean; baseQuestionCount?: number; variantOffset?: number } = {}
): SyntheticAnswerSpec[] {
  // V5.3: a different offset yields a different life story (other names, places and years).
  const off = options.variantOffset || 0;
  const baseCount = Math.min(options.baseQuestionCount ?? 20, size === 'small' ? 8 : 20);
  const specs: SyntheticAnswerSpec[] = [];
  for (let i = 0; i < baseCount; i++) {
    specs.push({
      kind: 'base',
      baseIndex: i,
      text: baseAnswerText(i + off),
      ...(options.withPhotos && (i === 0 || i === 4)
        ? { photoCaption: i === 0 ? `Mi casa de adobe en ${pick(TOWNS, i + off)}` : `La fiesta en ${pick(TOWNS, i + off)}` }
        : {}),
    });
  }
  const followUpsPerBase = size === 'small' ? 0 : size === 'medium' ? 1 : 5;
  const followUpBases = size === 'medium' ? 14 : baseCount;
  for (let i = 0; i < followUpBases; i++) {
    for (let k = 0; k < followUpsPerBase; k++) {
      specs.push({
        kind: 'follow_up',
        baseIndex: i,
        questionText: `¿Qué más recuerdas de ese momento? (${k + 1})`,
        text: followUpText(i + off, k),
      });
    }
  }
  const additional = size === 'small' ? 0 : size === 'medium' ? 12 : 120;
  for (let k = 0; k < additional; k++) {
    specs.push({
      kind: 'additional',
      baseIndex: -1,
      questionText: 'Recuerdo adicional',
      text: additionalMemoryText(k + off),
    });
  }
  return specs;
}

export const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------------------------
// Simulated drafter
// ---------------------------------------------------------------------------------------------

/**
 * A faithful stand-in for the AI drafter: writes each planned chapter from a base redaction
 * (keeping its photo placements). `transform` lets a scenario alter specific chapters
 * (omissions, contradictions, paraphrases, invalid output).
 */
export function createFaithfulDrafter(
  base: DemoManuscript,
  transform?: (chapterId: string, paragraphs: string[]) => string[]
) {
  const calls: number[] = [];
  const draftBatch = async (ctx: { batchIdx: number; batchChapters: any[] }): Promise<BookBatchCheckpointPayload> => {
    calls.push(ctx.batchIdx);
    return {
      respondedModel: 'modelo-simulado',
      parsed: {
        title: base.title,
        subtitle: base.subtitle,
        introduction: base.introduction,
        closingMessage: base.closingMessage,
        chapters: ctx.batchChapters.map((seg: any) => {
          const ch = base.chapters.find((c) => c.id === seg.id);
          if (!ch) throw new Error(`Capítulo planificado desconocido: ${seg.id}`);
          const paragraphs = seg.segmentIndex === 1 ? ch.paragraphs : [];
          return {
            id: seg.id,
            partNumber: seg.partNumber,
            dimensionKey: seg.dimensionKey,
            title: ch.title,
            paragraphs: transform ? transform(seg.id, paragraphs) : paragraphs,
            ...(seg.segmentIndex === 1 && ch.photoPlacements ? { photoPlacements: ch.photoPlacements } : {}),
          };
        }),
      },
    };
  };
  return { draftBatch, calls };
}

// ---------------------------------------------------------------------------------------------
// Simulated semantic judge (scenario-driven, never blanket approval)
// ---------------------------------------------------------------------------------------------

export interface ScenarioJudgeOptions {
  /**
   * Meaning reversals the judge recognizes: when the testimony contains `source` and the
   * excerpt contains `reversed` (and not `source`), the verdict is "contradicted".
   */
  contradictions?: Array<{ source: RegExp; reversed: RegExp }>;
  /** Known faithful paraphrases: testimony pattern -> excerpt pattern that expresses it. */
  paraphrases?: Array<{ testimony: RegExp; excerpt: RegExp }>;
}

export interface ScenarioJudge {
  judge: SemanticJudgeFunction;
  calls: SemanticJudgmentCaseInput[][];
  judgedCases: () => SemanticJudgmentCaseInput[];
}

const FACT_VERBS_RX =
  /\b(me mude|abri|gane|compre|vendi|naci|murio|fallecio|me case|emigre|herede|fund[eé]|perdi|construi|me gradue)\b/;

/**
 * Deterministic stand-in for a careful semantic judge.
 * - testimony_fidelity: "contradicted" on a known reversal; "supported" only when the excerpt
 *   carries the memory's distinctive content (every detail to confirm present) or a known faithful
 *   paraphrase; otherwise "omitted".
 * - unsupported_addition: "omitted" when the sentence asserts a biographical fact (a year, a name
 *   absent from the testimonies, or a factual verb); "supported" for editorial bridges.
 */
export function createScenarioJudge(options: ScenarioJudgeOptions = {}): ScenarioJudge {
  const calls: SemanticJudgmentCaseInput[][] = [];
  const judge: SemanticJudgeFunction = async ({ cases }) => {
    calls.push(cases);
    return cases.map((c) => {
      const testimony = fold(c.originalTestimony);
      const excerpt = fold(c.candidateExcerpt);
      if (c.checkKind === 'unsupported_addition') {
        const sentenceRaw = c.sentenceToVerify || '';
        const sentence = fold(sentenceRaw);
        const hasYear = /\b(18|19|20)\d{2}\b/.test(sentence);
        const known = fold([c.originalTestimony, ...(c.protagonistNames || [])].join(' '));
        const words = sentenceRaw.split(/\s+/);
        const capitalized = words
          .filter((w, i) => i > 0 && !/[.!?]$/.test(words[i - 1]))
          .map((w) => w.replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ]+|[^A-Za-zÁÉÍÓÚÑáéíóúñ]+$/g, ''))
          .filter((w) => /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}$/.test(w))
          .map(fold);
        const unknownName = capitalized.some((w) => !known.includes(w));
        const factual = FACT_VERBS_RX.test(sentence);
        const invented = hasYear || unknownName || factual;
        return {
          unitId: c.unitId,
          verdict: invented ? ('omitted' as const) : ('supported' as const),
          rationale: invented ? 'Afirma un hecho biográfico que ningún testimonio respalda.' : 'Puente editorial sin hechos nuevos.',
        };
      }
      for (const pair of options.contradictions || []) {
        if (pair.source.test(testimony) && pair.reversed.test(excerpt) && !pair.source.test(excerpt)) {
          return { unitId: c.unitId, verdict: 'contradicted' as const, rationale: 'El fragmento invierte el sentido del testimonio.' };
        }
      }
      for (const pair of options.paraphrases || []) {
        if (pair.testimony.test(testimony) && pair.excerpt.test(excerpt)) {
          return { unitId: c.unitId, verdict: 'supported' as const, rationale: 'Paráfrasis fiel con otro vocabulario.' };
        }
      }
      const distinctive = Array.from(
        new Set(testimony.split(/[^a-z0-9]+/).filter((w) => w.length >= 5 || /^\d+$/.test(w)))
      );
      const hits = distinctive.filter((w) => excerpt.includes(w.slice(0, 5))).length;
      const detailsPresent = (c.detailsToConfirm || []).every((detail) => {
        const value = fold(detail.slice(detail.indexOf(':') + 1)).trim();
        return value.length === 0 || excerpt.includes(value.slice(0, 5));
      });
      // A careful reader also requires the ACTION of the memory, not just its nouns.
      const actions = c.originalTestimony
        .split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/)
        .filter((w) => w.length >= 5 && !/^[A-ZÁÉÍÓÚÑ]/.test(w) && /(ó|é|aba|aban|aron|ieron)$/.test(w))
        .map(fold);
      const actionsPresent = actions.every((verb) => excerpt.includes(verb.slice(0, 4)));
      const supported =
        detailsPresent && actionsPresent && (distinctive.length === 0 || hits / distinctive.length >= 0.6);
      return {
        unitId: c.unitId,
        verdict: supported ? ('supported' as const) : ('omitted' as const),
        rationale: supported ? 'Conserva el hecho.' : 'El fragmento no contiene este recuerdo.',
      };
    });
  };
  return { judge, calls, judgedCases: () => calls.flat() };
}

/** Judge that fails at the transport level (provider error). */
export const throwingJudge: SemanticJudgeFunction = async () => {
  throw new Error('Proveedor del juez no disponible (simulado)');
};

/** Judge that answers, but with an empty verdict list (no unit judged). */
export const silentJudge: SemanticJudgeFunction = async () => [];

// ---------------------------------------------------------------------------------------------
// Compilado Testimonial Fidedigno (stand-in for Mi Esencia, which talks to Firestore)
// ---------------------------------------------------------------------------------------------

export function buildSyntheticCompilationPdf(interviewId: string, rawText: string) {
  const body = `%PDF-1.4\n% Compilado Testimonial Fidedigno (simulado para pruebas)\n${'0'.repeat(200)}\n%%EOF`;
  return {
    pdfId: `comp_pdf_int_${interviewId}`,
    avatarId: 'interview_compilation',
    sourceInterviewId: interviewId,
    fileName: `compilado_${interviewId}.pdf`,
    origin: 'auto_generated_from_interview' as const,
    sha256Hash: 'simulado',
    totalQuestions: 0,
    totalLiteralAnswers: 0,
    totalAudiosTranscribed: 0,
    totalPhotosReferenced: 0,
    rawTextContent: rawText || 'Testimonios',
    pdfBase64: Buffer.from(body, 'utf8').toString('base64'),
    createdAt: new Date().toISOString(),
    createdBy: 'pruebas_automatizadas',
  };
}
