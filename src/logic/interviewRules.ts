import crypto from 'node:crypto';

export type LiteraryPromptStyleId =
  | 'first_person_simple'
  | 'first_person_literary'
  | 'third_person_biography';

export type BookAiProvider = 'gemini' | 'openai';

export type BookStructureMode = 'prompt_autonomous' | 'fixed_five_stages';

export interface LiteraryPromptVersion {
  id: string;
  name: string;
  styleId: LiteraryPromptStyleId;
  createdForStyleId?: LiteraryPromptStyleId;
  promptText: string;
  createdAt: string;
  updatedAt?: string;
  createdBy: string;
}

export interface LiteraryStylePromptConfig {
  styleId: LiteraryPromptStyleId;
  styleLabel: string;
  activeVersionId: string;
  promptText: string;
  updatedAt: string;
  updatedBy: string;
}

export interface AppConfig {
  defaultOpenDays: number;
  defaultSufficiencyThreshold: number;
  defaultMaxFollowUps: number;
  allowAnswerEditing: boolean;
  allowAdditionalMemories: boolean;
  bookAiProvider?: BookAiProvider;
  bookAiGeminiModel?: string;
  bookAiOpenAiModel?: string;
  bookStructureMode?: BookStructureMode;
  literaryPrompts?: Record<LiteraryPromptStyleId, LiteraryStylePromptConfig>;
  literaryPromptVersions?: LiteraryPromptVersion[];
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_LITERARY_PROMPTS_TEXT: Record<LiteraryPromptStyleId, string> = {
  first_person_simple: `REGLA ESPECÍFICA DEL ESTILO A (Primera persona — Relato personal formal y estructurado):
- Redacta en primera persona ("yo" en historia individual, o "nosotros" identificando la voz de cada integrante en historia compartida), pero REESCRIBE las frases con un lenguaje más formal, claro, ordenado y bien estructurado.
- Usa el contexto íntegro del Compilado Testimonial Fidedigno (preguntas, respuestas originales, transcripciones de voz, información adicional y fotografías con sus descripciones) para dar coherencia y sentido completo a cada oración sin jamás usar frases robóticas o muletillas introductorias fijas ("En lo que respecta a esta etapa de mi vida...", "Asimismo, cabe señalar en torno a esta vivencia que...").
- Corrige TODAS las faltas de ortografía, tildes omitidas, errores gramaticales, discordancias y puntuación defectuosa.
- Elimina por completo muletillas orales ("este...", "eh", "pues", "o sea", "bueno", "digamos", "como te decía") y suprime repeticiones innecesarias de palabras o ideas.
- Respeta el 100% de los hechos reales, nombres, fechas, lugares y vivencias del Compilado Testimonial Fidedigno sin inventar ni omitir ningún testimonio.`,
  first_person_literary: `REGLA ESPECÍFICA DEL ESTILO B (Primera persona — Narrativa literaria y emotiva):
- Redacta en primera persona ("yo" en historia individual, o "nosotros" en historia compartida) con una prosa literaria, cálida, emotiva y envolvente, como un libro de memorias cuidadosamente editado.
- Usa el contexto íntegro del Compilado Testimonial Fidedigno (preguntas, respuestas originales, transcripciones de voz, información adicional y fotografías con sus descripciones) para que las respuestas breves o directas fluyan como prosa autobiográfica natural, sin anteponer frases fijas repetitivas.
- Corrige TODAS las faltas de ortografía, tildes, gramática, muletillas orales y repeticiones innecesarias, elevando la fluidez literaria de cada párrafo.
- Respeta el 100% de los hechos reales, nombres, fechas, lugares y vivencias del Compilado Testimonial Fidedigno sin inventar ni omitir ningún testimonio.`,
  third_person_biography: `REGLA ESPECÍFICA DEL ESTILO C (Tercera persona — Biografía narrativa completa):
- CONVIERTE EL 100% DEL RELATO A TERCERA PERSONA en todas las oraciones (incluyendo respuestas principales, profundizaciones e información adicional).
- PROHIBIDO dejar verbos, pronombres o posesivos en primera persona ("yo", "me", "mi", "mis", "nosotros", "nos", "nuestro", "nací", "recuerdo", "viví", "fui", "estudié", "trabajé", "siento"). Todo debe narrarse desde un biógrafo cálido hablando sobre el/los protagonista(s) ("nació", "recuerda", "vivió", "su infancia", "sus padres", etc.).
- Usa sujeto tácito en oraciones consecutivas para no repetir el nombre del protagonista de forma artificial en cada frase, y jamás uses frases robóticas fijas como "En consonancia con este recuerdo, X refiere que...".
- Corrige TODAS las faltas de ortografía, tildes, gramática, muletillas orales y repeticiones innecesarias.
- Respeta el 100% de los hechos reales, nombres, fechas, lugares y vivencias del Compilado Testimonial Fidedigno sin inventar ni omitir ningún testimonio.`,
};

export const DEFAULT_LITERARY_PROMPT_VERSIONS: LiteraryPromptVersion[] = [
  {
    id: 'ver_style_a_default',
    name: 'Versión Base Oficial — Estilo A (1ª Persona Formal y Estructurado)',
    styleId: 'first_person_simple',
    promptText: DEFAULT_LITERARY_PROMPTS_TEXT.first_person_simple,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'system',
  },
  {
    id: 'ver_style_b_default',
    name: 'Versión Base Oficial — Estilo B (1ª Persona Literaria y Emotiva)',
    styleId: 'first_person_literary',
    promptText: DEFAULT_LITERARY_PROMPTS_TEXT.first_person_literary,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'system',
  },
  {
    id: 'ver_style_c_default',
    name: 'Versión Base Oficial — Estilo C (3ª Persona Biografía Narrativa)',
    styleId: 'third_person_biography',
    promptText: DEFAULT_LITERARY_PROMPTS_TEXT.third_person_biography,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'system',
  },
];

export const DEFAULT_LITERARY_PROMPTS_CONFIG: Record<
  LiteraryPromptStyleId,
  LiteraryStylePromptConfig
> = {
  first_person_simple: {
    styleId: 'first_person_simple',
    styleLabel: 'Opción A — Primera persona (Relato personal y sencillo)',
    activeVersionId: 'ver_style_a_default',
    promptText: DEFAULT_LITERARY_PROMPTS_TEXT.first_person_simple,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'system',
  },
  first_person_literary: {
    styleId: 'first_person_literary',
    styleLabel: 'Opción B — Primera persona (Narrativa literaria y emotiva)',
    activeVersionId: 'ver_style_b_default',
    promptText: DEFAULT_LITERARY_PROMPTS_TEXT.first_person_literary,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'system',
  },
  third_person_biography: {
    styleId: 'third_person_biography',
    styleLabel: 'Opción C — Tercera persona (Biografía narrativa)',
    activeVersionId: 'ver_style_c_default',
    promptText: DEFAULT_LITERARY_PROMPTS_TEXT.third_person_biography,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'system',
  },
};

export const INITIAL_APP_CONFIG: AppConfig = {
  defaultOpenDays: 15,
  defaultSufficiencyThreshold: 100,
  defaultMaxFollowUps: 2,
  allowAnswerEditing: true,
  allowAdditionalMemories: true,
  bookAiProvider: 'gemini',
  bookAiGeminiModel: 'gemini-3-flash-preview',
  bookAiOpenAiModel: 'gpt-6-luna',
  bookStructureMode: 'prompt_autonomous',
  literaryPrompts: {
    first_person_simple: { ...DEFAULT_LITERARY_PROMPTS_CONFIG.first_person_simple },
    first_person_literary: { ...DEFAULT_LITERARY_PROMPTS_CONFIG.first_person_literary },
    third_person_biography: { ...DEFAULT_LITERARY_PROMPTS_CONFIG.third_person_biography },
  },
  literaryPromptVersions: DEFAULT_LITERARY_PROMPT_VERSIONS.map((v) => ({ ...v })),
};

export type StoryMode = 'individual' | 'compartida';
export type InterviewStatus = 'draft' | 'open' | 'ready_for_review' | 'completed' | 'expired' | 'archived';
export type SufficiencyStatus = 'not_evaluated' | 'insufficient' | 'sufficient' | 'sufficient_with_limitations';

export interface InterviewRecord {
  id: string;
  title: string;
  storyMode: StoryMode;
  storyType: string;
  status: InterviewStatus;
  openedAt: string; // ISO
  expiresAt: string; // ISO
  openDaysAtCreation: number;
  sufficiencyThreshold: number;
  maxFollowUpsAtCreation: number;
  completedQuestionCount: number;
  sufficiencyStatus: SufficiencyStatus;
  userDeclaredComplete: boolean;
  closedAt?: string | null;
  closureReason?: string | null;
  participantClosingText?: string | null;
  reopenedAt?: string | null;
  layoutEditsAllowed?: number;
  layoutEditsUsed?: number;
  bookGeneratedCount?: number;
  lastActivityAt: string;
  questionnaireVersionId: string;
  createdById?: string;
  createdByName?: string;
  // Admin-only duplication metadata (never exposed to participant endpoints)
  copiedFromInterviewId?: string;
  copiedFromName?: string;
  copiedAt?: string;
  adminCopyNote?: string;
  registrationSource?: 'admin' | 'self_register_free';
}

export interface ParticipantRecord {
  id: string;
  interviewId: string;
  name: string;
  relationship: string;
  role: 'primary' | 'contributor';
  status: 'invited' | 'active' | 'completed';
  email?: string;
  age?: number | null;
  city?: string;
  privacyAcceptedAt?: string;
  privacyVersion?: string;
  joinedAt?: string;
}

export interface InterviewTokenRecord {
  id: string;
  tokenHash: string;
  accessCode: string; // Short 6-char code e.g. "LEG-7294" for easy phone typing
  interviewId: string;
  participantId: string;
  expiresAt: string; // ISO
  revoked: boolean;
  createdAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

export interface AnswerPhotoAttachment {
  id: string;
  interviewId: string;
  questionId: string;
  questionText?: string;
  lifeStage?: string;
  topic?: string;
  participantId: string;
  participantName: string;
  fileName: string;
  mimeType: string;
  caption: string;
  imageUrl: string;
  createdAt: string;
}

export interface InterviewPhotoRecord extends AnswerPhotoAttachment {
  dataUrl: string;
}

export interface AnswerVoiceAttachment {
  id: string;
  interviewId: string;
  questionId: string;
  questionText?: string;
  participantId: string;
  participantName: string;
  audioUrl: string;
  audioDataUrl?: string;
  mimeType: string;
  transcription: string;
  durationSeconds?: number;
  createdAt: string;
}

export interface InterviewAudioRecord extends AnswerVoiceAttachment {
  audioDataUrl: string;
}

export interface IncomingAudioInput {
  id?: string;
  audioBase64?: string;
  audioUrl?: string;
  mimeType?: string;
  transcription: string;
  durationSeconds?: number;
}

export interface AnswerRecord {
  id: string;
  interviewId: string;
  questionId: string;
  questionText?: string;
  participantId: string;
  participantName: string;
  answerText: string;
  notRecalled: boolean;
  isFollowUp: boolean;
  parentQuestionId?: string | null;
  isAdditionalMemory: boolean;
  branchChoice?: 'yes' | 'no' | null;
  deepeningReason?: string;
  photos?: AnswerPhotoAttachment[];
  audio?: AnswerVoiceAttachment;
  audioRecordings?: AnswerVoiceAttachment[];
  idempotencyKey: string;
  editHistory?: Array<{ text: string; editedAt: string; reason?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface BranchConfig {
  enabled: boolean;
  targetFlowId: string; // e.g., 'hijos'
  triggerRule: 'affirmative' | 'keywords' | 'any_answer';
  keywords?: string[];
  branchLabel?: string; // e.g., 'Flujo sobre Hijos'
}

export interface QuestionRecord {
  id: string;
  text: string;
  lifeStage: 'infancia' | 'juventud' | 'adultez' | 'madurez' | 'legado_general';
  topic: string;
  priority: 'alta' | 'media' | 'baja';
  allowedStoryModes: 'individual' | 'compartida' | 'ambas';
  requirementType: 'mandatory' | 'optional' | 'skippable';
  active: boolean;
  version: number;
  createdAt: string;
  flowId?: string; // 'principal' (default) or sub-flow ID e.g. 'hijos'
  orderIndex?: number;
  branchConfig?: BranchConfig | null;
}

export interface FlowSequenceItem {
  question: QuestionRecord;
  flowId: string;
  isSubFlow: boolean;
  parentGatewayQuestionId?: string;
  subFlowStepIndex?: number;
  subFlowTotalSteps?: number;
  returnToFlowId?: string;
}

/**
 * Normalize Spanish text for keyword and negation matching.
 */
function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Evaluate whether a participant's answer to a gateway question triggers its configured sub-flow branch.
 */
export function doesAnswerTriggerBranch(
  question: QuestionRecord,
  answer: Pick<AnswerRecord, 'answerText' | 'notRecalled' | 'branchChoice'> | undefined
): boolean {
  if (!question.branchConfig || !question.branchConfig.enabled || !question.branchConfig.targetFlowId) {
    return false;
  }
  if (!answer || answer.notRecalled) {
    return false;
  }
  if (answer.branchChoice === 'no') {
    return false;
  }
  if (answer.branchChoice === 'yes') {
    return true;
  }

  const norm = normalizeText(answer.answerText || '');
  if (!norm) return false;

  // Detect explicit negations in Spanish (e.g., "No tuve hijos", "No tengo hijos", "No aplica", "Sin hijos")
  const negationPatterns = [
    /^no\b/,
    /\bno tuve\b/,
    /\bno tengo\b/,
    /\bnunca tuve\b/,
    /\bno tuvimos\b/,
    /\bsin hijos\b/,
    /\bno aplica\b/,
    /^ningun(o|a)?\b/,
  ];
  if (negationPatterns.some((rx) => rx.test(norm))) {
    return false;
  }

  const rule = question.branchConfig.triggerRule || 'affirmative';
  if (rule === 'any_answer') {
    return true;
  }

  if (rule === 'keywords') {
    const kws = (question.branchConfig.keywords || [])
      .map((k) => normalizeText(k))
      .filter((k) => k.length > 0);
    if (kws.length === 0) return true;
    return kws.some((kw) => norm.includes(kw));
  }

  // 'affirmative': Any non-negated substantive answer or explicit affirmative word triggers the sub-flow
  return norm.length > 0;
}

/**
 * Build the dynamic ordered sequence of questions for a participant,
 * splicing configured sub-flows (e.g., 'hijos') immediately after gateway questions
 * when triggered, and returning automatically to the main thread ('principal') afterward.
 */
export function buildParticipantFlowSequence(params: {
  allQuestions: QuestionRecord[];
  participantAnswers: AnswerRecord[];
  storyMode?: StoryMode;
}): FlowSequenceItem[] {
  const { allQuestions, participantAnswers, storyMode } = params;

  const eligibleQuestions = allQuestions.filter((q) => {
    if (!q.active) return false;
    if (storyMode && q.allowedStoryModes !== 'ambas' && q.allowedStoryModes !== storyMode) {
      return false;
    }
    return true;
  });

  // Group questions by flowId ('principal' is default)
  const flowBuckets = new Map<string, QuestionRecord[]>();
  for (const q of eligibleQuestions) {
    const fId = (q.flowId || 'principal').trim().toLowerCase() || 'principal';
    if (!flowBuckets.has(fId)) {
      flowBuckets.set(fId, []);
    }
    flowBuckets.get(fId)!.push(q);
  }

  // Sort each bucket by orderIndex if present
  for (const [, list] of flowBuckets.entries()) {
    list.sort((a, b) => {
      if (a.orderIndex !== undefined && b.orderIndex !== undefined) {
        return a.orderIndex - b.orderIndex;
      }
      return 0;
    });
  }

  const answerByQuestionId = new Map<string, AnswerRecord>();
  for (const ans of participantAnswers) {
    if (!ans.isFollowUp && !ans.isAdditionalMemory) {
      answerByQuestionId.set(ans.questionId, ans);
    }
  }

  const sequence: FlowSequenceItem[] = [];
  const visitedFlows = new Set<string>(['principal']);

  function appendFlow(
    flowId: string,
    isSubFlow: boolean,
    parentGatewayQuestionId?: string,
    returnToFlowId?: string
  ) {
    const questionsInFlow = flowBuckets.get(flowId) || [];
    const total = questionsInFlow.length;

    for (let idx = 0; idx < total; idx++) {
      const q = questionsInFlow[idx];
      sequence.push({
        question: q,
        flowId,
        isSubFlow,
        parentGatewayQuestionId,
        subFlowStepIndex: isSubFlow ? idx + 1 : undefined,
        subFlowTotalSteps: isSubFlow ? total : undefined,
        returnToFlowId,
      });

      // Check if this question triggers a branch to a sub-flow
      if (q.branchConfig?.enabled && q.branchConfig.targetFlowId) {
        const targetFlow = q.branchConfig.targetFlowId.trim().toLowerCase();
        if (targetFlow && !visitedFlows.has(targetFlow)) {
          const ans = answerByQuestionId.get(q.id);
          if (doesAnswerTriggerBranch(q, ans)) {
            visitedFlows.add(targetFlow);
            appendFlow(targetFlow, true, q.id, flowId);
          }
        }
      }
    }
  }

  appendFlow('principal', false);
  return sequence;
}

/**
 * Determine the next question in the dynamic flow sequence after answering `currentQuestionId`,
 * or indicate that the participant has completed all questions in the instrument.
 */
export function getNextQuestionInFlow(params: {
  sequence: FlowSequenceItem[];
  currentQuestionId: string;
  participantAnswers: AnswerRecord[];
}): {
  nextItem: FlowSequenceItem | null;
  nextIndex: number;
  returnedToMainFlow: boolean;
  enteredSubFlowId: string | null;
  completedInstrument: boolean;
} {
  const { sequence, currentQuestionId, participantAnswers } = params;
  if (sequence.length === 0) {
    return {
      nextItem: null,
      nextIndex: 0,
      returnedToMainFlow: false,
      enteredSubFlowId: null,
      completedInstrument: true,
    };
  }

  const currentIdx = sequence.findIndex((item) => item.question.id === currentQuestionId);
  const currentItem = currentIdx >= 0 ? sequence[currentIdx] : null;

  const answeredIds = new Set(
    participantAnswers
      .filter((a) => !a.isFollowUp && !a.isAdditionalMemory)
      .map((a) => a.questionId)
  );

  // 1. Find the first unanswered question after currentIdx
  if (currentIdx >= 0 && currentIdx < sequence.length - 1) {
    let nextUnansweredAfterIdx = -1;
    for (let i = currentIdx + 1; i < sequence.length; i++) {
      if (!answeredIds.has(sequence[i].question.id)) {
        nextUnansweredAfterIdx = i;
        break;
      }
    }

    if (nextUnansweredAfterIdx >= 0) {
      const nextItem = sequence[nextUnansweredAfterIdx];
      const returnedToMainFlow = Boolean(currentItem?.isSubFlow && !nextItem.isSubFlow);
      const enteredSubFlowId =
        !currentItem?.isSubFlow && nextItem.isSubFlow ? nextItem.flowId : null;

      return {
        nextItem,
        nextIndex: nextUnansweredAfterIdx,
        returnedToMainFlow,
        enteredSubFlowId,
        completedInstrument: false,
      };
    }
  }

  // 2. Otherwise check if there are any earlier unanswered questions in the sequence
  const firstUnansweredIdx = sequence.findIndex((item) => !answeredIds.has(item.question.id));
  if (firstUnansweredIdx >= 0) {
    const nextItem = sequence[firstUnansweredIdx];
    return {
      nextItem,
      nextIndex: firstUnansweredIdx,
      returnedToMainFlow: Boolean(currentItem?.isSubFlow && !nextItem.isSubFlow),
      enteredSubFlowId: !currentItem?.isSubFlow && nextItem.isSubFlow ? nextItem.flowId : null,
      completedInstrument: false,
    };
  }

  // 3. All questions in the active flow sequence are answered!
  return {
    nextItem: null,
    nextIndex: sequence.length - 1,
    returnedToMainFlow: false,
    enteredSubFlowId: null,
    completedInstrument: true,
  };
}

/**
 * Check if all questions in the participant's active flow sequence have been answered.
 */
export function isQuestionnaireFlowComplete(
  sequence: FlowSequenceItem[],
  participantAnswers: AnswerRecord[]
): boolean {
  if (sequence.length === 0) return false;
  const answeredIds = new Set(
    participantAnswers
      .filter((a) => !a.isFollowUp && !a.isAdditionalMemory)
      .map((a) => a.questionId)
  );
  return sequence.every((item) => answeredIds.has(item.question.id));
}

/**
 * Hash a plain string token using SHA-256 for secure DB persistence.
 */
export function hashToken(token: string): string {
  try {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  } catch {
    return token.trim();
  }
}

const SAFE_YF_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SAFE_YF_DIGITS = '23456789';
const SAFE_YF_ALPHABET = SAFE_YF_LETTERS + SAFE_YF_DIGITS;

function buildMixedAlphanumeric5(bytes: Buffer | Uint8Array): string {
  const chars: string[] = [];
  for (let i = 0; i < 5; i++) {
    chars.push(SAFE_YF_ALPHABET[bytes[i] % SAFE_YF_ALPHABET.length]);
  }
  const hasLetter = chars.some((c) => /[A-Z]/.test(c));
  const hasDigit = chars.some((c) => /[0-9]/.test(c));
  if (!hasLetter) {
    const pos = bytes[5] % 5;
    chars[pos] = SAFE_YF_LETTERS[bytes[6] % SAFE_YF_LETTERS.length];
  }
  if (!hasDigit) {
    const pos = (bytes[5] + 2) % 5;
    chars[pos] = SAFE_YF_DIGITS[bytes[7] % SAFE_YF_DIGITS.length];
  }
  return chars.join('');
}

/**
 * Deterministically derive an 8-character mixed alphanumeric access code (`YF-XXXXX`) from a seed string.
 * Guarantees at least one letter and at least one number with zero sequential counters.
 */
export function deriveDeterministicAccessCode(seed: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(`youforever_yf5_access:${seed || 'youforever_default_seed'}`)
    .digest();
  return `YF-${buildMixedAlphanumeric5(digest)}`;
}

/**
 * Legacy deterministic 4-char LEG-XXXX derivation kept for backward compatibility with older tokens.
 */
export function deriveLegacyLegAccessCode(seed: string): string {
  const hash = hashToken(seed || 'foreveryou_default_seed').toUpperCase();
  const codePart = hash.replace(/[^A-Z0-9]/g, '').substring(0, 4).padEnd(4, '0');
  return `LEG-${codePart}`;
}

/**
 * Deterministically derive a 64-character hex plainToken from a seed string.
 */
export function deriveDeterministicPlainToken(seed: string): string {
  return hashToken(`plain_token_${seed || 'foreveryou_default_seed'}`).toLowerCase();
}

/**
 * Extract a clean token or access code from any user input (including full URLs,
 * "Código: YF-XXXXX" / "Código: LEG-XXXX" badges, WhatsApp invitation messages, or spaced/unhyphenated codes).
 */
export function extractCleanTokenOrCode(rawInput: string): string {
  if (!rawInput) return '';
  let cleaned = rawInput.trim();
  try {
    if (cleaned.includes('%')) {
      cleaned = decodeURIComponent(cleaned).trim();
    }
  } catch {
    // Keep original if malformed URI encoding
  }

  // Extract from query or hash parameters if a URL was pasted
  if (cleaned.includes('token=')) {
    cleaned = cleaned.split('token=')[1].split('&')[0].split('#')[0].split(/\s/)[0];
  } else if (cleaned.includes('code=')) {
    cleaned = cleaned.split('code=')[1].split('&')[0].split('#')[0].split(/\s/)[0];
  } else if (cleaned.includes('#token=')) {
    cleaned = cleaned.split('#token=')[1].split('&')[0].split(/\s/)[0];
  } else if (cleaned.includes('#code=')) {
    cleaned = cleaned.split('#code=')[1].split('&')[0].split(/\s/)[0];
  }

  // Strip common labels copied from Admin Panel badges or WhatsApp messages
  cleaned = cleaned
    .replace(/^(c[oó]digo\s*(de\s*acceso)?|access\s*code|code|token|enlace)\s*[:\-]?\s*/i, '')
    .replace(/^[👉▶️•\-\s]+/, '')
    .replace(/["'«»]/g, '')
    .trim();

  // If the pasted text contains a YF-XXXXX pattern inside a longer message, extract it
  const embeddedYfMatch = cleaned.match(/\bYF[\s\-_]*([A-Z0-9]{4,8})\b/i);
  if (embeddedYfMatch) {
    return `YF-${embeddedYfMatch[1].toUpperCase()}`;
  }

  const compactYfMatch = cleaned.match(/^YF[\s\-_]*([A-Z0-9]{4,8})$/i);
  if (compactYfMatch) {
    return `YF-${compactYfMatch[1].toUpperCase()}`;
  }

  // Legacy support: If the pasted text contains a LEG-XXXX pattern inside a longer message, extract it
  const embeddedLegMatch = cleaned.match(/\bLEG[\s\-_]*([A-Z0-9]{4,8})\b/i);
  if (embeddedLegMatch) {
    return `LEG-${embeddedLegMatch[1].toUpperCase()}`;
  }

  // If user typed "LEG" followed by 4-8 alphanumeric chars without hyphen or with spaces (e.g. "LEG8492" or "LEG 8492")
  const compactLegMatch = cleaned.match(/^LEG[\s\-_]*([A-Z0-9]{4,8})$/i);
  if (compactLegMatch) {
    return `LEG-${compactLegMatch[1].toUpperCase()}`;
  }

  return cleaned;
}

/**
 * V5.6.2 — Emergency compatibility switch (default OFF). When `YF_LEGACY_DERIVED_ACCESS_CODES=1`,
 * codes computed on the fly from a token's participantId / hash (YF and 4-char LEG) are accepted
 * again even when they are not the code stored on the token. It never re-enables IDs or hashes as
 * credentials. Meant only as a rollback lever if a real participant turns out to depend on one.
 */
export function legacyDerivedAccessCodesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.YF_LEGACY_DERIVED_ACCESS_CODES || '').trim() === '1';
}

/**
 * Resolve a token record from a collection of tokens. Accepted credentials (V5.6.2):
 * - The access code STORED on the token (`accessCode`, `legacyAccessCode`), case-insensitive, with or
 *   without hyphen/spaces, only the suffix, or pasted inside a URL / WhatsApp message.
 * - For a legacy token with NO stored code: the code the administrator panel has always shown for
 *   it (derived from its participantId), so nobody holding that code loses access.
 * - The plain invitation token (case-insensitive), verified directly or through its SHA-256 hash.
 *
 * Never accepted (V5.6.2): the interviewId, participantId, token id or the stored hash itself, and
 * codes derived on the fly for tokens that already have their own code (see
 * `legacyDerivedAccessCodesEnabled` for the emergency switch).
 */
export function matchTokenRecord<T extends InterviewTokenRecord & { plainToken?: string; legacyAccessCode?: string }>(
  rawInput: string,
  tokens: Iterable<T>,
  options: { allowLegacyDerivedCodes?: boolean } = {}
): T | undefined {
  const allowLegacyDerivedCodes = options.allowLegacyDerivedCodes ?? legacyDerivedAccessCodesEnabled();
  const cleaned = extractCleanTokenOrCode(rawInput);
  if (!cleaned) return undefined;

  const upperInput = cleaned.toUpperCase();
  const lowerInput = cleaned.toLowerCase();
  const alphaNumInput = upperInput.replace(/[^A-Z0-9]/g, '');
  const yfPrefixedInput =
    alphaNumInput.length === 5 || alphaNumInput.length === 4 ? `YF${alphaNumInput}` : alphaNumInput;
  const legPrefixedInput =
    alphaNumInput.length === 4 || alphaNumInput.length === 5 ? `LEG${alphaNumInput}` : alphaNumInput;

  const hashedExact = hashToken(cleaned).toLowerCase();
  const hashedLower = hashToken(lowerInput).toLowerCase();
  const hashedUpper = hashToken(upperInput).toLowerCase();

  const tokenList = Array.from(tokens);
  // Prefer non-revoked tokens first
  const orderedTokens = [
    ...tokenList.filter((t) => !t.revoked),
    ...tokenList.filter((t) => t.revoked),
  ];

  // Single pass: stored access codes and the plain token (directly or through its hash)
  for (const tok of orderedTokens) {
    const tokAccessUpper = (tok.accessCode || '').trim().toUpperCase();
    const tokAccessAlphaNum = tokAccessUpper.replace(/[^A-Z0-9]/g, '');
    const tokLegacyUpper = ((tok as any).legacyAccessCode || '').trim().toUpperCase();
    const tokLegacyAlphaNum = tokLegacyUpper.replace(/[^A-Z0-9]/g, '');

    if (
      tokAccessUpper &&
      (tokAccessUpper === upperInput ||
        tokAccessAlphaNum === alphaNumInput ||
        tokAccessAlphaNum === yfPrefixedInput ||
        tokAccessAlphaNum === legPrefixedInput)
    ) {
      return tok;
    }

    if (
      tokLegacyUpper &&
      (tokLegacyUpper === upperInput ||
        tokLegacyAlphaNum === alphaNumInput ||
        tokLegacyAlphaNum === yfPrefixedInput ||
        tokLegacyAlphaNum === legPrefixedInput)
    ) {
      return tok;
    }

    // Legacy token without a stored code: the panel has always shown the participantId-derived
    // code for it (see StorageManager.registerTokenInMemory), so that one keeps working.
    if (!tokAccessUpper && tok.participantId) {
      const shownCodeAlphaNum = deriveDeterministicAccessCode(tok.participantId).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (shownCodeAlphaNum === alphaNumInput || shownCodeAlphaNum === yfPrefixedInput) {
        return tok;
      }
    }

    if (allowLegacyDerivedCodes) {
      const derivedAlphaNums = [
        deriveDeterministicAccessCode(tok.participantId || tok.tokenHash),
        deriveDeterministicAccessCode(tok.tokenHash || tok.participantId),
        deriveLegacyLegAccessCode(tok.participantId || tok.tokenHash),
        deriveLegacyLegAccessCode(tok.tokenHash || tok.participantId),
      ].map((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, ''));
      if (
        derivedAlphaNums.some(
          (c) => c === alphaNumInput || c === yfPrefixedInput || c === legPrefixedInput
        )
      ) {
        return tok;
      }
    }

    if (tok.plainToken) {
      const tokPlainLower = tok.plainToken.trim().toLowerCase();
      if (tokPlainLower === lowerInput) {
        return tok;
      }
    }

    // The plain token is verified through its hash (works even if plainToken is not stored).
    // The stored hash itself is NOT a credential.
    const tokHashLower = (tok.tokenHash || '').trim().toLowerCase();
    if (
      tokHashLower &&
      (tokHashLower === hashedExact || tokHashLower === hashedLower || tokHashLower === hashedUpper)
    ) {
      return tok;
    }
  }

  return undefined;
}

/**
 * Generate a cryptographically secure random invitation token, its SHA-256 hash, and an 8-char mixed alphanumeric access code (`YF-XXXXX`).
 */
export function generateInvitationToken(): { plainToken: string; tokenHash: string; accessCode: string } {
  try {
    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(plainToken);
    const randBytes = crypto.randomBytes(8);
    const accessCode = `YF-${buildMixedAlphanumeric5(randBytes)}`;
    return { plainToken, tokenHash, accessCode };
  } catch {
    const plainToken = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const tokenHash = hashToken(plainToken);
    return { plainToken, tokenHash, accessCode: deriveDeterministicAccessCode(tokenHash) };
  }
}

/**
 * Calculate interview expiration timestamp from start and calendar days.
 */
export function calculateExpirationDate(startDateMs: number, calendarDays: number): number {
  if (calendarDays <= 0) {
    throw new Error('Los días de apertura deben ser un entero positivo.');
  }
  return startDateMs + calendarDays * 24 * 60 * 60 * 1000;
}

/**
 * Check if an interview is currently active and can receive answers or memories.
 */
export function canSubmitAnswer(
  interview: Pick<InterviewRecord, 'status' | 'expiresAt' | 'userDeclaredComplete'>,
  nowMs: number = Date.now(),
  isAdditionalMemory: boolean = false
): { allowed: boolean; reason?: string } {
  const expiresAtMs = new Date(interview.expiresAt).getTime();
  if (nowMs >= expiresAtMs) {
    return {
      allowed: false,
      reason: 'El periodo de apertura de la entrevista ha vencido.',
    };
  }

  if (interview.userDeclaredComplete) {
    return {
      allowed: false,
      reason: 'La entrevista ha sido finalizada voluntariamente por el participante. Tus respuestas se encuentran en modo de solo lectura.',
    };
  }

  // Allow adding additional free memories while the interview has not been closed by the participant and has not expired
  if (isAdditionalMemory) {
    return { allowed: true };
  }

  if (interview.status !== 'open') {
    return {
      allowed: false,
      reason: `La entrevista no está en estado abierta (estado actual: ${interview.status}).`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a token is valid, unrevoked, and unexpired.
 */
export function isTokenActive(token: InterviewTokenRecord, nowMs: number = Date.now()): boolean {
  if (token.revoked) return false;
  const expiresAtMs = new Date(token.expiresAt).getTime();
  return nowMs < expiresAtMs;
}

export interface AnswerSubmissionPayload {
  interviewId: string;
  questionId: string;
  participantId: string;
  participantName: string;
  answerText: string;
  notRecalled: boolean;
  isFollowUp?: boolean;
  parentQuestionId?: string | null;
  isAdditionalMemory?: boolean;
  branchChoice?: 'yes' | 'no' | null;
  idempotencyKey: string;
}

/**
 * Evaluate if an incoming answer is a valid completed question according to business rules:
 * - A valid answer text or explicit "not_recalled" counts as completed.
 * - Empty text with notRecalled: false is an uncompleted/skipped attempt and does NOT increment counter.
 * - Edits do not increment counter.
 * - Duplicate idempotencyKey does not increment counter.
 */
export function evaluateAnswerIncrement(params: {
  existingAnswers: AnswerRecord[];
  incomingPayload: AnswerSubmissionPayload;
  allowEditing: boolean;
}): {
  shouldIncrementCounter: boolean;
  isEdit: boolean;
  isDuplicate: boolean;
  existingAnswer?: AnswerRecord;
  error?: string;
} {
  const { existingAnswers, incomingPayload, allowEditing } = params;

  // 1. Check network idempotency (identical key or identical payload submission)
  const duplicate = existingAnswers.find(
    (a) => a.idempotencyKey === incomingPayload.idempotencyKey
  );
  if (duplicate) {
    return {
      shouldIncrementCounter: false,
      isEdit: false,
      isDuplicate: true,
      existingAnswer: duplicate,
    };
  }

  // 2. Check if answering an existing question by this participant
  const existingForQuestion = existingAnswers.find(
    (a) =>
      a.interviewId === incomingPayload.interviewId &&
      a.questionId === incomingPayload.questionId &&
      a.participantId === incomingPayload.participantId
  );

  // Check validity of response: either notRecalled is true or answerText is non-empty
  const trimmedText = incomingPayload.answerText.trim();
  const isValidCompletion = incomingPayload.notRecalled || trimmedText.length > 0;

  if (!isValidCompletion) {
    return {
      shouldIncrementCounter: false,
      isEdit: false,
      isDuplicate: false,
      error: 'Una respuesta vacía sin marcar «No lo recuerdo» no cuenta como completada.',
    };
  }

  if (existingForQuestion) {
    if (!allowEditing) {
      return {
        shouldIncrementCounter: false,
        isEdit: true,
        isDuplicate: false,
        existingAnswer: existingForQuestion,
        error: 'La edición de respuestas está deshabilitada en la configuración.',
      };
    }
    // Existing answer being edited: does NOT increment counter
    return {
      shouldIncrementCounter: false,
      isEdit: true,
      isDuplicate: false,
      existingAnswer: existingForQuestion,
    };
  }

  // Brand new valid answer or follow-up: increments counter!
  return {
    shouldIncrementCounter: true,
    isEdit: false,
    isDuplicate: false,
  };
}

/**
 * Handle voluntary participant completion.
 */
export function applyVoluntaryCompletion(
  interview: InterviewRecord,
  reason: string = 'Declarado por el participante',
  timestampISO: string = new Date().toISOString(),
  participantClosingText?: string | null
): InterviewRecord {
  const isGenericDefault =
    !reason.trim() ||
    reason.trim() === 'Declarado por el participante' ||
    reason.trim() === 'Declaración voluntaria del participante';
  const cleanClosing =
    typeof participantClosingText === 'string'
      ? participantClosingText.trim()
      : !isGenericDefault
      ? reason.trim()
      : interview.participantClosingText || '';
  return {
    ...interview,
    userDeclaredComplete: true,
    status: 'completed',
    closedAt: timestampISO,
    closureReason: reason,
    participantClosingText: cleanClosing,
    layoutEditsAllowed: interview.layoutEditsAllowed ?? 1,
    layoutEditsUsed: interview.layoutEditsUsed ?? 0,
    bookGeneratedCount: interview.bookGeneratedCount ?? 0,
    lastActivityAt: timestampISO,
  };
}

export interface LayoutEditQuotaStatus {
  hasInitialBook: boolean;
  bookGeneratedCount: number;
  layoutEditsAllowed: number;
  layoutEditsUsed: number;
  remainingEdits: number;
  canGenerateInitial: boolean;
  canModifyLayout: boolean;
}

/**
 * Computes the layout modification quota status for an interview's generated PDF book.
 * By default, after generating Version 1 (initial book), the participant has 1 additional
 * layout modification (`layoutEditsAllowed = 1`).
 */
export function computeLayoutEditQuotaStatus(
  interview: Pick<
    InterviewRecord,
    'userDeclaredComplete' | 'bookGeneratedCount' | 'layoutEditsAllowed' | 'layoutEditsUsed'
  >
): LayoutEditQuotaStatus {
  const bookGeneratedCount = Math.max(0, interview.bookGeneratedCount ?? 0);
  const layoutEditsAllowed = Math.max(0, interview.layoutEditsAllowed ?? 1);
  const layoutEditsUsed = Math.max(0, interview.layoutEditsUsed ?? 0);
  const hasInitialBook = bookGeneratedCount >= 1;
  const remainingEdits = Math.max(0, layoutEditsAllowed - layoutEditsUsed);
  return {
    hasInitialBook,
    bookGeneratedCount,
    layoutEditsAllowed,
    layoutEditsUsed,
    remainingEdits,
    canGenerateInitial: !hasInitialBook,
    canModifyLayout: hasInitialBook && remainingEdits > 0,
  };
}

/**
 * Admin action: Extend open days of an interview.
 */
export function applyAdminExtension(
  interview: InterviewRecord,
  additionalDays: number,
  timestampISO: string = new Date().toISOString()
): InterviewRecord {
  if (additionalDays <= 0) {
    throw new Error('Los días adicionales deben ser mayores a 0.');
  }

  const currentExpiryMs = new Date(interview.expiresAt).getTime();
  const baseMs = Math.max(Date.now(), currentExpiryMs);
  const newExpiryMs = baseMs + additionalDays * 24 * 60 * 60 * 1000;

  return {
    ...interview,
    expiresAt: new Date(newExpiryMs).toISOString(),
    status: interview.status === 'expired' ? 'open' : interview.status,
    lastActivityAt: timestampISO,
  };
}

/**
 * Admin action: Reopen an interview that was closed or expired, and optionally configure layout edit allowance.
 */
export function applyAdminReopen(
  interview: InterviewRecord,
  reopenDays: number,
  reason: string,
  timestampISO: string = new Date().toISOString(),
  additionalLayoutEdits?: number
): InterviewRecord {
  if (reopenDays <= 0) {
    throw new Error('Los días para reabrir deben ser mayores a 0.');
  }

  const nowMs = Date.now();
  const newExpiryMs = nowMs + reopenDays * 24 * 60 * 60 * 1000;
  const used = Math.max(0, interview.layoutEditsUsed ?? 0);
  const nextAllowed =
    typeof additionalLayoutEdits === 'number' && !Number.isNaN(additionalLayoutEdits)
      ? Math.max(0, used + Math.floor(additionalLayoutEdits))
      : Math.max(interview.layoutEditsAllowed ?? 1, used + 1);

  return {
    ...interview,
    status: 'open',
    userDeclaredComplete: false,
    closedAt: null,
    reopenedAt: timestampISO,
    closureReason: `Reabierta por administrador: ${reason}`,
    expiresAt: new Date(newExpiryMs).toISOString(),
    layoutEditsAllowed: nextAllowed,
    lastActivityAt: timestampISO,
  };
}

/**
 * Check if sufficiency evaluation should be triggered.
 */
export function isSufficiencyThresholdMet(
  completedCount: number,
  threshold: number
): boolean {
  return completedCount >= threshold;
}

export interface IncomingPhotoInput {
  id?: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
  dataUrl?: string;
  imageUrl?: string;
}

/**
 * Validate optional photo attachments submitted with an answer.
 * - Uploading photos is always optional (empty array is valid).
 * - If the interviewee attaches one or more photos, each photo MUST include a contextual description (caption).
 */
export function validatePhotoAttachments(
  photos: IncomingPhotoInput[] | undefined | null
): { valid: boolean; error?: string } {
  if (!photos || photos.length === 0) {
    return { valid: true };
  }

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const hasImageSource =
      (typeof p.dataUrl === 'string' && p.dataUrl.trim().startsWith('data:image/')) ||
      (typeof p.imageUrl === 'string' && p.imageUrl.trim().length > 0);

    if (!hasImageSource) {
      return {
        valid: false,
        error: `La fotografía #${i + 1} no contiene una imagen válida.`,
      };
    }

    const caption = (p.caption || '').trim();
    if (caption.length < 3) {
      return {
        valid: false,
        error: `Por favor describe o da contexto a la fotografía #${i + 1}${p.fileName ? ` («${p.fileName}»)` : ''} antes de guardar, o elimínala si la subiste por error.`,
      };
    }
  }

  return { valid: true };
}

const STAGE_HEADING_KEYWORDS: Record<string, string[]> = {
  infancia: ['infancia', 'niñez', 'origen', 'raíces', 'raices', 'primeros años'],
  juventud: ['juventud', 'adolescencia', 'estudios', 'vocación', 'vocacion'],
  adultez: ['adultez', 'familia', 'hijos', 'crianza', 'hogar', 'vida compartida', 'matrimonio', 'trabajo'],
  madurez: ['madurez', 'plenitud', 'aprendizajes', 'momentos decisivos', 'reflexiones'],
  legado_general: ['legado', 'valores', 'mensaje', 'futuro', 'enseñanzas', 'adicional'],
};

/**
 * Format a single photo attachment as a Markdown image block with rich contextual caption.
 */
export function formatPhotoMarkdownBlock(photo: AnswerPhotoAttachment): string {
  const safeCaption = (photo.caption || '').replace(/[\[\]\r\n]+/g, ' ').trim();
  const stageLabel = (photo.lifeStage || 'recuerdo').replace(/_/g, ' ');
  const url = photo.imageUrl || `/api/photos/${photo.id}`;
  return `\n![${safeCaption} | Aportada por ${photo.participantName} (${stageLabel})](${url})\n*Fotografía relacionada con «${photo.questionText || stageLabel}» — Contexto: ${safeCaption} (Aportada por ${photo.participantName})*\n`;
}

/**
 * Guarantee that every photograph uploaded across the interview's answers appears
 * in the appropriate thematic/chronological place within the compiled manuscript Markdown.
 */
export function ensurePhotosPlacedInManuscript(params: {
  compiledMarkdown: string;
  answers: AnswerRecord[];
  questions: QuestionRecord[];
}): string {
  const { compiledMarkdown, answers, questions } = params;
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  // Gather all photos in chronological/answer order with resolved stage & question metadata
  const allPhotos: AnswerPhotoAttachment[] = [];
  for (const ans of answers) {
    if (!ans.photos || ans.photos.length === 0) continue;
    const q = questionMap.get(ans.questionId);
    const parentQ = ans.parentQuestionId ? questionMap.get(ans.parentQuestionId) : undefined;
    const resolvedStage =
      q?.lifeStage ||
      parentQ?.lifeStage ||
      (ans.isAdditionalMemory ? 'legado_general' : 'adultez');
    const resolvedQuestionText =
      ans.questionText ||
      q?.text ||
      parentQ?.text ||
      (ans.isAdditionalMemory ? 'Información adicional' : 'Recuerdo biográfico');

    for (const p of ans.photos) {
      allPhotos.push({
        ...p,
        lifeStage: p.lifeStage || resolvedStage,
        topic: p.topic || q?.topic || parentQ?.topic || 'general',
        questionText: p.questionText || resolvedQuestionText,
        imageUrl: p.imageUrl || `/api/photos/${p.id}`,
      });
    }
  }

  const activePhotoIds = new Set(allPhotos.map((p) => p.id));

  // Strip any markdown image blocks referencing /api/photos/<photoId> that are no longer in activePhotoIds
  const rawLines = (compiledMarkdown || '').split('\n');
  const cleanedLines: string[] = [];
  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    const match = line.match(/!\[[^\]]*\]\((?:https?:\/\/[^)]+)?\/api\/photos\/([^)\s]+)\)/);
    if (match && match[1] && !activePhotoIds.has(match[1])) {
      // Also skip the immediately following photo context caption line if present
      if (
        idx + 1 < rawLines.length &&
        /^\*Fotografía relacionada con /i.test(rawLines[idx + 1].trim())
      ) {
        idx++;
      }
      continue;
    }
    cleanedLines.push(line);
  }

  let updatedMarkdown = cleanedLines.join('\n');

  if (allPhotos.length === 0) {
    return updatedMarkdown;
  }

  for (const photo of allPhotos) {
    const photoUrl = photo.imageUrl || `/api/photos/${photo.id}`;
    // If Gemini already embedded this exact photo URL in the markdown, keep it in place
    if (updatedMarkdown.includes(photoUrl) || updatedMarkdown.includes(photo.id)) {
      continue;
    }

    const photoBlock = formatPhotoMarkdownBlock(photo);
    const stageKey = photo.lifeStage || 'legado_general';
    const stageKeywords = STAGE_HEADING_KEYWORDS[stageKey] || [stageKey];

    // Split markdown into sections by headings (## or ###) to locate the best matching section
    const lines = updatedMarkdown.split('\n');
    let targetInsertLineIdx = -1;

    // 1. First try matching a section that mentions the exact question text or answer snippet
    if (photo.questionText) {
      const qPrefix = photo.questionText.substring(0, 35).toLowerCase();
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(qPrefix)) {
          // Find the end of this sub-section (before next heading or +4 lines)
          let insertAt = i + 1;
          while (
            insertAt < lines.length &&
            !lines[insertAt].startsWith('#') &&
            insertAt - i < 8
          ) {
            insertAt++;
          }
          targetInsertLineIdx = insertAt;
          break;
        }
      }
    }

    // 2. Otherwise match by chapter heading corresponding to the photo's lifeStage or topic
    if (targetInsertLineIdx === -1) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^#{2,3}\s+/.test(line)) {
          const normHeading = normalizeText(line);
          const matchesStage = stageKeywords.some((kw) =>
            normHeading.includes(normalizeText(kw))
          );
          const matchesTopic =
            photo.topic && normHeading.includes(normalizeText(photo.topic.replace(/_/g, ' ')));

          if (matchesStage || matchesTopic) {
            // Find the end of this chapter/section (right before the next ## heading)
            let insertAt = i + 1;
            while (insertAt < lines.length && !/^#{1,2}\s+/.test(lines[insertAt])) {
              insertAt++;
            }
            targetInsertLineIdx = insertAt;
            break;
          }
        }
      }
    }

    if (targetInsertLineIdx !== -1) {
      lines.splice(targetInsertLineIdx, 0, photoBlock);
      updatedMarkdown = lines.join('\n');
    } else {
      // 3. Fallback: append in a dedicated contextual section for its lifeStage at the end of the manuscript
      const stageTitleMap: Record<string, string> = {
        infancia: 'Infancia y Raíces Familiares',
        juventud: 'Juventud y Vocación',
        adultez: 'Adultez, Familia e Hijos',
        madurez: 'Madurez y Reflexiones',
        legado_general: 'Legado y Recuerdos Adicionales',
      };
      const sectionTitle = stageTitleMap[stageKey] || 'Memoria Fotográfica del Relato';
      updatedMarkdown += `\n\n### ${sectionTitle}\n${photoBlock}`;
    }
  }

  return updatedMarkdown;
}

// -------------------------------------------------------------
// PRIVACY, INFORMED CONSENT & DATA PROTECTION MODELS & HELPERS
// -------------------------------------------------------------

export const CURRENT_PRIVACY_POLICY_VERSION = '1.0';
export const CURRENT_PRIVACY_POLICY_DATE = '2026-10-29';
export const RESPONSIBLE_CONTACT_EMAIL = 'youforever.team@gmail.com';
export const DEFAULT_SERVER_TIMEZONE = 'America/Merida';

export interface PrivacyDeclarations {
  declarationA_acknowledgement: boolean; // Obligatoria: acceso al aviso integral y derechos
  declarationB_necessaryProcessing: boolean; // Obligatoria: tratamiento para crear el libro
  declarationC_sensitiveData: boolean; // Expresa e independiente: relatos de salud, creencias, etc.
  declarationD_financialData: boolean; // Expresa específica: datos patrimoniales
  declarationE_aiAssistant: boolean; // Opcional: asistente conversacional
  declarationF_shareWithFamily: boolean; // Opcional: compartir con personas designadas
  declarationG_promotionalUse: boolean; // Opcional: uso promocional de fragmentos
}

export interface PrivacyConsentRecord {
  id: string;
  participantId: string;
  interviewId: string;
  participantName: string;
  policyVersion: string;
  policyHash: string;
  declarations: PrivacyDeclarations;
  confirmedIdentity: boolean;
  confirmedParticipantName: string;
  confirmationMethod: 'electronic_affirmative_action';
  serverTimestamp: string; // ISO UTC
  serverTimestampEpoch: number;
  serverTimezone: string;
  clientIpSnippet?: string;
  status: 'active' | 'revoked' | 'modified';
  revokedAt?: string;
  revocationReason?: string;
  lastModifiedAt?: string;
}

export interface BookDeliveryScheduleRecord {
  id: string;
  interviewId: string;
  participantId: string;
  recipientEmail: string;
  recipientName?: string;
  scheduledDate: string; // YYYY-MM-DD
  status: 'scheduled' | 'delivered' | 'cancelled';
  deliveryType: 'complete_digital_book';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecondaryAccessRecord {
  id: string;
  interviewId: string;
  participantId: string;
  authorizedPersonName: string;
  relationship: string;
  email: string;
  grantedAt: string;
  active: boolean;
}

export interface ARCORequestRecord {
  id: string;
  participantId: string;
  interviewId: string;
  participantName: string;
  contactEmail: string;
  requestType: 'acceso' | 'rectificacion' | 'cancelacion' | 'oposicion';
  details: string;
  status: 'received' | 'in_review' | 'resolved' | 'denied';
  responseNotes?: string;
  submittedAt: string;
  resolvedAt?: string;
}

export interface PrivacyPolicyVersionRecord {
  version: string;
  title: string;
  effectiveDate: string;
  sha256Hash: string;
  simplifiedText: string;
  integralText: string;
  requiresNewConsent: boolean;
  publishedAt: string;
}

/**
 * Validates whether a participant has a valid, active consent covering the required
 * statements for the target policy version.
 */
export function isConsentValid(
  consent: PrivacyConsentRecord | null | undefined,
  targetVersion: string = CURRENT_PRIVACY_POLICY_VERSION
): boolean {
  if (!consent) return false;
  if (consent.status !== 'active') return false;
  if (consent.policyVersion !== targetVersion) return false;
  if (!consent.confirmedIdentity) return false;
  if (!consent.declarations) return false;

  // Declaraciones obligatorias estrictas A y B
  if (!consent.declarations.declarationA_acknowledgement) return false;
  if (!consent.declarations.declarationB_necessaryProcessing) return false;

  return true;
}

/**
 * Computes a standard SHA-256 hex digest for document tamper verification.
 */
export function computeDocumentSha256(content: string | Record<string, unknown>): string {
  const normalized = typeof content === 'string' ? content.trim() : JSON.stringify(content);
  try {
    return crypto.createHash('sha256').update(normalized).digest('hex');
  } catch {
    return 'browser_stub_hash';
  }
}

/**
 * Determines whether the "Cuestionario Reabierto para Edición Completa" banner
 * should be displayed.
 * - Appears only when the interview is open, not declared complete, and has a `reopenedAt` timestamp.
 * - Disappears permanently for that `reopenedAt` cycle as soon as the participant changes question.
 * - Reappears automatically if the interview is closed and reopened again (generating a new `reopenedAt`).
 */
export function shouldDisplayReopenedBanner(params: {
  interview: Pick<InterviewRecord, 'status' | 'userDeclaredComplete' | 'reopenedAt'>;
  dismissedReopenedAt: string | null | undefined;
}): boolean {
  const { interview, dismissedReopenedAt } = params;
  if (interview.status !== 'open' || interview.userDeclaredComplete) {
    return false;
  }
  if (!interview.reopenedAt) {
    return false;
  }
  return interview.reopenedAt !== dismissedReopenedAt;
}

/**
 * Strips all admin-only copy/duplication metadata before sending an InterviewRecord
 * to any participant-facing endpoint so the interviewee never sees it is a copy.
 */
export function sanitizeInterviewForParticipant<T extends InterviewRecord>(interview: T): T {
  const {
    copiedFromInterviewId: _cfId,
    copiedFromName: _cfName,
    copiedAt: _cAt,
    adminCopyNote: _acn,
    ...clean
  } = interview as any;
  return clean as T;
}

/**
 * Builds the default admin-only note identifying the copied interviewee and creation date.
 */
export function buildDefaultAdminCopyNote(
  fullName: string,
  dateInput: string | Date = new Date()
): string {
  const cleanName = (fullName || '').trim() || 'Entrevistado';
  const dateObj = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const validDate = Number.isNaN(dateObj.getTime()) ? new Date() : dateObj;
  const formattedDate = validDate.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `Es una copia de ${cleanName}, realizada el ${formattedDate}`;
}

/**
 * Sorts interviews so root interviews appear newest-first (by openedAt descending),
 * while each duplicated interview appears immediately underneath its original interview
 * (ordered chronologically by copiedAt ascending).
 */
export function sortInterviewsWithCopies<
  T extends Pick<InterviewRecord, 'id' | 'openedAt' | 'copiedFromInterviewId' | 'copiedAt'>
>(interviews: T[]): T[] {
  if (!Array.isArray(interviews) || interviews.length <= 1) {
    return Array.isArray(interviews) ? [...interviews] : [];
  }

  const byId = new Map<string, T>();
  for (const item of interviews) {
    if (item && item.id) byId.set(item.id, item);
  }

  const childrenByParent = new Map<string, T[]>();
  const roots: T[] = [];

  for (const item of interviews) {
    const parentId = item.copiedFromInterviewId;
    if (parentId && parentId !== item.id && byId.has(parentId)) {
      const bucket = childrenByParent.get(parentId) || [];
      bucket.push(item);
      childrenByParent.set(parentId, bucket);
    } else {
      roots.push(item);
    }
  }

  roots.sort(
    (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
  );

  for (const [, bucket] of childrenByParent.entries()) {
    bucket.sort((a, b) => {
      const timeA = new Date(a.copiedAt || a.openedAt).getTime();
      const timeB = new Date(b.copiedAt || b.openedAt).getTime();
      return timeA - timeB;
    });
  }

  const result: T[] = [];
  const visited = new Set<string>();

  const appendTree = (node: T) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    result.push(node);
    const children = childrenByParent.get(node.id) || [];
    for (const child of children) {
      appendTree(child);
    }
  };

  for (const root of roots) {
    appendTree(root);
  }

  // Fallback for any disconnected cycle
  for (const item of interviews) {
    if (!visited.has(item.id)) {
      result.push(item);
    }
  }

  return result;
}

/**
 * Computes the next answer text deterministically when a voice recording finishes transcription,
 * avoiding stale React state reads when auto-saving immediately after voice submission.
 */
export function mergeVoiceTranscriptText(prevText: string, transcript: string): string {
  const cleanTranscript = (transcript || '').trim();
  const cleanPrev = (prevText || '').trim();
  if (!cleanTranscript) {
    return cleanPrev;
  }
  if (!cleanPrev || cleanPrev === 'No aplica a mi historia.') {
    return cleanTranscript;
  }
  if (cleanPrev.includes(cleanTranscript)) {
    return cleanPrev;
  }
  return `${cleanPrev}\n\n[Nota de voz]: ${cleanTranscript}`;
}

/**
 * Determines whether sending and transcribing a voice recording should auto-save and advance
 * automatically to the next question or deepening card.
 * Stays on the current question when the transcript is empty or audio quality was flagged
 * as silent, unintelligible, or excessively noisy.
 */
export function shouldAutoAdvanceAfterVoiceSubmit(params: {
  transcript?: string | null;
  audioQuality?: string | null;
}): boolean {
  const cleanTranscript = (params.transcript || '').trim();
  if (cleanTranscript.length === 0) {
    return false;
  }
  const quality = (params.audioQuality || '').toLowerCase();
  if (quality === 'noisy' || quality === 'unintelligible' || quality === 'silent') {
    return false;
  }
  return true;
}

/**
 * Resolves the confirmation notice shown ONLY AFTER transcription, database persistence,
 * and flow transition (next question, deepening card, or completion screen) have completed.
 */
export function resolvePostSaveFeedbackNotice(params: {
  flowType: 'base' | 'adaptive';
  hasAdaptiveFollowUp: boolean;
  hasVoiceAudio: boolean;
  hasPhotos: boolean;
  notRecalled: boolean;
}): { message: string; durationMs: number } {
  if (params.flowType === 'adaptive') {
    return {
      message: 'Profundización guardada e integrada a tu historia.',
      durationMs: 3500,
    };
  }
  if (params.hasAdaptiveFollowUp) {
    return {
      message:
        'Respuesta guardada. Hemos preparado una pregunta para profundizar en este recuerdo.',
      durationMs: 4000,
    };
  }
  if (!params.notRecalled && params.hasVoiceAudio) {
    return {
      message: 'Archivos de voz y transcripción guardados con éxito',
      durationMs: 3500,
    };
  }
  if (!params.notRecalled && params.hasPhotos) {
    return {
      message: 'Respuesta y fotografías guardadas con éxito en el servidor.',
      durationMs: 3500,
    };
  }
  return {
    message: 'Respuesta guardada con éxito en la base de datos.',
    durationMs: 3500,
  };
}

function getLatestTimestampMs(values: Array<string | undefined | null>): number {
  let maxMs = 0;
  for (const val of values) {
    if (!val) continue;
    const ms = new Date(val).getTime();
    if (!Number.isNaN(ms) && ms > maxMs) {
      maxMs = ms;
    }
  }
  return maxMs;
}

/**
 * Non-destructively merges a remote Firestore InterviewRecord with an existing local/disk record.
 * Preserves newer lifecycle state (reopened vs completed), higher counters, and newer edits
 * so remote writes from www.youforever.app are never overwritten by stale local snapshots.
 */
export function mergeInterviewRecordNonDestructive(
  localInv: InterviewRecord | undefined,
  remoteInv: InterviewRecord
): InterviewRecord {
  if (!localInv) {
    return remoteInv;
  }

  const localLatestMs = getLatestTimestampMs([
    localInv.reopenedAt,
    localInv.closedAt,
    localInv.copiedAt,
    localInv.openedAt,
  ]);
  const remoteLatestMs = getLatestTimestampMs([
    remoteInv.reopenedAt,
    remoteInv.closedAt,
    remoteInv.copiedAt,
    remoteInv.openedAt,
  ]);

  // Base takes whichever record has a newer timestamp (ties favor remote Firestore as source of truth)
  const preferRemote = remoteLatestMs >= localLatestMs;
  const primary = preferRemote ? remoteInv : localInv;
  const secondary = preferRemote ? localInv : remoteInv;

  // Respect explicit reopen vs completion timestamps safely
  const bestReopenedAt =
    getLatestTimestampMs([remoteInv.reopenedAt]) >= getLatestTimestampMs([localInv.reopenedAt])
      ? remoteInv.reopenedAt ?? localInv.reopenedAt
      : localInv.reopenedAt ?? remoteInv.reopenedAt;
  const bestClosedAt =
    getLatestTimestampMs([remoteInv.closedAt]) >= getLatestTimestampMs([localInv.closedAt])
      ? remoteInv.closedAt ?? localInv.closedAt
      : localInv.closedAt ?? remoteInv.closedAt;

  const reopenedMs = getLatestTimestampMs([bestReopenedAt]);
  const closedMs = getLatestTimestampMs([bestClosedAt]);
  const isReopenedNewer = reopenedMs > 0 && reopenedMs > closedMs;

  return {
    ...secondary,
    ...primary,
    status: isReopenedNewer ? 'open' : primary.status,
    userDeclaredComplete: isReopenedNewer ? false : primary.userDeclaredComplete,
    reopenedAt: bestReopenedAt,
    closedAt: bestClosedAt,
    bookGeneratedCount: Math.max(
      localInv.bookGeneratedCount ?? 0,
      remoteInv.bookGeneratedCount ?? 0
    ),
    layoutEditsUsed: Math.max(localInv.layoutEditsUsed ?? 0, remoteInv.layoutEditsUsed ?? 0),
    layoutEditsAllowed:
      preferRemote
        ? remoteInv.layoutEditsAllowed ?? localInv.layoutEditsAllowed
        : localInv.layoutEditsAllowed ?? remoteInv.layoutEditsAllowed,
    completedQuestionCount: Math.max(
      localInv.completedQuestionCount ?? 0,
      remoteInv.completedQuestionCount ?? 0
    ),
    copiedFromInterviewId: remoteInv.copiedFromInterviewId ?? localInv.copiedFromInterviewId,
    copiedFromName: remoteInv.copiedFromName ?? localInv.copiedFromName,
    copiedAt: remoteInv.copiedAt ?? localInv.copiedAt,
    adminCopyNote: preferRemote
      ? remoteInv.adminCopyNote ?? localInv.adminCopyNote
      : localInv.adminCopyNote ?? remoteInv.adminCopyNote,
  };
}

/**
 * Non-destructively merges a remote Firestore AnswerRecord with an existing local/disk record.
 * Keeps newer text by updatedAt while preserving union of uploaded photos and voice recordings.
 */
export function mergeAnswerRecordNonDestructive(
  localAns: AnswerRecord | undefined,
  remoteAns: AnswerRecord
): AnswerRecord {
  if (!localAns) {
    return remoteAns;
  }

  const localUpdatedMs = getLatestTimestampMs([localAns.updatedAt, localAns.createdAt]);
  const remoteUpdatedMs = getLatestTimestampMs([remoteAns.updatedAt, remoteAns.createdAt]);
  const preferRemote = remoteUpdatedMs >= localUpdatedMs;
  const primary = preferRemote ? remoteAns : localAns;
  const secondary = preferRemote ? localAns : remoteAns;

  const photoMap = new Map<string, AnswerPhotoAttachment>();
  for (const ph of [...(secondary.photos || []), ...(primary.photos || [])]) {
    if (!ph) continue;
    const key = ph.id || ph.imageUrl || ph.caption;
    if (key) {
      const existing = photoMap.get(key);
      const hasDataUrl = Boolean((ph as AnswerPhotoAttachment & { dataUrl?: string }).dataUrl);
      const existingHasDataUrl = Boolean(
        existing && (existing as AnswerPhotoAttachment & { dataUrl?: string }).dataUrl
      );
      if (!existing || (hasDataUrl && !existingHasDataUrl)) {
        photoMap.set(key, ph);
      }
    }
  }

  const audioMap = new Map<string, AnswerVoiceAttachment>();
  const secondaryAudios = [
    ...(secondary.audioRecordings || []),
    ...(secondary.audio ? [secondary.audio] : []),
  ];
  const primaryAudios = [
    ...(primary.audioRecordings || []),
    ...(primary.audio ? [primary.audio] : []),
  ];
  for (const aud of [...secondaryAudios, ...primaryAudios]) {
    if (!aud || !aud.id) continue;
    const existing = audioMap.get(aud.id);
    if (!existing || (aud.transcription && !existing.transcription)) {
      audioMap.set(aud.id, aud);
    }
  }
  const mergedAudios = Array.from(audioMap.values());

  return {
    ...secondary,
    ...primary,
    photos: photoMap.size > 0 ? Array.from(photoMap.values()) : primary.photos,
    audioRecordings: mergedAudios.length > 0 ? mergedAudios : primary.audioRecordings,
    audio:
      primary.audio ||
      secondary.audio ||
      (mergedAudios.length > 0 ? mergedAudios[mergedAudios.length - 1] : undefined),
  };
}


