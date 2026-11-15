import crypto from 'crypto';
import {
  BOOK_GENERATION_ENGINE_VERSION,
  CANONICAL_AUDIT_RULES_VERSION,
  buildManuscriptApprovalDigestPayload,
  type BookApprovalEvidence,
  type DemoManuscript,
  type DemoNarrativeStyleId,
  type DocumentaryAuditReport,
} from '../logic/demoStoryRules.ts';

/**
 * V5.1 — Unified, tamper-evident book approval.
 *
 * Before V5.1 the manuscript was approved twice by two different policies: generation used the
 * hybrid audit (deterministic rules + semantic judge) while saving re-ran a deterministic-only
 * audit. A manuscript whose paraphrases had been confirmed by the judge was therefore approved
 * during generation and rejected a minute later when the participant pressed "save".
 *
 * This module makes approval a single server-side decision that is recorded once and verified
 * afterwards:
 *   1. `computeBookSourceFingerprint` hashes the exact interview content and configuration.
 *   2. `computeManuscriptContentHash` hashes the exact audited text.
 *   3. `issueBookApprovalEvidence` signs both (plus style and rule versions) with an HMAC whose
 *      key never leaves the server.
 *   4. `verifyBookApprovalEvidence` re-computes both hashes from what the server holds NOW and
 *      checks the signature. The browser only transports the evidence; changing the manuscript,
 *      the answers, the style or the status flags invalidates it.
 */

export interface BookSourceAnswerFingerprintInput {
  id?: string;
  questionId?: string;
  participantId?: string;
  answerText?: string;
  notRecalled?: boolean;
  preferNotToAnswer?: boolean;
  excludeFromBook?: boolean;
  excludedByInterviewee?: boolean;
  omissionReason?: string;
  restriction?: string;
  isFollowUp?: boolean;
  parentQuestionId?: string | null;
  isAdditionalMemory?: boolean;
  questionText?: string;
  audio?: { transcription?: string } | null;
  audioRecordings?: Array<{ transcription?: string }> | null;
  photos?: Array<{ id?: string; caption?: string }> | null;
}

export interface BookSourceQuestionFingerprintInput {
  id: string;
  text?: string;
  lifeStage?: string;
  orderIndex?: number;
}

const sha256Hex = (input: string): string =>
  crypto.createHash('sha256').update(input, 'utf8').digest('hex');

const cleanText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Cryptographic fingerprint of everything that determines what a correct book must contain:
 * every answer (text, transcriptions, exclusion flags, photos and captions), the questions those
 * answers belong to, the narrative style, the structure mode, the active literary prompt, the
 * closing dedication and the audit/engine versions. Order-independent and insensitive to volatile
 * fields (timestamps, data URLs), so it only changes when the testimony or configuration changes.
 */
export function computeBookSourceFingerprint(params: {
  interviewId: string;
  narrativeStyle: DemoNarrativeStyleId;
  bookStructureMode?: string;
  literaryPromptText?: string;
  closingDedicationText?: string;
  answers: BookSourceAnswerFingerprintInput[];
  questions?: BookSourceQuestionFingerprintInput[];
}): string {
  const answers = params.answers || [];
  const referencedQuestionIds = new Set<string>();
  const answerLines = answers
    .map((a) => {
      if (a.questionId) referencedQuestionIds.add(a.questionId);
      if (a.parentQuestionId) referencedQuestionIds.add(a.parentQuestionId);
      const photos = (a.photos || [])
        .filter((p) => p && p.id)
        .map((p) => `${p.id}=${cleanText(p.caption)}`)
        .sort();
      const audios = [
        cleanText(a.audio?.transcription),
        ...(a.audioRecordings || []).map((r) => cleanText(r?.transcription)),
      ];
      return JSON.stringify([
        a.id || '',
        a.questionId || '',
        a.participantId || '',
        a.parentQuestionId || '',
        a.isFollowUp ? 1 : 0,
        a.isAdditionalMemory ? 1 : 0,
        a.notRecalled ? 1 : 0,
        a.preferNotToAnswer ? 1 : 0,
        a.excludeFromBook || a.excludedByInterviewee ? 1 : 0,
        a.omissionReason || '',
        a.restriction || '',
        cleanText(a.answerText),
        cleanText(a.questionText),
        audios,
        photos,
      ]);
    })
    .sort();

  const questionLines = (params.questions || [])
    .filter((q) => q && referencedQuestionIds.has(q.id))
    .map((q) => JSON.stringify([q.id, cleanText(q.text), q.lifeStage || '']))
    .sort();

  return sha256Hex(
    JSON.stringify({
      rules: CANONICAL_AUDIT_RULES_VERSION,
      engine: BOOK_GENERATION_ENGINE_VERSION,
      interviewId: params.interviewId,
      style: params.narrativeStyle,
      structure: params.bookStructureMode || 'prompt_autonomous',
      prompt: sha256Hex(cleanText(params.literaryPromptText)),
      dedication: cleanText(params.closingDedicationText),
      answers: answerLines,
      questions: questionLines,
    })
  );
}

/** SHA-256 of the audited text of a manuscript (see `buildManuscriptApprovalDigestPayload`). */
export function computeManuscriptContentHash(manuscript: DemoManuscript): string {
  return sha256Hex(buildManuscriptApprovalDigestPayload(manuscript));
}

let processLocalApprovalSecret: Buffer | null = null;
let warnedAboutEphemeralSecret = false;

/**
 * Server-only HMAC key.
 * 1. `BOOK_APPROVAL_SECRET` when configured (recommended in production).
 * 2. Otherwise a key derived from secrets the server already holds and the browser never sees,
 *    so evidence stays valid across restarts and instances without any new configuration.
 * 3. Otherwise a random per-process key: evidence then expires on restart, and saving falls back
 *    to re-running the same hybrid audit (never to an automatic approval).
 */
function resolveApprovalSecret(): Buffer {
  const explicit = (process.env.BOOK_APPROVAL_SECRET || '').trim();
  if (explicit.length >= 16) {
    return crypto.createHash('sha256').update(`yf-book-approval::${explicit}`).digest();
  }
  const derivedMaterial = [
    process.env.GEMINI_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.SMTP_PASS,
    process.env.ADMIN_PASSWORD,
  ]
    .map((v) => (v || '').trim())
    .filter((v) => v.length >= 12 && !/^MY_[A-Z_]+$/.test(v));
  if (derivedMaterial.length > 0) {
    return crypto
      .createHash('sha256')
      .update(`yf-book-approval-derived::${derivedMaterial.join('::')}`)
      .digest();
  }
  if (!processLocalApprovalSecret) {
    processLocalApprovalSecret = crypto.randomBytes(32);
    if (!warnedAboutEphemeralSecret) {
      warnedAboutEphemeralSecret = true;
      console.warn(
        '[BookApproval] BOOK_APPROVAL_SECRET no está configurado y no hay secretos de servidor de los que derivarlo: la evidencia de aprobación solo será válida hasta el próximo reinicio.'
      );
    }
  }
  return processLocalApprovalSecret;
}

function buildEvidenceSigningString(evidence: Omit<BookApprovalEvidence, 'signature'>): string {
  return JSON.stringify([
    evidence.evidenceVersion,
    evidence.auditRulesVersion,
    evidence.engineVersion,
    evidence.auditPolicy,
    evidence.interviewId,
    evidence.narrativeStyle,
    evidence.sourceFingerprint,
    evidence.manuscriptContentHash,
    evidence.coveragePercentage,
    evidence.totalSourceUnits,
    evidence.judgeResolvedUnits,
    evidence.issuedAt,
  ]);
}

function signEvidence(evidence: Omit<BookApprovalEvidence, 'signature'>): string {
  return crypto
    .createHmac('sha256', resolveApprovalSecret())
    .update(buildEvidenceSigningString(evidence), 'utf8')
    .digest('hex');
}

/**
 * Issues approval evidence. Throws when the report did not pass: evidence can only ever describe
 * a manuscript that the hybrid audit approved.
 */
export function issueBookApprovalEvidence(params: {
  interviewId: string;
  manuscript: DemoManuscript;
  sourceFingerprint: string;
  report: DocumentaryAuditReport;
  editorialAuditPassed: boolean;
}): BookApprovalEvidence {
  const { interviewId, manuscript, sourceFingerprint, report, editorialAuditPassed } = params;
  if (!report.passed || !editorialAuditPassed) {
    throw new Error('No se puede emitir evidencia de aprobación para un manuscrito no aprobado.');
  }
  const unsigned: Omit<BookApprovalEvidence, 'signature'> = {
    evidenceVersion: 1,
    auditRulesVersion: CANONICAL_AUDIT_RULES_VERSION,
    engineVersion: BOOK_GENERATION_ENGINE_VERSION,
    auditPolicy: 'hybrid_arbitrated',
    interviewId,
    narrativeStyle: manuscript.narrativeStyle,
    sourceFingerprint,
    manuscriptContentHash: computeManuscriptContentHash(manuscript),
    coveragePercentage: report.coveragePercentage,
    totalSourceUnits: report.totalSourceUnits,
    judgeResolvedUnits: (report.semanticAudit?.judgeResolvedUnitIds || []).length,
    issuedAt: new Date().toISOString(),
  };
  return { ...unsigned, signature: signEvidence(unsigned) };
}

export type BookApprovalVerificationFailure =
  | 'missing_evidence'
  | 'malformed_evidence'
  | 'rules_version_changed'
  | 'interview_mismatch'
  | 'style_mismatch'
  | 'source_changed'
  | 'manuscript_changed'
  | 'invalid_signature';

export interface BookApprovalVerificationResult {
  valid: boolean;
  reason?: BookApprovalVerificationFailure;
  evidence?: BookApprovalEvidence;
}

/**
 * Verifies that `manuscript` is exactly the text the server approved for exactly the sources the
 * server holds now. Nothing the client sends is trusted: both hashes are recomputed here and the
 * status flags on the manuscript are ignored.
 */
export function verifyBookApprovalEvidence(params: {
  manuscript: DemoManuscript;
  interviewId: string;
  narrativeStyle: DemoNarrativeStyleId;
  currentSourceFingerprint: string;
}): BookApprovalVerificationResult {
  const evidence = params.manuscript?.approvalEvidence;
  if (!evidence || typeof evidence !== 'object') {
    return { valid: false, reason: 'missing_evidence' };
  }
  if (
    evidence.evidenceVersion !== 1 ||
    typeof evidence.signature !== 'string' ||
    typeof evidence.sourceFingerprint !== 'string' ||
    typeof evidence.manuscriptContentHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(evidence.signature)
  ) {
    return { valid: false, reason: 'malformed_evidence' };
  }

  const { signature, ...unsigned } = evidence;
  const expected = Buffer.from(signEvidence(unsigned), 'hex');
  const provided = Buffer.from(signature, 'hex');
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { valid: false, reason: 'invalid_signature' };
  }
  if (
    evidence.auditRulesVersion !== CANONICAL_AUDIT_RULES_VERSION ||
    evidence.engineVersion !== BOOK_GENERATION_ENGINE_VERSION
  ) {
    return { valid: false, reason: 'rules_version_changed' };
  }
  if (evidence.interviewId !== params.interviewId) {
    return { valid: false, reason: 'interview_mismatch' };
  }
  if (
    evidence.narrativeStyle !== params.narrativeStyle ||
    params.manuscript.narrativeStyle !== params.narrativeStyle
  ) {
    return { valid: false, reason: 'style_mismatch' };
  }
  if (evidence.sourceFingerprint !== params.currentSourceFingerprint) {
    return { valid: false, reason: 'source_changed' };
  }
  if (evidence.manuscriptContentHash !== computeManuscriptContentHash(params.manuscript)) {
    return { valid: false, reason: 'manuscript_changed' };
  }
  return { valid: true, evidence };
}

/** Test-only hook: forgets the per-process fallback key (simulates a server restart). */
export function __resetProcessLocalApprovalSecretForTests(): void {
  processLocalApprovalSecret = null;
  warnedAboutEphemeralSecret = false;
}
