import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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
 * DOCUMENTARY fingerprint (approval and integrity): everything that determines what a correct
 * book must CONTAIN — every answer (text, transcriptions, exclusion flags, photos and captions),
 * the questions those answers belong to, the narrative style, the closing dedication and the audit
 * rules version. Order-independent and insensitive to volatile fields (timestamps, data URLs).
 *
 * V5.2: the structure mode, the literary prompt and the engine version only change HOW a book is
 * drafted, not what a faithful book must contain, so they moved to
 * `computeBookGenerationFingerprint`. Changing the model, the provider, the prompt or any visual
 * option therefore no longer invalidates an approved manuscript; it only stops drafted batches
 * from being reused. (`bookStructureMode` / `literaryPromptText` are still accepted and ignored
 * here so existing callers keep compiling.)
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
      kind: 'documentary',
      rules: CANONICAL_AUDIT_RULES_VERSION,
      interviewId: params.interviewId,
      style: params.narrativeStyle,
      dedication: cleanText(params.closingDedicationText),
      answers: answerLines,
      questions: questionLines,
    })
  );
}

/**
 * V5.2 — GENERATION fingerprint (batch identity and resumption): the documentary fingerprint plus
 * every setting that changes how a batch is drafted — configured provider and model, engine
 * version, structure mode and the active literary prompt. A drafted batch is reused only by a
 * generation with the same generation fingerprint. It is never part of the approval evidence.
 */
export function computeBookGenerationFingerprint(params: {
  sourceFingerprint: string;
  provider: string;
  model: string;
  bookStructureMode?: string;
  literaryPromptText?: string;
}): string {
  return sha256Hex(
    JSON.stringify({
      kind: 'generation',
      source: params.sourceFingerprint,
      engine: BOOK_GENERATION_ENGINE_VERSION,
      provider: params.provider,
      model: params.model,
      structure: params.bookStructureMode || 'prompt_autonomous',
      prompt: sha256Hex(cleanText(params.literaryPromptText)),
    })
  );
}

/** V5.2 — Identity of one drafting batch: which chapter segments it was asked to write. */
export function computeBookBatchSignature(batchChapters: Array<{ id?: string; segmentIndex?: number }>): string {
  return sha256Hex(
    JSON.stringify((batchChapters || []).map((c) => [c?.id || '', Number(c?.segmentIndex) || 0]))
  );
}

/** SHA-256 of the audited text of a manuscript (see `buildManuscriptApprovalDigestPayload`). */
export function computeManuscriptContentHash(manuscript: DemoManuscript): string {
  return sha256Hex(buildManuscriptApprovalDigestPayload(manuscript));
}

let processLocalApprovalSecret: Buffer | null = null;
let warnedAboutEphemeralSecret = false;
let cachedPersistedSecret: { path: string; key: Buffer | null } | null = null;

const MIN_SECRET_LENGTH = 16;

const deriveKeyFromSecret = (secret: string): Buffer =>
  crypto.createHash('sha256').update(`yf-book-approval::${secret}`).digest();

/** Where the dedicated signing key is kept when `BOOK_APPROVAL_SECRET` is not configured. */
export function resolveApprovalSecretFilePath(): string {
  const configured = (process.env.BOOK_APPROVAL_SECRET_FILE || '').trim();
  return configured || path.join(process.cwd(), 'data', '.book_approval_secret');
}

/**
 * Reads (or creates once) the dedicated random signing key file. The key is 32 random bytes
 * generated on the server; it is not derived from any provider credential, so rotating the
 * Gemini/OpenAI/SMTP keys no longer invalidates approvals. Returns null when the file system is
 * not writable (the caller then falls back to a per-process key).
 */
function loadOrCreatePersistedSecret(createIfMissing: boolean): Buffer | null {
  const filePath = resolveApprovalSecretFilePath();
  if (cachedPersistedSecret && cachedPersistedSecret.path === filePath && cachedPersistedSecret.key) {
    return cachedPersistedSecret.key;
  }
  const readExisting = (): Buffer | null => {
    try {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      return raw.length >= 32 ? deriveKeyFromSecret(raw) : null;
    } catch {
      return null;
    }
  };
  let key = readExisting();
  if (!key && createIfMissing) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // 'wx' fails if another process created it first; then we read theirs.
      fs.writeFileSync(filePath, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch {
      // Either it already exists (race) or the file system is read-only.
    }
    key = readExisting();
  }
  cachedPersistedSecret = { path: filePath, key };
  return key;
}

/**
 * V5.1 key material, accepted for VERIFICATION ONLY so evidence issued before V5.2 (whose key was
 * derived from the server's provider credentials) keeps verifying while those credentials are
 * unchanged. New evidence is never signed with it.
 */
function legacyDerivedApprovalKey(): Buffer | null {
  const derivedMaterial = [
    process.env.GEMINI_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.SMTP_PASS,
    process.env.ADMIN_PASSWORD,
  ]
    .map((v) => (v || '').trim())
    .filter((v) => v.length >= 12 && !/^MY_[A-Z_]+$/.test(v));
  if (derivedMaterial.length === 0) return null;
  return crypto
    .createHash('sha256')
    .update(`yf-book-approval-derived::${derivedMaterial.join('::')}`)
    .digest();
}

/**
 * Server-only HMAC signing key (V5.2 order):
 * 1. `BOOK_APPROVAL_SECRET` (16+ characters) — recommended in production, and REQUIRED when
 *    several server instances share approvals, because each instance would otherwise create
 *    its own key file.
 * 2. Otherwise a dedicated random key persisted at `BOOK_APPROVAL_SECRET_FILE`
 *    (default `data/.book_approval_secret`, git-ignored). It survives restarts and is independent
 *    of every other credential.
 * 3. Otherwise (read-only file system) a random per-process key: evidence then expires on
 *    restart and saving falls back to re-running the same hybrid audit — never to approval.
 */
function resolveApprovalSecret(): Buffer {
  const explicit = (process.env.BOOK_APPROVAL_SECRET || '').trim();
  if (explicit.length >= MIN_SECRET_LENGTH) return deriveKeyFromSecret(explicit);
  const persisted = loadOrCreatePersistedSecret(true);
  if (persisted) return persisted;
  if (!processLocalApprovalSecret) {
    processLocalApprovalSecret = crypto.randomBytes(32);
    if (!warnedAboutEphemeralSecret) {
      warnedAboutEphemeralSecret = true;
      console.warn(
        '[BookApproval] No se pudo guardar una clave de firma dedicada y BOOK_APPROVAL_SECRET no está configurado: la evidencia de aprobación solo será válida hasta el próximo reinicio.'
      );
    }
  }
  return processLocalApprovalSecret;
}

/**
 * Every key a signature may have been produced with, primary first: the current signing key,
 * keys listed in `BOOK_APPROVAL_PREVIOUS_SECRETS` (comma-separated, for planned rotation), the
 * persisted key file and the legacy V5.1 derived key. A signature that matches none of them is
 * invalid and the save path re-audits; nothing is ever approved because a key changed.
 */
function resolveVerificationKeys(): Buffer[] {
  const keys: Buffer[] = [resolveApprovalSecret()];
  for (const prev of (process.env.BOOK_APPROVAL_PREVIOUS_SECRETS || '').split(',')) {
    const clean = prev.trim();
    if (clean.length >= MIN_SECRET_LENGTH) keys.push(deriveKeyFromSecret(clean));
  }
  const persisted = loadOrCreatePersistedSecret(false);
  if (persisted) keys.push(persisted);
  const legacy = legacyDerivedApprovalKey();
  if (legacy) keys.push(legacy);
  const unique: Buffer[] = [];
  for (const k of keys) if (!unique.some((u) => u.equals(k))) unique.push(k);
  return unique;
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

function signEvidenceWithKey(evidence: Omit<BookApprovalEvidence, 'signature'>, key: Buffer): string {
  return crypto.createHmac('sha256', key).update(buildEvidenceSigningString(evidence), 'utf8').digest('hex');
}

function signEvidence(evidence: Omit<BookApprovalEvidence, 'signature'>): string {
  return signEvidenceWithKey(evidence, resolveApprovalSecret());
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
  const provided = Buffer.from(signature, 'hex');
  const signatureMatches = resolveVerificationKeys().some((key) => {
    const expected = Buffer.from(signEvidenceWithKey(unsigned, key), 'hex');
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  });
  if (!signatureMatches) {
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

/** Test-only hook: forgets every in-memory key (simulates a server restart). */
export function __resetProcessLocalApprovalSecretForTests(): void {
  processLocalApprovalSecret = null;
  warnedAboutEphemeralSecret = false;
  cachedPersistedSecret = null;
}
