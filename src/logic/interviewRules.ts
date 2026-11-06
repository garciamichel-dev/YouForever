import crypto from 'node:crypto';

export interface AppConfig {
  defaultOpenDays: number;
  defaultSufficiencyThreshold: number;
  defaultMaxFollowUps: number;
  allowAnswerEditing: boolean;
  allowAdditionalMemories: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export const INITIAL_APP_CONFIG: AppConfig = {
  defaultOpenDays: 15,
  defaultSufficiencyThreshold: 100,
  defaultMaxFollowUps: 2,
  allowAnswerEditing: true,
  allowAdditionalMemories: true,
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
}

export interface ParticipantRecord {
  id: string;
  interviewId: string;
  name: string;
  relationship: string;
  role: 'primary' | 'contributor';
  status: 'invited' | 'active' | 'completed';
  email?: string;
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

/**
 * Deterministically derive an 8-character friendly access code (e.g. "LEG-8F4A") from a seed string.
 */
export function deriveDeterministicAccessCode(seed: string): string {
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
 * "Código: LEG-XXXX" badges, WhatsApp invitation messages, or spaced/unhyphenated codes).
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

  // If the pasted text contains a LEG-XXXX pattern inside a longer message, extract it
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
 * Resolve a token record from a collection of tokens using flexible matching across:
 * - Access code (case-insensitive, with or without hyphen/spaces, or 4-char suffix after LEG-)
 * - Plain token (case-insensitive to support uppercase inputs)
 * - SHA-256 tokenHash (both exact case and lowercase hex input)
 * - Direct token ID, participantId, or interviewId
 */
export function matchTokenRecord<T extends InterviewTokenRecord & { plainToken?: string }>(
  rawInput: string,
  tokens: Iterable<T>
): T | undefined {
  const cleaned = extractCleanTokenOrCode(rawInput);
  if (!cleaned) return undefined;

  const upperInput = cleaned.toUpperCase();
  const lowerInput = cleaned.toLowerCase();
  const alphaNumInput = upperInput.replace(/[^A-Z0-9]/g, '');
  const legPrefixedInput =
    alphaNumInput.length === 4 ? `LEG${alphaNumInput}` : alphaNumInput;

  const hashedExact = hashToken(cleaned).toLowerCase();
  const hashedLower = hashToken(lowerInput).toLowerCase();
  const hashedUpper = hashToken(upperInput).toLowerCase();

  const tokenList = Array.from(tokens);
  // Prefer non-revoked tokens first
  const orderedTokens = [
    ...tokenList.filter((t) => !t.revoked),
    ...tokenList.filter((t) => t.revoked),
  ];

  // Pass 1: Exact / normalized accessCode, plainToken, or tokenHash match
  for (const tok of orderedTokens) {
    const tokAccessUpper = (tok.accessCode || '').trim().toUpperCase();
    const tokAccessAlphaNum = tokAccessUpper.replace(/[^A-Z0-9]/g, '');
    const derivedByPartUpper = deriveDeterministicAccessCode(tok.participantId || tok.tokenHash).toUpperCase();
    const derivedByPartAlphaNum = derivedByPartUpper.replace(/[^A-Z0-9]/g, '');
    const derivedByHashUpper = deriveDeterministicAccessCode(tok.tokenHash || tok.participantId).toUpperCase();
    const derivedByHashAlphaNum = derivedByHashUpper.replace(/[^A-Z0-9]/g, '');

    if (
      tokAccessUpper &&
      (tokAccessUpper === upperInput ||
        tokAccessAlphaNum === alphaNumInput ||
        tokAccessAlphaNum === legPrefixedInput)
    ) {
      return tok;
    }

    if (
      derivedByPartUpper === upperInput ||
      derivedByPartAlphaNum === alphaNumInput ||
      derivedByPartAlphaNum === legPrefixedInput ||
      derivedByHashUpper === upperInput ||
      derivedByHashAlphaNum === alphaNumInput ||
      derivedByHashAlphaNum === legPrefixedInput
    ) {
      return tok;
    }

    if (tok.plainToken) {
      const tokPlainLower = tok.plainToken.trim().toLowerCase();
      if (tokPlainLower === lowerInput) {
        return tok;
      }
    }

    const tokHashLower = (tok.tokenHash || '').trim().toLowerCase();
    if (
      tokHashLower &&
      (tokHashLower === lowerInput ||
        tokHashLower === hashedExact ||
        tokHashLower === hashedLower ||
        tokHashLower === hashedUpper)
    ) {
      return tok;
    }
  }

  // Pass 2: Direct token.id, participantId, or interviewId match
  for (const tok of orderedTokens) {
    if (
      tok.id.toLowerCase() === lowerInput ||
      tok.participantId.toLowerCase() === lowerInput ||
      tok.interviewId.toLowerCase() === lowerInput
    ) {
      return tok;
    }
  }

  return undefined;
}

/**
 * Generate a cryptographically secure random invitation token, its SHA-256 hash, and a deterministic 8-char access code.
 */
export function generateInvitationToken(): { plainToken: string; tokenHash: string; accessCode: string } {
  try {
    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(plainToken);
    const accessCode = deriveDeterministicAccessCode(tokenHash);
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
  const safeCaption = photo.caption.replace(/[\[\]\r\n]+/g, ' ').trim();
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

  if (allPhotos.length === 0) {
    return compiledMarkdown;
  }

  let updatedMarkdown = compiledMarkdown;

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
export const RESPONSIBLE_CONTACT_EMAIL = 'atención@foreveryou.com';
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


