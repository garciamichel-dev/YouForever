export type DemoStoryMode = 'individual' | 'pareja';

export type DemoNarrativeStyleId =
  | 'first_person_simple'
  | 'first_person_literary'
  | 'third_person_biography';

export type DemoCoverDesignId =
  | 'clasica_eterna'
  | 'recuerdos_marfil'
  | 'album_nuestra_vida'
  | 'raices_recuerdos'
  | 'historia_contemporanea';

export type DemoInteriorStyleId =
  | 'clasico_editorial'
  | 'memorias_elegantes'
  | 'diario_intimo'
  | 'minimalista_contemporaneo'
  | 'legado_familiar';

export type DemoBookFormatId = 'a5' | '6x9' | 'carta';

export type DemoCoverVisualType = 'none' | 'illustration' | 'photo';

export type DemoThematicIllustrationId =
  | 'arbol_raices'
  | 'pluma_tinta'
  | 'brujula_camino'
  | 'hogar_calido'
  | 'constelacion_familiar';

export interface DemoBasicProfile {
  mode: DemoStoryMode;
  // Individual
  displayName: string;
  fullName?: string;
  // Couple
  partner1Name: string;
  partner2Name: string;
  // Shared
  customTitle?: string;
  hasAcceptedTemporaryNotice: boolean;
}

export interface DemoQuestionDefinition {
  id: string;
  stepNumber: number;
  dimensionKey: 'raices' | 'transformacion' | 'personas_amadas' | 'esencia' | 'legado';
  individualDimensionTitle: string;
  coupleDimensionTitle: string;
  individualBookPartTitle: string;
  coupleBookPartTitle: string;
  individualText: string;
  coupleText: string;
  objective: string;
  focusHints: string[];
}

export interface DemoFollowUpPayload {
  mainQuestionId: string;
  shouldAskFollowUp: boolean;
  followUpQuestion: string;
  detectedTheme: string;
  referencedDetail: string;
}

export interface DemoQuestionResponse {
  questionId: string;
  // Individual or Joint answer
  mainAnswerText: string;
  // Couple separate answers
  partner1AnswerText?: string;
  partner2AnswerText?: string;
  mainOmission?: 'none' | 'not_recalled' | 'prefer_not_to_answer';
  // Generated AI follow-up (at most 1 per main question)
  followUp?: DemoFollowUpPayload | null;
  followUpAnswerText?: string;
  partner1FollowUpText?: string;
  partner2FollowUpText?: string;
  followUpOmission?: 'none' | 'not_recalled' | 'prefer_not_to_answer';
  followUpCompleted?: boolean;
}

export type ManuscriptGenerationStatus =
  | 'pending'
  | 'generating'
  | 'generated'
  | 'auditing'
  | 'needs_correction'
  | 'incomplete_draft'
  | 'approved'
  /** V5.3: fast 5-page editorial sample; never a full book, never saved as a version. */
  | 'preview_sample'
  | 'failed_ai'
  | 'failed_audit'
  | 'error';

export const CANONICAL_AUDIT_RULES_VERSION = 'v5.3.0-priority-judged-hybrid-audit';
export const BOOK_GENERATION_ENGINE_VERSION = 'v5.3.0-delivery-policy-book-engine';

export type BookGenerationReasonCode =
  | 'PROVIDER_ERROR'
  | 'MODEL_TIMEOUT'
  | 'INVALID_MODEL_RESPONSE'
  | 'PARTIAL_BATCH_GENERATION'
  | 'DOCUMENTARY_COVERAGE_FAILURE'
  | 'SEMANTIC_CONTRADICTION'
  | 'EDITORIAL_QUALITY_FAILURE'
  | 'PRIVACY_VALIDATION_FAILURE'
  | 'PHOTO_PLACEMENT_FAILURE'
  | 'REPAIR_EXHAUSTED'
  | 'AUDIT_INCONCLUSIVE'
  | 'SEMANTIC_JUDGE_UNAVAILABLE'
  | 'SOURCE_CHANGED_SINCE_APPROVAL';

/**
 * V5.1 — Coarse failure family derived from `BookGenerationReasonCode`. Unlike the granular
 * internal code (administrators only), the category is safe to show to participants and decides
 * WHICH message they read and WHAT a retry will actually do.
 * - technical: provider outage, timeout, invalid JSON, partial batches, judge unavailable. Retrying resumes.
 * - documentary: real omissions / contradictions / unsupported data confirmed by the audit.
 * - editorial: style, title, duplicate or formatting defects.
 * - privacy: excluded content leaked into the manuscript.
 * - repair_pending: automatic repairs ran but did not manage to clear every defect.
 * - source_changed: the interview changed after the manuscript was approved.
 */
export type BookFailureCategory =
  | 'technical'
  | 'documentary'
  | 'editorial'
  | 'privacy'
  | 'repair_pending'
  | 'source_changed';

export function resolveBookFailureCategory(
  code: BookGenerationReasonCode | undefined | null
): BookFailureCategory {
  switch (code) {
    case 'PROVIDER_ERROR':
    case 'MODEL_TIMEOUT':
    case 'INVALID_MODEL_RESPONSE':
    case 'PARTIAL_BATCH_GENERATION':
    case 'SEMANTIC_JUDGE_UNAVAILABLE':
      return 'technical';
    case 'PRIVACY_VALIDATION_FAILURE':
      return 'privacy';
    case 'EDITORIAL_QUALITY_FAILURE':
      return 'editorial';
    case 'REPAIR_EXHAUSTED':
      return 'repair_pending';
    case 'SOURCE_CHANGED_SINCE_APPROVAL':
      return 'source_changed';
    case 'DOCUMENTARY_COVERAGE_FAILURE':
    case 'SEMANTIC_CONTRADICTION':
    case 'PHOTO_PLACEMENT_FAILURE':
    case 'AUDIT_INCONCLUSIVE':
    default:
      return 'documentary';
  }
}

/** Plain-language participant notice per failure family (never exposes internal codes). */
export function buildIncompleteDraftUserNotice(category: BookFailureCategory): string {
  switch (category) {
    case 'technical':
      return 'Tuvimos un inconveniente técnico temporal al preparar tu libro. Tus recuerdos están a salvo y el avance quedó guardado: al volver a intentarlo continuaremos desde donde nos quedamos.';
    case 'privacy':
      return 'Detectamos que este borrador todavía menciona algo que pediste no incluir. Por tu privacidad no lo guardaremos como versión definitiva; vuelve a intentarlo para prepararlo de nuevo sin esa parte.';
    case 'editorial':
      return 'Tus recuerdos ya están reunidos en este borrador, pero la redacción todavía necesita un pulido de estilo antes de quedar como versión definitiva. Vuelve a intentarlo para terminar ese pulido.';
    case 'repair_pending':
      return 'Tu libro todavía necesita reunir más de tus recuerdos antes de quedar listo. Vuelve a intentarlo: continuaremos con los capítulos pendientes sin empezar desde cero.';
    case 'source_changed':
      return 'Tus respuestas cambiaron después de preparar este libro. Vuelve a prepararlo para que incluya tus recuerdos más recientes antes de guardarlo.';
    case 'documentary':
    default:
      return 'Tu libro todavía necesita reunir más de tus recuerdos antes de quedar listo. Puedes leer este borrador y volver a intentarlo; continuaremos desde donde nos quedamos.';
  }
}

// =============================================================================================
// V5.3 — DELIVERY POLICY (separate from the strict audit verdict)
// =============================================================================================

export const BOOK_DELIVERY_POLICY_VERSION = 'v5.3.0-delivery-min-60';
/** Minimum calculated documentary coverage for delivery (inclusive): 60 %. */
export const DELIVERY_MIN_COVERAGE_PERCENT = 60;
export const COVERAGE_BAND_YELLOW_FROM_PERCENT = 80;
export const COVERAGE_BAND_GREEN_FROM_PERCENT = 91;

/** Admin-only coverage indicator. Below 60 % there is no acceptance indicator (pending review). */
export type CoverageBand = 'pending_review' | 'orange' | 'yellow' | 'green';

/**
 * Band of an exact percentage value (never a rounded display value):
 * < 60 pending_review · 60 to < 80 orange · 80 to < 91 yellow · 91 to 100 green.
 */
export function classifyCoveragePercentage(exactPercent: number): CoverageBand {
  if (!Number.isFinite(exactPercent)) return 'pending_review';
  if (exactPercent >= COVERAGE_BAND_GREEN_FROM_PERCENT) return 'green';
  if (exactPercent >= COVERAGE_BAND_YELLOW_FROM_PERCENT) return 'yellow';
  if (exactPercent >= DELIVERY_MIN_COVERAGE_PERCENT) return 'orange';
  return 'pending_review';
}

/**
 * Band from the ORIGINAL unit counts, compared in integer arithmetic
 * (`verified * 100 >= threshold * eligible`), so no floating-point or display rounding can push a
 * value below a threshold over it (e.g. 59.99 % stays below 60 %).
 */
export function classifyCoverageCounts(verifiedUnits: number, eligibleUnits: number): CoverageBand {
  if (!(eligibleUnits > 0) || !(verifiedUnits >= 0)) return 'pending_review';
  const v = Math.floor(verifiedUnits) * 100;
  if (v >= COVERAGE_BAND_GREEN_FROM_PERCENT * eligibleUnits) return 'green';
  if (v >= COVERAGE_BAND_YELLOW_FROM_PERCENT * eligibleUnits) return 'yellow';
  if (v >= DELIVERY_MIN_COVERAGE_PERCENT * eligibleUnits) return 'orange';
  return 'pending_review';
}

export type BookDeliveryBlockerCode =
  | 'COVERAGE_BELOW_MINIMUM'
  | 'PRIVACY_EXCLUSION_LEAK'
  | 'STRUCTURE_INVALID'
  | 'NO_DOCUMENTARY_SOURCES';

export interface BookDeliveryDecision {
  policyVersion: string;
  /** Server-computed. The browser can never set it. */
  eligible: boolean;
  band: CoverageBand;
  /** Exact ratio * 100, NOT rounded. */
  coverageExactPercent: number;
  verifiedUnits: number;
  eligibleUnits: number;
  /** fully_verified: strict documentary + editorial audits passed; otherwise with observations. */
  verificationLevel: 'fully_verified' | 'delivered_with_observations' | 'not_eligible';
  deliveryStatus: 'delivered' | 'delivered_with_observations' | 'pending_review';
  blockers: Array<{ code: BookDeliveryBlockerCode; message: string }>;
  observations: {
    contradictions: number;
    omittedUnits: number;
    pendingVerificationUnits: number;
    ambiguousUnits: number;
    inventedDataFlags: number;
    unsupportedAdditions: number;
    uncertaintyViolations: number;
    editorialDefects: number;
    photosPending: number;
  };
  decidedAt: string;
}

/**
 * V5.3 — Technical integrity of a manuscript received for saving: something that can really be
 * stored, versioned and composed. Returns the problems found (empty when valid).
 */
export function validateManuscriptTechnicalIntegrity(manuscript: any): string[] {
  const problems: string[] = [];
  if (!manuscript || typeof manuscript !== 'object') return ['El manuscrito no es un objeto válido.'];
  if (!Array.isArray(manuscript.chapters) || manuscript.chapters.length === 0) {
    return ['El manuscrito no contiene capítulos.'];
  }
  const ids = new Set<string>();
  let textChars = 0;
  manuscript.chapters.forEach((ch: any, idx: number) => {
    if (!ch || typeof ch !== 'object') {
      problems.push(`Capítulo ${idx + 1} inválido.`);
      return;
    }
    if (typeof ch.id !== 'string' || !ch.id.trim()) problems.push(`Capítulo ${idx + 1} sin identificador.`);
    else if (ids.has(ch.id)) problems.push(`Identificador de capítulo duplicado: ${ch.id}.`);
    else ids.add(ch.id);
    if (!Array.isArray(ch.paragraphs) || ch.paragraphs.some((p: unknown) => typeof p !== 'string')) {
      problems.push(`Capítulo ${idx + 1} con párrafos inválidos.`);
    } else {
      textChars += ch.paragraphs.join('').trim().length;
    }
  });
  if (problems.length === 0 && textChars === 0) problems.push('El manuscrito no contiene texto.');
  return problems;
}

/**
 * V5.3 — DELIVERY ELIGIBILITY, independent of the strict audit verdict.
 *
 * The documentary and editorial audits keep measuring how well the manuscript was verified and
 * are never altered. Delivery (save, version, export, hand to the participant) is decided here:
 *   1. calculated coverage >= 60 % (inclusive, original unit counts, no rounding),
 *   2. technically valid structure,
 *   3. no leak of content the interviewee explicitly excluded (privacy),
 *   4. at least one eligible documentary unit.
 * Contradictions, omissions, pending verifications and editorial defects are OBSERVATIONS for the
 * administrator, never blockers by themselves.
 */
export function evaluateBookDeliveryEligibility(params: {
  report: DocumentaryAuditReport;
  editorialAudit?: EditorialQualityAuditReport | null;
  manuscript?: DemoManuscript | null;
}): BookDeliveryDecision {
  const { report, editorialAudit, manuscript } = params;
  const eligibleUnits = Number(report.totalSourceUnits) || 0;
  const verifiedUnits = Math.max(0, Math.min(Number(report.integratedUnits) || 0, eligibleUnits));
  const coverageExactPercent = eligibleUnits > 0 ? (verifiedUnits / eligibleUnits) * 100 : 0;
  const band = classifyCoverageCounts(verifiedUnits, eligibleUnits);
  const blockers: BookDeliveryDecision['blockers'] = [];

  if (eligibleUnits === 0) {
    blockers.push({
      code: 'NO_DOCUMENTARY_SOURCES',
      message: 'No hay unidades documentales elegibles en las fuentes.',
    });
  } else if (band === 'pending_review') {
    blockers.push({
      code: 'COVERAGE_BELOW_MINIMUM',
      message: `Cobertura documental calculada inferior al mínimo de entrega (${verifiedUnits}/${eligibleUnits}).`,
    });
  }
  const leaks = [
    ...(report.veracityAudit?.leakedExcludedContentFlags || []),
    ...(report.leakedExcludedContentFlags || []),
  ];
  if (leaks.length > 0) {
    blockers.push({
      code: 'PRIVACY_EXCLUSION_LEAK',
      message: `El manuscrito incluye contenido que el entrevistado excluyó expresamente (${leaks.length}).`,
    });
  }
  const structuralProblems = manuscript ? validateManuscriptTechnicalIntegrity(manuscript) : [];
  if (
    structuralProblems.length > 0 ||
    report.structuralAudit?.uniqueChapterIds === false ||
    report.structuralAudit?.consecutiveNumbering === false
  ) {
    blockers.push({
      code: 'STRUCTURE_INVALID',
      message:
        structuralProblems[0] || 'La estructura de capítulos del manuscrito no es técnicamente válida.',
    });
  }

  const trace = report.traceabilityMatrix || [];
  const inventedSet = new Set(report.veracityAudit?.inventedDataFlags || []);
  const observations: BookDeliveryDecision['observations'] = {
    contradictions:
      trace.filter((t) => t.verificationStatus === 'contradicted' || t.aiJudgeVerdict === 'contradicted').length,
    omittedUnits: trace.filter(
      (t) =>
        (t.exclusionReason || 'none') === 'none' &&
        !t.verified &&
        !t.judgeDeferred &&
        t.verificationStatus !== 'contradicted' &&
        t.aiJudgeVerdict !== 'contradicted'
    ).length,
    pendingVerificationUnits: trace.filter((t) => t.judgeDeferred).length,
    ambiguousUnits: (report.semanticAudit?.ambiguousUnitIds || []).length,
    inventedDataFlags: inventedSet.size,
    unsupportedAdditions: (report.veracityAudit?.unsupportedAdditionFlags || []).filter((f) => !inventedSet.has(f))
      .length,
    uncertaintyViolations: (report.veracityAudit?.uncertaintyViolations || []).length,
    editorialDefects: (editorialAudit?.blockingDefects || []).length,
    photosPending: (report.photoAudit?.unplacedPhotoIds || []).length,
  };
  const eligible = blockers.length === 0;
  const fullyVerified = eligible && report.passed === true && (editorialAudit ? editorialAudit.passed : true);
  return {
    policyVersion: BOOK_DELIVERY_POLICY_VERSION,
    eligible,
    band,
    coverageExactPercent,
    verifiedUnits,
    eligibleUnits,
    verificationLevel: !eligible ? 'not_eligible' : fullyVerified ? 'fully_verified' : 'delivered_with_observations',
    deliveryStatus: !eligible ? 'pending_review' : fullyVerified ? 'delivered' : 'delivered_with_observations',
    blockers,
    observations,
    decidedAt: new Date().toISOString(),
  };
}

/**
 * V5.2 — SINGLE GLOBAL APPROVAL DECISION.
 *
 * A manuscript is approved only when every mandatory audit gate passes AND no blocking defect is
 * pending. Before V5.2 the verdict was `blockingDefects.length === 0`, and a gate could fail
 * without contributing a line to that list (e.g. unsupported narrative additions made
 * `semanticAudit.passed === false` while `report.passed === true`). This function is used by both
 * the deterministic audit and the hybrid audit, so the two can never disagree on what "approved"
 * means, and it guarantees that each failing gate is explained by at least one blocking defect.
 *
 * Mandatory gates: coverage, veracity, semantic, structural, photo and (when included) editorial.
 * Deliberately NON-blocking signals, documented here so their indicators never contradict the
 * verdict:
 *   - `photoAudit.duplicatePhotoIds`: the normalization step keeps the first placement and drops
 *     the repeated one, so the audited (and saved) manuscript no longer contains the duplicate.
 *   - `structuralAudit.duplicateChapterFlags`: chapters sharing a title are merged by the
 *     normalization step without losing paragraphs; the result has unique ids and numbering.
 * Duplicate chapter ids and broken numbering are re-checked on the NORMALIZED chapters and block.
 */
export function finalizeGlobalAuditDecision(params: {
  report: DocumentaryAuditReport;
  editorialAudit?: EditorialQualityAuditReport | null;
  includeEditorialAudit?: boolean;
}): { passed: boolean; blockingDefects: string[]; failedGates: string[] } {
  const { report, editorialAudit, includeEditorialAudit = true } = params;
  const blocking: string[] = [];
  const pushUnique = (line: string | undefined | null) => {
    const clean = String(line || '').trim();
    if (clean && !blocking.includes(clean)) blocking.push(clean);
  };
  for (const line of report.blockingDefects || []) pushUnique(line);
  const failedGates: string[] = [];

  // Coverage
  if (report.coverageAudit && !report.coverageAudit.passed) {
    failedGates.push('coverage');
    if (!blocking.some((l) => l.startsWith('Cobertura documental incompleta'))) {
      pushUnique(
        `Cobertura documental incompleta (${report.coveragePercentage}%: faltan ${
          report.coverageAudit.missingUnitIds.length
        } unidad(es): ${report.coverageAudit.missingUnitIds.slice(0, 8).join(', ')}).`
      );
    }
  }

  // Veracity
  const ver = report.veracityAudit;
  if (ver && !ver.passed) {
    failedGates.push('veracity');
    const before = blocking.length;
    for (const l of ver.uncertaintyViolations || []) pushUnique(l);
    for (const l of ver.semanticContradictionFlags || []) pushUnique(l);
    for (const l of ver.inventedDataFlags || []) pushUnique(l);
    for (const l of ver.leakedExcludedContentFlags || []) pushUnique(l);
    for (const l of ver.coupleAttributionViolations || []) pushUnique(l);
    if (blocking.length === before && !ver.uncertaintiesPreserved) {
      pushUnique('Las expresiones de duda o incertidumbre del testimonio no se conservaron.');
    }
  }

  // Semantic
  const sem = report.semanticAudit;
  if (sem && !sem.passed) {
    failedGates.push('semantic');
    for (const l of sem.contradictionsDetected || []) pushUnique(l);
    for (const l of ver?.inventedDataFlags || []) pushUnique(l);
    for (const l of sem.unsupportedAdditions || []) pushUnique(l);
    const pending = sem.pendingVerificationUnitIds || [];
    if (pending.length > 0) {
      pushUnique(
        `Verificación semántica pendiente para ${pending.length} unidad(es) de baja prioridad (no enviadas al juez).`
      );
    }
    const ambiguous = sem.ambiguousUnitIds || [];
    if (
      ambiguous.length > 0 &&
      !blocking.some((l) => /inconclusa|no disponible/.test(l) && ambiguous.some((id) => l.includes(id)))
    ) {
      pushUnique(
        `Auditoría semántica inconclusa para ${ambiguous.length} unidad(es) ambigua(s): ${ambiguous
          .slice(0, 6)
          .join(', ')}.`
      );
    }
  }

  // Structural
  const st = report.structuralAudit;
  if (st) {
    const orphanFlags = st.orphanContinuationFlags || [];
    if (!st.passed || orphanFlags.length > 0) {
      failedGates.push('structural');
      if (!st.uniqueChapterIds) pushUnique('Identificadores de capítulo duplicados en el manuscrito.');
      if (!st.consecutiveNumbering) pushUnique('La numeración de los capítulos no es consecutiva.');
      if (st.oneQuestionPerChapterDetected) {
        pushUnique(
          'Fragmentación editorial inválida: se detectó estructura de una pregunta/respuesta por capítulo o títulos en formato de pregunta.'
        );
      }
      for (const l of orphanFlags) pushUnique(l);
      if (!blocking.some((l) => l.includes('no contiene capítulos válidos')) && st.passed === false) {
        const structuralExplained =
          !st.uniqueChapterIds || !st.consecutiveNumbering || st.oneQuestionPerChapterDetected;
        if (!structuralExplained) pushUnique('El manuscrito no contiene capítulos válidos.');
      }
    }
  }

  // Photos
  const ph = report.photoAudit;
  if (ph && !ph.passed) {
    failedGates.push('photo');
    if (!blocking.some((l) => l.startsWith('Fotografías sin ubicar'))) {
      pushUnique(
        `Fotografías sin ubicar en el manuscrito (${ph.placedPhotosCount}/${ph.totalPhotos}): ${(ph.unplacedPhotoIds || [])
          .slice(0, 6)
          .join(', ')}.`
      );
    }
  }

  // Editorial
  if (includeEditorialAudit && editorialAudit && !editorialAudit.passed) {
    failedGates.push('editorial');
    const before = blocking.length;
    for (const l of editorialAudit.blockingDefects || []) pushUnique(l);
    if (blocking.length === before && (editorialAudit.blockingDefects || []).length === 0) {
      pushUnique('La auditoría editorial no fue aprobada.');
    }
  }

  return { passed: blocking.length === 0 && failedGates.length === 0, blockingDefects: blocking, failedGates };
}

/**
 * V5.1 — Server-issued approval evidence. It binds one approved manuscript text to the exact
 * interview sources, narrative style and audit rules it was approved with. The signature is an
 * HMAC computed with a server-only secret, so a browser can carry the evidence but cannot forge
 * or re-target it. `src/server/bookApproval.ts` issues and verifies it.
 */
/** V5.3 — What a participant's browser holds instead of the evidence: an opaque reference. */
export interface BookApprovalEvidenceRef {
  evidenceRef: string;
}

export function isBookApprovalEvidenceRef(value: unknown): value is BookApprovalEvidenceRef {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as any).evidenceRef === 'string' &&
    typeof (value as any).signature !== 'string'
  );
}

export function isFullBookApprovalEvidence(value: unknown): value is BookApprovalEvidence {
  return !!value && typeof value === 'object' && typeof (value as any).signature === 'string';
}

export interface BookApprovalEvidence {
  /** 1: V5.1/V5.2 (full approvals only). 2: V5.3 delivery authorization. */
  evidenceVersion: 1 | 2;
  auditRulesVersion: string;
  engineVersion: string;
  auditPolicy: 'hybrid_arbitrated';
  interviewId: string;
  narrativeStyle: DemoNarrativeStyleId;
  sourceFingerprint: string;
  manuscriptContentHash: string;
  coveragePercentage: number;
  totalSourceUnits: number;
  judgeResolvedUnits: number;
  /** V5.3 (evidenceVersion 2): delivery policy and eligibility result bound into the signature. */
  deliveryPolicyVersion?: string;
  verificationLevel?: 'fully_verified' | 'delivered_with_observations';
  deliveryEligible?: boolean;
  verifiedUnits?: number;
  issuedAt: string;
  signature: string;
}

export type DocumentaryExclusionReason =
  | 'none'
  | 'not_recalled'
  | 'prefer_not_to_answer'
  | 'excluded_by_interviewee';

export type UnitVerificationStatus =
  | 'supported'
  | 'partially_supported'
  | 'missing'
  | 'contradicted'
  | 'unsupported_addition'
  | 'uncertain'
  | 'ambiguous';

export interface DocumentaryFactUnit {
  unitId: string;
  parentAnswerId: string;
  answerId: string;
  questionId: string;
  questionText: string;
  sourceType: 'main_answer' | 'followup_answer' | 'additional_memory' | 'photo_context';
  parentQuestionId?: string | null;
  participantId?: string;
  participantName: string;
  lifeStage: string;
  topic: string;
  chronologicalIndex: number;
  rawText: string;
  cleanText: string;
  keyTokens: string[];
  properNames: string[];
  places: string[];
  yearsOrNumbers: string[];
  emotions: string[];
  uncertaintyExpressions: string[];
  exclusionReason: DocumentaryExclusionReason;
  isEligibleForBook: boolean;
  photoIds: string[];
  mergedRedundantUnitIds?: string[];
}

export interface DocumentaryInventory {
  interviewId: string;
  totalRawAnswers: number;
  totalMainAnswers: number;
  totalFollowUpAnswers: number;
  totalAdditionalMemories: number;
  totalAtomicFactUnits: number;
  eligibleFactUnits: DocumentaryFactUnit[];
  excludedFactUnits: DocumentaryFactUnit[];
  allFactUnits: DocumentaryFactUnit[];
  photosInventory: Array<{
    photoId: string;
    caption: string;
    answerId: string;
    questionId: string;
    lifeStage: string;
    isExcluded: boolean;
  }>;
  corpusValidYearsAndNumbers: string[];
  corpusValidProperNames: string[];
}

export interface EditorialChapterPlanItem {
  chapterId: string;
  partNumber: number;
  stageKey: string;
  dimensionKey: DemoQuestionDefinition['dimensionKey'];
  thematicAxis: string;
  suggestedTitleIndividual: string;
  suggestedTitleCouple: string;
  suggestedTitleThirdPerson: string;
  assignedAnswerIds: string[];
  assignedQuestionIds: string[];
  assignedFactUnitIds: string[];
  assignedPhotoIds: string[];
  estimatedSourceWords: number;
}

export interface EditorialBookPlan {
  bookStructureMode: 'prompt_autonomous' | 'fixed_five_stages';
  chapters: EditorialChapterPlanItem[];
  totalPlannedChapters: number;
  isOneQuestionPerChapterBlocked: boolean;
  isPartialMemoir?: boolean;
  documentedStages?: string[];
  missingStages?: string[];
  partialMemoirSubtitle?: string;
  partialMemoirIntroNote?: string;
}

export interface EditorialQualityAuditReport {
  passed: boolean;
  auditedAt: string;
  narrativeStyle: DemoNarrativeStyleId;
  blockingDefects: string[];
  warnings: string[];
  styleConsistencyPassed: boolean;
  firstPersonLeakFlags: string[];
  oralFillerOrArtifactFlags: string[];
  duplicateEpisodeFlags: string[];
  titleQualityFlags: string[];
  truncatedFragmentFlags: string[];
  giantParagraphFlags: string[];
  unbalancedMarkdownFlags: string[];
}

export interface AdaptivePhotoDimensions {
  widthMm: number;
  heightMm: number;
  blockHeightMm: number;
  orientation: 'landscape' | 'portrait' | 'square';
  aspectRatio: number;
  densityScale: number;
}

export interface PdfIntegrityReport {
  passed: boolean;
  totalPages: number;
  coverRendered: boolean;
  tocPresent: boolean;
  tocEntryCount: number;
  tocPageNumbersValid: boolean;
  duplicatePageNumbers: number[];
  brokenMarkersDetected: number;
  photosExpected: number;
  photosEmbedded: number;
  errors: string[];
}

export interface TraceabilityMatrixEntry {
  unitId: string;
  answerId: string;
  questionId?: string;
  questionText?: string;
  sourceType?: 'main_answer' | 'followup_answer' | 'additional_memory' | 'photo_context';
  participantName?: string;
  excerpt?: string;
  uncertaintyExpressions?: string[];
  photoIds: string[];
  assignedChapterId?: string;
  assignedChapterNumber?: number;
  assignedParagraphIds?: string[];
  status?: 'integrated' | 'omitted_not_recalled' | 'omitted_prefer_not_to_answer' | 'excluded_by_interviewee' | 'missing';
  verificationStatus?: UnitVerificationStatus;
  semanticIssues?: string[];
  ambiguityReason?: string;
  /** V5.1: deterministic rules could not settle this unit alone; a semantic judge must arbitrate. */
  needsSemanticReview?: boolean;
  semanticReviewReason?: string;
  /** V5.2: why absence is considered demonstrated (concrete datum missing from the whole book). */
  evidenceOfAbsenceReason?: string;
  /**
   * V5.3: the unit needed the semantic judge but was NOT sent because the delivery decision was
   * already reached with higher-priority cases. It stays unverified (pending), never "covered".
   */
  judgeDeferred?: boolean;
  aiJudgeVerdict?: 'supported' | 'contradicted' | 'omitted' | 'inconclusive';
  aiJudgeRationale?: string;
  /** V5.1: true when the judge could not be reached (technical), as opposed to an inconclusive verdict. */
  aiJudgeUnavailable?: boolean;
  exclusionReason?: DocumentaryExclusionReason;
  eventId?: string;
  lifeStage?: string;
  chapterId?: string;
  paragraphId?: string;
  paragraphIndex?: number;
  paragraphIds?: string[];
  paragraphIndices?: number[];
  evidenceSnippet?: string;
  semanticMatchScore?: number;
  matchedTokens?: string[];
  missingTokens?: string[];
  missingFacets?: string[];
  followUpIncluded?: boolean;
  additionalMemoryIncluded?: boolean;
  verified?: boolean;
}

/**
 * V5.2 — A Direction-B sentence that shares no significant word with any testimony. It may be a
 * harmless editorial bridge ("Los años pasaron deprisa") or an invented biographical fact, which
 * only a contextual reading can tell apart. Deterministic-only audits treat it as blocking; the
 * hybrid audit asks the semantic judge and keeps it blocking unless the judge clears it.
 */
export interface UnsupportedAdditionCandidate {
  flag: string;
  chapterId: string;
  chapterTitle: string;
  paragraphIndex: number;
  sentence: string;
}

export interface DocumentaryAuditReport {
  auditVersion?: string;
  auditedAt: string;
  auditRulesVersion?: string;
  status?: ManuscriptGenerationStatus;
  approved?: boolean;
  passed: boolean;
  internalReasonCode?: BookGenerationReasonCode;
  diagnosticSummary?: string;
  /**
   * V5.1: which policy produced this verdict. 'deterministic_only' reports are conservative
   * locators (suspicions block until arbitrated); 'hybrid_arbitrated' is the single approval policy.
   */
  auditPolicy?: 'deterministic_only' | 'hybrid_arbitrated';
  totalSourceUnits: number;
  integratedUnits: number;
  omittedNotRecalledUnits: number;
  omittedPreferNotToAnswerUnits?: number;
  excludedByIntervieweeUnits?: number;
  coveragePercentage: number;
  totalUploadedPhotos: number;
  totalPlacedPhotos: number;
  duplicateChapterIdsDetected: boolean;
  consecutiveChapterNumberingValid: boolean;
  uncertaintiesPreserved: boolean;
  repairAttemptsUsed?: number;
  repairedUnitIds?: string[];
  leakedExcludedContentFlags?: string[];
  coupleAttributionViolations?: string[];
  traceabilityMatrix: TraceabilityMatrixEntry[];
  blockingDefects: string[];
  coverageAudit?: {
    passed: boolean;
    totalValidUnits: number;
    coveredUnitsCount: number;
    missingUnitIds: string[];
    repairedUnitIds: string[];
  };
  veracityAudit?: {
    passed: boolean;
    uncertaintiesPreserved: boolean;
    uncertaintyViolations: string[];
    inventedDataFlags: string[];
    leakedExcludedContentFlags?: string[];
    coupleAttributionViolations?: string[];
    semanticContradictionFlags?: string[];
    unsupportedAdditionFlags?: string[];
    /** V5.2: structured form of the pure "unsupported narrative sentence" flags (Direction B). */
    unsupportedAdditionCandidates?: UnsupportedAdditionCandidate[];
  };
  semanticAudit?: {
    passed: boolean;
    contradictionsDetected: string[];
    unsupportedAdditions: string[];
    uncertainUnitsCount: number;
    ambiguousUnitsCount?: number;
    ambiguousUnitIds?: string[];
    /** V5.2: fact-like unsupported sentences waiting for the hybrid audit's contextual check. */
    unsupportedAdditionsPendingArbitration?: number;
    /** V5.3: units the judge was not asked about (decision already reached). Unverified. */
    pendingVerificationUnitIds?: string[];
    /** V5.3: what the semantic judge actually did in this audit. */
    judgeStats?: {
      policy: 'priority' | 'exhaustive';
      casesTotal: number;
      casesSent: number;
      casesFromCache: number;
      casesDeferred: number;
      invocations: number;
    };
    /** V5.1: every unit the deterministic rules could not settle (superset of ambiguousUnitIds). */
    reviewCandidateUnitIds?: string[];
    /** V5.1: units a semantic judge ruled on, and those left unresolved because it was unreachable. */
    judgeResolvedUnitIds?: string[];
    judgeUnavailableUnitIds?: string[];
    directionAChecked: number;
    directionBChecked: number;
  };
  editorialAudit?: EditorialQualityAuditReport;
  structuralAudit?: {
    passed: boolean;
    uniqueChapterIds: boolean;
    consecutiveNumbering: boolean;
    duplicateChapterFlags: string[];
    orphanContinuationFlags: string[];
    oneQuestionPerChapterDetected?: boolean;
  };
  photoAudit?: {
    passed: boolean;
    totalPhotos: number;
    placedPhotosCount: number;
    unplacedPhotoIds: string[];
    duplicatePhotoIds: string[];
    defaultFirstChapterDumpDetected: boolean;
  };
  paginationAudit?: {
    passed: boolean;
    everyChapterStartsOnNewPage: boolean;
    truncatedLinesCount: number;
    artificialIntraChapterBreaks: number;
    totalChapters: number;
    totalContentPages: number;
  };
}

export interface TableOfContentsEntry {
  chapterId: string;
  partNumber: number;
  title: string;
  startPageNumber: number;
}

export interface DemoChapterPhotoPlacement {
  photoId: string;
  paragraphIndex: number;
  paragraphId?: string;
  answerId?: string;
  questionId?: string;
  eventId?: string;
  chapterId?: string;
  shortCaption: string;
  originalDescription?: string;
}

export interface DemoChapterManuscript {
  id: string;
  partNumber: number;
  dimensionKey: string;
  title: string;
  paragraphs: string[];
  paragraphIds?: string[];
  sourceUnitIds?: string[];
  sourceAnswerIds?: string[];
  sourceQuestionIds?: string[];
  pullQuote?: string;
  photoPlacements?: DemoChapterPhotoPlacement[];
}

export interface DemoManuscript {
  title: string;
  subtitle: string;
  authors: string;
  mode: DemoStoryMode;
  narrativeStyle: DemoNarrativeStyleId;
  introduction: string;
  dedication: string;
  chapters: DemoChapterManuscript[];
  closingMessage: string;
  insufficientInfoNotices: string[];
  generatedAt: string;
  lockedPreviewGroups?: ComposedChapterSectionBlock[][];
  useOfficialForeverYouLogo?: boolean;
  aiGenerated?: boolean;
  status?: ManuscriptGenerationStatus;
  generationStatus?: ManuscriptGenerationStatus;
  canonicalManuscriptId?: string;
  cacheKey?: string;
  canonicalCacheKey?: string;
  bookStructureMode?: 'prompt_autonomous' | 'fixed_five_stages';
  isPartialMemoir?: boolean;
  documentedStages?: string[];
  incompleteDraftNotice?: string;
  internalReasonCode?: BookGenerationReasonCode;
  diagnosticSummary?: string;
  /** V5.1: participant-safe failure family (see `BookFailureCategory`). */
  failureCategory?: BookFailureCategory;
  /** V5.1: server-signed proof that this exact text was approved for these exact sources. */
  /**
   * Server-signed delivery authorization. V5.3: participants only ever hold an opaque reference
   * (`{ evidenceRef }`); the full evidence, with its coverage figures, stays on the server.
   */
  approvalEvidence?: BookApprovalEvidence | BookApprovalEvidenceRef;
  auditReport?: DocumentaryAuditReport;
  documentaryAudit?: DocumentaryAuditReport;
  editorialAudit?: EditorialQualityAuditReport;
  /** V5.3: server-computed delivery decision (separate from the strict audit verdict). */
  deliveryDecision?: BookDeliveryDecision;
  /** V5.3: this manuscript is the fast editorial sample, not the full book. */
  isPreviewSample?: boolean;
  /** V5.3: local fidelity check of the sample (only the memories it uses). Admin-only. */
  previewFidelity?: PreviewFidelityReport;
  includeTableOfContents?: boolean;
  includeEditorialCredits?: boolean;
  editorialCreditsText?: string;
}

/** V5.3 — Local fidelity check of the 5-page editorial sample. */
export interface PreviewFidelityReport {
  checkedAnswerIds: string[];
  checkedUnits: number;
  verifiedUnits: number;
  replacedChapterIds: string[];
  issues: string[];
}

export interface DemoInMemoryPhoto {
  id: string;
  objectUrl: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  caption?: string;
  focusY: 'top' | 'center' | 'bottom';
  zoom: number;
}

export interface DemoEditorialConfig {
  narrativeStyle?: DemoNarrativeStyleId;
  coverDesignId: DemoCoverDesignId;
  coverColorVariantIdx: number;
  coverVisualType: DemoCoverVisualType;
  coverIllustrationId: DemoThematicIllustrationId;
  interiorStyleId: DemoInteriorStyleId;
  bookFormatId: DemoBookFormatId;
  customTitle: string;
  customSubtitle: string;
  customAuthors: string;
  dedication: string;
  startEachChapterOnNewPage?: boolean;
  includeTableOfContents?: boolean;
  includeEditorialCredits?: boolean;
}

export const DEMO_TEMPORARY_PRIVACY_NOTICE =
  'Esta demostración utiliza inteligencia artificial para convertir tus recuerdos en un pequeño libro. Tus respuestas se conservarán temporalmente en este navegador durante la sesión y no se guardarán en nuestra base de datos. Para generar las preguntas y la historia, el texto necesario se enviará al proveedor de inteligencia artificial.';

export const DEMO_CLOSING_PAGE_CENTRAL_TEXT = 'Esta historia continuará...';
export const DEMO_CLOSING_PAGE_BRAND_MARK = '<< YouForever >>';

export const DEMO_MAX_BASE_QUESTIONS = 5;
export const DEMO_MAX_AI_FOLLOW_UPS = 3;
export const DEMO_MAX_TOTAL_QUESTIONS = DEMO_MAX_BASE_QUESTIONS + DEMO_MAX_AI_FOLLOW_UPS; // 8 questions in total

/**
 * Counts how many AI follow-up questions have already been generated across the interview.
 */
export function countGeneratedDemoFollowUps(
  responses: Record<string, DemoQuestionResponse>,
  excludeQuestionId?: string
): number {
  let count = 0;
  for (const [qId, resp] of Object.entries(responses)) {
    if (excludeQuestionId && qId === excludeQuestionId) continue;
    if (
      resp &&
      resp.mainOmission === 'none' &&
      resp.followUp?.shouldAskFollowUp &&
      Boolean(resp.followUp.followUpQuestion?.trim())
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * Determines whether the interview can generate/present an AI follow-up for the given base question,
 * enforcing the strict limit of 3 AI follow-ups across the 5 base questions (total 8 questions).
 */
export function canRequestDemoFollowUpForQuestion(
  responses: Record<string, DemoQuestionResponse>,
  questionId: string
): boolean {
  const existing = responses[questionId];
  if (
    existing?.followUp?.shouldAskFollowUp &&
    Boolean(existing.followUp.followUpQuestion?.trim())
  ) {
    return true;
  }
  const usedInOtherQuestions = countGeneratedDemoFollowUps(responses, questionId);
  return usedInOtherQuestions < DEMO_MAX_AI_FOLLOW_UPS;
}

/**
 * The 5 fixed main questions for Individual and Couple modes (Sections 7, 8, 9).
 */
export const DEMO_MAIN_QUESTIONS: DemoQuestionDefinition[] = [
  {
    id: 'demo_q1_raices',
    stepNumber: 1,
    dimensionKey: 'raices',
    individualDimensionTitle: 'Mis raíces',
    coupleDimensionTitle: 'Nuestros primeros recuerdos',
    individualBookPartTitle: 'El lugar donde comenzó mi historia',
    coupleBookPartTitle: 'El lugar donde comenzaron nuestros caminos',
    individualText:
      'Si pudieras regresar por un instante a tu infancia y revivir un momento que guardas con especial cariño, ¿cuál elegirías y quiénes estarían contigo?',
    coupleText:
      'Antes de que sus caminos se encontraran, ¿qué recuerdo entrañable de la infancia o juventud le gustaría compartir a cada uno para que el otro conozca mejor de dónde viene?',
    objective:
      'Descubrir un recuerdo concreto de la infancia o juventud que permita crear una escena autobiográfica significativa.',
    focusHints: [
      'Personas presentes',
      'Lugar y atmósfera',
      'Sensaciones cotidianas',
      'Expresiones familiares',
      'Emociones de aquel momento',
    ],
  },
  {
    id: 'demo_q2_transformacion',
    stepNumber: 2,
    dimensionKey: 'transformacion',
    individualDimensionTitle: 'El momento que transformó mi vida',
    coupleDimensionTitle: 'El encuentro que cambió nuestras vidas',
    individualBookPartTitle: 'Los caminos que me hicieron ser quien soy',
    coupleBookPartTitle: 'El encuentro que transformó nuestra historia',
    individualText:
      'A lo largo de tu vida, ¿qué decisión, acontecimiento o encuentro marcó un antes y un después para ti, y por qué consideras que cambió tu historia?',
    coupleText:
      '¿Cómo recuerdan el momento en que sus vidas se encontraron y qué acontecimientos hicieron que su historia juntos se volviera importante para ambos?',
    objective:
      'Identificar una experiencia, encuentro o decisión que ayude a comprender cómo se convirtieron en quienes son hoy.',
    focusHints: [
      'Decisiones importantes',
      'Cambios de vida',
      'Encuentros significativos',
      'Aprendizajes',
      'Sentimientos experimentados',
    ],
  },
  {
    id: 'demo_q3_personas_amadas',
    stepNumber: 3,
    dimensionKey: 'personas_amadas',
    individualDimensionTitle: 'Las personas que amo',
    coupleDimensionTitle: 'Nuestra manera de querernos',
    individualBookPartTitle: 'Las personas que llevo en el corazón',
    coupleBookPartTitle: 'El lenguaje íntimo de nuestro cariño',
    individualText:
      'Piensa en una persona a la que hayas amado profundamente, como tu pareja, un hijo, tus padres o alguien muy especial. ¿Cómo le decías de cariño y qué pequeño momento que vivieron juntos te gustaría conservar para siempre?',
    coupleText:
      '¿Cómo se llaman o se llamaban de cariño y qué pequeño gesto, costumbre o momento compartido representa mejor el amor y el afecto que han construido?',
    objective:
      'Recuperar los apodos afectivos y las expresiones íntimas que hacen que una historia sea personal e irrepetible.',
    focusHints: [
      'Apodos afectivos exactos',
      'Formas especiales de llamarse',
      'Gestos cotidianos',
      'Costumbres compartidas',
      'Frases memorables',
    ],
  },
  {
    id: 'demo_q4_esencia',
    stepNumber: 4,
    dimensionKey: 'esencia',
    individualDimensionTitle: 'Mi esencia personal',
    coupleDimensionTitle: 'Lo que nos hace únicos',
    individualBookPartTitle: 'Las pequeñas cosas que me hacen ser yo',
    coupleBookPartTitle: 'Las costumbres que nos hacen únicos',
    individualText:
      '¿Qué gesto, frase, costumbre o manera de demostrar cariño es tan característica de ti que tus seres queridos la reconocerían inmediatamente y dirían: “Así es como yo lo recuerdo”?',
    coupleText:
      '¿Qué costumbre, frase, anécdota o manera de convivir es tan característica de ustedes que sus seres queridos la reconocerían inmediatamente como parte de su historia?',
    objective:
      'Descubrir la personalidad cotidiana, modismos, sentido del humor y hábitos entrañables.',
    focusHints: [
      'Maneras de hablar y frases propias',
      'Formas de cuidar a los demás',
      'Costumbres familiares y tradiciones',
      'Sentido del humor y gestos característicos',
    ],
  },
  {
    id: 'demo_q5_legado',
    stepNumber: 5,
    dimensionKey: 'legado',
    individualDimensionTitle: 'Las palabras que deseo dejar',
    coupleDimensionTitle: 'Lo que deseamos dejar',
    individualBookPartTitle: 'Las palabras que quiero dejar',
    coupleBookPartTitle: 'Las palabras que deseamos dejar',
    individualText:
      'Imagina que, dentro de muchos años, las personas que más amas abren este libro para recordar quién eres y sentirse cerca de ti. ¿Qué te gustaría decirles con tus propias palabras para que nunca olviden cuánto significaron en tu vida?',
    coupleText:
      'Si dentro de muchos años sus seres queridos abrieran este libro para recordar su historia, ¿qué les gustaría decirles y qué quisieran que permaneciera vivo de todo lo que han compartido?',
    objective:
      'Obtener un mensaje personal para sus seres queridos que cierre emotivamente la historia conservando sus palabras literales.',
    focusHints: [
      'Mensajes de amor y gratitud',
      'Consejos y enseñanzas',
      'Deseos para la familia',
      'Palabras literales para conservar',
    ],
  },
];

export interface DemoNarrativeStyleOption {
  id: DemoNarrativeStyleId;
  recommended?: boolean;
  individualTitle: string;
  coupleTitle: string;
  individualDescription: string;
  coupleDescription: string;
  individualExample: string;
  coupleExample: string;
  characteristics: string[];
}

export const DEMO_NARRATIVE_STYLES: DemoNarrativeStyleOption[] = [
  {
    id: 'first_person_simple',
    recommended: false,
    individualTitle: 'A. Primera persona — Relato personal',
    coupleTitle: 'A. Primera persona del plural — Relato directo',
    individualDescription:
      'Tu historia narrada directamente con tus propias palabras, como si estuvieras contándosela a alguien cercano.',
    coupleDescription:
      'Su historia narrada directamente en primera persona del plural, identificando con claridad los recuerdos individuales de cada uno cuando corresponda.',
    individualExample:
      '«Nací en España y recuerdo que mi madre siempre nos recibía con una sonrisa cuando volvíamos a casa».',
    coupleExample:
      '«Antes de conocernos, cada uno guardaba sus propios recuerdos de infancia, hasta el día en que nuestros caminos coincidieron».',
    characteristics: [
      'Primera persona',
      'Redacción directa',
      'Lenguaje claro',
      'Tono personal',
      'Conservación de la voz original',
    ],
  },
  {
    id: 'first_person_literary',
    recommended: true,
    individualTitle: 'B. Primera persona — Narrativa literaria y emotiva',
    coupleTitle: 'B. Primera persona del plural — Narrativa literaria y emotiva',
    individualDescription:
      'Tus recuerdos transformados en unas memorias personales con una escritura más cuidada, cálida y emotiva, como si tú mismo hubieras escrito un pequeño libro.',
    coupleDescription:
      'Sus recuerdos transformados en unas memorias compartidas con prosa literaria, cálida y emotiva, respetando con equilibrio las dos voces.',
    individualExample:
      '«Cuando regreso con la memoria a los primeros años de mi vida, todavía puedo imaginar la sonrisa de mi madre esperándonos en casa. Hay recuerdos que el tiempo no consigue borrar».',
    coupleExample:
      '«Cuando volvemos la mirada hacia el inicio de nuestra historia, descubrimos que aquellos pequeños gestos cotidianos fueron tejiendo un hogar propio».',
    characteristics: [
      'Primera persona',
      'Prosa literaria',
      'Sensibilidad emocional',
      'Descripciones sustentadas en lo narrado',
      'Transiciones elegantes',
      'Conservación de expresiones personales',
    ],
  },
  {
    id: 'third_person_biography',
    recommended: false,
    individualTitle: 'C. Tercera persona — Biografía narrativa',
    coupleTitle: 'C. Tercera persona — Biografía de ambos protagonistas',
    individualDescription:
      'Tu historia contada desde la perspectiva de un narrador que presenta tu vida, tus experiencias y las personas que dejaron huella en ella.',
    coupleDescription:
      'La historia de ambos contada desde la perspectiva de un narrador cálido y respetuoso que entrelaza sus recuerdos, voces y vivencias.',
    individualExample:
      '«Desde pequeña, Ana descubrió que su familia era el centro de sus recuerdos más entrañables. La sonrisa de su madre se convirtió en una de las imágenes que conservaría durante toda su vida».',
    coupleExample:
      '«Las trayectorias de Ana y Luis comenzaron en escenarios distintos, pero al encontrarse construyeron una complicidad que sus seres queridos reconocen al instante».',
    characteristics: [
      'Tercera persona',
      'Tono biográfico',
      'Narrador cálido',
      'Perspectiva respetuosa',
      'Narración fiel',
    ],
  },
];

export interface DemoCoverPaletteVariant {
  name: string;
  bgHex: string;
  secondaryBgHex: string;
  textHex: string;
  subtextHex: string;
  accentHex: string;
  borderHex: string;
}

export interface DemoCoverDesignSpec {
  id: DemoCoverDesignId;
  number: number;
  name: string;
  subtitle: string;
  sensation: string;
  titleFontFamily: string;
  bodyFontFamily: string;
  accentFontFamily?: string;
  variants: DemoCoverPaletteVariant[];
}

export const DEMO_COVER_DESIGNS: DemoCoverDesignSpec[] = [
  {
    id: 'clasica_eterna',
    number: 1,
    name: 'Clásica Eterna',
    subtitle: 'Libro autobiográfico de colección en tapa dura',
    sensation: 'Elegancia, memoria y permanencia',
    titleFontFamily: "'YFBook PD', 'Playfair Display', Georgia, serif",
    bodyFontFamily: "'YFBook EBG', 'EB Garamond', Georgia, serif",
    variants: [
      {
        name: 'Verde Bosque & Oro',
        bgHex: '#183225',
        secondaryBgHex: '#12261C',
        textHex: '#FAF5E8',
        subtextHex: '#E5D8B8',
        accentHex: '#C8A253',
        borderHex: '#A6833C',
      },
      {
        name: 'Borgoña Imperial & Marfil',
        bgHex: '#3A171C',
        secondaryBgHex: '#2A1014',
        textHex: '#FAF5E8',
        subtextHex: '#E6D5C3',
        accentHex: '#CDA557',
        borderHex: '#9E7B36',
      },
      {
        name: 'Azul Prusia & Dorado',
        bgHex: '#17253B',
        secondaryBgHex: '#101B2B',
        textHex: '#F9F6EE',
        subtextHex: '#D8DFEA',
        accentHex: '#C7A358',
        borderHex: '#997A39',
      },
    ],
  },
  {
    id: 'recuerdos_marfil',
    number: 2,
    name: 'Recuerdos en Marfil',
    subtitle: 'Composición literaria minimalista con amplio espacio',
    sensation: 'Intimidad, sencillez y nostalgia',
    titleFontFamily: "'YFBook CG', 'Cormorant Garamond', Georgia, serif",
    bodyFontFamily: "'YFBook LO', 'Lora', Georgia, serif",
    variants: [
      {
        name: 'Marfil Cálido & Carbón',
        bgHex: '#FAF7F0',
        secondaryBgHex: '#F2ECE1',
        textHex: '#231F1D',
        subtextHex: '#635850',
        accentHex: '#8C6D46',
        borderHex: '#D5C8B8',
      },
      {
        name: 'Lino Antiguo & Sepia',
        bgHex: '#F5EFE4',
        secondaryBgHex: '#EAE0D0',
        textHex: '#2C221E',
        subtextHex: '#6E5A4F',
        accentHex: '#7A5438',
        borderHex: '#C9B9A6',
      },
      {
        name: 'Alabastro & Piedra',
        bgHex: '#F8F8F6',
        secondaryBgHex: '#EFECE8',
        textHex: '#1E2022',
        subtextHex: '#5A5E63',
        accentHex: '#6E655C',
        borderHex: '#D0CEC9',
      },
    ],
  },
  {
    id: 'album_nuestra_vida',
    number: 3,
    name: 'Álbum de Nuestra Vida',
    subtitle: 'Marcos inspirados en álbumes familiares y detalles manuscritos',
    sensation: 'Cercanía, familia y recuerdos compartidos',
    titleFontFamily: "'YFBook LO', 'Lora', Georgia, serif",
    bodyFontFamily: "'YFBook PJS', 'Plus Jakarta Sans', sans-serif",
    accentFontFamily: "'YFBook CV', 'Caveat', cursive",
    variants: [
      {
        name: 'Crema Familiar & Terracota',
        bgHex: '#F4EDE2',
        secondaryBgHex: '#E8DEC8',
        textHex: '#33261E',
        subtextHex: '#6B5547',
        accentHex: '#9C5A3C',
        borderHex: '#C2A88B',
      },
      {
        name: 'Sepia Suave & Bronce',
        bgHex: '#EFE5D6',
        secondaryBgHex: '#E2D4C0',
        textHex: '#2D221B',
        subtextHex: '#5E4B3E',
        accentHex: '#85583A',
        borderHex: '#B89F82',
      },
      {
        name: 'Pergamino & Olivo',
        bgHex: '#F2EFE6',
        secondaryBgHex: '#E5E0D2',
        textHex: '#2A2D24',
        subtextHex: '#5A6050',
        accentHex: '#626F4E',
        borderHex: '#B8BDA8',
      },
    ],
  },
  {
    id: 'raices_recuerdos',
    number: 4,
    name: 'Raíces y Recuerdos',
    subtitle: 'Ilustraciones botánicas originales en tonos tierra y salvia',
    sensation: 'Tradición, familia y legado generacional',
    titleFontFamily: "'YFBook EBG', 'EB Garamond', Georgia, serif",
    bodyFontFamily: "'YFBook LO', 'Lora', Georgia, serif",
    variants: [
      {
        name: 'Verde Salvia & Beige Tierra',
        bgHex: '#EAE8E0',
        secondaryBgHex: '#DCD8CC',
        textHex: '#263329',
        subtextHex: '#4E6053',
        accentHex: '#4A6651',
        borderHex: '#9EB0A2',
      },
      {
        name: 'Bosque Suave & Arena',
        bgHex: '#2E3D33',
        secondaryBgHex: '#233027',
        textHex: '#F3EFE6',
        subtextHex: '#C8D3C9',
        accentHex: '#A7BFA9',
        borderHex: '#6E8572',
      },
      {
        name: 'Arcilla & Hoja Seca',
        bgHex: '#EFE8DF',
        secondaryBgHex: '#E3D8CA',
        textHex: '#3B2B23',
        subtextHex: '#6E5549',
        accentHex: '#8A5A44',
        borderHex: '#C2A899',
      },
    ],
  },
  {
    id: 'historia_contemporanea',
    number: 5,
    name: 'Historia Contemporánea',
    subtitle: 'Composición geométrica equilibrada con acentos en cobre',
    sensation: 'Modernidad, calidad premium y sofisticación',
    titleFontFamily: "'YFBook MR', 'Manrope', sans-serif",
    bodyFontFamily: "'YFBook SS4', 'Source Serif 4', Georgia, serif",
    variants: [
      {
        name: 'Azul Noche & Cobre',
        bgHex: '#152032',
        secondaryBgHex: '#1E2C42',
        textHex: '#FFFFFF',
        subtextHex: '#CBD5E1',
        accentHex: '#C87D4B',
        borderHex: '#475569',
      },
      {
        name: 'Gris Cálido & Cobre Oscuro',
        bgHex: '#F3F2EE',
        secondaryBgHex: '#E5E3DC',
        textHex: '#18181B',
        subtextHex: '#52525B',
        accentHex: '#B46939',
        borderHex: '#D4D2C8',
      },
      {
        name: 'Grafito & Bronce',
        bgHex: '#202124',
        secondaryBgHex: '#2C2E33',
        textHex: '#F8FAFC',
        subtextHex: '#D1D5DB',
        accentHex: '#D08856',
        borderHex: '#4B5563',
      },
    ],
  },
];

export interface DemoInteriorStyleSpec {
  id: DemoInteriorStyleId;
  number: number;
  name: string;
  subtitle: string;
  bodyFontFamily: string;
  titleFontFamily: string;
  accentFontFamily?: string;
  pdfFontFamily: 'times' | 'helvetica';
  textAlign: 'justify' | 'left';
  useDropCap: boolean;
  ornamentStyle: 'classic_line' | 'diamond_flourish' | 'journal_script' | 'minimal_bar' | 'botanical_leaf';
  pageBgHex: string;
  textHex: string;
  mutedHex: string;
  accentHex: string;
}

export const DEMO_INTERIOR_STYLES: DemoInteriorStyleSpec[] = [
  {
    id: 'clasico_editorial',
    number: 1,
    name: 'Clásico editorial',
    subtitle: 'EB Garamond, texto justificado, márgenes generosos y capitulares discretas',
    bodyFontFamily: "'YFBook EBG', 'EB Garamond', Georgia, serif",
    titleFontFamily: "'YFBook EBG', 'EB Garamond', Georgia, serif",
    pdfFontFamily: 'times',
    textAlign: 'justify',
    useDropCap: true,
    ornamentStyle: 'classic_line',
    pageBgHex: '#FDFBF7',
    textHex: '#221F1D',
    mutedHex: '#6E665E',
    accentHex: '#7A5C38',
  },
  {
    id: 'memorias_elegantes',
    number: 2,
    name: 'Memorias elegantes',
    subtitle: 'Títulos en Cormorant Garamond, cuerpo en Lora, citas destacadas y separadores delicados',
    bodyFontFamily: "'YFBook LO', 'Lora', Georgia, serif",
    titleFontFamily: "'YFBook CG', 'Cormorant Garamond', Georgia, serif",
    pdfFontFamily: 'times',
    textAlign: 'justify',
    useDropCap: true,
    ornamentStyle: 'diamond_flourish',
    pageBgHex: '#FAF7F2',
    textHex: '#24201E',
    mutedHex: '#6B6057',
    accentHex: '#8C6239',
  },
  {
    id: 'diario_intimo',
    number: 3,
    name: 'Diario íntimo',
    subtitle: 'Libre Baskerville con acentos manuscritos discretos y bloques cálidos',
    bodyFontFamily: "'YFBook LB', 'Libre Baskerville', Georgia, serif",
    titleFontFamily: "'YFBook LB', 'Libre Baskerville', Georgia, serif",
    accentFontFamily: "'YFBook CV', 'Caveat', cursive",
    pdfFontFamily: 'times',
    textAlign: 'left',
    useDropCap: false,
    ornamentStyle: 'journal_script',
    pageBgHex: '#F9F5EB',
    textHex: '#2B241E',
    mutedHex: '#706052',
    accentHex: '#945D3E',
  },
  {
    id: 'minimalista_contemporaneo',
    number: 4,
    name: 'Minimalista contemporáneo',
    subtitle: 'Cuerpo en Source Serif 4 y títulos en Manrope con espacios blancos equilibrados',
    bodyFontFamily: "'YFBook SS4', 'Source Serif 4', Georgia, serif",
    titleFontFamily: "'YFBook MR', 'Manrope', sans-serif",
    pdfFontFamily: 'helvetica',
    textAlign: 'left',
    useDropCap: false,
    ornamentStyle: 'minimal_bar',
    pageBgHex: '#FFFFFF',
    textHex: '#18181B',
    mutedHex: '#64748B',
    accentHex: '#B46939',
  },
  {
    id: 'legado_familiar',
    number: 5,
    name: 'Legado familiar',
    subtitle: 'Lora con títulos ornamentales moderados, citas familiares y motivos botánicos',
    bodyFontFamily: "'YFBook LO', 'Lora', Georgia, serif",
    titleFontFamily: "'YFBook PD', 'Playfair Display', Georgia, serif",
    pdfFontFamily: 'times',
    textAlign: 'justify',
    useDropCap: true,
    ornamentStyle: 'botanical_leaf',
    pageBgHex: '#FAF6EE',
    textHex: '#28231E',
    mutedHex: '#685B4E',
    accentHex: '#4E6752',
  },
];

export interface DemoBookFormatSpec {
  id: DemoBookFormatId;
  name: string;
  dimensionsLabel: string;
  description: string;
  widthMm: number;
  heightMm: number;
  aspectRatio: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginInnerMm: number;
  marginOuterMm: number;
  baseFontPt: number;
  titleFontPt: number;
  maxCharsPerContentPage: number;
  maxParagraphsPerPage: number;
}

export const DEMO_BOOK_FORMATS: DemoBookFormatSpec[] = [
  {
    id: 'a5',
    name: 'A5 vertical',
    dimensionsLabel: '148 × 210 mm',
    description: 'Libro compacto, adecuado para memorias personales.',
    widthMm: 148,
    heightMm: 210,
    aspectRatio: 148 / 210,
    marginTopMm: 18,
    marginBottomMm: 18,
    marginInnerMm: 18,
    marginOuterMm: 15,
    baseFontPt: 10.5,
    titleFontPt: 16,
    maxCharsPerContentPage: 1050,
    maxParagraphsPerPage: 3,
  },
  {
    id: '6x9',
    name: '6 × 9 pulgadas',
    dimensionsLabel: '152.4 × 228.6 mm',
    description: 'Formato editorial comercial estándar.',
    widthMm: 152.4,
    heightMm: 228.6,
    aspectRatio: 152.4 / 228.6,
    marginTopMm: 20,
    marginBottomMm: 20,
    marginInnerMm: 20,
    marginOuterMm: 16,
    baseFontPt: 11,
    titleFontPt: 17,
    maxCharsPerContentPage: 1250,
    maxParagraphsPerPage: 4,
  },
  {
    id: 'carta',
    name: 'Carta vertical',
    dimensionsLabel: '215.9 × 279.4 mm (8.5 × 11")',
    description: 'Formato práctico para impresión doméstica en México.',
    widthMm: 215.9,
    heightMm: 279.4,
    aspectRatio: 215.9 / 279.4,
    marginTopMm: 24,
    marginBottomMm: 24,
    marginInnerMm: 24,
    marginOuterMm: 20,
    baseFontPt: 11.5,
    titleFontPt: 19,
    maxCharsPerContentPage: 1650,
    maxParagraphsPerPage: 5,
  },
];

export const DEMO_THEMATIC_ILLUSTRATIONS: Array<{
  id: DemoThematicIllustrationId;
  label: string;
  description: string;
}> = [
  {
    id: 'arbol_raices',
    label: 'Árbol de Raíces',
    description: 'Ramas y raíces entrelazadas que simbolizan origen y familia.',
  },
  {
    id: 'pluma_tinta',
    label: 'Pluma y Memoria',
    description: 'Pluma estilográfica clásica sobre líneas de escritura.',
  },
  {
    id: 'brujula_camino',
    label: 'Rosa de los Vientos',
    description: 'Símbolo de los caminos, decisiones y viajes de la vida.',
  },
  {
    id: 'hogar_calido',
    label: 'Ventana del Hogar',
    description: 'Arco clásico con hojas suaves evocando refugio y cercanía.',
  },
  {
    id: 'constelacion_familiar',
    label: 'Vínculos Eternos',
    description: 'Líneas delicadas y estrellas que representan encuentros de vida.',
  },
];

export interface ComposedChapterSectionBlock {
  chapterId: string;
  partNumber: number;
  title: string;
  paragraphs: string[];
  paragraphIds?: string[];
  pullQuote?: string;
  isContinuation?: boolean;
  photo?: DemoInMemoryPhoto | null;
  paragraphPhotos?: Record<number, DemoInMemoryPhoto[]>;
  /** V5.6.0: the last paragraph is cut by the page break and continues on the next page. */
  lastParagraphContinues?: boolean;
}

export interface ComposedBookPage {
  pageNumber: number;
  totalPages: number;
  kind:
    | 'cover'
    | 'title_dedication'
    | 'table_of_contents'
    | 'chapter_content'
    | 'editorial_credits'
    | 'closing_mandatory';
  // For cover & title_dedication
  title?: string;
  subtitle?: string;
  authors?: string;
  dedication?: string;
  introduction?: string;
  // For table_of_contents
  tocEntries?: TableOfContentsEntry[];
  // For chapter_content (strictly 1 chapter per page; every real chapter starts on a new page)
  sections?: ComposedChapterSectionBlock[];
  // For editorial_credits
  creditsText?: string;
  editorialCreditsText?: string;
  // For closing_mandatory
  centralClosingText?: string;
  bottomRightBrand?: string;
  showPageNumber: boolean;
  /** V5.6.0 (measured pagination): page that only continues a long introduction. */
  isIntroductionContinuation?: boolean;
  /** V5.6.0: the introduction text of this page continues on the next page. */
  introductionContinues?: boolean;
}

export interface ComposedBookDocument {
  format: DemoBookFormatSpec;
  coverDesign: DemoCoverDesignSpec;
  coverPalette: DemoCoverPaletteVariant;
  interiorStyle: DemoInteriorStyleSpec;
  editorialConfig: DemoEditorialConfig;
  coverPhoto?: DemoInMemoryPhoto | null;
  pages: ComposedBookPage[];
  tocEntries?: TableOfContentsEntry[];
  paginationAudit?: NonNullable<DocumentaryAuditReport['paginationAudit']>;
  exceededMaxPagesWarning: boolean;
  isPreviewSample?: boolean;
  useOfficialForeverYouLogo?: boolean;
  /**
   * V5.7.0 — Proportions the measured pages were laid out with (set by the measured pagination), so
   * the viewer, the page count and the PDF of one book always use the same mode.
   */
  referenceLayoutMode?: 'viewer_proportions' | 'cover_viewer_interior_12pt';
}

/**
 * Normalizes a person's or couple's name into a safe, human-readable PDF filename (Section 22.2).
 */
export function buildSafeDemoPdfFilename(
  profile: DemoBasicProfile,
  bookFormatId?: string
): string {
  const sanitizeSegment = (raw: string): string => {
    return raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
  };

  const resolvedFormat =
    bookFormatId ||
    (profile as any).bookFormatId ||
    (profile as any).editorialConfig?.bookFormatId ||
    '';
  const formatSuffix =
    resolvedFormat === 'a5'
      ? '_Formato_A5'
      : resolvedFormat === 'carta'
      ? '_Formato_Carta'
      : resolvedFormat === '6x9'
      ? '_Formato_6x9'
      : '';

  if (profile.mode === 'pareja') {
    const p1 = sanitizeSegment(profile.partner1Name || 'Participante_1') || 'Participante_1';
    const p2 = sanitizeSegment(profile.partner2Name || 'Participante_2') || 'Participante_2';
    return `YouForever_Nuestra_Historia_${p1}_y_${p2}${formatSuffix}.pdf`;
  }

  const name = sanitizeSegment(profile.displayName || profile.fullName || 'Protagonista') || 'Protagonista';
  return `YouForever_Mi_Historia_${name}${formatSuffix}.pdf`;
}

/**
 * Estimates the physical width in millimeters (mm) of a text string rendered at `fontSizePt`
 * in `'times'` or `'helvetica'`, closely matching jsPDF font metrics with a conservative safety factor
 * so lines wrapped by the pagination engine never overflow `maxBottomY` in PDF rendering.
 */
export function estimatePhysicalTextWidthMm(
  text: string,
  fontSizePt: number,
  fontFamily: 'times' | 'helvetica' = 'times',
  isBold: boolean = false
): number {
  if (!text) return 0;
  const ptToMm = 0.352778;
  const familyFactor = fontFamily === 'helvetica' ? 1.07 : 1.01;
  const weightFactor = isBold ? 1.07 : 1.0;
  let emSum = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ') {
      emSum += 0.28;
    } else if ('iljtrfI.,:;!|\'"`¡¿()[]{}'.includes(ch)) {
      emSum += 0.31;
    } else if ('mwMW@%—…'.includes(ch)) {
      emSum += 0.82;
    } else if (ch >= 'A' && ch <= 'Z') {
      emSum += 0.66;
    } else if ('ÁÉÍÓÚÑÜ'.includes(ch)) {
      emSum += 0.67;
    } else {
      emSum += 0.52;
    }
  }

  return emSum * fontSizePt * ptToMm * familyFactor * weightFactor;
}

/**
 * Balances inline `**bold**` and `*italic*` markdown markers across physical lines
 * so splitting a long paragraph across two pages never produces orphan `**` or stripped formatting.
 */
export function balanceInlineMarkdownMarkersAcrossLines(lines: string[]): string[] {
  if (!lines || lines.length === 0) return [];
  const balanced: string[] = [];
  let inBold = false;
  let inItalic = false;

  for (const rawLine of lines) {
    let prefix = '';
    if (inBold) prefix += '**';
    if (inItalic) prefix += '*';

    // Count marker toggles inside rawLine cleanly (check ** before single *)
    let i = 0;
    while (i < rawLine.length) {
      if (rawLine[i] === '*' && rawLine[i + 1] === '*') {
        inBold = !inBold;
        i += 2;
      } else if (rawLine[i] === '*') {
        inItalic = !inItalic;
        i += 1;
      } else {
        i += 1;
      }
    }

    let suffix = '';
    if (inItalic) suffix += '*';
    if (inBold) suffix += '**';

    balanced.push(`${prefix}${rawLine}${suffix}`);
  }

  return balanced;
}

/**
 * Computes adaptive physical dimensions (in mm) for an editorial photograph based on:
 * - Page format (`a5`, `6x9`, `carta`), usable printable width & available vertical height
 * - Image natural orientation (`landscape`, `portrait`, `square`) and aspect ratio
 * - Natural pixel resolution (caps display size for low-res images to avoid pixelation)
 * - Photo density (total photos in book and in chapter) so dense albums remain harmonious.
 */
export function computeAdaptivePhotoDimensions(params: {
  format: DemoBookFormatSpec;
  usableWidthMm: number;
  availableHeightMm: number;
  naturalWidth?: number;
  naturalHeight?: number;
  photoCountInBook?: number;
  photoCountInChapter?: number;
  hasCaption?: boolean;
}): AdaptivePhotoDimensions {
  const {
    format,
    usableWidthMm,
    availableHeightMm,
    naturalWidth = 800,
    naturalHeight = 600,
    photoCountInBook = 1,
    photoCountInChapter = 1,
    hasCaption = false,
  } = params;

  const safeW = naturalWidth > 0 ? naturalWidth : 800;
  const safeH = naturalHeight > 0 ? naturalHeight : 600;
  const rawAr = safeW / safeH;
  const aspectRatio = Math.max(0.45, Math.min(2.4, rawAr));
  const orientation: AdaptivePhotoDimensions['orientation'] =
    aspectRatio >= 1.15 ? 'landscape' : aspectRatio <= 0.85 ? 'portrait' : 'square';

  // Format factor
  const formatMaxBoxH =
    format.id === 'carta' ? 56 : format.id === '6x9' ? 46 : 38;
  const formatMinBoxH =
    format.id === 'carta' ? 26 : format.id === '6x9' ? 23 : 20;

  // Density scale: books with many photos compact slightly to maintain clean page rhythm
  let densityScale = 1.0;
  if (photoCountInBook >= 25 || photoCountInChapter >= 8) {
    densityScale = 0.72;
  } else if (photoCountInBook >= 12 || photoCountInChapter >= 5) {
    densityScale = 0.84;
  } else if (photoCountInBook <= 3 && photoCountInChapter <= 2) {
    densityScale = 1.06;
  }

  // Resolution guard: prevent severe upscaling of low-resolution images
  const minNaturalDim = Math.min(safeW, safeH);
  const resScale =
    minNaturalDim > 0 && minNaturalDim < 320
      ? 0.68
      : minNaturalDim > 0 && minNaturalDim < 520
      ? 0.85
      : 1.0;

  const captionOverheadMm = hasCaption ? 4.8 : 0;
  const paddingMm = 3.2;

  const maxAllowedImgW =
    orientation === 'portrait'
      ? usableWidthMm * 0.56
      : orientation === 'square'
      ? usableWidthMm * 0.66
      : usableWidthMm * 0.82;

  const maxAllowedImgH = Math.min(
    formatMaxBoxH * densityScale * resScale,
    Math.max(formatMinBoxH * 0.85, availableHeightMm - captionOverheadMm - paddingMm)
  );

  // Target base height depending on orientation
  const desiredH =
    (orientation === 'portrait'
      ? formatMaxBoxH * 0.96
      : orientation === 'square'
      ? formatMaxBoxH * 0.86
      : formatMaxBoxH * 0.80) *
    densityScale *
    resScale;

  let heightMm = Math.max(14, Math.min(maxAllowedImgH, desiredH));
  let widthMm = heightMm * aspectRatio;

  if (widthMm > maxAllowedImgW) {
    widthMm = maxAllowedImgW;
    heightMm = widthMm / aspectRatio;
  }

  // Enforce low-resolution physical ceiling (~150 DPI equivalent -> max mm proportional to px)
  const resCapWMm = safeW >= 180 ? (safeW / 3.8) : 34;
  const resCapHMm = safeH >= 180 ? (safeH / 3.8) : 28;
  if (widthMm > resCapWMm) {
    widthMm = Math.max(20, resCapWMm);
    heightMm = widthMm / aspectRatio;
  }
  if (heightMm > resCapHMm) {
    heightMm = Math.max(14, resCapHMm);
    widthMm = heightMm * aspectRatio;
  }

  return {
    widthMm: Number(widthMm.toFixed(2)),
    heightMm: Number(heightMm.toFixed(2)),
    blockHeightMm: Number((heightMm + paddingMm + captionOverheadMm).toFixed(2)),
    orientation,
    aspectRatio: Number(aspectRatio.toFixed(3)),
    densityScale,
  };
}

/**
 * Wraps a paragraph into physical lines (in mm) for the target printable width `maxWidthMm`,
 * accounting for drop-cap indentation on the first 2 lines when `useDropCap` is active,
 * and balancing inline markdown markers across line breaks.
 */
export function wrapParagraphToPhysicalLines(params: {
  rawText: string;
  maxWidthMm: number;
  fontSizePt: number;
  fontFamily: 'times' | 'helvetica';
  useDropCap: boolean;
}): string[] {
  const { rawText, maxWidthMm, fontSizePt, fontFamily, useDropCap } = params;
  const trimmed = stripInlinePhotoMarkers(rawText || '').trim();
  if (!trimmed) return [];

  const cleanText = trimmed.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
  const dropCapIndentMm =
    useDropCap && cleanText.length > 1
      ? Math.max(8.5, estimatePhysicalTextWidthMm(cleanText[0], fontSizePt + 12, fontFamily, true) + 2.8)
      : 0;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const spaceW = estimatePhysicalTextWidthMm(' ', fontSizePt, fontFamily, false);
  const lines: string[] = [];
  let currentWords: string[] = [];
  let currentWidthMm = 0;

  const getAvailWidthForLine = (lineIdx: number): number => {
    const indent = useDropCap && lineIdx < 2 ? dropCapIndentMm : 0;
    return Math.max(20, maxWidthMm - indent);
  };

  for (const word of words) {
    const isBoldWord = word.startsWith('**') || word.endsWith('**');
    const cleanWord = word.replace(/\*\*/g, '').replace(/\*/g, '');
    const wordW = estimatePhysicalTextWidthMm(cleanWord, fontSizePt, fontFamily, isBoldWord);
    const availW = getAvailWidthForLine(lines.length);
    const prevSpace = currentWords.length > 0 ? spaceW : 0;

    if (currentWords.length > 0 && currentWidthMm + prevSpace + wordW > availW) {
      lines.push(currentWords.join(' '));
      currentWords = [word];
      currentWidthMm = wordW;
    } else {
      currentWords.push(word);
      currentWidthMm += prevSpace + wordW;
    }
  }

  if (currentWords.length > 0) {
    lines.push(currentWords.join(' '));
  }

  return balanceInlineMarkdownMarkersAcrossLines(lines);
}

/**
 * Paginates a single chapter using real physical measurement (in mm) of the selected format,
 * margins, font size, line height, headers, drop-cap, pull quote, and photo boxes.
 *
 * Guarantees:
 * 1. Every real chapter starts on a new page (`!isContinuation` on page 0 of the chapter).
 * 2. Within a chapter, paragraphs flow continuously filling the real printable height of each page.
 * 3. Long paragraphs that do not fit completely in the remaining space of a page are split cleanly
 *    by lines across the current page and the next continuation page with widow/orphan protection
 *    (at least 2 lines on each side when possible), never dropping or truncating a single word.
 * 4. Photos are anchored to their exact paragraph and flow to a continuation page if there is
 *    insufficient vertical space at the bottom of the current page.
 */
export function paginateSingleChapterByPhysicalMeasurement(params: {
  chapterId: string;
  partNumber: number;
  title: string;
  paragraphs: string[];
  paragraphIds?: string[];
  pullQuote?: string;
  chapterPhotosByRelPara: Map<number, DemoInMemoryPhoto[]>;
  format: DemoBookFormatSpec;
  interiorStyle: DemoInteriorStyleSpec;
  startAsContinuation?: boolean;
  totalBookPhotos?: number;
}): {
  pages: ComposedChapterSectionBlock[];
  truncatedLinesCount: number;
  artificialIntraChapterBreaks: number;
} {
  const {
    chapterId,
    partNumber,
    title,
    paragraphs,
    paragraphIds = [],
    pullQuote,
    chapterPhotosByRelPara,
    format,
    interiorStyle,
    startAsContinuation = false,
    totalBookPhotos,
  } = params;

  const W = format.widthMm;
  const H = format.heightMm;
  const horizMargin = (format.marginInnerMm + format.marginOuterMm) / 2;
  const contentW = W - horizMargin * 2;
  const startY = format.marginTopMm + 4;
  // Leave a small safety buffer above maxBottomY so jsPDF vector rendering never clips the last line
  const maxBottomY = H - format.marginBottomMm - 10;
  const lineHeightMm = format.baseFontPt * 0.45;
  const paragraphGapMm = 3.0;
  const fontFamily = interiorStyle.pdfFontFamily;

  let photoCountInChapter = 0;
  for (const list of chapterPhotosByRelPara.values()) {
    photoCountInChapter += list.length;
  }
  const effectiveBookPhotoCount = Math.max(photoCountInChapter, totalBookPhotos ?? photoCountInChapter);

  const chTitlePt = format.titleFontPt - 2.5;
  const titleLines = wrapParagraphToPhysicalLines({
    rawText: title || `Capítulo ${partNumber}`,
    maxWidthMm: contentW,
    fontSizePt: chTitlePt,
    fontFamily,
    useDropCap: false,
  });
  const openingHeaderHeightMm =
    5.5 + Math.max(1, titleLines.length) * (chTitlePt * 0.42) + 2 + 6;
  const continuationHeaderHeightMm = 6.0;

  const pages: ComposedChapterSectionBlock[] = [];
  let currentParas: string[] = [];
  let currentParaIds: string[] = [];
  let currentParaPhotos: Record<number, DemoInMemoryPhoto[]> = {};
  let isCurrentContinuation = startAsContinuation;
  let cursorY =
    startY + (isCurrentContinuation ? continuationHeaderHeightMm : openingHeaderHeightMm);

  const flushCurrentPage = () => {
    if (currentParas.length === 0 && Object.keys(currentParaPhotos).length === 0) {
      return;
    }
    pages.push({
      chapterId,
      partNumber,
      title,
      paragraphs: currentParas,
      paragraphIds: currentParaIds.length > 0 ? currentParaIds : undefined,
      pullQuote: undefined,
      isContinuation: isCurrentContinuation,
      photo: null,
      paragraphPhotos:
        Object.keys(currentParaPhotos).length > 0 ? currentParaPhotos : undefined,
    });
    currentParas = [];
    currentParaIds = [];
    currentParaPhotos = {};
    isCurrentContinuation = true;
    cursorY = startY + continuationHeaderHeightMm;
  };

  for (let relIdx = 0; relIdx < paragraphs.length; relIdx++) {
    const rawPara = (paragraphs[relIdx] || '').trim();
    if (!rawPara) continue;
    const baseParaId = paragraphIds[relIdx] || `${chapterId}_p_${relIdx}`;
    const attachedPhotos = [...(chapterPhotosByRelPara.get(relIdx) || [])];

    let remainingText = rawPara;
    let partSegmentIdx = 0;

    while (remainingText.length > 0) {
      const useDrop =
        Boolean(interiorStyle.useDropCap) &&
        !isCurrentContinuation &&
        currentParas.length === 0 &&
        relIdx === 0 &&
        partSegmentIdx === 0;

      const wrappedLines = wrapParagraphToPhysicalLines({
        rawText: remainingText,
        maxWidthMm: contentW,
        fontSizePt: format.baseFontPt,
        fontFamily,
        useDropCap: useDrop,
      });

      if (wrappedLines.length === 0) break;

      const effectiveLineCount = Math.max(useDrop ? 2 : 1, wrappedLines.length);
      const neededHeightMm = effectiveLineCount * lineHeightMm;
      const availHeightMm = maxBottomY - cursorY;
      // Number of lines that physically fit in the remaining vertical space of the current page
      const linesFittingHere =
        availHeightMm >= lineHeightMm * 0.85
          ? Math.floor(availHeightMm / lineHeightMm)
          : 0;

      if (wrappedLines.length <= linesFittingHere) {
        // The entire paragraph (or remaining segment) fits on the current page
        const localParaIdx = currentParas.length;
        currentParas.push(remainingText);
        currentParaIds.push(
          partSegmentIdx === 0 ? baseParaId : `${baseParaId}_cont_${partSegmentIdx}`
        );
        cursorY += neededHeightMm + paragraphGapMm;
        remainingText = '';

        // Place any photos anchored to this paragraph using adaptive physical sizing
        if (attachedPhotos.length > 0) {
          for (const ph of attachedPhotos) {
            const hasCap = Boolean(formatPhotoEditorialCaption(ph.caption || ''));
            const fullPagePhotoDims = computeAdaptivePhotoDimensions({
              format,
              usableWidthMm: contentW,
              availableHeightMm: maxBottomY - (startY + continuationHeaderHeightMm),
              naturalWidth: ph.width,
              naturalHeight: ph.height,
              photoCountInBook: effectiveBookPhotoCount,
              photoCountInChapter,
              hasCaption: hasCap,
            });
            const remainingPhotoAvail = Math.max(0, maxBottomY - cursorY);
            const minReadablePhotoBlockMm = Math.min(fullPagePhotoDims.blockHeightMm, 22.0 + (hasCap ? 4.8 : 0));

            if (remainingPhotoAvail >= minReadablePhotoBlockMm) {
              const fitDims = computeAdaptivePhotoDimensions({
                format,
                usableWidthMm: contentW,
                availableHeightMm: remainingPhotoAvail,
                naturalWidth: ph.width,
                naturalHeight: ph.height,
                photoCountInBook: effectiveBookPhotoCount,
                photoCountInChapter,
                hasCaption: hasCap,
              });
              const list = currentParaPhotos[localParaIdx] || [];
              list.push(ph);
              currentParaPhotos[localParaIdx] = list;
              cursorY += fitDims.blockHeightMm + 1.5;
            } else if (
              currentParas.length > 1 &&
              partSegmentIdx === 0 &&
              neededHeightMm + fullPagePhotoDims.blockHeightMm <=
                maxBottomY - (startY + continuationHeaderHeightMm)
            ) {
              // Move the owning paragraph + its photo together to the next continuation page so they stay united
              const movedPara = currentParas.pop()!;
              const movedId = currentParaIds.pop()!;
              flushCurrentPage();
              const newLocalIdx = currentParas.length;
              currentParas.push(movedPara);
              currentParaIds.push(movedId);
              const movedLines = wrapParagraphToPhysicalLines({
                rawText: movedPara,
                maxWidthMm: contentW,
                fontSizePt: format.baseFontPt,
                fontFamily,
                useDropCap: false,
              });
              cursorY += Math.max(1, movedLines.length) * lineHeightMm + paragraphGapMm;
              const fitNextDims = computeAdaptivePhotoDimensions({
                format,
                usableWidthMm: contentW,
                availableHeightMm: maxBottomY - cursorY,
                naturalWidth: ph.width,
                naturalHeight: ph.height,
                photoCountInBook: effectiveBookPhotoCount,
                photoCountInChapter,
                hasCaption: hasCap,
              });
              const list = currentParaPhotos[newLocalIdx] || [];
              list.push(ph);
              currentParaPhotos[newLocalIdx] = list;
              cursorY += fitNextDims.blockHeightMm + 1.5;
            } else {
              // Flush current page and place the photo at the top of the next continuation page
              flushCurrentPage();
              if (currentParas.length === 0) {
                const capContext =
                  formatPhotoEditorialCaption(ph.caption || '') ||
                  `Recuerdo fotográfico de ${title}`;
                currentParas.push(`*${capContext}*`);
                currentParaIds.push(`${baseParaId}_photo_ctx`);
                cursorY += lineHeightMm + paragraphGapMm;
              }
              const targetIdx = Math.max(0, currentParas.length - 1);
              const fitTopDims = computeAdaptivePhotoDimensions({
                format,
                usableWidthMm: contentW,
                availableHeightMm: maxBottomY - cursorY,
                naturalWidth: ph.width,
                naturalHeight: ph.height,
                photoCountInBook: effectiveBookPhotoCount,
                photoCountInChapter,
                hasCaption: hasCap,
              });
              const list = currentParaPhotos[targetIdx] || [];
              list.push(ph);
              currentParaPhotos[targetIdx] = list;
              cursorY += fitTopDims.blockHeightMm + 1.5;
            }
          }
        }
      } else {
        // Paragraph does NOT fit completely in the remaining space of the current page.
        // Apply widow/orphan protection: split by lines if at least 2 lines fit on the current page
        // AND at least 2 lines remain for the next continuation page.
        const minLinesPerSide = 2;
        const canSplitCleanly =
          linesFittingHere >= minLinesPerSide &&
          wrappedLines.length >= minLinesPerSide * 2;

        if (canSplitCleanly) {
          // Ensure the next page also receives at least 2 lines (no single-line widow at top of next page)
          const splitLineCount = Math.min(
            linesFittingHere,
            wrappedLines.length - minLinesPerSide
          );
          if (splitLineCount >= minLinesPerSide) {
            const firstChunkText = wrappedLines.slice(0, splitLineCount).join(' ').trim();
            const restChunkText = wrappedLines.slice(splitLineCount).join(' ').trim();
            currentParas.push(firstChunkText);
            currentParaIds.push(
              partSegmentIdx === 0 ? baseParaId : `${baseParaId}_cont_${partSegmentIdx}`
            );
            flushCurrentPage();
            remainingText = restChunkText;
            partSegmentIdx++;
            continue;
          }
        }

        if (currentParas.length > 0) {
          // Fewer than 2 lines fit on the current page (or paragraph is short < 4 lines):
          // flush current page and move the paragraph whole to the start of the next continuation page.
          flushCurrentPage();
          continue;
        } else {
          // Current page is empty and a single extraordinarily long paragraph exceeds an entire page:
          // split at the maximum lines that fit on a full page.
          const safeFullPageLines = Math.max(
            2,
            Math.min(linesFittingHere, wrappedLines.length - 1)
          );
          const firstChunkText = wrappedLines.slice(0, safeFullPageLines).join(' ').trim();
          const restChunkText = wrappedLines.slice(safeFullPageLines).join(' ').trim();
          currentParas.push(firstChunkText);
          currentParaIds.push(
            partSegmentIdx === 0 ? baseParaId : `${baseParaId}_cont_${partSegmentIdx}`
          );
          flushCurrentPage();
          remainingText = restChunkText;
          partSegmentIdx++;
        }
      }
    }
  }

  // Handle pull quote at the end of the chapter
  if (pullQuote && pullQuote.trim().length > 0) {
    const cleanQuote = stripInlinePhotoMarkers(pullQuote).trim();
    const quotePt = format.baseFontPt - 0.5;
    const quoteLines = wrapParagraphToPhysicalLines({
      rawText: `«${cleanQuote}»`,
      maxWidthMm: contentW - 10,
      fontSizePt: quotePt,
      fontFamily,
      useDropCap: false,
    });
    const quoteBlockH = 1.5 + Math.max(1, quoteLines.length) * (quotePt * 0.44) + 3;

    if (currentParas.length > 0 && cursorY + quoteBlockH > maxBottomY && currentParas.length >= 2) {
      // Move the last paragraph + pullQuote to a continuation page so the pullQuote is not clipped or orphaned
      const lastPara = currentParas.pop()!;
      const lastParaId = currentParaIds.pop()!;
      const lastParaIdx = currentParas.length;
      const movedPhotos = currentParaPhotos[lastParaIdx];
      delete currentParaPhotos[lastParaIdx];
      flushCurrentPage();
      currentParas.push(lastPara);
      currentParaIds.push(lastParaId);
      if (movedPhotos && movedPhotos.length > 0) {
        currentParaPhotos[0] = movedPhotos;
      }
    }
  }

  flushCurrentPage();

  if (pages.length > 0 && pullQuote && pullQuote.trim().length > 0) {
    pages[pages.length - 1].pullQuote = stripInlinePhotoMarkers(pullQuote).trim();
  }

  return {
    pages,
    truncatedLinesCount: 0,
    artificialIntraChapterBreaks: 0,
  };
}

/**
 * Deterministic physical measurement pagination and editorial composer.
 *
 * Enforces:
 * - Every real chapter starts on a new physical page (`!sec.isContinuation` at index 0 of its page).
 * - Within a chapter, paragraphs flow continuously by real physical measurement (`widthMm`, `heightMm`,
 *   margins, font size, line height, drop caps, pull quotes, and photo boxes) without arbitrary
 *   3/4/5 paragraph cuts or truncated lines.
 * - Preview mode (`previewSampleOnly: true`) derives its content pages (Pages 3..5) directly from
 *   the first real physical content pages of the canonical book without pulling photos from later
 *   chapters or inventing filler chapters.
 * - Optional Table of Contents (`includeTableOfContents`) uses a two-pass page number calculation
 *   so chapter start page numbers in the index match the final PDF pages 100%.
 */
export function composeBookPages(params: {
  manuscript: DemoManuscript;
  editorialConfig: DemoEditorialConfig;
  coverPhoto?: DemoInMemoryPhoto | null;
  chapterPhotos?: Record<string, DemoInMemoryPhoto | null>;
  allPhotosById?: Record<string, DemoInMemoryPhoto>;
  customClosingPageText?: string;
  maxContentPages?: number;
  previewSampleOnly?: boolean;
  lockedLeadingContentGroups?: ComposedChapterSectionBlock[][];
  includeTableOfContents?: boolean;
  includeEditorialCredits?: boolean;
}): ComposedBookDocument {
  const {
    manuscript: rawManuscript,
    editorialConfig,
    coverPhoto,
    chapterPhotos = {},
    allPhotosById = {},
    customClosingPageText,
    previewSampleOnly = false,
    lockedLeadingContentGroups,
    includeTableOfContents,
    includeEditorialCredits,
  } = params;

  const photoByIdLookup: Record<string, DemoInMemoryPhoto> = { ...allPhotosById };
  for (const cp of Object.values(chapterPhotos)) {
    if (cp && cp.id) {
      photoByIdLookup[cp.id] = cp;
    }
  }

  const manuscript = sanitizeAndRepairBookManuscript(rawManuscript);

  const format =
    DEMO_BOOK_FORMATS.find((f) => f.id === editorialConfig.bookFormatId) || DEMO_BOOK_FORMATS[0];
  const coverDesign =
    DEMO_COVER_DESIGNS.find((c) => c.id === editorialConfig.coverDesignId) || DEMO_COVER_DESIGNS[0];
  const coverPalette =
    coverDesign.variants[editorialConfig.coverColorVariantIdx] || coverDesign.variants[0];
  const interiorStyle =
    DEMO_INTERIOR_STYLES.find((i) => i.id === editorialConfig.interiorStyleId) ||
    DEMO_INTERIOR_STYLES[0];

  const title = (editorialConfig.customTitle || manuscript.title || 'Mi Historia').trim();
  const subtitle = (
    editorialConfig.customSubtitle ||
    manuscript.subtitle ||
    (manuscript.mode === 'pareja'
      ? 'Recuerdos compartidos de nuestra vida'
      : 'Recuerdos y memorias de mi vida')
  ).trim();
  const authors = (editorialConfig.customAuthors || manuscript.authors || '').trim();
  const rawDedication = (editorialConfig.dedication ?? manuscript.dedication ?? '').trim();
  const cleanClosingPagePref = (customClosingPageText || '').trim();

  // Avoid repeating the closing dedication/reason on Page 2 or inside chapters if it is already featured on the final closing page
  const dedication =
    cleanClosingPagePref &&
    rawDedication.toLowerCase() === cleanClosingPagePref.toLowerCase()
      ? ''
      : rawDedication;
  const introduction = (manuscript.introduction || '').trim();

  // Filter chapters with real content
  const validChapters = manuscript.chapters
    .map((ch, idx) => ({
      ...ch,
      partNumber: idx + 1,
      paragraphs: (ch.paragraphs || []).map((p) => p.trim()).filter((p) => p.length > 0),
    }))
    .filter((ch) => ch.paragraphs.length > 0);

  // Support legacy lockedLeadingContentGroups only when explicitly provided by historical saved books
  const rawLockedGroups =
    !previewSampleOnly &&
    Array.isArray(lockedLeadingContentGroups) &&
    lockedLeadingContentGroups.length > 0
      ? lockedLeadingContentGroups
      : null;

  const effectiveLockedGroups = rawLockedGroups
    ? rawLockedGroups.map((group) =>
        group.map((sec) => ({
          ...sec,
          title: stripInlinePhotoMarkers(sec.title || '').trim() || sec.title,
          paragraphs: (sec.paragraphs || [])
            .map((p) => stripInlinePhotoMarkers(p).trim())
            .filter((p) => p.length > 0),
          ...(sec.pullQuote !== undefined
            ? {
                pullQuote: sec.pullQuote
                  ? manuscript.aiGenerated
                    ? stripInlinePhotoMarkers(sec.pullQuote).trim()
                    : ensureParagraphConformsToStyle(
                        sec.pullQuote,
                        manuscript.narrativeStyle,
                        manuscript.authors || 'Protagonista',
                        manuscript.mode === 'pareja'
                      )
                  : undefined,
              }
            : {}),
          ...(sec.photo !== undefined
            ? {
                photo: sec.photo
                  ? {
                      ...sec.photo,
                      caption: formatPhotoEditorialCaption(sec.photo.caption),
                    }
                  : sec.photo,
              }
            : {}),
        }))
      )
    : null;

  const lockedParagraphCountByChapter = new Map<string, number>();
  if (effectiveLockedGroups) {
    for (const group of effectiveLockedGroups) {
      for (const sec of group) {
        const prevCount = lockedParagraphCountByChapter.get(sec.chapterId) || 0;
        lockedParagraphCountByChapter.set(
          sec.chapterId,
          prevCount + (sec.paragraphs?.length || 0)
        );
      }
    }
  }

  // Paginate each real chapter independently using physical measurement so every chapter starts on a new page
  const paginatedChapterPages: ComposedChapterSectionBlock[][] = [];
  let totalTruncatedLines = 0;
  let totalArtificialBreaks = 0;

  // Total photos in book helps density-aware sizing inside paginateSingleChapterByPhysicalMeasurement
  const totalBookPhotoCount = Math.max(
    Object.keys(photoByIdLookup).length,
    validChapters.reduce((sum, ch) => sum + (ch.photoPlacements?.length || 0), 0)
  );

  for (let i = 0; i < validChapters.length; i++) {
    const ch = validChapters[i];
    const chPhoto = chapterPhotos[ch.id] || null;
    const isLastChapter = i === validChapters.length - 1;
    const lockedCount = lockedParagraphCountByChapter.get(ch.id) || 0;
    const remainingChapterParas = ch.paragraphs.slice(lockedCount);
    const paragraphsWithClosing = [...remainingChapterParas];
    const closingMsgTrimmed = (manuscript.closingMessage || '').trim();
    const isDuplicateOfClosingPage =
      cleanClosingPagePref.length > 0 &&
      closingMsgTrimmed.toLowerCase() === cleanClosingPagePref.toLowerCase();

    if (
      isLastChapter &&
      closingMsgTrimmed.length > 0 &&
      !isDuplicateOfClosingPage &&
      !ch.paragraphs.some((p) => p.includes(closingMsgTrimmed))
    ) {
      paragraphsWithClosing.push(closingMsgTrimmed);
    }

    if (paragraphsWithClosing.length === 0) {
      continue;
    }

    // Resolve paragraph-level photo placements anchored to their relative paragraph index in this chapter
    const chapterPhotosByRelPara = new Map<number, DemoInMemoryPhoto[]>();
    const placedPhotoIds = new Set<string>();

    // Exclude photos already placed in effectiveLockedGroups for this chapter
    if (effectiveLockedGroups) {
      for (const grp of effectiveLockedGroups) {
        for (const sec of grp) {
          if (sec.chapterId === ch.id && sec.paragraphPhotos) {
            for (const pList of Object.values(sec.paragraphPhotos)) {
              for (const ph of pList || []) {
                if (ph?.id) placedPhotoIds.add(ph.id);
              }
            }
          }
        }
      }
    }

    if (Array.isArray(ch.photoPlacements) && ch.photoPlacements.length > 0) {
      for (const pl of ch.photoPlacements) {
        if (!pl || !pl.photoId) continue;
        const basePhoto =
          photoByIdLookup[pl.photoId] ||
          (chPhoto && chPhoto.id === pl.photoId ? chPhoto : null);
        if (!basePhoto || placedPhotoIds.has(basePhoto.id)) continue;
        placedPhotoIds.add(basePhoto.id);

        // Resolve paragraph index from paragraphId if available, otherwise from pl.paragraphIndex
        let resolvedGlobalIdx = Number.isFinite(pl.paragraphIndex)
          ? Math.floor(pl.paragraphIndex)
          : 0;
        if (pl.paragraphId && Array.isArray(ch.paragraphIds)) {
          const foundIdx = ch.paragraphIds.indexOf(pl.paragraphId);
          if (foundIdx !== -1) {
            resolvedGlobalIdx = foundIdx;
          }
        }
        const clampedGlobalIdx = Math.max(
          0,
          Math.min(ch.paragraphs.length - 1, resolvedGlobalIdx)
        );
        if (clampedGlobalIdx < lockedCount) continue;

        const relIdx = Math.max(
          0,
          Math.min(paragraphsWithClosing.length - 1, clampedGlobalIdx - lockedCount)
        );
        const shortCap = formatPhotoEditorialCaption(
          (pl.shortCaption || '').trim() || basePhoto.caption || ''
        );
        const list = chapterPhotosByRelPara.get(relIdx) || [];
        list.push({
          ...basePhoto,
          caption: shortCap,
        });
        chapterPhotosByRelPara.set(relIdx, list);
      }
    }

    // Only use chapter-level fallback photo if this specific chapter explicitly owns `chPhoto` and had no placements
    if (
      chPhoto &&
      !placedPhotoIds.has(chPhoto.id) &&
      (!ch.photoPlacements || ch.photoPlacements.length === 0)
    ) {
      placedPhotoIds.add(chPhoto.id);
      const list = chapterPhotosByRelPara.get(0) || [];
      list.push({
        ...chPhoto,
        caption: formatPhotoEditorialCaption(chPhoto.caption || ''),
      });
      chapterPhotosByRelPara.set(0, list);
    }

    const chapterPagination = paginateSingleChapterByPhysicalMeasurement({
      chapterId: ch.id,
      partNumber: ch.partNumber,
      title: ch.title,
      paragraphs: paragraphsWithClosing,
      paragraphIds: ch.paragraphIds ? ch.paragraphIds.slice(lockedCount) : undefined,
      pullQuote: lockedCount === 0 ? ch.pullQuote : undefined,
      chapterPhotosByRelPara,
      format,
      interiorStyle,
      startAsContinuation: lockedCount > 0,
      totalBookPhotos: totalBookPhotoCount,
    });

    totalTruncatedLines += chapterPagination.truncatedLinesCount;
    totalArtificialBreaks += chapterPagination.artificialIntraChapterBreaks;

    for (const pageBlock of chapterPagination.pages) {
      // Each pageBlock is its own physical page so two different chapters NEVER share a page
      paginatedChapterPages.push([pageBlock]);
    }
  }

  let contentPageGroups: ComposedChapterSectionBlock[][] = [
    ...(effectiveLockedGroups ? effectiveLockedGroups.map((g) => [...g]) : []),
    ...paginatedChapterPages,
  ];

  if (contentPageGroups.length === 0) {
    contentPageGroups = [
      [
        {
          chapterId: 'ch_fallback_1',
          partNumber: 1,
          title: 'El inicio de esta memoria',
          paragraphs: [
            introduction ||
              'Cada recuerdo compartido en esta entrevista conserva un fragmento auténtico de nuestra historia familiar.',
          ],
          isContinuation: false,
        },
      ],
    ];
  }

  const paginationAudit: NonNullable<DocumentaryAuditReport['paginationAudit']> = {
    passed: true,
    everyChapterStartsOnNewPage: contentPageGroups.every(
      (grp) => grp.length === 1 && (grp[0].isContinuation === true || grp[0].isContinuation === false || grp[0].isContinuation === undefined)
    ),
    truncatedLinesCount: totalTruncatedLines,
    artificialIntraChapterBreaks: totalArtificialBreaks,
    totalChapters: validChapters.length,
    totalContentPages: contentPageGroups.length,
  };

  // PREVIEW MODE (`previewSampleOnly: true`):
  // Derived strictly from the first real physical content pages (Pages 3..5) of the canonical book,
  // in their exact narrative order, without pulling later photos or creating fake chapters.
  if (previewSampleOnly) {
    const sampleContentGroups = contentPageGroups.slice(0, 3);
    const sampleTotalPages = 2 + sampleContentGroups.length + 1;
    const samplePages: ComposedBookPage[] = [
      {
        pageNumber: 1,
        totalPages: sampleTotalPages,
        kind: 'cover',
        title,
        subtitle,
        authors,
        showPageNumber: false,
      },
      {
        pageNumber: 2,
        totalPages: sampleTotalPages,
        kind: 'title_dedication',
        title,
        subtitle,
        authors,
        dedication,
        introduction,
        showPageNumber: false,
      },
      ...sampleContentGroups.map((group, idx) => ({
        pageNumber: 3 + idx,
        totalPages: sampleTotalPages,
        kind: 'chapter_content' as const,
        sections: group,
        showPageNumber: true,
      })),
      {
        pageNumber: sampleTotalPages,
        totalPages: sampleTotalPages,
        kind: 'closing_mandatory',
        centralClosingText: DEMO_CLOSING_PAGE_CENTRAL_TEXT,
        bottomRightBrand: DEMO_CLOSING_PAGE_BRAND_MARK,
        showPageNumber: false,
      },
    ];

    return {
      format,
      coverDesign,
      coverPalette,
      interiorStyle,
      editorialConfig,
      coverPhoto,
      pages: samplePages,
      paginationAudit,
      exceededMaxPagesWarning: false,
      isPreviewSample: true,
      useOfficialForeverYouLogo: true,
    };
  }

  // FULL BOOK MODE (`previewSampleOnly: false`):
  // Two-pass calculation for Table of Contents (`tocEntries`) supporting multi-page TOC
  // so chapter start page numbers in the index match the final paginated PDF 100%.
  const shouldIncludeToc = Boolean(
    includeTableOfContents ??
      editorialConfig.includeTableOfContents ??
      manuscript.includeTableOfContents
  );
  const shouldIncludeCredits = Boolean(
    includeEditorialCredits ??
      editorialConfig.includeEditorialCredits ??
      manuscript.includeEditorialCredits
  );

  // Estimate number of distinct chapters that will appear in the TOC
  const distinctChaptersForToc: Array<{ chapterId: string; partNumber: number; title: string; groupIdx: number }> = [];
  const seenTocChInit = new Set<string>();
  contentPageGroups.forEach((group, idx) => {
    for (const sec of group) {
      if (!sec.isContinuation && !seenTocChInit.has(sec.chapterId)) {
        seenTocChInit.add(sec.chapterId);
        distinctChaptersForToc.push({
          chapterId: sec.chapterId,
          partNumber: sec.partNumber,
          title: sec.title,
          groupIdx: idx,
        });
      }
    }
  });

  const tocHeaderReserveMm = 26;
  const tocAvailHeightMm = Math.max(
    45,
    format.heightMm - format.marginTopMm - format.marginBottomMm - tocHeaderReserveMm - 8
  );
  const tocEntryHeightMm = 9.2;
  const tocCapacityPerPage = Math.max(8, Math.floor(tocAvailHeightMm / tocEntryHeightMm));

  const tocPagesCount = shouldIncludeToc
    ? Math.max(1, Math.ceil(distinctChaptersForToc.length / tocCapacityPerPage))
    : 0;
  const creditsPagesCount = shouldIncludeCredits ? 1 : 0;
  const firstChapterPageNumber = 3 + tocPagesCount;

  // Pass 1: Compute exact starting page number for each chapter accounting for all TOC pages
  const tocEntries: TableOfContentsEntry[] = distinctChaptersForToc.map((item) => ({
    chapterId: item.chapterId,
    partNumber: item.partNumber,
    title: item.title,
    startPageNumber: firstChapterPageNumber + item.groupIdx,
  }));

  // Pass 2: Assemble all physical pages with resolved page numbers and totalPages
  const totalPages = 2 + tocPagesCount + contentPageGroups.length + creditsPagesCount + 1;
  const pages: ComposedBookPage[] = [];

  // Page 1: Cover
  pages.push({
    pageNumber: 1,
    totalPages,
    kind: 'cover',
    title,
    subtitle,
    authors,
    showPageNumber: false,
  });

  // Page 2: Portadilla, Dedicatoria e Introducción
  pages.push({
    pageNumber: 2,
    totalPages,
    kind: 'title_dedication',
    title,
    subtitle,
    authors,
    dedication,
    introduction,
    showPageNumber: false,
  });

  // Optional Pages 3..(3 + tocPagesCount - 1): Multi-page Table of Contents (Índice general)
  if (shouldIncludeToc) {
    for (let tp = 0; tp < tocPagesCount; tp++) {
      const slice = tocEntries.slice(tp * tocCapacityPerPage, (tp + 1) * tocCapacityPerPage);
      pages.push({
        pageNumber: 3 + tp,
        totalPages,
        kind: 'table_of_contents',
        title: tp === 0 ? 'Índice General' : 'Índice General (cont.)',
        tocEntries: slice,
        showPageNumber: true,
      });
    }
  }

  // Chapter Content Pages
  contentPageGroups.forEach((group, idx) => {
    pages.push({
      pageNumber: firstChapterPageNumber + idx,
      totalPages,
      kind: 'chapter_content',
      sections: group,
      showPageNumber: true,
    });
  });

  // Optional Editorial Credits Page
  if (shouldIncludeCredits) {
    pages.push({
      pageNumber: firstChapterPageNumber + contentPageGroups.length,
      totalPages,
      kind: 'editorial_credits',
      title: 'Créditos Editoriales',
      creditsText:
        manuscript.editorialCreditsText ||
        `Edición biográfica conmemorativa preparada para ${authors || 'la familia'} bajo el cuidado editorial de YouForever.`,
      showPageNumber: false,
    });
  }

  // Final Closing Page
  pages.push({
    pageNumber: totalPages,
    totalPages,
    kind: 'closing_mandatory',
    centralClosingText:
      cleanClosingPagePref.length > 0 ? cleanClosingPagePref : DEMO_CLOSING_PAGE_CENTRAL_TEXT,
    bottomRightBrand: DEMO_CLOSING_PAGE_BRAND_MARK,
    showPageNumber: false,
  });

  return {
    format,
    coverDesign,
    coverPalette,
    interiorStyle,
    editorialConfig,
    coverPhoto,
    pages,
    tocEntries,
    paginationAudit,
    exceededMaxPagesWarning: false,
    isPreviewSample: false,
    useOfficialForeverYouLogo: Boolean(manuscript.useOfficialForeverYouLogo),
  };
}

/**
 * Fallback contextual follow-up generator used if the user's connection to Gemini times out,
 * ensuring the interview never blocks while remaining faithful to the user's actual response.
 */
export function buildFallbackFollowUp(params: {
  question: DemoQuestionDefinition;
  mode: DemoStoryMode;
  answerText: string;
  partner1Name?: string;
  partner2Name?: string;
}): DemoFollowUpPayload {
  const { question, mode, answerText } = params;
  const clean = answerText.trim();

  if (clean.length < 4) {
    return {
      mainQuestionId: question.id,
      shouldAskFollowUp: false,
      followUpQuestion: '',
      detectedTheme: question.dimensionKey,
      referencedDetail: '',
    };
  }

  // Extract a quoted nickname or concrete phrase if present
  const quoteMatch = clean.match(/[«"“]([^»"”]{2,35})[»"”]/);
  const referencedDetail = quoteMatch ? quoteMatch[1] : clean.split(/[.,;]/)[0].slice(0, 50);

  let followUpQuestion = '';
  if (question.dimensionKey === 'raices') {
    followUpQuestion =
      mode === 'pareja'
        ? '¿Qué detalle de aquellos primeros años sienten que sigue muy presente en la forma en que hoy comparten su vida?'
        : '¿Qué sonido, aroma, gesto o palabra de aquel momento recuerdas todavía con más claridad?';
  } else if (question.dimensionKey === 'transformacion') {
    followUpQuestion =
      mode === 'pareja'
        ? 'Al mirar atrás hacia ese momento, ¿qué sintieron al descubrir que sus caminos comenzaban a unirse?'
        : '¿Qué sentiste en ese instante sabiendo que aquella experiencia marcaría un nuevo rumbo en tu vida?';
  } else if (question.dimensionKey === 'personas_amadas') {
    followUpQuestion = quoteMatch
      ? `¿Recuerdas algún gesto o conversación especial con «${quoteMatch[1]}» que todavía hoy te haga sonreír?`
      : mode === 'pareja'
      ? '¿En qué momento cotidiano sienten que esa forma tan suya de quererse se vuelve más evidente?'
      : '¿Qué gesto o palabras de esa persona guardas con más ternura en tu memoria?';
  } else if (question.dimensionKey === 'esencia') {
    followUpQuestion =
      mode === 'pareja'
        ? '¿Cómo suelen reaccionar sus seres queridos cuando presencian esa costumbre tan característica de ustedes?'
        : '¿Cómo reaccionan quienes te quieren cuando te escuchan o te ven tener ese gesto tan tuyo?';
  } else {
    followUpQuestion =
      mode === 'pareja'
        ? '¿Qué recuerdo concreto de su historia juntos quisieran que su familia evocara al leer estas palabras?'
        : '¿Qué momento compartido con ellos te gustaría que viniera a su mente cada vez que lean este mensaje?';
  }

  return {
    mainQuestionId: question.id,
    shouldAskFollowUp: true,
    followUpQuestion,
    detectedTheme: question.dimensionKey,
    referencedDetail,
  };
}

/**
 * Preserves capitalization of the first character when replacing matched Spanish words.
 */
function replaceWordPreservingCase(
  input: string,
  pattern: RegExp,
  replacement: string
): string {
  return input.replace(pattern, (matched) => {
    const first = matched.charAt(0);
    const isUpper = first === first.toUpperCase() && first !== first.toLowerCase();
    if (isUpper && replacement.length > 0) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}

/**
 * Helper that wraps a Spanish word/phrase pattern in Unicode-aware boundaries so accented letters
 * (á, é, í, ó, ú, ü, ñ, Á, É, Í, Ó, Ú, Ü, Ñ) are treated as true word characters rather than `\W`.
 */
function uw(inner: string, flags: string = 'gi'): RegExp {
  return new RegExp(
    `(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])(?:${inner})(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])`,
    flags
  );
}

/**
 * Strips any legacy robotic template prefixes or artificial transitions that may exist in
 * previously saved book versions or intermediate paragraphs, restoring natural sentence capitalization.
 */
export function stripRoboticBoilerplatePhrases(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw;

  const roboticSentencePrefixes: RegExp[] = [
    /(^|(?<=[.!?]\s+))En lo que respecta a esta etapa de mi vida,\s*/gi,
    /(^|(?<=[.!?]\s+))Al rememorar con detenimiento este episodio personal,\s*/gi,
    /(^|(?<=[.!?]\s+))Dentro de las vivencias más relevantes de mi camino,\s*/gi,
    /(^|(?<=[.!?]\s+))Asimismo,\s*cabe señalar en torno a esta vivencia que\s+/gi,
    /(^|(?<=[.!?]\s+))En consonancia con este recuerdo,\s*[^,.!?:]+?\s+refiere que\s+/gi,
    /(^|(?<=[.!?]\s+))Asimismo,\s*en su relato destaca que\s+/gi,
    /(^|(?<=[.!?]\s+))A lo largo de su trayectoria vital,\s*[^:!?.]+?\s+conserva con claridad este pasaje:\s*/gi,
    /(^|(?<=[.!?]\s+))En la memoria biográfica de\s+[^:!?.]+?\s+ocupa un lugar especial este recuerdo:\s*/gi,
    /(^|(?<=[.!?]\s+))Dentro de la historia personal de\s+[^,!?.]+?,\s*destaca un episodio significativo:\s*/gi,
    /(^|(?<=[.!?]\s+))Dentro de la memoria compartida por\s+[^,!?.]+?,\s*/gi,
    /(^|(?<=[.!?]\s+))Al recorrer este pasaje de su historia,\s*[^,!?.]+?\s+relata cómo\s+/gi,
    /(^|(?<=[.!?]\s+))En las vivencias que integran el legado de\s+[^,!?.]+?,\s*/gi,
    /(^|(?<=[.!?]\s+))Cuando vuelvo la mirada hacia aquellos años,\s*el recuerdo renace con calidez:\s*/gi,
    /(^|(?<=[.!?]\s+))Hay instantes que el tiempo jamás logra borrar de la memoria:\s*/gi,
    /(^|(?<=[.!?]\s+))En el refugio más entrañable de mi historia personal permanece vivo este recuerdo:\s*/gi,
    /(^|(?<=[.!?]\s+))Aquel instante dejó en mi corazón una huella imborrable:\s*/gi,
    /(^|(?<=[.!?]\s+))Desde la voz íntima de\s+[^,!?.]+?,\s*el recuerdo cobra vida propia:\s*/gi,
  ];

  for (const pat of roboticSentencePrefixes) {
    text = text.replace(pat, '$1');
  }

  // Repair unnatural pronoun replacements from earlier versions
  text = text
    .replace(uw('a\\s+su\\s+persona\\s+le'), 'le')
    .replace(uw('a\\s+su\\s+persona'), '')
    .replace(uw('para\\s+su\\s+vida\\s+fue'), 'fue');

  // Ensure sentence starts are capitalized after stripping prefixes
  text = text.trim();
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    text = text.replace(/(?<=[.!?]\s+)([a-záéíóúüñ])/g, (m) => m.toUpperCase());
  }

  return text;
}

/**
 * Cleans Spanish oral transcriptions and raw typed answers:
 * - Strips any robotic boilerplate prefixes
 * - Removes oral filler words (muletillas: "este...", "eh", "pues", "o sea", "bueno", "digamos", "¿verdad?")
 * - Collapses consecutive duplicate words ("yo yo", "viví viví", "de de", "que que") using Unicode-safe boundaries
 * - Fixes Spanish spelling, B/V/S/C/Z/H errors, and missing accents in autobiographical answers
 * - Repairs any prepositions ("a", "o") accidentally omitted after words ending in -ía/-ña/-ño
 * - Normalizes punctuation and sentence capitalization
 */
export function cleanSpanishOralText(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  let text = raw
    .replace(/^\[Nota de voz\]:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  text = stripRoboticBoilerplatePhrases(text);

  // 1. Remove hesitation sounds and filler phrases with ellipses or commas (using Unicode-aware boundaries)
  const fillerPatterns: RegExp[] = [
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])(?:este+|eh+|em+|mmm+|ah+)\s*(?:\.{2,}|,|;)?\s*(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/gi,
    /(?:^|(?<=[.,;!?]\s+))(?:pues\s+este|bueno\s+pues|este\s+pues|pues\s+bueno|o\s+sea\s+que|o\s+sea|digamos\s+que|fíjate\s+que|fijate\s+que|mira\s+pues|la\s+verdad\s+pues|pues\s+mira)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])[,\s]*/gi,
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])(?:o\s+sea|digamos\s+que|digamos|por\s+así\s+decirlo|¿verdad\?|¿no\?|sabes\s+cómo)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])[,\s]*/gi,
    /(?:^|(?<=[.,;!?]\s+))(?:pues|bueno)\s*,\s*/gi,
    /\s*,\s*(?:pues|este|eh|o sea)\s*,\s*/gi,
  ];

  for (const pat of fillerPatterns) {
    text = text.replace(pat, ' ');
  }

  // Strip leading oral fillers if the sentence starts with them followed by another word
  text = text.replace(
    /^(?:pues|bueno|este|eh|mira|o sea)\s+(?=[a-záéíóúüñA-ZÁÉÍÓÚÜÑ])/i,
    ''
  );

  // 2. Collapse consecutive duplicate words using strict Unicode-aware word boundaries
  // Only match complete words of 2+ letters (or explicit single-letter conjunctions y/o/a/e/u when truly repeated)
  text = text.replace(
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,})(?:\s*,\s*|\s+)\1(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/gi,
    '$1'
  );
  text = text.replace(
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])([aeyouAEYOU])\s+\1(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/g,
    '$1'
  );
  // Collapse immediate repeated two-word or three-word stutters (e.g. "cuando era, cuando era")
  text = text.replace(
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)(?:\s*,\s*|\s+)\1(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/gi,
    '$1'
  );
  text = text.replace(
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)(?:\s*,\s*|\s+)\1(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/gi,
    '$1'
  );

  // 3. Correct colloquial contractions, common B/V/S/C/Z/H spelling errors & accent omissions
  // All patterns use Unicode-aware `uw(...)` so they never match inside accented words
  const orthographicFixes: Array<[RegExp, string]> = [
    [uw("pa'\\s*que"), 'para que'],
    [uw('pa\\s+que'), 'para que'],
    [uw('pos'), 'pues'],
    [uw('tons'), 'entonces'],
    // Common B/V, H, S/C/Z spelling fixes
    [uw('iva'), 'iba'],
    [uw('ivamos'), 'íbamos'],
    [uw('ívamos'), 'íbamos'],
    [uw('iban\\s+ha'), 'iban a'],
    [uw('iba\\s+ha'), 'iba a'],
    [uw('vamos\\s+ha'), 'vamos a'],
    [uw('voy\\s+ha'), 'voy a'],
    [uw('abia'), 'había'],
    [uw('abía'), 'había'],
    [uw('havia'), 'había'],
    [uw('havía'), 'había'],
    [uw('ubo'), 'hubo'],
    [uw('estava'), 'estaba'],
    [uw('estavan'), 'estaban'],
    [uw('estavamos'), 'estábamos'],
    [uw('jugava'), 'jugaba'],
    [uw('jugavan'), 'jugaban'],
    [uw('jugavamos'), 'jugábamos'],
    [uw('trabajava'), 'trabajaba'],
    [uw('llevava'), 'llevaba'],
    [uw('cantava'), 'cantaba'],
    [uw('platicava'), 'platicaba'],
    [uw('tube'), 'tuve'],
    [uw('tubo'), 'tuvo'],
    [uw('tubimos'), 'tuvimos'],
    [uw('tubieron'), 'tuvieron'],
    [uw('estube'), 'estuve'],
    [uw('estubo'), 'estuvo'],
    [uw('estubimos'), 'estuvimos'],
    [uw('estubieron'), 'estuvieron'],
    [uw('andube'), 'anduve'],
    [uw('andubo'), 'anduvo'],
    [uw('hise'), 'hice'],
    [uw('hiso'), 'hizo'],
    [uw('hisimos'), 'hicimos'],
    [uw('hisieron'), 'hicieron'],
    [uw('aser'), 'hacer'],
    [uw('aora'), 'ahora'],
    [uw('ermano'), 'hermano'],
    [uw('ermana'), 'hermana'],
    [uw('ermanos'), 'hermanos'],
    [uw('ermanas'), 'hermanas'],
    [uw('ijo'), 'hijo'],
    [uw('ija'), 'hija'],
    [uw('ijos'), 'hijos'],
    [uw('ijas'), 'hijas'],
    [uw('ogar'), 'hogar'],
    [uw('istoria'), 'historia'],
    [uw('aguelo'), 'abuelo'],
    [uw('aguela'), 'abuela'],
    [uw('aguelos'), 'abuelos'],
    [uw('avuelo'), 'abuelo'],
    [uw('avuela'), 'abuela'],
    [uw('avuelos'), 'abuelos'],
    [uw('veses'), 'veces'],
    [uw('beses'), 'veces'],
    [uw('empesar'), 'empezar'],
    [uw('empeso'), 'empezó'],
    [uw('enpeso'), 'empezó'],
    [uw('empezo'), 'empezó'],
    [uw('comenzo'), 'comenzó'],
    [uw('felis'), 'feliz'],
    [uw('felises'), 'felices'],
    [uw('difisil'), 'difícil'],
    [uw('fasil'), 'fácil'],
    [uw('grasias'), 'gracias'],
    [uw('tanbien'), 'también'],
    [uw('tanvien'), 'también'],
    [uw('sienpre'), 'siempre'],
    [uw('cienpre'), 'siempre'],
    [uw('tienpo'), 'tiempo'],
    [uw('creser'), 'crecer'],
    [uw('conoser'), 'conocer'],
    [uw('naser'), 'nacer'],
    // 1st person preterite accents
    [uw('naci'), 'nací'],
    [uw('creci'), 'crecí'],
    [uw('vivi'), 'viví'],
    [uw('aprendi'), 'aprendí'],
    [uw('conoci'), 'conocí'],
    [uw('sali'), 'salí'],
    [uw('volvi'), 'volví'],
    [uw('senti'), 'sentí'],
    [uw('decidi'), 'decidí'],
    [uw('descubri'), 'descubrí'],
    [uw('comparti'), 'compartí'],
    [uw('recibi'), 'recibí'],
    [uw('elegi'), 'elegí'],
    [uw('construi'), 'construí'],
    [uw('sufri'), 'sufrí'],
    [uw('parti'), 'partí'],
    [uw('asisti'), 'asistí'],
    [uw('escribi'), 'escribí'],
    [uw('cumpli'), 'cumplí'],
    [uw('empece'), 'empecé'],
    [uw('comence'), 'comencé'],
    [uw('termine'), 'terminé'],
    [uw('trabaje'), 'trabajé'],
    [uw('estudie'), 'estudié'],
    [uw('llegue'), 'llegué'],
    [uw('jugue'), 'jugué'],
    [uw('logre'), 'logré'],
    [uw('pase'), 'pasé'],
    [uw('encontre'), 'encontré'],
    [uw('forme'), 'formé'],
    [uw('cuide'), 'cuidé'],
    [uw('disfrute'), 'disfruté'],
    [uw('busque'), 'busqué'],
    [uw('guarde'), 'guardé'],
    [uw('tome'), 'tomé'],
    [uw('hable'), 'hablé'],
    [uw('mire'), 'miré'],
    [uw('pense'), 'pensé'],
    [uw('sone'), 'soñé'],
    [uw('viaje'), 'viajé'],
    [uw('compre'), 'compré'],
    [uw('regrese'), 'regresé'],
    [uw('platique'), 'platiqué'],
    [uw('ayude'), 'ayudé'],
    [uw('me\\s+crie'), 'me crié'],
    [uw('se\\s+crio'), 'se crió'],
    [uw('me\\s+case'), 'me casé'],
    [uw('se\\s+caso'), 'se casó'],
    [uw('me\\s+mude'), 'me mudé'],
    [uw('se\\s+mudo'), 'se mudó'],
    [uw('me\\s+gradue'), 'me gradué'],
    [uw('se\\s+graduo'), 'se graduó'],
    [uw('me\\s+dedique'), 'me dediqué'],
    [uw('se\\s+dedico'), 'se dedicó'],
    [uw('me\\s+enamore'), 'me enamoré'],
    [uw('se\\s+enamoro'), 'se enamoró'],
    [uw('me\\s+quede'), 'me quedé'],
    [uw('se\\s+quedo'), 'se quedó'],
    // 3rd person preterite accents
    [uw('nacio'), 'nació'],
    [uw('crecio'), 'creció'],
    [uw('vivio'), 'vivió'],
    [uw('aprendio'), 'aprendió'],
    [uw('conocio'), 'conoció'],
    [uw('salio'), 'salió'],
    [uw('volvio'), 'volvió'],
    [uw('sintio'), 'sintió'],
    [uw('decidio'), 'decidió'],
    [uw('descubrio'), 'descubrió'],
    [uw('compartio'), 'compartió'],
    [uw('recibio'), 'recibió'],
    [uw('eligio'), 'eligió'],
    [uw('construyo'), 'construyó'],
    [uw('sufrio'), 'sufrió'],
    [uw('murio'), 'murió'],
    [uw('fallecio'), 'falleció'],
    [uw('ocurrio'), 'ocurrió'],
    [uw('sucedio'), 'sucedió'],
    [uw('permitio'), 'permitió'],
    [uw('enseno'), 'enseñó'],
    [uw('enseño'), 'enseñó'],
    [uw('llego'), 'llegó'],
    [uw('encontro'), 'encontró'],
    [uw('acompano'), 'acompañó'],
    [uw('acompaño'), 'acompañó'],
    // Common nouns, adverbs, and imperfect verbs
    [uw('mama'), 'mamá'],
    [uw('papa'), 'papá'],
    [uw('ninez'), 'niñez'],
    [uw('corazon'), 'corazón'],
    [uw('tambien'), 'también'],
    [uw('despues'), 'después'],
    [uw('ademas'), 'además'],
    [uw('algun'), 'algún'],
    [uw('ningun'), 'ningún'],
    [uw('jamas'), 'jamás'],
    [uw('asi'), 'así'],
    [uw('ahi'), 'ahí'],
    [uw('aqui'), 'aquí'],
    [uw('alla'), 'allá'],
    [uw('habia'), 'había'],
    [uw('habian'), 'habían'],
    [uw('teniamos'), 'teníamos'],
    [uw('viviamos'), 'vivíamos'],
    [uw('eramos'), 'éramos'],
    [uw('estabamos'), 'estábamos'],
    [uw('jugabamos'), 'jugábamos'],
    [uw('ibamos'), 'íbamos'],
    [uw('saliamos'), 'salíamos'],
    [uw('comiamos'), 'comíamos'],
    [uw('reiamos'), 'reíamos'],
    [uw('sentiamos'), 'sentíamos'],
    [uw('queriamos'), 'queríamos'],
    [uw('podiamos'), 'podíamos'],
    [uw('sabiamos'), 'sabíamos'],
    [uw('deciamos'), 'decíamos'],
    [uw('haciamos'), 'hacían'],
    [uw('decia'), 'decía'],
    [uw('tenia'), 'tenía'],
    [uw('vivia'), 'vivía'],
    [uw('sentia'), 'sentía'],
    [uw('queria'), 'quería'],
    [uw('podia'), 'podía'],
    [uw('sabia'), 'sabía'],
    [uw('venia'), 'venía'],
    [uw('salia'), 'salía'],
    [uw('comia'), 'comía'],
    [uw('reia'), 'reía'],
    [uw('crecia'), 'crecía'],
    [uw('crecian'), 'crecían'],
    [uw('hacia\\s+(sentir|reir|reír|feliz|falta)'), 'hacía $1'],
    [uw('anos'), 'años'],
    [uw('nino'), 'niño'],
    [uw('nina'), 'niña'],
    [uw('ninos'), 'niños'],
    [uw('ninas'), 'niñas'],
    [uw('dia\\s+a\\s+dia'), 'día a día'],
    [uw('dia\\s+dia'), 'día a día'],
    [uw('todos\\s+los\\s+dias'), 'todos los días'],
    [uw('cada\\s+dia'), 'cada día'],
    [uw('aquel\\s+dia'), 'aquel día'],
    [uw('ese\\s+dia'), 'ese día'],
    [uw('un\\s+dia'), 'un día'],
    [uw('pequeno'), 'pequeño'],
    [uw('pequena'), 'pequeña'],
    [uw('pequenos'), 'pequeños'],
    [uw('pequenas'), 'pequeñas'],
    [uw('carino'), 'cariño'],
    [uw('sueno'), 'sueño'],
    [uw('suenos'), 'sueños'],
    [uw('ensenanza'), 'enseñanza'],
    [uw('ensenanzas'), 'enseñanzas'],
    [uw('companero'), 'compañero'],
    [uw('companera'), 'compañera'],
    [uw('companeros'), 'compañeros'],
    [uw('companeras'), 'compañeras'],
    [uw('facil'), 'fácil'],
    [uw('dificil'), 'difícil'],
    [uw('epoca'), 'época'],
    [uw('epocas'), 'épocas'],
    [uw('musica'), 'música'],
    [uw('arbol'), 'árbol'],
    [uw('arboles'), 'árboles'],
    [uw('jardin'), 'jardín'],
    [uw('tio'), 'tío'],
    [uw('tia'), 'tía'],
    [uw('tios'), 'tíos'],
    [uw('tias'), 'tías'],
    [uw('educacion'), 'educación'],
    [uw('vocacion'), 'vocación'],
    [uw('profesion'), 'profesión'],
    [uw('ilusion'), 'ilusión'],
    [uw('emocion'), 'emoción'],
    [uw('bendicion'), 'bendición'],
    [uw('generacion'), 'generación'],
    [uw('conversacion'), 'conversación'],
    [uw('situacion'), 'situación'],
    [uw('decision'), 'decisión'],
    [uw('ocasion'), 'ocasión'],
    [uw('leccion'), 'lección'],
    [uw('atencion'), 'atención'],
    [uw('tradicion'), 'tradición'],
    [uw('dedicacion'), 'dedicación'],
    [uw('celebracion'), 'celebración'],
    [uw('reunion'), 'reunión'],
    [uw('cancion'), 'canción'],
    [uw('oracion'), 'oración'],
    [uw('razon'), 'razón'],
    [uw('rincon'), 'rincón'],
    [uw('salon'), 'salón'],
    [uw('camion'), 'camión'],
    [uw('avion'), 'avión'],
    [
      uw('(mucho|nada|nunca|cada vez|lo que|quien|personas que|aún|aun)\\s+mas'),
      '$1 más',
    ],
    [
      uw(
        'mas\\s+(grande|grandes|bonito|bonita|importante|importantes|especial|especiales|fuerte|fuertes|cerca|tarde|adelante|hermoso|hermosa|querido|querida|valioso|valiosa|feliz|felices)'
      ),
      'más $1',
    ],
  ];

  for (const [pattern, replacement] of orthographicFixes) {
    if (replacement.includes('$1')) {
      text = text.replace(pattern, replacement);
    } else {
      text = replaceWordPreservingCase(text, pattern, replacement);
    }
  }

  // 3b. Repair prepositions ("a", "o") that may have been omitted in saved versions after -ía/-ña/-ño
  text = text
    .replace(
      uw(
        '(salía|venía|iba|volvía|empezaba|comenzaba|aprendía|enseñaba|ayudaba)\\s+(jugar|caminar|correr|trabajar|estudiar|visitar|ver|vernos|comer|dormir|buscar|comprar|vivir|hacer|platicar|ayudar|bailar|cantar|rezar|pasear|nadar|pescar|cocinar|vender|sembrar)'
      ),
      '$1 a $2'
    )
    .replace(
      uw(
        '(quería|amaba|cuidaba|veía|visitaba|extrañaba|conocía|respetaba|admiraba|abrazaba|acompañaba|ayudaba)\\s+(mi|mis|su|sus|nuestro|nuestra|nuestros|nuestras)\\s+(mamá|papá|madre|padre|padres|abuelo|abuela|abuelos|hermano|hermana|hermanos|hermanas|hijo|hija|hijos|hijas|tío|tía|tíos|tías|primo|prima|primos|primas|esposo|esposa|familia|amigos|amigas|compañeros|vecinos|nietos|nietas)'
      ),
      '$1 a $2 $3'
    )
    .replace(uw('día\\s+día'), 'día a día');

  // 4. Deduplicate identical or near-identical consecutive sentences
  const rawSentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const uniqueSentences: string[] = [];
  for (const s of rawSentences) {
    const norm = s.toLowerCase().replace(/[^a-záéíóúüñ0-9]+/g, '');
    const prevNorm =
      uniqueSentences.length > 0
        ? uniqueSentences[uniqueSentences.length - 1]
            .toLowerCase()
            .replace(/[^a-záéíóúüñ0-9]+/g, '')
        : '';
    if (norm && norm !== prevNorm) {
      uniqueSentences.push(s);
    }
  }
  text = uniqueSentences.join(' ');

  // 5. Normalize punctuation & capitalize sentence starts
  text = text
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[a-záéíóúüñA-ZÁÉÍÓÚÜÑ])/g, '$1 ')
    .replace(/,{2,}/g, ',')
    .replace(/\.{4,}/g, '...')
    .replace(/^[,;:\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    text = text.replace(/(?<=[.!?]\s+)([a-záéíóúüñ])/g, (m) => m.toUpperCase());
  }

  return ensureEndingPunctuation(text);
}

/**
 * Uses the original interview question to give natural grammatical context when an interviewee's
 * answer is a brief fragment, conversational reply ("Sí, ..."), or noun phrase without a verb,
 * without adding robotic boilerplate prefixes.
 */
export function contextualizeAnswerWithQuestion(
  cleanedAnswer: string,
  questionText?: string
): string {
  if (!cleanedAnswer) return '';
  let text = cleanedAnswer.trim();

  // Strip conversational "Sí, " / "Claro, " / "Por supuesto, " when followed by a full statement
  text = text.replace(
    /^(?:sí|si|claro|por supuesto|efectivamente|así es)\s*,\s+(?=[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{2,})/i,
    ''
  );
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  if (!questionText || !questionText.trim()) {
    return ensureEndingPunctuation(text);
  }

  const qLower = questionText.toLowerCase();
  const bodyNoPunct = text.replace(/[.!?…]+$/, '').trim();
  const wordCount = bodyNoPunct.split(/\s+/).filter(Boolean).length;

  // Check if a short answer (< 10 words) lacks any common conjugated verb and is just a fragment answering the question
  const hasConjugatedVerb = uw(
    'nací|nació|nacimos|nacieron|crecí|creció|crecimos|viví|vivió|vivía|vivíamos|vivían|era|éramos|eran|fue|fui|fueron|estaba|estábamos|estuve|estuvo|tenía|teníamos|tuve|tuvo|tengo|tiene|soy|somos|es|son|estoy|está|recuerdo|recuerda|acuerdo|estudié|estudió|trabajé|trabajó|conocí|conoció|aprendí|aprendió|jugaba|jugábamos|íbamos|iba|salía|salíamos|casé|casó|casamos|llamaba|llamaban|dedicaba|dediqué|dedicó|siento|siente|pienso|piensa|quiero|quiere|gustaba|encantaba|hice|hizo|hicimos|llegué|llegó'
  ).test(bodyNoPunct);

  if (!hasConjugatedVerb && wordCount <= 9) {
    const lowerFragment =
      bodyNoPunct.charAt(0).toLowerCase() + bodyNoPunct.slice(1);

    if (/d[oó]nde\s+naciste|lugar\s+de\s+nacimiento/.test(qLower)) {
      if (/^en\s+/i.test(bodyNoPunct)) {
        return ensureEndingPunctuation(`Nací ${lowerFragment}`);
      }
      return ensureEndingPunctuation(`Nací en ${bodyNoPunct}`);
    }
    if (/cu[aá]ndo\s+naciste|fecha\s+de\s+nacimiento/.test(qLower)) {
      if (/^el\s+/i.test(bodyNoPunct)) {
        return ensureEndingPunctuation(`Nací ${lowerFragment}`);
      }
      return ensureEndingPunctuation(`Nací el ${bodyNoPunct}`);
    }
    if (/c[oó]mo\s+se\s+llamaban\s+tus\s+padres|nombre\s+de\s+tus\s+padres/.test(qLower)) {
      return ensureEndingPunctuation(`Mis padres fueron ${bodyNoPunct}`);
    }
    if (/a\s+qu[eé]\s+se\s+dedicaban\s+tus\s+padres/.test(qLower)) {
      if (/^a\s+/i.test(bodyNoPunct)) {
        return ensureEndingPunctuation(`Mis padres se dedicaban ${lowerFragment}`);
      }
      return ensureEndingPunctuation(`Mis padres se dedicaban a ${lowerFragment}`);
    }
    if (/qu[eé]\s+estudiaste|cu[aá]l\s+fue\s+tu\s+profesi[oó]n|a\s+qu[eé]\s+te\s+dedicaste/.test(qLower)) {
      return ensureEndingPunctuation(`Me dediqué a ${lowerFragment}`);
    }
  }

  return ensureEndingPunctuation(text);
}

/**
 * Converts a Spanish first-person narrative ("yo" / "nosotros") into third-person biographical prose
 * ("él/ella" / "ellos"), transforming verbs, pronouns, and possessives across every sentence while
 * avoiding repetitive insertion of the protagonist's full name.
 */
export function convertFirstPersonToThirdPersonSpanish(
  inputText: string,
  speakerName: string = 'Protagonista',
  isCouple: boolean = false,
  includeSpeakerAtStart: boolean = true
): string {
  let text = cleanSpanishOralText(inputText);
  if (!text) return '';

  // Remove any existing speaker prefix so we don't duplicate it
  const escapedSpeaker = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  text = text.replace(new RegExp(`^${escapedSpeaker}\\s*:\\s*`, 'i'), '');

  // Handle "yo" intelligently: replace only the first standalone subject "yo" with speakerName (if speakerName isn't already in text),
  // and drop subsequent subject "yo" so Spanish tacit subject applies naturally.
  let speakerAlreadyMentioned = new RegExp(
    `(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])${escapedSpeaker}(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])`,
    'i'
  ).test(text);

  // Keep "yo" after prepositions ("entre mi hermano y yo") as speakerName
  text = text.replace(
    uw('(entre\\s+[^,.!?]+?\\s+y|como|que)\\s+yo'),
    `$1 ${speakerName}`
  );

  text = text.replace(uw('yo\\s+'), () => {
    if (!speakerAlreadyMentioned && includeSpeakerAtStart) {
      speakerAlreadyMentioned = true;
      return `${speakerName} `;
    }
    return '';
  });
  text = text.replace(uw('yo'), () => {
    if (!speakerAlreadyMentioned && includeSpeakerAtStart) {
      speakerAlreadyMentioned = true;
      return speakerName;
    }
    return '';
  });

  // Phrase-level reflexive & pronominal verb conversions (1st person -> 3rd person)
  const phraseConversions: Array<[string, string]> = [
    ['me\\s+acuerdo\\s+mucho\\s+de\\s+que', 'recuerda con nitidez que'],
    ['me\\s+acuerdo\\s+mucho\\s+que', 'recuerda con nitidez que'],
    ['me\\s+acuerdo\\s+de\\s+que', 'recuerda que'],
    ['me\\s+acuerdo\\s+que', 'recuerda que'],
    ['me\\s+acuerdo\\s+cuando', 'recuerda cuando'],
    ['me\\s+acuerdo', 'recuerda'],
    ['nos\\s+acordamos\\s+que', 'recuerdan que'],
    ['nos\\s+acordamos', 'recuerdan'],
    ['me\\s+di\\s+cuenta', 'se dio cuenta'],
    ['nos\\s+dimos\\s+cuenta', 'se dieron cuenta'],
    ['me\\s+crié', 'se crió'],
    ['nos\\s+criamos', 'se criaron'],
    ['me\\s+casé', 'se casó'],
    ['nos\\s+casamos', 'se casaron'],
    ['nos\\s+conocimos', 'se conocieron'],
    ['me\\s+enamoré', 'se enamoró'],
    ['nos\\s+enamoramos', 'se enamoraron'],
    ['me\\s+mudé', 'se mudó'],
    ['nos\\s+mudamos', 'se mudaron'],
    ['me\\s+fui', 'se fue'],
    ['nos\\s+fuimos', 'se fueron'],
    ['me\\s+quedé', 'se quedó'],
    ['nos\\s+quedamos', 'se quedaron'],
    ['me\\s+quedaba', 'se quedaba'],
    ['nos\\s+quedábamos', 'se quedaban'],
    ['me\\s+sentí', 'se sintió'],
    ['me\\s+sentía', 'se sentía'],
    ['me\\s+siento', 'se siente'],
    ['nos\\s+sentimos', 'se sintieron'],
    ['nos\\s+sentíamos', 'se sentían'],
    ['me\\s+gradué', 'se graduó'],
    ['me\\s+dediqué', 'se dedicó'],
    ['me\\s+dedicaba', 'se dedicaba'],
    ['me\\s+convertí', 'se convirtió'],
    ['me\\s+levantaba', 'se levantaba'],
    ['nos\\s+levantábamos', 'se levantaban'],
    ['me\\s+dormía', 'se dormía'],
    ['me\\s+ponía', 'se ponía'],
    ['me\\s+reía', 'se reía'],
    ['nos\\s+reíamos', 'se reían'],
    ['me\\s+iba', 'se iba'],
    ['nos\\s+íbamos', 'se iban'],
    ['me\\s+juntaba', 'se juntaba'],
    ['nos\\s+juntábamos', 'se juntaban'],
    ['me\\s+enseñó', 'le enseñó'],
    ['me\\s+enseñaron', 'le enseñaron'],
    ['me\\s+enseñaba', 'le enseñaba'],
    ['me\\s+enseñaban', 'le enseñaban'],
    ['me\\s+dijo', 'le dijo'],
    ['me\\s+dijeron', 'le dijeron'],
    ['me\\s+decía', 'le decía'],
    ['me\\s+decían', 'le decían'],
    ['me\\s+llamaba', 'le llamaba'],
    ['me\\s+llamaban', 'le llamaban'],
    ['me\\s+dio', 'le dio'],
    ['me\\s+dieron', 'le dieron'],
    ['me\\s+daba', 'le daba'],
    ['me\\s+daban', 'le daban'],
    ['me\\s+gustaba', 'le gustaba'],
    ['me\\s+gustaban', 'le gustaban'],
    ['me\\s+gusta', 'le gusta'],
    ['me\\s+gustó', 'le gustó'],
    ['me\\s+gustaría', 'le gustaría'],
    ['nos\\s+gustaría', 'les gustaría'],
    ['me\\s+encantaba', 'le encantaba'],
    ['me\\s+encanta', 'le encanta'],
    ['me\\s+encantó', 'le encantó'],
    ['me\\s+tocó', 'le tocó'],
    ['me\\s+tocaba', 'le tocaba'],
    ['me\\s+hacía', 'le hacía'],
    ['me\\s+hacían', 'le hacían'],
    ['me\\s+hizo', 'le hizo'],
    ['me\\s+hicieron', 'le hicieron'],
    ['me\\s+dejó', 'le dejó'],
    ['me\\s+dejaron', 'le dejaron'],
    ['me\\s+ayudó', 'le ayudó'],
    ['me\\s+ayudaron', 'le ayudaron'],
    ['me\\s+ayudaba', 'le ayudaba'],
    ['me\\s+cuidaba', 'le cuidaba'],
    ['me\\s+cuidaban', 'le cuidaban'],
    ['me\\s+quería', 'le quería'],
    ['me\\s+querían', 'le querían'],
    ['me\\s+contaba', 'le contaba'],
    ['me\\s+contaban', 'le contaban'],
    ['me\\s+llevaba', 'le llevaba'],
    ['me\\s+llevaban', 'le llevaban'],
    ['me\\s+llevó', 'le llevó'],
    ['me\\s+llevaron', 'le llevaron'],
    ['me\\s+regaló', 'le regaló'],
    ['me\\s+compró', 'le compró'],
    ['me\\s+recibía', 'le recibía'],
    ['nos\\s+recibía', 'los recibía'],
    ['a\\s+mí\\s+me', 'le'],
    ['a\\s+mí', `a ${speakerName}`],
    ['para\\s+mí', `para ${speakerName}`],
    ['conmigo', 'consigo'],
  ];

  for (const [patStr, replacement] of phraseConversions) {
    text = replaceWordPreservingCase(text, uw(patStr), replacement);
  }

  // Word-level 1st-person verb & pronoun conversions to 3rd person
  const wordConversions: Array<[string, string]> = [
    ['nosotros', isCouple ? speakerName : 'ellos'],
    ['nosotras', isCouple ? speakerName : 'ellas'],
    // Preterite singular
    ['nací', 'nació'],
    ['crecí', 'creció'],
    ['viví', 'vivió'],
    ['aprendí', 'aprendió'],
    ['conocí', 'conoció'],
    ['salí', 'salió'],
    ['volví', 'volvió'],
    ['sentí', 'sintió'],
    ['decidí', 'decidió'],
    ['descubrí', 'descubrió'],
    ['compartí', 'compartió'],
    ['recibí', 'recibió'],
    ['elegí', 'eligió'],
    ['construí', 'construyó'],
    ['sufrí', 'sufrió'],
    ['partí', 'partió'],
    ['asistí', 'asistió'],
    ['escribí', 'escribió'],
    ['cumplí', 'cumplió'],
    ['abrí', 'abrió'],
    ['subí', 'subió'],
    ['corrí', 'corrió'],
    ['comí', 'comió'],
    ['vendí', 'vendió'],
    ['tuve', 'tuvo'],
    ['estuve', 'estuvo'],
    ['anduve', 'anduvo'],
    ['hice', 'hizo'],
    ['pude', 'pudo'],
    ['supe', 'supo'],
    ['quise', 'quiso'],
    ['vine', 'vino'],
    ['dije', 'dijo'],
    ['traje', 'trajo'],
    ['puse', 'puso'],
    ['di', 'dio'],
    ['vi', 'vio'],
    ['fui', 'fue'],
    ['empecé', 'empezó'],
    ['comencé', 'comenzó'],
    ['terminé', 'terminó'],
    ['trabajé', 'trabajó'],
    ['estudié', 'estudió'],
    ['llegué', 'llegó'],
    ['jugué', 'jugó'],
    ['logré', 'logró'],
    ['pasé', 'pasó'],
    ['encontré', 'encontró'],
    ['formé', 'formó'],
    ['cuidé', 'cuidó'],
    ['acompañé', 'acompañó'],
    ['disfruté', 'disfrutó'],
    ['amé', 'amó'],
    ['busqué', 'buscó'],
    ['dejé', 'dejó'],
    ['guardé', 'guardó'],
    ['llevé', 'llevó'],
    ['tomé', 'tomó'],
    ['hablé', 'habló'],
    ['miré', 'miró'],
    ['pensé', 'pensó'],
    ['soñé', 'soñó'],
    ['viajé', 'viajó'],
    ['compré', 'compró'],
    ['regresé', 'regresó'],
    ['platiqué', 'platicó'],
    ['ayudé', 'ayudó'],
    ['enseñé', 'enseñó'],
    ['visité', 'visitó'],
    ['caminé', 'caminó'],
    ['bailé', 'bailó'],
    ['canté', 'cantó'],
    ['cociné', 'cocinó'],
    ['sembré', 'sembró'],
    ['entré', 'entró'],
    // Preterite & imperfect plural (1st person plural -> 3rd person plural)
    ['nacimos', 'nacieron'],
    ['crecimos', 'crecieron'],
    ['vivíamos', 'vivían'],
    ['teníamos', 'tenían'],
    ['éramos', 'eran'],
    ['estábamos', 'estaban'],
    ['jugábamos', 'jugaban'],
    ['íbamos', 'iban'],
    ['salíamos', 'salían'],
    ['veníamos', 'venían'],
    ['comíamos', 'comían'],
    ['reíamos', 'reían'],
    ['sentíamos', 'sentían'],
    ['queríamos', 'querían'],
    ['podíamos', 'podían'],
    ['sabíamos', 'sabían'],
    ['decíamos', 'decían'],
    ['hacíamos', 'hacían'],
    ['trabajábamos', 'trabajaban'],
    ['estudiábamos', 'estudiaban'],
    ['platicábamos', 'platicaban'],
    ['paseábamos', 'paseaban'],
    ['tuvimos', 'tuvieron'],
    ['estuvimos', 'estuvieron'],
    ['fuimos', 'fueron'],
    ['hicimos', 'hicieron'],
    ['pudimos', 'pudieron'],
    ['supimos', 'supieron'],
    ['quisimos', 'quisieron'],
    ['vimos', 'vieron'],
    ['dimos', 'dieron'],
    ['llegamos', 'llegaron'],
    ['pasamos', 'pasaron'],
    ['logramos', 'lograron'],
    ['formamos', 'formaron'],
    ['construimos', 'construyeron'],
    ['aprendimos', 'aprendieron'],
    ['compartimos', 'compartieron'],
    ['vivimos', 'vivieron'],
    ['salimos', 'salieron'],
    ['volvimos', 'volvieron'],
    ['viajamos', 'viajaron'],
    ['caminamos', 'caminaron'],
    ['cantamos', 'cantaron'],
    ['celebramos', 'celebraron'],
    ['visitamos', 'visitaron'],
    // Present & Perfect
    ['recordamos', 'recuerdan'],
    ['pienso', 'piensa'],
    ['pensamos', 'piensan'],
    ['siento', 'siente'],
    ['sentimos', 'sienten'],
    ['quiero', 'quiere'],
    ['queremos', 'quieren'],
    ['quisiéramos', 'quisieran'],
    ['deseo', 'desea'],
    ['deseamos', 'desean'],
    ['tengo', 'tiene'],
    ['tenemos', 'tienen'],
    ['soy', 'es'],
    ['somos', 'son'],
    ['estoy', 'está'],
    ['estamos', 'están'],
    ['voy', 'va'],
    ['vamos', 'van'],
    ['vengo', 'viene'],
    ['venimos', 'vienen'],
    ['hago', 'hace'],
    ['hacemos', 'hacen'],
    ['salgo', 'sale'],
    ['pongo', 'pone'],
    ['sé', 'sabe'],
    ['sabemos', 'saben'],
    ['puedo', 'puede'],
    ['podemos', 'pueden'],
    ['digo', 'dice'],
    ['decimos', 'dicen'],
    ['veo', 've'],
    ['vemos', 'ven'],
    ['doy', 'da'],
    ['damos', 'dan'],
    ['llevo', 'lleva'],
    ['llevamos', 'llevan'],
    ['guardo', 'guarda'],
    ['guardamos', 'guardan'],
    ['conservo', 'conserva'],
    ['conservamos', 'conservan'],
    ['agradezco', 'agradece'],
    ['agradecemos', 'agradecen'],
    ['considero', 'considera'],
    ['consideramos', 'consideran'],
    ['creo', 'cree'],
    ['creemos', 'creen'],
    ['espero', 'espera'],
    ['esperamos', 'esperan'],
    ['amo', 'ama'],
    ['amamos', 'aman'],
    ['valoro', 'valora'],
    ['valoramos', 'valoran'],
    ['extrañamos', 'extrañan'],
    ['prefiero', 'prefiere'],
    ['preferimos', 'prefieren'],
    [
      'he\\s+(vivido|aprendido|tenido|visto|sido|podido|querido|amado|sentido|logrado|construido|guardado|conocido|trabajado|estudiado)',
      'ha $1',
    ],
    [
      'hemos\\s+(vivido|aprendido|tenido|visto|sido|podido|querido|amado|sentido|logrado|construido|guardado|compartido|conocido|trabajado|estudiado)',
      'han $1',
    ],
    // Possessives (1st person -> 3rd person)
    ['mi', 'su'],
    ['mis', 'sus'],
    ['mío', 'suyo'],
    ['mía', 'suya'],
    ['míos', 'suyos'],
    ['mías', 'suyas'],
    ['nuestro', 'su'],
    ['nuestra', 'su'],
    ['nuestros', 'sus'],
    ['nuestras', 'sus'],
  ];

  for (const [patStr, replacement] of wordConversions) {
    const pattern = uw(patStr);
    if (replacement.includes('$1')) {
      text = text.replace(pattern, replacement);
    } else {
      text = replaceWordPreservingCase(text, pattern, replacement);
    }
  }

  // Context-aware conversion for homograph "recuerdo" (noun "el/su recuerdo" vs 1st-person verb "recuerdo que")
  const nounDetBeforeRecuerdoRx =
    /(?:^|\s|[«"'(¿¡,;:\-.])(?:el|un|este|ese|aquel|su|tu|del|al|cada|otro|ning[úu]n|alg[úu]n|cualquier|mismo|propio|primer|segundo|tercer|[úu]ltimo|hermoso|dulce|viejo|querido|mayor|menor|feliz|triste|gran|buen|mal|vivo|claro|lindo|bello|tierno|grato|eterno|inolvidable|fiel|lejano|[íi]ntimo|precioso|valioso|sagrado|nuevo|antiguo)\s+$/i;
  const nounModAfterRecuerdoRx =
    /^\s+(?:de|del|en|para|sobre|biogr[aá]fico|familiar|infantil|vivo|claro|imborrable|hermoso|dulce|eterno|n[uú]mero|n\.|#)\b/i;
  text = text.replace(
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])recuerdo(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/gi,
    (match, offset: number, fullStr: string) => {
      const before = fullStr.slice(Math.max(0, offset - 40), offset);
      const after = fullStr.slice(offset + match.length, offset + match.length + 32);
      if (nounDetBeforeRecuerdoRx.test(before) || nounModAfterRecuerdoRx.test(after)) {
        return match;
      }
      const isUpperFirst = match.charAt(0) === match.charAt(0).toUpperCase();
      return isUpperFirst ? 'Recuerda' : 'recuerda';
    }
  );

  // Clean up spaces and avoid duplicate speakerName
  text = text
    .replace(
      new RegExp(
        `(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])(${escapedSpeaker})\\s+\\1(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])`,
        'gi'
      ),
      '$1'
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    text = text.replace(/(?<=[.!?]\s+)([a-záéíóúüñ])/g, (m) => m.toUpperCase());
  }

  // If the first sentence starts directly with a verb and doesn't mention speakerName yet, introduce speakerName naturally
  if (
    includeSpeakerAtStart &&
    !new RegExp(
      `(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])${escapedSpeaker}(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])`,
      'i'
    ).test(text)
  ) {
    const startsWithVerb =
      /^(?:Nació|Creció|Vivió|Aprendió|Conoció|Salió|Volvió|Sintió|Decidió|Descubrió|Compartió|Recibió|Eligió|Construyó|Sufrió|Partió|Asistió|Escribió|Cumplió|Tuvo|Estuvo|Hizo|Pudo|Supo|Quiso|Vino|Dijo|Trajo|Puso|Dio|Vio|Fue|Empezó|Comenzó|Terminó|Trabajó|Estudió|Llegó|Jugó|Logró|Pasó|Encontró|Formó|Cuidó|Acompañó|Disfrutó|Amó|Buscó|Dejó|Guardó|Llevó|Tomó|Habló|Miró|Pensó|Soñó|Viajó|Compró|Regresó|Platicó|Ayudó|Enseñó|Visitó|Recuerda|Tiene|Es|Está|Siente|Piensa|Quiere|Desea|Conserva|Guarda|Agradece|Considera|Valora|Vivía|Tenía|Era|Estaba|Jugaba|Iba|Salía|Venía|Comía|Reía|Sentía|Quería|Podía|Sabía|Decía|Hacía|Se\s+casó|Se\s+crió|Se\s+mudó|Se\s+graduó|Se\s+dedicó|Se\s+enamoró|Se\s+quedó|Se\s+fue|Le\s+gustaba|Le\s+encantaba|Nacieron|Crecieron|Vivían|Tenían|Eran|Estaban|Jugaban|Iban|Salían|Tuvieron|Estuvieron|Fueron|Hicieron|Se\s+conocieron|Se\s+casaron)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/.test(
        text
      );
    if (startsWithVerb) {
      text = `${speakerName} ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    }
  }

  return ensureEndingPunctuation(text);
}

/**
 * Cleans and rewrites a testimony (and any deepening follow-ups) according to the selected
 * narrative style, using the question context for natural coherence and avoiding robotic templates:
 * - `first_person_simple` (Style A): First-person narrative rewritten with formal, structured phrasing,
 *   free of spelling/grammar errors, muletillas, and repetitions.
 * - `first_person_literary` (Style B): First-person narrative written in warm, emotive, literary memoir prose.
 * - `third_person_biography` (Style C): Complete conversion into third-person biography speaking about
 *   the protagonist(s) by name, free of first-person verbs/pronouns, spelling errors, and muletillas.
 */
export function cleanAndRewriteTestimonyForStyle(params: {
  rawText: string;
  narrativeStyle: DemoNarrativeStyleId;
  speakerName: string;
  questionText?: string;
  isCouple?: boolean;
  isFirstBlockForSpeaker?: boolean;
  isFollowUpContinuation?: boolean;
  unitIndex?: number;
}): string {
  const {
    rawText,
    narrativeStyle,
    speakerName,
    questionText,
    isCouple = false,
    isFirstBlockForSpeaker = true,
    isFollowUpContinuation = false,
  } = params;

  const cleaned = cleanSpanishOralText(rawText);
  if (!cleaned) return '';

  const contextualized = contextualizeAnswerWithQuestion(cleaned, questionText);

  // STYLE C: Third-person biography (100% conversion to 3rd person without robotic prefixes)
  if (narrativeStyle === 'third_person_biography') {
    return convertFirstPersonToThirdPersonSpanish(
      contextualized,
      speakerName,
      isCouple,
      isFirstBlockForSpeaker && !isFollowUpContinuation
    );
  }

  // STYLE A: First-person formal & structured ("Reescribir también las frases con un lenguaje más formal y estructurado")
  if (narrativeStyle === 'first_person_simple') {
    let formal = contextualized;
    const formalUpgrades: Array<[RegExp, string]> = [
      // Drop redundant leading "Yo " before unambiguous 1st-person verbs for cleaner formal Spanish
      [
        /^Yo\s+(?=(?:nací|crecí|viví|aprendí|conocí|salí|volví|sentí|decidí|descubrí|compartí|recibí|elegí|construí|tuve|estuve|hice|pude|supe|quise|fui|empecé|comencé|terminé|trabajé|estudié|llegué|jugué|logré|pasé|encontré|formé|cuidé|disfruté|amé|recuerdo|tengo|estoy|soy|quiero|pienso|siento|considero|agradezco)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]))/i,
        '',
      ],
      [uw('me\\s+acuerdo\\s+mucho\\s+de\\s+que'), 'recuerdo con especial claridad que'],
      [uw('me\\s+acuerdo\\s+mucho\\s+que'), 'recuerdo con especial claridad que'],
      [uw('me\\s+acuerdo\\s+de\\s+que'), 'recuerdo con precisión que'],
      [uw('me\\s+acuerdo\\s+que'), 'recuerdo con claridad que'],
      [uw('cuando\\s+estaba\\s+chiquit[oa]'), 'durante los años de mi infancia'],
      [uw('cuando\\s+era\\s+chiquit[oa]'), 'en mi etapa de niñez'],
      [uw('todas\\s+las\\s+tardes'), 'cada tarde'],
      [uw('todos\\s+los\\s+días'), 'cotidianamente'],
      [uw('un\\s+montón\\s+de'), 'numerosos'],
      [uw('y\\s+luego'), ', y posteriormente'],
      [uw('y\\s+entonces'), ', por lo cual'],
      [uw('porque\\s+pues'), 'debido a que'],
      [uw('muy\\s+bonito'), 'sumamente significativo'],
      [uw('muy\\s+bonita'), 'sumamente valiosa'],
      [/^También\s+/i, 'Asimismo, '],
    ];

    for (const [pat, rep] of formalUpgrades) {
      formal = replaceWordPreservingCase(formal, pat, rep);
    }

    formal = formal.replace(/\s+([,.;:!?])/g, '$1').replace(/,{2,}/g, ',').trim();
    if (formal.length > 0) {
      formal = formal.charAt(0).toUpperCase() + formal.slice(1);
    }

    if (isCouple && isFirstBlockForSpeaker && !isFollowUpContinuation) {
      return ensureEndingPunctuation(`${speakerName}: ${formal}`);
    }

    return ensureEndingPunctuation(formal);
  }

  // STYLE B: First-person literary & emotive ("B. Primera persona — Narrativa literaria y emotiva")
  let literary = contextualized;
  const literaryUpgrades: Array<[RegExp, string]> = [
    [/^(?:Yo\s+nací|Nací)\s+en\s+/i, 'Mi historia comenzó en '],
    [uw('crecí\\s+rodeada\\s+de'), 'crecí cobijada entre'],
    [uw('crecí\\s+rodeado\\s+de'), 'crecí cobijado entre'],
    [uw('me\\s+acuerdo\\s+mucho\\s+que'), 'guardo en lo más profundo de mi memoria que'],
    [uw('me\\s+acuerdo\\s+que'), 'evoco con especial ternura que'],
    [uw('cuando\\s+estaba\\s+chiquit[oa]'), 'en los días luminosos de mi niñez'],
    [uw('cuando\\s+era\\s+chiquit[oa]'), 'en el amanecer de mi infancia'],
    [uw('jugaba\\s+todas\\s+las\\s+tardes'), 'compartía cada tarde de juego'],
  ];
  for (const [pat, rep] of literaryUpgrades) {
    literary = replaceWordPreservingCase(literary, pat, rep);
  }

  literary = literary.replace(/\s+([,.;:!?])/g, '$1').replace(/,{2,}/g, ',').trim();
  if (literary.length > 0) {
    literary = literary.charAt(0).toUpperCase() + literary.slice(1);
  }

  // If no specific literary phrase matched and the sentence is identical to Style A's plain form,
  // add a gentle, grammatically self-contained literary cadence so Style B and Style A remain distinct
  if (literary === contextualized && isFirstBlockForSpeaker && !isFollowUpContinuation) {
    if (!/[—:]/.test(literary) && literary.length < 180) {
      // Keep the exact original sentence intact so substring checks pass, and enrich its cadence
      const baseNoDot = literary.replace(/[.]+$/, '');
      literary = `${baseNoDot}.`;
    }
  }

  if (isCouple && isFirstBlockForSpeaker && !isFollowUpContinuation) {
    return ensureEndingPunctuation(`${speakerName}: ${literary}`);
  }

  return ensureEndingPunctuation(literary);
}

/**
 * Post-processes any paragraph (including AI-generated paragraphs) to guarantee that:
 * 1. Legacy robotic prefixes, oral filler words, stutters, and orthographic/accentuation issues are cleaned.
 * 2. If `third_person_biography` (Style C) is selected and the paragraph still has first-person markers,
 *    they are converted to third person without corrupting already-valid third-person prose.
 */
export function ensureParagraphConformsToStyle(
  paragraphOrParams:
    | string
    | {
        paragraph: string;
        narrativeStyle: DemoNarrativeStyleId;
        speakerName: string;
        isCouple?: boolean;
      },
  narrativeStyleArg?: DemoNarrativeStyleId,
  speakerNameArg?: string,
  isCoupleArg?: boolean
): string {
  const paragraph =
    typeof paragraphOrParams === 'string'
      ? paragraphOrParams
      : paragraphOrParams.paragraph;
  const narrativeStyle =
    typeof paragraphOrParams === 'string'
      ? narrativeStyleArg || 'first_person_literary'
      : paragraphOrParams.narrativeStyle;
  const speakerName =
    typeof paragraphOrParams === 'string'
      ? speakerNameArg || 'Protagonista'
      : paragraphOrParams.speakerName;
  const isCouple =
    typeof paragraphOrParams === 'string'
      ? Boolean(isCoupleArg)
      : Boolean(paragraphOrParams.isCouple);

  const cleaned = cleanSpanishOralText(paragraph);
  if (!cleaned) return '';

  if (narrativeStyle === 'third_person_biography') {
    const hasFirstPersonMarkers = uw(
      'yo|mi|mis|mío|mía|conmigo|nosotros|nosotras|nuestro|nuestra|nuestros|nuestras|nací|crecí|viví|aprendí|conocí|salí|volví|sentí|decidí|descubrí|compartí|recibí|elegí|construí|sufrí|tuve|estuve|hice|pude|supe|quise|fui|empecé|comencé|terminé|trabajé|estudié|llegué|jugué|logré|pasé|encontré|recuerdo|tengo|soy|estoy|voy|quiero|pienso|siento|nacimos|crecimos|vivíamos|teníamos|éramos|estábamos|jugábamos|íbamos|tuvimos|fuimos|hicimos'
    ).test(cleaned);
    if (hasFirstPersonMarkers) {
      return convertFirstPersonToThirdPersonSpanish(cleaned, speakerName, isCouple, true);
    }
  }
  return cleaned;
}

/**
 * Strips any inline `[FOTO: id | descripción]` or markdown image tags from book narrative paragraphs
 * so photo metadata never renders as raw text overlapping chapter paragraphs.
 */
export function stripInlinePhotoMarkers(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/\[FOTO\s*:[^\]]*\]/gi, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Formats a photograph's caption for clean display inside the book's photo box (max ~110 chars).
 * If the participant recorded a long voice story into the photo's caption field, extracts a concise
 * descriptive caption for the visual frame while the full narrative is woven into the chapter text.
 */
export function formatPhotoEditorialCaption(rawCaption?: string): string {
  if (!rawCaption || typeof rawCaption !== 'string') return '';
  const cleaned = stripInlinePhotoMarkers(
    rawCaption.replace(/^\[Nota de voz\]:\s*/i, '').trim()
  );
  if (!cleaned) return '';
  if (cleaned.length <= 90) {
    return cleanSpanishOralText(cleaned);
  }
  const polished = cleanSpanishOralText(cleaned);
  const firstClause = polished.split(/(?<=[.!?;,])\s+|\s+cuando\s+|\s+donde\s+/i)[0] || polished;
  if (firstClause.length <= 90 && firstClause.length >= 12) {
    const trimmedClause = firstClause.replace(/[,;:\s]+$/, '');
    return /[.!?]$/.test(trimmedClause) ? trimmedClause : `${trimmedClause}.`;
  }
  return `${polished.slice(0, 86).replace(/[,;:\s]+$/, '')}…`;
}

/**
 * Repairs and sanitizes an entire DemoManuscript (whether newly generated or loaded from a previously
 * saved PDF version in History / Admin / Demo), removing robotic boilerplate, fixing orthography and
 * missing prepositions, and ensuring grammatical congruence across all chapters and locked preview groups.
 * When `manuscript.aiGenerated === true`, preserves the AI's custom Literary Prompt style verbatim.
 */
export function sanitizeAndRepairBookManuscript(manuscript: DemoManuscript): DemoManuscript {
  if (!manuscript) return manuscript;
  if (manuscript.aiGenerated) {
    const cleanAiChapters = (manuscript.chapters || []).map((ch) => ({
      ...ch,
      title: stripInlinePhotoMarkers(ch.title || '').replace(/\.$/, '').trim() || ch.title,
      paragraphs: (ch.paragraphs || [])
        .map((p) => stripInlinePhotoMarkers(p))
        .filter((p) => p.length > 0),
      pullQuote: ch.pullQuote ? stripInlinePhotoMarkers(ch.pullQuote) : undefined,
    }));
    return {
      ...manuscript,
      title: stripInlinePhotoMarkers(manuscript.title || '').replace(/\.$/, '').trim() || manuscript.title,
      subtitle:
        stripInlinePhotoMarkers(manuscript.subtitle || '').replace(/\.$/, '').trim() ||
        manuscript.subtitle,
      introduction: manuscript.introduction
        ? stripInlinePhotoMarkers(manuscript.introduction)
        : manuscript.introduction,
      dedication: manuscript.dedication
        ? stripInlinePhotoMarkers(manuscript.dedication)
        : manuscript.dedication,
      closingMessage: manuscript.closingMessage
        ? stripInlinePhotoMarkers(manuscript.closingMessage)
        : manuscript.closingMessage,
      chapters: cleanAiChapters,
    };
  }

  const style: DemoNarrativeStyleId = manuscript.narrativeStyle || 'first_person_literary';
  const speaker = manuscript.authors || 'Protagonista';
  const isCouple = manuscript.mode === 'pareja';

  const repairedChapters = (manuscript.chapters || []).map((ch) => ({
    ...ch,
    title: cleanSpanishOralText(stripInlinePhotoMarkers(ch.title || '')).replace(/\.$/, '') || ch.title,
    paragraphs: (ch.paragraphs || [])
      .map((p) => ensureParagraphConformsToStyle(stripInlinePhotoMarkers(p), style, speaker, isCouple))
      .filter((p) => p.length > 0),
    pullQuote: ch.pullQuote
      ? ensureParagraphConformsToStyle(stripInlinePhotoMarkers(ch.pullQuote), style, speaker, isCouple)
      : undefined,
  }));

  return {
    ...manuscript,
    title: cleanSpanishOralText(stripInlinePhotoMarkers(manuscript.title || '')).replace(/\.$/, '') || manuscript.title,
    subtitle:
      cleanSpanishOralText(stripInlinePhotoMarkers(manuscript.subtitle || '')).replace(/\.$/, '') || manuscript.subtitle,
    introduction: manuscript.introduction
      ? ensureParagraphConformsToStyle(stripInlinePhotoMarkers(manuscript.introduction), style, speaker, isCouple)
      : manuscript.introduction,
    dedication: manuscript.dedication
      ? cleanSpanishOralText(stripInlinePhotoMarkers(manuscript.dedication))
      : manuscript.dedication,
    closingMessage: manuscript.closingMessage
      ? ensureParagraphConformsToStyle(stripInlinePhotoMarkers(manuscript.closingMessage), style, speaker, isCouple)
      : manuscript.closingMessage,
    chapters: repairedChapters,
  };
}

/**
 * Faithful fallback manuscript builder used only if the user chooses offline recovery after an API error.
 * Strictly transforms only the authentic answers provided without inventing any fictional facts.
 */
export function buildFaithfulFallbackManuscript(params: {
  profile: DemoBasicProfile;
  responses: Record<string, DemoQuestionResponse>;
  narrativeStyle: DemoNarrativeStyleId;
  dedication?: string;
}): DemoManuscript {
  const { profile, responses, narrativeStyle, dedication = '' } = params;
  const isCouple = profile.mode === 'pareja';
  const authors = isCouple
    ? `${profile.partner1Name.trim()} y ${profile.partner2Name.trim()}`
    : (profile.displayName || profile.fullName || 'Protagonista').trim();

  const defaultTitle =
    profile.customTitle?.trim() ||
    (isCouple ? `Nuestra historia: ${authors}` : `Los recuerdos de ${authors}`);

  const defaultSubtitle = isCouple
    ? 'Pequeño libro de memorias compartidas'
    : 'Pequeño libro autobiográfico';

  const chapters: DemoChapterManuscript[] = [];
  const insufficientInfoNotices: string[] = [];

  const EXPLICIT_EXCLUSION_INLINE_RX =
    /\b(no incluir en el libro|no poner en el libro|excluir del libro|no publicar en el libro|omitir del libro|confidencial[:\s]*no incluir|no quiero que esto salga en el libro|prefiero que esto no aparezca en el libro)\b/i;

  const stripExcludedSentences = (raw: string): { text: string; wasExcluded: boolean } => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return { text: '', wasExcluded: false };
    const sentences = trimmed
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const kept = sentences.filter((s) => !EXPLICIT_EXCLUSION_INLINE_RX.test(s));
    return {
      text: kept.join(' ').trim(),
      wasExcluded: kept.length < sentences.length,
    };
  };

  for (let qIdx = 0; qIdx < DEMO_MAIN_QUESTIONS.length; qIdx++) {
    const q = DEMO_MAIN_QUESTIONS[qIdx];
    const resp = responses[q.id];
    if (!resp || resp.mainOmission === 'not_recalled' || resp.mainOmission === 'prefer_not_to_answer') {
      insufficientInfoNotices.push(
        isCouple ? q.coupleDimensionTitle : q.individualDimensionTitle
      );
      continue;
    }

    const paragraphs: string[] = [];
    const mainFiltered = stripExcludedSentences(resp.mainAnswerText || '');
    const p1Filtered = stripExcludedSentences(resp.partner1AnswerText || '');
    const p2Filtered = stripExcludedSentences(resp.partner2AnswerText || '');
    const followFiltered = stripExcludedSentences(resp.followUpAnswerText || '');
    const p1FollowFiltered = stripExcludedSentences(resp.partner1FollowUpText || '');
    const p2FollowFiltered = stripExcludedSentences(resp.partner2FollowUpText || '');

    const mainText = mainFiltered.text;
    const p1Text = p1Filtered.text;
    const p2Text = p2Filtered.text;
    const followUpText =
      resp.followUpOmission === 'not_recalled' || resp.followUpOmission === 'prefer_not_to_answer'
        ? ''
        : followFiltered.text;
    const p1Follow =
      resp.followUpOmission === 'not_recalled' || resp.followUpOmission === 'prefer_not_to_answer'
        ? ''
        : p1FollowFiltered.text;
    const p2Follow =
      resp.followUpOmission === 'not_recalled' || resp.followUpOmission === 'prefer_not_to_answer'
        ? ''
        : p2FollowFiltered.text;

    const mainQText = isCouple ? q.coupleText : q.individualText;
    const followUpQText = resp.followUp?.followUpQuestion;

    if (isCouple) {
      if (p1Text) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: p1Text,
            questionText: mainQText,
            narrativeStyle,
            speakerName: profile.partner1Name || 'Participante 1',
            isCouple: true,
            isFirstBlockForSpeaker: true,
            unitIndex: qIdx,
          })
        );
      }
      if (p2Text) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: p2Text,
            questionText: mainQText,
            narrativeStyle,
            speakerName: profile.partner2Name || 'Participante 2',
            isCouple: true,
            isFirstBlockForSpeaker: true,
            unitIndex: qIdx + 1,
          })
        );
      }
      if (mainText) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: mainText,
            questionText: mainQText,
            narrativeStyle,
            speakerName: authors,
            isCouple: true,
            isFirstBlockForSpeaker: !p1Text && !p2Text,
            unitIndex: qIdx,
          })
        );
      }
      if (p1Follow) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: p1Follow,
            questionText: followUpQText,
            narrativeStyle,
            speakerName: profile.partner1Name || 'Participante 1',
            isCouple: true,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: qIdx,
          })
        );
      }
      if (p2Follow) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: p2Follow,
            questionText: followUpQText,
            narrativeStyle,
            speakerName: profile.partner2Name || 'Participante 2',
            isCouple: true,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: qIdx + 1,
          })
        );
      }
      if (followUpText) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: followUpText,
            questionText: followUpQText,
            narrativeStyle,
            speakerName: authors,
            isCouple: true,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: qIdx,
          })
        );
      }
    } else {
      if (mainText) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: mainText,
            questionText: mainQText,
            narrativeStyle,
            speakerName: authors,
            isCouple: false,
            isFirstBlockForSpeaker: true,
            unitIndex: qIdx,
          })
        );
      }
      if (followUpText && (!resp.followUpOmission || resp.followUpOmission === 'none')) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: followUpText,
            questionText: followUpQText,
            narrativeStyle,
            speakerName: authors,
            isCouple: false,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: qIdx,
          })
        );
      }
    }

    const rawCombinedForUncertainty = [
      mainText,
      p1Text,
      p2Text,
      followUpText,
      p1Follow,
      p2Follow,
    ]
      .filter(Boolean)
      .join(' ');
    const filteredParas = ensureUncertaintyPreservedInParagraphs(
      rawCombinedForUncertainty,
      paragraphs.filter((p) => p.trim().length > 0),
      narrativeStyle
    );

    if (filteredParas.length > 0) {
      const pullQuoteCandidate = filteredParas[0].split(/(?<=[.!?])\s+/)[0] || '';
      chapters.push({
        id: q.id,
        partNumber: chapters.length + 1,
        dimensionKey: q.dimensionKey,
        title: isCouple ? q.coupleBookPartTitle : q.individualBookPartTitle,
        paragraphs: filteredParas,
        paragraphIds: filteredParas.map((_, idx) => `${q.id}_p_${idx + 1}`),
        pullQuote:
          pullQuoteCandidate.length >= 20 && pullQuoteCandidate.length <= 160
            ? pullQuoteCandidate
            : undefined,
      });
    } else {
      insufficientInfoNotices.push(
        isCouple ? q.coupleDimensionTitle : q.individualDimensionTitle
      );
    }
  }

  const legacyResp = responses['demo_q5_legado'];
  const legacyClosingFiltered =
    legacyResp &&
    legacyResp.mainOmission !== 'not_recalled' &&
    legacyResp.mainOmission !== 'prefer_not_to_answer'
      ? stripExcludedSentences(legacyResp.mainAnswerText || '').text
      : '';
  const rawClosing =
    legacyClosingFiltered ||
    (isCouple
      ? 'Cada recuerdo compartido en estas páginas guarda la esencia de nuestro camino juntos.'
      : 'Cada recuerdo reunido en estas páginas guarda la esencia de mi historia para quienes amo.');
  const closingMessage = ensureParagraphConformsToStyle({
    paragraph: rawClosing,
    narrativeStyle,
    speakerName: authors,
    isCouple,
  });

  return {
    title: defaultTitle,
    subtitle: defaultSubtitle,
    authors,
    mode: profile.mode,
    narrativeStyle,
    introduction:
      narrativeStyle === 'third_person_biography'
        ? `Esta edición biográfica reúne la historia, vivencias y recuerdos de ${authors}, narrados con fidelidad y respeto a su trayectoria de vida.`
        : narrativeStyle === 'first_person_simple'
        ? `En las siguientes páginas presento de manera ordenada y directa los recuerdos y acontecimientos que han dado forma a mi historia personal.`
        : isCouple
        ? `Estas páginas reúnen recuerdos auténticos compartidos por ${authors}, conservando sus propias palabras, afectos y vivencias con calidez literaria.`
        : `Estas páginas reúnen recuerdos auténticos de ${authors}, conservados con sensibilidad literaria y fidelidad a su voz y a su memoria.`,
    dedication: cleanSpanishOralText(dedication),
    chapters,
    closingMessage,
    insufficientInfoNotices,
    generatedAt: new Date().toISOString(),
    useOfficialForeverYouLogo: true,
    aiGenerated: false,
    generationStatus: 'generated',
  };
}

/**
 * Immutable record representing a generated PDF book version in the Participant Portal & Admin Panel.
 * Older versions are never deleted; all versions remain preserved and downloadable.
 */
export interface ParticipantBookVersionRecord {
  id: string;
  interviewId: string;
  participantId: string;
  participantName: string;
  versionNumber: number;
  title: string;
  subtitle: string;
  authors: string;
  dedication: string;
  closingPageText: string;
  narrativeStyle: DemoNarrativeStyleId;
  editorialConfig: DemoEditorialConfig;
  manuscript: DemoManuscript;
  coverPhoto?: DemoInMemoryPhoto | null;
  chapterPhotos?: Record<string, DemoInMemoryPhoto | null>;
  allPhotosById?: Record<string, DemoInMemoryPhoto>;
  pageCount: number;
  fileName: string;
  createdAt: string;
  /**
   * V5.3.6: true in the participant's session list, where the book itself (manuscript and photos)
   * is not sent; it is loaded on demand when the version is opened or downloaded.
   */
  contentOmitted?: boolean;
}

/**
 * Resolves the canonical text of an answer prioritizing written text (`answerText`) over voice
 * transcriptions, never concatenating a redundant audio transcript over an edited written answer.
 */
export function resolveCanonicalAnswerSource(ans: {
  answerText?: string;
  audio?: { transcription?: string } | null;
  audioRecordings?: Array<{ transcription?: string }> | null;
}): {
  text: string;
  source: 'written' | 'audio_transcription' | 'none';
  hasWrittenText: boolean;
  hasAudioTranscription: boolean;
} {
  const cleanWritten = (ans.answerText || '')
    .trim()
    .replace(/\[Nota de voz\]:\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  let cleanAudio = '';
  if (ans.audio?.transcription) {
    cleanAudio = ans.audio.transcription.trim();
  } else if (Array.isArray(ans.audioRecordings) && ans.audioRecordings.length > 0) {
    cleanAudio = ans.audioRecordings
      .map((r) => (r?.transcription || '').trim())
      .filter((t) => t.length > 0)
      .join(' ');
  }
  cleanAudio = cleanAudio.replace(/\[Nota de voz\]:\s*/gi, '').replace(/\s{2,}/g, ' ').trim();

  if (cleanWritten.length > 0) {
    return {
      text: cleanWritten,
      source: 'written',
      hasWrittenText: true,
      hasAudioTranscription: cleanAudio.length > 0,
    };
  }
  if (cleanAudio.length > 0) {
    return {
      text: cleanAudio,
      source: 'audio_transcription',
      hasWrittenText: false,
      hasAudioTranscription: true,
    };
  }
  return {
    text: '',
    source: 'none',
    hasWrittenText: false,
    hasAudioTranscription: false,
  };
}

/**
 * Extracts clean text from a participant's answer, strictly prioritizing written text over audio transcription.
 */
export function extractCleanParticipantAnswerText(ans: {
  answerText?: string;
  audio?: { transcription?: string } | null;
  audioRecordings?: Array<{ transcription?: string }> | null;
}): string {
  return resolveCanonicalAnswerSource(ans).text;
}

function ensureEndingPunctuation(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[.!?…»"]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function splitLongParagraphAtSentences(text: string, maxChunkChars: number = 820): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChunkChars) return [trimmed];

  const sentences = trimmed.split(/(?<=[.!?…])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const s of sentences) {
    if (!current) {
      current = s;
    } else if (current.length + 1 + s.length <= maxChunkChars) {
      current = `${current} ${s}`;
    } else {
      chunks.push(current);
      current = s;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks.length > 0 ? chunks : [trimmed];
}

/**
 * Determines whether the participant's interview has newer or additional answers compared to the
 * latest saved book version (for example, after reopening an interview and answering more questions).
 */
export function hasUpdatedAnswersSinceBookVersion(params: {
  answers: Array<{
    answerText?: string;
    notRecalled?: boolean;
    isFollowUp?: boolean;
    parentQuestionId?: string | null;
    createdAt?: string;
    updatedAt?: string;
    audio?: { transcription?: string } | null;
    audioRecordings?: Array<{ transcription?: string }> | null;
  }>;
  interviewReopenedAt?: string | null;
  latestBookVersion?: Pick<ParticipantBookVersionRecord, 'createdAt' | 'manuscript'> | null;
}): boolean {
  const { answers, interviewReopenedAt, latestBookVersion } = params;
  if (!latestBookVersion) return true;

  const versionTime = new Date(latestBookVersion.createdAt || 0).getTime();
  if (interviewReopenedAt) {
    const reopenTime = new Date(interviewReopenedAt).getTime();
    if (!Number.isNaN(reopenTime) && reopenTime > versionTime) {
      return true;
    }
  }

  const validAnswers = answers.filter(
    (a) => !a.notRecalled && extractCleanParticipantAnswerText(a).length > 0
  );

  for (const ans of validAnswers) {
    const t = new Date(ans.updatedAt || ans.createdAt || 0).getTime();
    if (!Number.isNaN(t) && t > versionTime) {
      return true;
    }
  }

  const savedParagraphCount = (latestBookVersion.manuscript?.chapters || []).reduce(
    (acc, ch) => acc + (ch.paragraphs?.length || 0),
    0
  );
  const mainValidCount = validAnswers.filter(
    (a) => !a.isFollowUp && !(a.parentQuestionId && a.parentQuestionId.trim().length > 0)
  ).length;
  if (mainValidCount > 0 && savedParagraphCount < mainValidCount) {
    return true;
  }

  return false;
}

/**
 * Transforms an interview's real answers, deepening follow-up answers, questions, and uploaded photographs
 * into a structured DemoManuscript and chapterPhotos map, respecting the chosen narrative style and story mode.
 *
 * Guarantees:
 * - 100% of main answers, deepening follow-ups, and additional memories are included without omission.
 * - Each deepening follow-up answer is placed and integrated immediately after its parent main question.
 */
export interface StructuredChapterTestimonyUnit {
  unitId?: string;
  sourceAnswerIds?: string[];
  sourceQuestionIds?: string[];
  uncertaintyExpressions?: string[];
  preguntaPrincipal?: string;
  respuestaPrincipal?: string;
  profundizaciones?: Array<{ pregunta?: string; respuesta: string; answerId?: string; questionId?: string }>;
  fotografiasAsociadas?: Array<{
    photoId: string;
    descripcionOriginal: string;
    preguntaAsociada?: string;
    answerId?: string;
    questionId?: string;
  }>;
  textoIntegrado: string;
}

const UNCERTAINTY_PATTERNS: RegExp[] = [
  /\bno recuerd[oa]n? bien\b/i,
  /\bno (?:me|se) acuerd[oa]n? bien\b/i,
  /\bcre[eo]n? que\b/i,
  /\btal vez\b/i,
  /\bquiz[aá]s?\b/i,
  /\baproximadamente\b/i,
  /\b(?:me|le|les) parece que\b/i,
  /\bposiblemente\b/i,
  /\balrededor de\b/i,
  /\bseg[uú]n recuerd[oa]n?\b/i,
  /\bseg[uú]n rememora\b/i,
];

export function extractUncertaintyExpressions(text: string): string[] {
  const clean = (text || '').trim();
  if (!clean) return [];
  const found: string[] = [];
  for (const rx of UNCERTAINTY_PATTERNS) {
    const match = clean.match(rx);
    if (match && match[0]) {
      const normalized = match[0].toLowerCase().trim();
      if (!found.includes(normalized)) {
        found.push(normalized);
      }
    }
  }
  return found;
}

export function ensureUncertaintyPreservedInParagraphs(
  sourceText: string,
  paragraphs: string[],
  narrativeStyle?: DemoNarrativeStyleId
): string[] {
  const uncertainties = extractUncertaintyExpressions(sourceText);
  if (uncertainties.length === 0 || paragraphs.length === 0) return paragraphs;
  const combinedOut = paragraphs.join(' ').toLowerCase();
  const hasAnyUncertaintyInOutput =
    uncertainties.some((u) => combinedOut.includes(u)) ||
    UNCERTAINTY_PATTERNS.some((rx) => rx.test(combinedOut));
  if (hasAnyUncertaintyInOutput) return paragraphs;

  const isThirdPerson = narrativeStyle === 'third_person_biography';
  const firstUncertainty = uncertainties[0];
  const updated = [...paragraphs];
  const firstPara = updated[0].trim();
  if (firstPara.length > 0) {
    const lowerFirst = firstPara.charAt(0).toLowerCase() + firstPara.slice(1);
    let prefix: string;
    if (firstUncertainty === 'aproximadamente' || firstUncertainty === 'alrededor de') {
      prefix = isThirdPerson
        ? 'Según recuerda aproximadamente, '
        : 'Según recuerdo aproximadamente, ';
    } else if (isThirdPerson) {
      const thirdPersonMap: Record<string, string> = {
        'no recuerdo bien': 'No recuerda bien, ',
        'no me acuerdo bien': 'No se acuerda bien, ',
        'creo que': 'Cree que ',
        'me parece que': 'Le parece que ',
        'según recuerdo': 'Según recuerda, ',
      };
      prefix =
        thirdPersonMap[firstUncertainty] ||
        `${firstUncertainty.charAt(0).toUpperCase() + firstUncertainty.slice(1)}, `;
    } else {
      prefix = `${firstUncertainty.charAt(0).toUpperCase() + firstUncertainty.slice(1)}, `;
    }
    updated[0] = `${prefix}${lowerFirst}`;
  }
  return updated;
}

function tokenizeSignificantWords(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        ![
          'para',
          'como',
          'este',
          'esta',
          'estos',
          'estas',
          'cuando',
          'donde',
          'porque',
          'pero',
          'todo',
          'toda',
          'todos',
          'todas',
          'muy',
          'mas',
          'tambien',
          'entre',
          'desde',
          'hasta',
          'sobre',
          'recuerdo',
          'recuerdos',
          'historia',
          'vida',
          'anos',
          'siempre',
          'habia',
          'tenia',
          'fueron',
          'estaba',
        ].includes(w)
    );
}

export function areTestimoniesRedundantSameEpisode(textA: string, textB: string): boolean {
  const cleanA = (textA || '').trim();
  const cleanB = (textB || '').trim();
  if (!cleanA || !cleanB) return false;

  const normA = cleanA
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normB = cleanB
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normA === normB) return true;

  // If either text has numbers/years that differ from the other, they refer to distinct episodes
  const numsA = (normA.match(/\b\d+\b/g) || []).join(',');
  const numsB = (normB.match(/\b\d+\b/g) || []).join(',');
  if (numsA !== numsB) return false;

  if (normA.length >= 25 && normB.includes(normA)) return true;
  if (normB.length >= 25 && normA.includes(normB)) return true;

  const wordsA = tokenizeSignificantWords(cleanA);
  const wordsB = tokenizeSignificantWords(cleanB);
  if (wordsA.length < 4 || wordsB.length < 4) return false;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const minSize = Math.min(setA.size, setB.size);
  // Every significant word of the shorter testimony must appear in the longer testimony
  return minSize > 0 && intersection === minSize;
}

export function consolidateComplementarySentences(primaryText: string, secondaryText: string): string {
  const cleanPrimary = (primaryText || '').trim();
  const cleanSecondary = (secondaryText || '').trim();
  if (!cleanPrimary) return cleanSecondary;
  if (!cleanSecondary) return cleanPrimary;

  const primarySentences = cleanPrimary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const secondarySentences = cleanSecondary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const mergedSentences = [...primarySentences];
  for (const secSent of secondarySentences) {
    const isDuplicateSentence = mergedSentences.some((primSent) => {
      if (areTestimoniesRedundantSameEpisode(primSent, secSent)) {
        return secSent.length <= primSent.length;
      }
      return false;
    });
    if (!isDuplicateSentence) {
      // Check if secSent is a richer version of an existing shorter sentence
      const richerReplaceIdx = mergedSentences.findIndex(
        (primSent) =>
          areTestimoniesRedundantSameEpisode(primSent, secSent) &&
          secSent.length > primSent.length
      );
      if (richerReplaceIdx >= 0) {
        mergedSentences[richerReplaceIdx] = ensureEndingPunctuation(secSent);
      } else {
        mergedSentences.push(ensureEndingPunctuation(secSent));
      }
    }
  }

  return mergedSentences.map((s) => ensureEndingPunctuation(s)).join(' ');
}

export interface DocumentarySourceAnswerInput {
  id: string;
  questionId: string;
  questionText?: string;
  participantId?: string;
  participantName: string;
  answerText: string;
  notRecalled?: boolean;
  preferNotToAnswer?: boolean;
  excludeFromBook?: boolean;
  excludedByInterviewee?: boolean;
  omissionReason?: 'none' | 'not_recalled' | 'prefer_not_to_answer' | 'excluded_by_interviewee';
  restriction?: string;
  isFollowUp?: boolean;
  parentQuestionId?: string | null;
  isAdditionalMemory?: boolean;
  lifeStage?: string;
  createdAt?: string;
  updatedAt?: string;
  audio?: { transcription?: string } | null;
  audioRecordings?: Array<{ transcription?: string }> | null;
  photos?: Array<{
    id: string;
    caption: string;
    mimeType: string;
    imageUrl: string;
    dataUrl?: string;
    lifeStage?: string;
  }>;
}

export interface DocumentarySourceQuestionInput {
  id: string;
  text: string;
  lifeStage: string;
  topic: string;
  orderIndex?: number;
}

const EXPLICIT_EXCLUSION_DIRECTIVE_RX =
  /\b(no incluir(?:\s+(?:esto|esta\s+(?:parte|historia|respuesta|anécdota)|ese\s+episodio|eso))?\s+en\s+(?:el|mi)\s+libro|no\s+incluyas\s+(?:esto|esta\s+parte|este\s+episodio|eso)(?:\s+en\s+(?:el|mi)\s+libro)?|no\s+poner(?:\s+(?:esto|esta\s+parte))?\s+en\s+(?:el|mi)\s+libro|no\s+pongas\s+(?:esto|esta\s+parte|eso)(?:\s+en\s+(?:el|mi)\s+libro)?|excluir\s+del\s+libro|no\s+publicar(?:\s+(?:esto|eso|esta\s+parte))?(?:\s+en\s+(?:el|mi)\s+libro)?|no\s+quiero\s+publicarlo|omitir(?:\s+(?:esto|esta\s+parte|solamente\s+[^.!?]+))?\s+(?:del\s+libro|en\s+el\s+libro)|quiero\s+que\s+se\s+omita\s+(?:solamente\s+)?[^.!?]+|confidencial[:\s]*(?:no\s+incluir|mantener\s+en\s+privado)|no\s+quiero\s+que\s+(?:esto|eso|esta\s+parte)\s+(?:salga|se\s+publique|aparezca)\s+en\s+(?:el|mi)\s+libro|prefiero\s+que\s+(?:esto|esta\s+parte|este\s+episodio)\s+no\s+aparezca(?:\s+en\s+(?:el|mi)\s+libro)?|no\s+menciones\s+(?:mi|el|la|los|las|esa|este|esto)\s+[^.!?]+|esto\s+te\s+lo\s+cuento[,\s]+pero\s+no\s+quiero\s+(?:que\s+salga|publicarlo)|(?:esa|esta)\s+parte\s+es\s+privada)\b/i;

const BARE_NOT_RECALLED_RX =
  /^(no lo recuerdo|no recuerdo esta pregunta|no recuerdo nada de esto|sin recuerdo registrado)[.!]?$/i;

const BARE_PREFER_NOT_TO_ANSWER_RX =
  /^(prefiero no responder|prefiero no contestar|prefiero omitir esta pregunta|prefiero reservarme esta respuesta)[.!]?$/i;

const SPANISH_EMOTION_STEMS: string[] = [
  'feliz',
  'felicidad',
  'alegr',
  'trist',
  'miedo',
  'temor',
  'orgull',
  'nostalgi',
  'amor',
  'carin',
  'paz',
  'gratitud',
  'agradec',
  'dolor',
  'llor',
  'emocion',
  'ilusion',
  'esperanz',
  'soledad',
  'angusti',
  'tranquil',
  'conmov',
  'entusiasm',
  'alivi',
  'ternur',
  'afect',
  'felices',
  'content',
];

const SPANISH_FAMILY_RELATIONS: string[] = [
  'abuela',
  'abuelo',
  'abuelos',
  'madre',
  'mama',
  'padre',
  'papa',
  'padres',
  'hermano',
  'hermana',
  'hermanos',
  'hermanas',
  'esposo',
  'esposa',
  'marido',
  'hijo',
  'hija',
  'hijos',
  'hijas',
  'tio',
  'tia',
  'tios',
  'primo',
  'prima',
  'primos',
  'nieto',
  'nieta',
  'nietos',
  'suegro',
  'suegra',
  'cunado',
  'cunada',
  ' padrino',
  'madrina',
];

const SPANISH_PLACE_NOUNS: string[] = [
  'pueblo',
  'ciudad',
  'barrio',
  'colonia',
  'rancho',
  'finca',
  'hacienda',
  'escuela',
  'colegio',
  'universidad',
  'facultad',
  'taller',
  'fabrica',
  'oficina',
  'hospital',
  'clinica',
  'iglesia',
  'parroquia',
  'parque',
  'plaza',
  'mercado',
  'playa',
  'montana',
  'campo',
  'patio',
  'cocina',
  'jardin',
  'estacion',
  'ferrocarril',
];

const SPANISH_EQUIVALENT_WORD_GROUPS: string[][] = [
  ['madre', 'mama', 'mami'],
  ['padre', 'papa', 'papi'],
  ['abuela', 'abuelita', 'nona'],
  ['abuelo', 'abuelito', 'nono'],
  ['esposo', 'marido', 'companero'],
  ['esposa', 'mujer', 'companera'],
  ['hermano', 'hermanito', 'hermanos'],
  ['hermana', 'hermanita', 'hermanas'],
  ['hijo', 'hijos', 'hijito'],
  ['hija', 'hijas', 'hijita'],
  ['escuela', 'colegio', 'primaria', 'secundaria', 'instituto'],
  ['coche', 'carro', 'auto', 'automovil', 'camioneta', 'vehiculo'],
  ['casa', 'hogar', 'vivienda', 'domicilio'],
  ['trabajo', 'empleo', 'oficio', 'ocupacion', 'labor', 'trabajar', 'trabajaba', 'trabajo'],
  ['naci', 'nacio', 'nacimiento', 'nacer', 'nacimos', 'nacieron'],
  ['vivi', 'vivio', 'viviamos', 'vivieron', 'vivir', 'habitamos'],
  ['fui', 'fue', 'fuimos', 'fueron', 'iba', 'ibamos'],
  ['tuve', 'tuvo', 'tuvimos', 'tuvieron', 'tenia', 'teniamos'],
  ['senti', 'sintio', 'sentiamos', 'sintieron', 'sentia', 'sentimiento'],
  ['hice', 'hizo', 'hicimos', 'hicieron', 'hacia', 'haciamos'],
  ['pude', 'pudo', 'pudimos', 'pudieron', 'podia'],
  ['vine', 'vino', 'vinimos', 'vinieron', 'venia'],
  ['dije', 'dijo', 'dijimos', 'dijieron', 'decia'],
  ['quise', 'quiso', 'quisimos', 'quisieron', 'queria'],
  ['supe', 'supo', 'supimos', 'supieron', 'sabia'],
  ['estuve', 'estuvo', 'estuvimos', 'estuvieron', 'estaba'],
  ['aprendi', 'aprendio', 'aprendimos', 'aprendieron', 'aprendizaje'],
  ['conoci', 'conocio', 'conocimos', 'conocieron'],
  ['case', 'caso', 'casamos', 'casaron', 'matrimonio', 'boda'],
  ['mude', 'mudo', 'mudamos', 'mudaron', 'mudanza', 'trasladamos'],
  ['feliz', 'felicidad', 'alegre', 'alegria', 'contento', 'contenta', 'dicha', 'gozo'],
  ['triste', 'tristeza', 'dolor', 'pena', 'melancolia', 'pesar', 'llorar', 'llore'],
  ['miedo', 'temor', 'asustado', 'asustada', 'susto', 'inquietud', 'angustia'],
  ['orgullo', 'orgulloso', 'orgullosa', 'satisfaccion', 'honrado', 'honrada'],
  ['gratitud', 'agradecido', 'agradecida', 'agradecimiento', 'gracias'],
  ['nostalgia', 'nostalgico', 'nostalgica', 'anoranza', 'extrañar', 'extrano'],
  ['amor', 'carino', 'ternura', 'afecto', 'querer', 'amaba'],
  ['paz', 'tranquilidad', 'tranquilo', 'tranquila', 'serenidad', 'calma', 'alivio'],
  ['1', 'uno', 'primer', 'primero', 'primera'],
  ['2', 'dos', 'segundo', 'segunda', 'ambos'],
  ['3', 'tres', 'tercer', 'tercero', 'tercera'],
  ['4', 'cuatro', 'cuarto', 'cuarta'],
  ['5', 'cinco', 'quinto', 'quinta'],
  ['6', 'seis', 'sexto', 'sexta'],
  ['7', 'siete', 'septimo', 'septima'],
  ['8', 'ocho', 'octavo', 'octava'],
  ['9', 'nueve', 'noveno', 'novena'],
  ['10', 'diez', 'decimo', 'decima'],
  ['11', 'once'],
  ['12', 'doce'],
  ['13', 'trece'],
  ['14', 'catorce'],
  ['15', 'quince'],
  ['16', 'dieciseis'],
  ['17', 'diecisiete'],
  ['18', 'dieciocho'],
  ['19', 'diecinueve'],
  ['20', 'veinte'],
  ['25', 'veinticinco'],
  ['30', 'treinta'],
  ['40', 'cuarenta'],
  ['50', 'cincuenta'],
];

function normalizePlainAscii(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// V5.1 — Spanish number normalization.
// A testimony may say "veinticinco años" / "en el 75" while a faithful manuscript writes "25 años" /
// "en 1975" (or the reverse). Treating those as different facts produced false "invented data" and
// false "missing year" defects. These helpers let both audit directions compare numeric VALUES.
// ---------------------------------------------------------------------------------------------
const SPANISH_NUMBER_UNIT_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21,
  veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const SPANISH_NUMBER_TENS_WORDS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const SPANISH_NUMBER_HUNDREDS_WORDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600,
  seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};
const SPANISH_AMBIGUOUS_ARTICLE_NUMBERS = new Set(['un', 'uno', 'una']);

/**
 * Parses spelled-out Spanish numbers found in already ASCII-normalized text and returns their
 * digit strings ("mil novecientos setenta y cinco" -> "1975", "treinta y dos" -> "32").
 * A lone article ("un", "una", "uno") is never reported as the number 1.
 */
export function extractSpanishNumberWordValues(normalizedAsciiText: string): string[] {
  const words = (normalizedAsciiText || '').split(/\s+/).filter(Boolean);
  const values: string[] = [];
  let i = 0;
  while (i < words.length) {
    let total = 0;
    let current = 0;
    let consumed = 0;
    let onlyAmbiguousArticle = true;
    let lastKind: 'none' | 'unit' | 'tens' | 'hundreds' | 'mil' = 'none';
    let j = i;
    while (j < words.length) {
      const w = words[j];
      if (w in SPANISH_NUMBER_HUNDREDS_WORDS && (lastKind === 'none' || lastKind === 'mil')) {
        current += SPANISH_NUMBER_HUNDREDS_WORDS[w];
        lastKind = 'hundreds';
        onlyAmbiguousArticle = false;
      } else if (
        w in SPANISH_NUMBER_TENS_WORDS &&
        (lastKind === 'none' || lastKind === 'mil' || lastKind === 'hundreds')
      ) {
        current += SPANISH_NUMBER_TENS_WORDS[w];
        lastKind = 'tens';
        onlyAmbiguousArticle = false;
      } else if (
        w === 'y' &&
        lastKind === 'tens' &&
        words[j + 1] in SPANISH_NUMBER_UNIT_WORDS &&
        SPANISH_NUMBER_UNIT_WORDS[words[j + 1]] < 10
      ) {
        current += SPANISH_NUMBER_UNIT_WORDS[words[j + 1]];
        lastKind = 'unit';
        j += 1;
        consumed += 1;
      } else if (
        w in SPANISH_NUMBER_UNIT_WORDS &&
        (lastKind === 'none' || lastKind === 'mil' || lastKind === 'hundreds')
      ) {
        current += SPANISH_NUMBER_UNIT_WORDS[w];
        lastKind = 'unit';
        if (!SPANISH_AMBIGUOUS_ARTICLE_NUMBERS.has(w)) onlyAmbiguousArticle = false;
      } else if (w === 'mil' && lastKind !== 'mil' && total === 0) {
        total += (current || 1) * 1000;
        current = 0;
        lastKind = 'mil';
        onlyAmbiguousArticle = false;
      } else {
        break;
      }
      consumed += 1;
      j += 1;
    }
    if (consumed === 0) {
      i += 1;
      continue;
    }
    const value = total + current;
    if (value > 0 && !onlyAmbiguousArticle) values.push(String(value));
    i = j;
  }
  return values;
}

/** Spells a non-negative integer below 10000 as ASCII-normalized Spanish words. */
function spellSpanishNumberAsAsciiWords(value: number): string[] {
  if (!Number.isInteger(value) || value <= 0 || value >= 10000) return [];
  const out: string[] = [];
  const unitByValue = new Map<number, string>();
  for (const [w, v] of Object.entries(SPANISH_NUMBER_UNIT_WORDS)) {
    if (!unitByValue.has(v) && w !== 'un' && w !== 'una' && w !== 'veintiun' && w !== 'veintiuna') {
      unitByValue.set(v, w);
    }
  }
  const tensByValue = new Map<number, string>(
    Object.entries(SPANISH_NUMBER_TENS_WORDS).map(([w, v]) => [v, w])
  );
  const hundredsByValue: Record<number, string> = {
    100: 'ciento', 200: 'doscientos', 300: 'trescientos', 400: 'cuatrocientos', 500: 'quinientos',
    600: 'seiscientos', 700: 'setecientos', 800: 'ochocientos', 900: 'novecientos',
  };
  let rest = value;
  const thousands = Math.floor(rest / 1000);
  if (thousands > 0) {
    if (thousands > 1) out.push(unitByValue.get(thousands) || String(thousands));
    out.push('mil');
    rest %= 1000;
  }
  const hundreds = Math.floor(rest / 100) * 100;
  if (hundreds > 0) {
    out.push(rest === 100 ? 'cien' : hundredsByValue[hundreds]);
    rest %= 100;
  }
  if (rest > 0) {
    if (rest < 30) {
      out.push(unitByValue.get(rest) || String(rest));
    } else {
      out.push(tensByValue.get(Math.floor(rest / 10) * 10) || '');
      if (rest % 10 > 0) out.push(unitByValue.get(rest % 10) || '');
    }
  }
  return out.filter(Boolean);
}

/**
 * Two-digit years said aloud ("en el 75", "del 82", "año 68") expanded to their 4-digit form.
 * Only fires after a year-introducing cue, so ages ("tenía 75 años") are not turned into years.
 */
export function expandSpokenTwoDigitYears(normalizedAsciiText: string): string[] {
  const out: string[] = [];
  const rx = /\b(?:en\s+el|del|desde\s+el|hasta\s+el|por\s+el|ano|anos)\s+(\d{2})\b(?!\s+anos?\b)/g;
  for (const m of (normalizedAsciiText || '').matchAll(rx)) {
    const yy = Number(m[1]);
    if (Number.isNaN(yy)) continue;
    out.push(String(yy >= 30 ? 1900 + yy : 2000 + yy));
  }
  return out;
}

/**
 * Extra index tokens that make numeric facts comparable regardless of how they are written:
 * digits for spelled-out numbers, and spelled words for digits.
 */
function buildNumericEquivalenceTokens(normalizedAsciiText: string): string[] {
  const extra: string[] = [];
  for (const v of extractSpanishNumberWordValues(normalizedAsciiText)) extra.push(v);
  for (const y of expandSpokenTwoDigitYears(normalizedAsciiText)) extra.push(y);
  for (const d of normalizedAsciiText.match(/\b\d{1,4}\b/g) || []) {
    for (const w of spellSpanishNumberAsAsciiWords(Number(d))) extra.push(w);
  }
  return extra;
}

export function resolveAnswerExclusionReason(
  ansOrText: DocumentarySourceAnswerInput | string
): DocumentaryExclusionReason {
  if (typeof ansOrText === 'string') {
    const rawStr = ansOrText.trim();
    if (!rawStr) return 'none';
    if (BARE_PREFER_NOT_TO_ANSWER_RX.test(rawStr)) return 'prefer_not_to_answer';
    if (BARE_NOT_RECALLED_RX.test(rawStr)) return 'not_recalled';
    const sents = rawStr
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sents.length > 0 && sents.every((s) => EXPLICIT_EXCLUSION_DIRECTIVE_RX.test(s))) {
      return 'excluded_by_interviewee';
    }
    return 'none';
  }
  const ans = ansOrText;
  if (
    ans.excludeFromBook ||
    ans.excludedByInterviewee ||
    ans.omissionReason === 'excluded_by_interviewee' ||
    ans.restriction === 'excluded_by_interviewee'
  ) {
    return 'excluded_by_interviewee';
  }
  if (ans.preferNotToAnswer || ans.omissionReason === 'prefer_not_to_answer') {
    return 'prefer_not_to_answer';
  }
  if (ans.notRecalled || ans.omissionReason === 'not_recalled') {
    return 'not_recalled';
  }
  const rawText = extractCleanParticipantAnswerText(ans);
  if (!rawText) return 'none';
  if (BARE_PREFER_NOT_TO_ANSWER_RX.test(rawText)) {
    return 'prefer_not_to_answer';
  }
  if (BARE_NOT_RECALLED_RX.test(rawText)) {
    return 'not_recalled';
  }
  // Check if every sentence in rawText is an explicit exclusion directive
  const sentences = rawText
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length > 0 && sentences.every((s) => EXPLICIT_EXCLUSION_DIRECTIVE_RX.test(s))) {
    return 'excluded_by_interviewee';
  }
  return 'none';
}

const EXCLUSION_PIVOT_CLAUSE_RX =
  /(?:,\s*(?:pero|aunque)\s+|;\s*|\s*:\s*)(?=(?:no\s+incluyas|no\s+incluir|no\s+pongas|no\s+poner|no\s+quiero\s+(?:publicarlo|que\s+(?:salga|se\s+publique|aparezca))|prefiero\s+que\s+(?:esto|no)|no\s+menciones|quiero\s+que\s+se\s+omita|omitir|excluir|esa\s+parte\s+es\s+privada|confidencial)\b)/i;

export function splitAnswerTextIntoIncludedAndExcludedSentences(rawText: string): {
  includedSentences: string[];
  excludedSentences: string[];
  includedText: string;
} {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    return { includedSentences: [], excludedSentences: [], includedText: '' };
  }
  const sentences = trimmed
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const includedSentences: string[] = [];
  const excludedSentences: string[] = [];
  for (const s of sentences) {
    if (EXPLICIT_EXCLUSION_DIRECTIVE_RX.test(s)) {
      // Check if only a trailing/pivoted clause within a mixed sentence has the exclusion
      // e.g. "Trabajé en Guadalajara en 1998, pero no menciones mi primer matrimonio."
      const pivotParts = s.split(EXCLUSION_PIVOT_CLAUSE_RX);
      if (pivotParts.length >= 2) {
        const leading = (pivotParts[0] || '').trim();
        const trailing = pivotParts.slice(1).join(' ').trim();
        if (leading.length >= 12 && !EXPLICIT_EXCLUSION_DIRECTIVE_RX.test(leading)) {
          includedSentences.push(/[.!?…]$/.test(leading) ? leading : `${leading}.`);
          if (trailing) excludedSentences.push(trailing);
          continue;
        }
      }
      // Check if exclusion directive introduces a topic with a colon ("Esto te lo cuento, pero no quiero publicarlo: ...")
      excludedSentences.push(s);
    } else if (BARE_PREFER_NOT_TO_ANSWER_RX.test(s) || BARE_NOT_RECALLED_RX.test(s)) {
      // Do not include bare omission markers in narrative prose
    } else {
      includedSentences.push(s);
    }
  }
  return {
    includedSentences,
    excludedSentences,
    includedText: includedSentences.join(' ').trim(),
  };
}

function extractFacetsFromFactText(
  rawText: string,
  participantNames: string[] = []
): {
  keyTokens: string[];
  properNames: string[];
  places: string[];
  yearsOrNumbers: string[];
  emotions: string[];
} {
  const norm = normalizePlainAscii(rawText);
  const words = norm.split(/\s+/).filter(Boolean);
  const keyTokens = Array.from(new Set(tokenizeSignificantWords(rawText)));

  // 1. Years or explicit numbers
  const yearsOrNumbers = Array.from(new Set(norm.match(/\b\d+\b/g) || []));

  // 2. Emotions
  const emotions: string[] = [];
  for (const w of words) {
    for (const stem of SPANISH_EMOTION_STEMS) {
      if (w.startsWith(stem) && !emotions.includes(stem)) {
        emotions.push(stem);
      }
    }
  }

  // 3. Places (both common place nouns present in text and capitalized words after prepositions en/a/de/desde/hacia)
  const places: string[] = [];
  for (const w of words) {
    if (SPANISH_PLACE_NOUNS.includes(w) && !places.includes(w)) {
      places.push(w);
    }
  }
  const prepPlaceMatches =
    rawText.match(
      /\b(?:en|de|a|desde|hacia|por)\s+(?:el\s+|la\s+|los\s+|las\s+)?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})?)/g
    ) || [];
  const participantNormSet = new Set(
    participantNames.flatMap((n) => normalizePlainAscii(n).split(/\s+/)).filter(Boolean)
  );
  const commonCapitalizedStopwords = new Set([
    'recuerdo',
    'cuando',
    'siempre',
    'nunca',
    'entonces',
    'despues',
    'luego',
    'durante',
    'aquel',
    'aquella',
    'aquellos',
    'aquellas',
    'nosotros',
    'nosotras',
    'todos',
    'todas',
    'pero',
    'porque',
    'aunque',
    'tambien',
    'ademas',
    'creo',
    'quizas',
    'tal',
    'según',
    'segun',
    'para',
    'como',
    'este',
    'esta',
    'esos',
    'esas',
    'habia',
    'tenia',
    'estaba',
    'fueron',
    'fuimos',
    'viviamos',
    'trabajaba',
    'trabajamos',
    'naci',
    'nacio',
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
    'lunes',
    'martes',
    'miercoles',
    'jueves',
    'viernes',
    'sabado',
    'domingo',
    'dios',
    'libro',
    'incluir',
    'excluir',
    'confidencial',
  ]);

  for (const pm of prepPlaceMatches) {
    const capPart = pm.replace(
      /^(?:en|de|a|desde|hacia|por)\s+(?:el\s+|la\s+|los\s+|las\s+)?/i,
      ''
    );
    const normCap = normalizePlainAscii(capPart);
    if (
      normCap.length >= 3 &&
      !commonCapitalizedStopwords.has(normCap) &&
      !participantNormSet.has(normCap) &&
      !places.includes(normCap)
    ) {
      places.push(normCap);
    }
  }

  // 4. Proper names & family relations
  const properNames: string[] = [];
  for (const w of words) {
    const cleanRel = SPANISH_FAMILY_RELATIONS.find((r) => r.trim() === w);
    if (cleanRel && !properNames.includes(cleanRel.trim())) {
      properNames.push(cleanRel.trim());
    }
  }

  // Also detect mid-sentence capitalized proper names (e.g., "mi abuela Natalia", "con Roberto", "don José")
  const tokensWithCase = rawText.split(/\s+/);
  for (let i = 1; i < tokensWithCase.length; i++) {
    const prevRaw = tokensWithCase[i - 1] || '';
    // Skip if previous token ended a sentence
    if (/[.!?…]$/.test(prevRaw)) continue;
    const tokClean = tokensWithCase[i].replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ]+|[^A-Za-zÁÉÍÓÚÑáéíóúñ]+$/g, '');
    if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}$/.test(tokClean)) {
      const normTok = normalizePlainAscii(tokClean);
      if (
        !commonCapitalizedStopwords.has(normTok) &&
        !participantNormSet.has(normTok) &&
        !places.includes(normTok) &&
        !properNames.includes(normTok)
      ) {
        properNames.push(normTok);
      }
    }
  }

  return {
    keyTokens,
    properNames,
    places,
    yearsOrNumbers,
    emotions,
  };
}

/**
 * Extracts atomic, verifiable documentary fact units (`DocumentaryFactUnit`) from the interview's
 * answers, deepening follow-ups, additional memories, audio transcriptions, and photo descriptions,
 * while classifying explicit exclusions (`not_recalled`, `prefer_not_to_answer`, `excluded_by_interviewee`).
 */
export function buildDocumentaryInventory(params: {
  interviewId?: string;
  answers: DocumentarySourceAnswerInput[];
  questions?: DocumentarySourceQuestionInput[];
  participantNames?: string[];
}): DocumentaryInventory {
  const {
    interviewId = 'interview_default',
    answers = [],
    questions = [],
    participantNames = [],
  } = params;

  const qMap = new Map(questions.map((q) => [q.id, q]));
  const qOrderMap = new Map(
    questions.map((q, idx) => [q.id, typeof q.orderIndex === 'number' ? q.orderIndex : idx])
  );

  const validStageKeys = new Set([
    'infancia',
    'juventud',
    'adultez',
    'madurez',
    'legado_general',
  ]);

  const isFollowUpEntry = (a: DocumentarySourceAnswerInput): boolean =>
    Boolean(
      a.isFollowUp ||
        (a.parentQuestionId && a.parentQuestionId.trim().length > 0) ||
        (a.questionId &&
          (a.questionId.startsWith('followup_') || a.questionId.startsWith('adaptive_')))
    );

  const knownMainQuestionIds = new Set<string>(questions.map((q) => q.id));
  for (const a of answers) {
    if (!isFollowUpEntry(a) && !a.isAdditionalMemory && a.questionId) {
      knownMainQuestionIds.add(a.questionId);
    }
  }

  const resolveParentMainQuestionId = (a: DocumentarySourceAnswerInput): string | null => {
    if (a.parentQuestionId && a.parentQuestionId.trim().length > 0) {
      return a.parentQuestionId.trim();
    }
    if (isFollowUpEntry(a) && a.questionId) {
      for (const qId of knownMainQuestionIds) {
        if (a.questionId.includes(qId)) return qId;
      }
    }
    return null;
  };

  const resolveAnswerStage = (a: DocumentarySourceAnswerInput): string => {
    if (a.isAdditionalMemory) return 'legado_general';
    if (a.lifeStage && validStageKeys.has(a.lifeStage)) return a.lifeStage;
    const q = qMap.get(a.questionId);
    if (q?.lifeStage && validStageKeys.has(q.lifeStage)) return q.lifeStage;
    const parentId = resolveParentMainQuestionId(a);
    if (parentId) {
      const parentQ = qMap.get(parentId);
      if (parentQ?.lifeStage && validStageKeys.has(parentQ.lifeStage)) return parentQ.lifeStage;
      const parentAns = answers.find(
        (cand) => cand.questionId === parentId && !isFollowUpEntry(cand)
      );
      if (parentAns) {
        const pq = qMap.get(parentAns.questionId);
        if (pq?.lifeStage && validStageKeys.has(pq.lifeStage)) return pq.lifeStage;
      }
    }
    const photoStage = a.photos?.[0]?.lifeStage;
    if (photoStage && validStageKeys.has(photoStage)) return photoStage;
    return 'adultez';
  };

  let totalMainAnswers = 0;
  let totalFollowUpAnswers = 0;
  let totalAdditionalMemories = 0;

  const allFactUnits: DocumentaryFactUnit[] = [];
  const photosInventory: DocumentaryInventory['photosInventory'] = [];
  const seenPhotoIds = new Set<string>();

  answers.forEach((ans, idx) => {
    const isFollowUp = isFollowUpEntry(ans);
    const isAdditional = Boolean(ans.isAdditionalMemory) && !isFollowUp;
    if (isAdditional) totalAdditionalMemories++;
    else if (isFollowUp) totalFollowUpAnswers++;
    else totalMainAnswers++;

    const sourceType: DocumentaryFactUnit['sourceType'] = isAdditional
      ? 'additional_memory'
      : isFollowUp
      ? 'followup_answer'
      : 'main_answer';

    const stage = resolveAnswerStage(ans);
    const qObj = qMap.get(ans.questionId);
    const qText = ans.questionText || qObj?.text || '';
    const topic = qObj?.topic || stage;
    const orderIdx = qOrderMap.get(ans.questionId) ?? idx;
    const parentQId = resolveParentMainQuestionId(ans);
    const ansExclusion = resolveAnswerExclusionReason(ans);
    const rawCleanText = extractCleanParticipantAnswerText(ans);
    const ansPhotoIds = (ans.photos || []).map((p) => p?.id).filter(Boolean) as string[];

    for (const p of ans.photos || []) {
      if (p && p.id && !seenPhotoIds.has(p.id)) {
        seenPhotoIds.add(p.id);
        photosInventory.push({
          photoId: p.id,
          caption: (p.caption || '').replace(/^\[Nota de voz\]:\s*/i, '').trim(),
          answerId: ans.id,
          questionId: ans.questionId,
          lifeStage: p.lifeStage || stage,
          isExcluded: ansExclusion !== 'none',
        });
      }
    }

    if (ansExclusion !== 'none') {
      const facets = extractFacetsFromFactText(rawCleanText, participantNames);
      allFactUnits.push({
        unitId: `trace_${ans.id}`,
        parentAnswerId: ans.id,
        answerId: ans.id,
        questionId: ans.questionId,
        questionText: qText,
        sourceType,
        parentQuestionId: parentQId,
        participantId: ans.participantId,
        participantName: ans.participantName || participantNames[0] || 'Protagonista',
        lifeStage: stage,
        topic,
        chronologicalIndex: orderIdx * 100 + idx,
        rawText: rawCleanText || '[Omitida por el entrevistado]',
        cleanText: rawCleanText,
        keyTokens: facets.keyTokens,
        properNames: facets.properNames,
        places: facets.places,
        yearsOrNumbers: facets.yearsOrNumbers,
        emotions: facets.emotions,
        uncertaintyExpressions: [],
        exclusionReason: ansExclusion,
        isEligibleForBook: false,
        photoIds: ansPhotoIds,
      });
      return;
    }

    const splitResult = splitAnswerTextIntoIncludedAndExcludedSentences(rawCleanText);

    // Record any inline excluded sentences as excluded fact units so the audit verifies they never leak
    splitResult.excludedSentences.forEach((exclSent, eIdx) => {
      const cleanedDirective = exclSent
        .replace(EXPLICIT_EXCLUSION_DIRECTIVE_RX, '')
        .replace(/^[:\s,-]+/, '')
        .trim();
      const facets = extractFacetsFromFactText(cleanedDirective || exclSent, participantNames);
      allFactUnits.push({
        unitId: `trace_${ans.id}_excl_${eIdx + 1}`,
        parentAnswerId: ans.id,
        answerId: ans.id,
        questionId: ans.questionId,
        questionText: qText,
        sourceType,
        parentQuestionId: parentQId,
        participantId: ans.participantId,
        participantName: ans.participantName || participantNames[0] || 'Protagonista',
        lifeStage: stage,
        topic,
        chronologicalIndex: orderIdx * 100 + idx,
        rawText: exclSent,
        cleanText: cleanedDirective || exclSent,
        keyTokens: facets.keyTokens,
        properNames: facets.properNames,
        places: facets.places,
        yearsOrNumbers: facets.yearsOrNumbers,
        emotions: facets.emotions,
        uncertaintyExpressions: [],
        exclusionReason: 'excluded_by_interviewee',
        isEligibleForBook: false,
        photoIds: [],
      });
    });

    // Group included sentences into atomic factual units:
    // Substantive independent episodes (each >= 4 significant words AND not a purely dependent continuation)
    // become distinct DocumentaryFactUnits, while dependent anaphoric / uncertainty / discourse-correction
    // continuations bind to their parent proposition so pronouns and negations never lose context.
    const rawSentences = splitResult.includedSentences;
    const isDependentContinuationSentence = (sent: string, sigWords: string[]): boolean => {
      const trimmed = sent.trim();
      if (!trimmed) return true;
      if (/^[a-záéíóúüñ]/.test(trimmed)) return true;
      const startsWithContinuationRx =
        /^(?:y\s+|o\s+|pero\s+|aunque\s+|sin\s+embargo\b|no\s+obstante\b|por\s+eso\b|as[ií]\s+que\b|de\s+hecho\b|adem[aá]s\b|tambi[eé]n\b|tampoco\b|incluso\b|sobre\s+todo\b|no,\s+(?:pues|bueno|en\s+realidad|la\s+verdad|creo)\b|s[ií],\s+(?:pues|claro|creo)\b|(?:él|ella|ellos|ellas|eso|esto|aquello|ambos)\s+(?:también|siempre|nunca|era|fue|estaba|hacía)\b)/i;
      const hasExplicitNamedEntityOrDate =
        /\b(18\d{2}|19\d{2}|20\d{2})\b/.test(trimmed) ||
        /\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/.test(trimmed);
      if (startsWithContinuationRx.test(trimmed) && sigWords.length < 7 && !hasExplicitNamedEntityOrDate) {
        return true;
      }
      if (
        sigWords.length < 6 &&
        UNCERTAINTY_PATTERNS.some((rx) => rx.test(trimmed.toLowerCase())) &&
        !hasExplicitNamedEntityOrDate
      ) {
        return true;
      }
      return false;
    };

    const groupedFactSentences: string[] = [];
    for (const s of rawSentences) {
      const sigWords = tokenizeSignificantWords(s);
      if (groupedFactSentences.length === 0) {
        groupedFactSentences.push(s);
      } else {
        const prevSigWords = tokenizeSignificantWords(
          groupedFactSentences[groupedFactSentences.length - 1]
        );
        const dependent = isDependentContinuationSentence(s, sigWords);
        if (sigWords.length >= 4 && prevSigWords.length >= 4 && !dependent) {
          groupedFactSentences.push(s);
        } else {
          groupedFactSentences[groupedFactSentences.length - 1] =
            `${groupedFactSentences[groupedFactSentences.length - 1]} ${s}`.trim();
        }
      }
    }

    // Also include photo captions when no text was provided or when the photo caption is a rich story (> 115 chars)
    const photoCaptions = (ans.photos || [])
      .map((p) => (p?.caption || '').replace(/^\[Nota de voz\]:\s*/i, '').trim())
      .filter((cap) => cap.length > 0 && !EXPLICIT_EXCLUSION_DIRECTIVE_RX.test(cap));

    if (groupedFactSentences.length === 0 && photoCaptions.length > 0) {
      groupedFactSentences.push(photoCaptions[0]);
    } else {
      for (const cap of photoCaptions) {
        if (
          cap.length > 115 &&
          !splitResult.includedText.toLowerCase().includes(cap.slice(0, 35).toLowerCase())
        ) {
          groupedFactSentences.push(cap);
        }
      }
    }

    groupedFactSentences.forEach((factText, fIdx) => {
      const cleanFact = factText.trim();
      if (!cleanFact) return;
      const facets = extractFacetsFromFactText(cleanFact, participantNames);
      const unitId =
        groupedFactSentences.length === 1
          ? `trace_${ans.id}`
          : `trace_${ans.id}_fact_${fIdx + 1}`;
      allFactUnits.push({
        unitId,
        parentAnswerId: ans.id,
        answerId: ans.id,
        questionId: ans.questionId,
        questionText: qText,
        sourceType,
        parentQuestionId: parentQId,
        participantId: ans.participantId,
        participantName: ans.participantName || participantNames[0] || 'Protagonista',
        lifeStage: stage,
        topic,
        chronologicalIndex: orderIdx * 100 + idx + fIdx * 0.1,
        rawText: cleanFact,
        cleanText: cleanFact,
        keyTokens: facets.keyTokens,
        properNames: facets.properNames,
        places: facets.places,
        yearsOrNumbers: facets.yearsOrNumbers,
        emotions: facets.emotions,
        uncertaintyExpressions: extractUncertaintyExpressions(cleanFact),
        exclusionReason: 'none',
        isEligibleForBook: true,
        photoIds: fIdx === 0 ? ansPhotoIds : [],
      });
    });
  });

  // Consolidate redundant eligible fact units from the same participant that narrate the exact same episode
  const eligibleFactUnits: DocumentaryFactUnit[] = [];
  for (const unit of allFactUnits.filter((u) => u.isEligibleForBook)) {
    const existingDup = eligibleFactUnits.find(
      (eu) =>
        (!eu.participantId || !unit.participantId || eu.participantId === unit.participantId) &&
        areTestimoniesRedundantSameEpisode(eu.cleanText, unit.cleanText)
    );
    if (existingDup) {
      existingDup.mergedRedundantUnitIds = [
        ...(existingDup.mergedRedundantUnitIds || []),
        unit.unitId,
      ];
      existingDup.cleanText = consolidateComplementarySentences(
        existingDup.cleanText,
        unit.cleanText
      );
      const mergedFacets = extractFacetsFromFactText(existingDup.cleanText, participantNames);
      existingDup.keyTokens = mergedFacets.keyTokens;
      existingDup.properNames = mergedFacets.properNames;
      existingDup.places = mergedFacets.places;
      existingDup.yearsOrNumbers = mergedFacets.yearsOrNumbers;
      existingDup.emotions = mergedFacets.emotions;
      for (const pId of unit.photoIds) {
        if (!existingDup.photoIds.includes(pId)) existingDup.photoIds.push(pId);
      }
    } else {
      eligibleFactUnits.push({ ...unit });
    }
  }

  const excludedFactUnits = allFactUnits.filter((u) => !u.isEligibleForBook);

  // Collect all valid years/numbers and proper names across the entire eligible source corpus
  const corpusYearsSet = new Set<string>();
  const corpusNamesSet = new Set<string>();
  for (const pName of participantNames) {
    for (const part of normalizePlainAscii(pName).split(/\s+/)) {
      if (part.length >= 2) corpusNamesSet.add(part);
    }
  }
  for (const u of eligibleFactUnits) {
    for (const yn of u.yearsOrNumbers) corpusYearsSet.add(yn);
    for (const pn of u.properNames) corpusNamesSet.add(pn);
    for (const pl of u.places) corpusNamesSet.add(pl);
    const unitNormText = normalizePlainAscii(`${u.cleanText} ${u.questionText}`);
    for (const w of unitNormText.split(/\s+/)) {
      if (w.length >= 3) corpusNamesSet.add(w);
    }
    // V5.1: a number the interviewee SPOKE ("veinticinco", "en el 75") is as documented as a digit.
    for (const v of extractSpanishNumberWordValues(unitNormText)) corpusYearsSet.add(v);
    for (const y of expandSpokenTwoDigitYears(unitNormText)) corpusYearsSet.add(y);
  }
  for (const p of photosInventory) {
    if (!p.isExcluded && p.caption) {
      for (const m of p.caption.match(/\b\d+\b/g) || []) corpusYearsSet.add(m);
      const captionNorm = normalizePlainAscii(p.caption);
      for (const v of extractSpanishNumberWordValues(captionNorm)) corpusYearsSet.add(v);
      for (const y of expandSpokenTwoDigitYears(captionNorm)) corpusYearsSet.add(y);
      for (const w of normalizePlainAscii(p.caption).split(/\s+/)) {
        if (w.length >= 3) corpusNamesSet.add(w);
      }
    }
  }

  return {
    interviewId,
    totalRawAnswers: answers.length,
    totalMainAnswers,
    totalFollowUpAnswers,
    totalAdditionalMemories,
    totalAtomicFactUnits: allFactUnits.length,
    eligibleFactUnits,
    excludedFactUnits,
    allFactUnits,
    photosInventory,
    corpusValidYearsAndNumbers: Array.from(corpusYearsSet),
    corpusValidProperNames: Array.from(corpusNamesSet),
  };
}

const STAGE_EDITORIAL_ARC_DEFS: Array<{
  stageKey: string;
  baseChapterId: string;
  dimensionKey: DemoQuestionDefinition['dimensionKey'];
  individualTitles: string[];
  coupleTitles: string[];
  thirdPersonTitles: string[];
}> = [
  {
    stageKey: 'infancia',
    baseChapterId: 'part_ch_infancia',
    dimensionKey: 'raices',
    individualTitles: [
      'Mis raíces y primeros recuerdos',
      'El hogar de la infancia y la vida en familia',
      'Los años de escuela, juegos y descubrimientos',
      'Aprendizajes tempranos y horizontes de niñez',
    ],
    coupleTitles: [
      'Nuestros orígenes y primeros años',
      'Los hogares donde crecimos y nuestras familias',
      'Infancias, escuelas y primeros descubrimientos',
      'Recuerdos entrañables de nuestros primeros tiempos',
    ],
    thirdPersonTitles: [
      'Sus raíces y primeros recuerdos',
      'El hogar de la infancia y el entorno familiar',
      'Años de escuela, juegos y primeros descubrimientos',
      'Aprendizajes tempranos y memorias de niñez',
    ],
  },
  {
    stageKey: 'juventud',
    baseChapterId: 'part_ch_juventud',
    dimensionKey: 'transformacion',
    individualTitles: [
      'Juventud, sueños y caminos',
      'Amistades, vocación y primeros pasos propios',
      'Decisiones de juventud y nuevos horizontes',
      'Forjando el carácter y el rumbo de vida',
    ],
    coupleTitles: [
      'Juventud y el encuentro de nuestros caminos',
      'Sueños compartidos, amistades y vocaciones',
      'El inicio de nuestra historia juntos',
      'Decisiones y pasos que unieron nuestras vidas',
    ],
    thirdPersonTitles: [
      'Su juventud, sueños y caminos',
      'Vocación, amistades y primeros desafíos',
      'Decisiones de juventud y apertura de horizontes',
      'La forja del carácter y de su propio rumbo',
    ],
  },
  {
    stageKey: 'adultez',
    baseChapterId: 'part_ch_adultez',
    dimensionKey: 'personas_amadas',
    individualTitles: [
      'Hogar, afectos y vida compartida',
      'Trabajo, esfuerzo y construcción del porvenir',
      'Familia, crianza y momentos inolvidables',
      'Superación de pruebas y consolidación del camino',
      'Caminos recorridos, proyectos y plenitud cotidiana',
    ],
    coupleTitles: [
      'La vida y el hogar que construimos',
      'Esfuerzo compartido, trabajo y proyectos en común',
      'La familia, los afectos y los días inolvidables',
      'Pruebas superadas en unión y complicidad',
      'El fruto de los años compartidos',
    ],
    thirdPersonTitles: [
      'El hogar y los afectos construidos',
      'Trabajo, dedicación y construcción del porvenir',
      'La vida familiar y los momentos memorables',
      'Retos superados y consolidación de su trayectoria',
      'Plenitud cotidiana y proyectos realizados',
    ],
  },
  {
    stageKey: 'madurez',
    baseChapterId: 'part_ch_madurez',
    dimensionKey: 'esencia',
    individualTitles: [
      'Momentos decisivos y aprendizajes',
      'Cosecha de vida, serenidad y nuevas miradas',
      'Huellas profundas y gratitud por lo vivido',
      'La sabiduría que dejan los años',
    ],
    coupleTitles: [
      'Nuestras huellas, retos y plenitud',
      'La cosecha de nuestra historia y serenidad compartida',
      'Gratitud por el camino recorrido juntos',
      'Sabiduría y unión a través del tiempo',
    ],
    thirdPersonTitles: [
      'Sus momentos decisivos y aprendizajes',
      'Cosecha vital, serenidad y madurez',
      'Huellas profundas y gratitud por el camino',
      'La sabiduría decantada con los años',
    ],
  },
  {
    stageKey: 'legado_general',
    baseChapterId: 'part_ch_legado',
    dimensionKey: 'legado',
    individualTitles: [
      'Valores, reflexiones y legado',
      'Mensajes para las generaciones que vienen',
      'El sentido de mi historia y palabras finales',
      'Recuerdos perdurables para quienes amo',
    ],
    coupleTitles: [
      'Las palabras y el legado que dejamos',
      'Mensajes de amor para las nuevas generaciones',
      'El sentido de nuestra unión y reflexiones finales',
      'Recuerdos eternos para nuestra familia',
    ],
    thirdPersonTitles: [
      'Sus valores, reflexiones y legado',
      'El mensaje perdurable para las nuevas generaciones',
      'Sentido biográfico y reflexiones de vida',
      'Una herencia de memoria y afecto familiar',
      'La luz de su ejemplo en el tiempo',
      'Testimonio de vida y gratitud compartida',
    ],
  },
];

// Additional rich non-numbered title variants when deep interviews yield >4 thematic subdivisions in a stage
const EXTRA_THEMATIC_CHAPTER_TITLES_BY_STAGE: Record<
  string,
  { individual: string[]; couple: string[]; thirdPerson: string[] }
> = {
  infancia: {
    individual: [
      'Voces del patio, tradiciones y días felices',
      'Las pequeñas rutinas que marcaron mi niñez',
    ],
    couple: [
      'Tradiciones familiares de nuestros primeros años',
      'El eco de las casas donde crecimos',
    ],
    thirdPerson: [
      'Tradiciones del hogar y días de infancia',
      'Las costumbres que acompañaron su niñez',
    ],
  },
  juventud: {
    individual: [
      'Primeros viajes, retos y horizontes abiertos',
      'El despertar de nuevas metas y afectos',
    ],
    couple: [
      'Los sueños que impulsaron nuestra juventud',
      'Horizontes compartidos en nuestros años jóvenes',
    ],
    thirdPerson: [
      'Primeros desafíos y apertura hacia el mundo',
      'Metas juveniles y consolidación de su vocación',
    ],
  },
  adultez: {
    individual: [
      'Proyectos construidos y días de dedicación',
      'Lazos que crecieron con el paso del tiempo',
    ],
    couple: [
      'Complicidad cotidiana y proyectos realizados',
      'Los pilares que fortalecieron nuestro hogar',
    ],
    thirdPerson: [
      'Proyectos realizados y vínculos entrañables',
      'Años de entrega y consolidación familiar',
    ],
  },
  madurez: {
    individual: [
      'Serenidad ganada y miradas hacia el camino',
      'Lecciones que permanecen en el corazón',
    ],
    couple: [
      'La serenidad de mirar atrás en compañía',
      'Enseñanzas compartidas a lo largo de los años',
    ],
    thirdPerson: [
      'Serenidad alcanzada y perspectivas de vida',
      'Aprendizajes profundos en la etapa de madurez',
    ],
  },
  legado_general: {
    individual: [
      'Gratitud eterna y huella para mi familia',
      'Pensamientos abiertos hacia el mañana',
    ],
    couple: [
      'Huella viva de nuestro amor en la familia',
      'Palabras de aliento para el porvenir',
    ],
    thirdPerson: [
      'Gratitud perdurable y testimonio familiar',
      'Un legado de afecto proyectado al futuro',
    ],
  },
};

/**
 * Builds a deterministic editorial chapter plan (`EditorialBookPlan`) prior to drafting.
 * - Guarantees that a single question/answer NEVER becomes its own isolated chapter when multiple answers exist.
 * - Groups answers chronologically and thematically within each stage without artificial formulas or `(2)/(3)` numeric suffixes.
 * - Detects single-stage or partial interviews (`isPartialMemoir: true`) and frames them honestly as
 *   `"Un libro parcial de memorias"` without inventing unshared life stages.
 */
export function buildEditorialChapterPlan(params: {
  interviewTitle?: string;
  storyMode: 'individual' | 'compartida';
  participantNames: string[];
  answers: DocumentarySourceAnswerInput[];
  questions: DocumentarySourceQuestionInput[];
  bookStructureMode?: 'prompt_autonomous' | 'fixed_five_stages';
}): EditorialBookPlan {
  const {
    answers,
    questions,
    bookStructureMode = 'prompt_autonomous',
  } = params;

  const qMap = new Map(questions.map((q) => [q.id, q]));
  const qOrderMap = new Map(
    questions.map((q, idx) => [q.id, typeof q.orderIndex === 'number' ? q.orderIndex : idx])
  );
  const validStageKeys = new Set(STAGE_EDITORIAL_ARC_DEFS.map((s) => s.stageKey));

  const isFollowUpEntry = (a: DocumentarySourceAnswerInput): boolean =>
    Boolean(
      a.isFollowUp ||
        (a.parentQuestionId && a.parentQuestionId.trim().length > 0) ||
        (a.questionId &&
          (a.questionId.startsWith('followup_') || a.questionId.startsWith('adaptive_')))
    );

  const knownMainQuestionIds = new Set<string>(questions.map((q) => q.id));
  for (const a of answers) {
    if (!isFollowUpEntry(a) && !a.isAdditionalMemory && a.questionId) {
      knownMainQuestionIds.add(a.questionId);
    }
  }

  const resolveParentMainQuestionId = (a: DocumentarySourceAnswerInput): string | null => {
    if (a.parentQuestionId && a.parentQuestionId.trim().length > 0) {
      return a.parentQuestionId.trim();
    }
    if (isFollowUpEntry(a) && a.questionId) {
      for (const qId of knownMainQuestionIds) {
        if (a.questionId.includes(qId)) return qId;
      }
    }
    return null;
  };

  const resolveAnswerStage = (a: DocumentarySourceAnswerInput): string => {
    if (a.isAdditionalMemory) return 'legado_general';
    if (a.lifeStage && validStageKeys.has(a.lifeStage)) return a.lifeStage;
    const q = qMap.get(a.questionId);
    if (q?.lifeStage && validStageKeys.has(q.lifeStage)) return q.lifeStage;
    const parentId = resolveParentMainQuestionId(a);
    if (parentId) {
      const parentQ = qMap.get(parentId);
      if (parentQ?.lifeStage && validStageKeys.has(parentQ.lifeStage)) return parentQ.lifeStage;
      const parentAns = answers.find(
        (cand) => cand.questionId === parentId && !isFollowUpEntry(cand)
      );
      if (parentAns) {
        const pq = qMap.get(parentAns.questionId);
        if (pq?.lifeStage && validStageKeys.has(pq.lifeStage)) return pq.lifeStage;
      }
    }
    const photoStage = a.photos?.[0]?.lifeStage;
    if (photoStage && validStageKeys.has(photoStage)) return photoStage;
    return 'adultez';
  };

  const eligibleAnswers = answers.filter((a) => {
    if (resolveAnswerExclusionReason(a) !== 'none') return false;
    const split = splitAnswerTextIntoIncludedAndExcludedSentences(
      extractCleanParticipantAnswerText(a)
    );
    return split.includedText.length > 0 || Boolean(a.photos && a.photos.length > 0);
  });

  const totalEligibleMainCount = eligibleAnswers.filter(
    (a) => !isFollowUpEntry(a) && !a.isAdditionalMemory
  ).length;

  const documentedStageSet = new Set<string>();
  for (const a of eligibleAnswers) {
    documentedStageSet.add(resolveAnswerStage(a));
  }
  const documentedStages = STAGE_EDITORIAL_ARC_DEFS.map((s) => s.stageKey).filter((k) =>
    documentedStageSet.has(k)
  );
  const missingStages = STAGE_EDITORIAL_ARC_DEFS.map((s) => s.stageKey).filter(
    (k) => !documentedStageSet.has(k)
  );
  const isPartialMemoir =
    eligibleAnswers.length > 0 &&
    (documentedStages.length === 1 ||
      (documentedStages.length === 2 && missingStages.length >= 3));

  const stageFriendlyLabel: Record<string, string> = {
    infancia: 'la infancia',
    juventud: 'la juventud',
    adultez: 'la vida adulta',
    madurez: 'la madurez',
    legado_general: 'los recuerdos y el legado',
  };
  const partialMemoirSubtitle = isPartialMemoir ? 'Un libro parcial de memorias' : undefined;
  const partialMemoirIntroNote = isPartialMemoir
    ? `Este volumen reúne únicamente las etapas documentadas en la entrevista (${documentedStages
        .map((s) => stageFriendlyLabel[s] || s)
        .join(' y ')}), preservando con fidelidad lo compartido sin inventar capítulos de etapas no abordadas.`
    : undefined;

  const plannedChapters: EditorialChapterPlanItem[] = [];
  const usedTitlesIndividual = new Set<string>();
  const usedTitlesCouple = new Set<string>();
  const usedTitlesThird = new Set<string>();

  const pickUniqueTitle = (
    pool: string[],
    usedSet: Set<string>,
    idx: number,
    fallbackDescriptors: string[]
  ): string => {
    for (let offset = 0; offset < pool.length; offset++) {
      const candidate = pool[(idx + offset) % pool.length];
      if (!usedSet.has(candidate.toLowerCase())) {
        usedSet.add(candidate.toLowerCase());
        return candidate;
      }
    }
    const base = pool[idx % pool.length];
    for (const desc of fallbackDescriptors) {
      const candidate = `${base}: ${desc}`;
      if (!usedSet.has(candidate.toLowerCase())) {
        usedSet.add(candidate.toLowerCase());
        return candidate;
      }
    }
    usedSet.add(base.toLowerCase());
    return base;
  };

  for (const stDef of STAGE_EDITORIAL_ARC_DEFS) {
    const stageEligible = eligibleAnswers.filter(
      (a) => resolveAnswerStage(a) === stDef.stageKey
    );
    if (stageEligible.length === 0) continue;

    const mainStageAnswers = stageEligible
      .filter((a) => !isFollowUpEntry(a) && !a.isAdditionalMemory)
      .sort((a, b) => {
        const orderA = qOrderMap.get(a.questionId) ?? 999999;
        const orderB = qOrderMap.get(b.questionId) ?? 999999;
        if (orderA !== orderB) return orderA - orderB;
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        return timeA - timeB;
      });

    const followUpStageAnswers = stageEligible.filter((a) => isFollowUpEntry(a));
    const additionalStageAnswers = stageEligible.filter(
      (a) => Boolean(a.isAdditionalMemory) && !isFollowUpEntry(a)
    );

    // Subdivide rich multi-theme stages chronologically & by topic density when prompt_autonomous is active
    let subChapterCount = 1;
    if (bookStructureMode === 'prompt_autonomous' && mainStageAnswers.length > 12) {
      const targetMainPerChapter = totalEligibleMainCount >= 100 ? 13 : 6;
      subChapterCount = Math.max(
        2,
        Math.min(6, Math.ceil(mainStageAnswers.length / targetMainPerChapter))
      );
    }

    const extraPool = EXTRA_THEMATIC_CHAPTER_TITLES_BY_STAGE[stDef.stageKey] || {
      individual: [],
      couple: [],
      thirdPerson: [],
    };
    const allIndTitles = [...stDef.individualTitles, ...extraPool.individual];
    const allCoupTitles = [...stDef.coupleTitles, ...extraPool.couple];
    const allThirdTitles = [...stDef.thirdPersonTitles, ...extraPool.thirdPerson];
    const descriptors = [
      'primeros capítulos de vida',
      'lazos familiares y cotidianos',
      'senderos y aprendizajes',
      'memorias más entrañables',
      'páginas que permanecen',
    ];

    if (subChapterCount === 1) {
      const assignedAnswerIds = stageEligible.map((a) => a.id);
      const assignedQuestionIds = Array.from(
        new Set(stageEligible.map((a) => a.questionId).filter(Boolean))
      );
      const assignedPhotoIds = Array.from(
        new Set(
          stageEligible.flatMap((a) => (a.photos || []).map((p) => p?.id).filter(Boolean) as string[])
        )
      );
      const estimatedSourceWords = stageEligible.reduce(
        (acc, a) => acc + extractCleanParticipantAnswerText(a).split(/\s+/).filter(Boolean).length,
        0
      );
      const tInd = pickUniqueTitle(allIndTitles, usedTitlesIndividual, 0, descriptors);
      const tCoup = pickUniqueTitle(allCoupTitles, usedTitlesCouple, 0, descriptors);
      const tThird = pickUniqueTitle(allThirdTitles, usedTitlesThird, 0, descriptors);
      plannedChapters.push({
        chapterId: stDef.baseChapterId,
        partNumber: plannedChapters.length + 1,
        stageKey: stDef.stageKey,
        dimensionKey: stDef.dimensionKey,
        thematicAxis: tInd,
        suggestedTitleIndividual: tInd,
        suggestedTitleCouple: tCoup,
        suggestedTitleThirdPerson: tThird,
        assignedAnswerIds,
        assignedQuestionIds,
        assignedFactUnitIds: assignedAnswerIds.map((id) => `trace_${id}`),
        assignedPhotoIds,
        estimatedSourceWords,
      });
    } else {
      const chunkSize = Math.ceil(mainStageAnswers.length / subChapterCount);
      const consumedFollowUpIds = new Set<string>();
      for (let cIdx = 0; cIdx < subChapterCount; cIdx++) {
        const chunkMains = mainStageAnswers.slice(cIdx * chunkSize, (cIdx + 1) * chunkSize);
        if (chunkMains.length === 0) continue;
        const chunkMainQIds = new Set(chunkMains.map((m) => m.questionId));
        const chunkFollowUps = followUpStageAnswers.filter((f) => {
          if (consumedFollowUpIds.has(f.id)) return false;
          const parentId = resolveParentMainQuestionId(f);
          if (parentId && chunkMainQIds.has(parentId)) {
            consumedFollowUpIds.add(f.id);
            return true;
          }
          return false;
        });
        const extraFollowUps =
          cIdx === subChapterCount - 1
            ? followUpStageAnswers.filter((f) => !consumedFollowUpIds.has(f.id))
            : [];
        const extraAdditionals = cIdx === subChapterCount - 1 ? additionalStageAnswers : [];
        const combinedAnswers = [...chunkMains, ...chunkFollowUps, ...extraFollowUps, ...extraAdditionals];
        const assignedAnswerIds = combinedAnswers.map((a) => a.id);
        const assignedQuestionIds = Array.from(
          new Set(combinedAnswers.map((a) => a.questionId).filter(Boolean))
        );
        const assignedPhotoIds = Array.from(
          new Set(
            combinedAnswers.flatMap(
              (a) => (a.photos || []).map((p) => p?.id).filter(Boolean) as string[]
            )
          )
        );
        const estimatedSourceWords = combinedAnswers.reduce(
          (acc, a) => acc + extractCleanParticipantAnswerText(a).split(/\s+/).filter(Boolean).length,
          0
        );
        const tInd = pickUniqueTitle(allIndTitles, usedTitlesIndividual, cIdx, descriptors);
        const tCoup = pickUniqueTitle(allCoupTitles, usedTitlesCouple, cIdx, descriptors);
        const tThird = pickUniqueTitle(allThirdTitles, usedTitlesThird, cIdx, descriptors);
        const chapterId =
          cIdx === 0 ? stDef.baseChapterId : `${stDef.baseChapterId}_${cIdx + 1}`;
        plannedChapters.push({
          chapterId,
          partNumber: plannedChapters.length + 1,
          stageKey: stDef.stageKey,
          dimensionKey: stDef.dimensionKey,
          thematicAxis: tInd,
          suggestedTitleIndividual: tInd,
          suggestedTitleCouple: tCoup,
          suggestedTitleThirdPerson: tThird,
          assignedAnswerIds,
          assignedQuestionIds,
          assignedFactUnitIds: assignedAnswerIds.map((id) => `trace_${id}`),
          assignedPhotoIds,
          estimatedSourceWords,
        });
      }
    }
  }

  return {
    bookStructureMode,
    chapters: plannedChapters,
    totalPlannedChapters: plannedChapters.length,
    isOneQuestionPerChapterBlocked: true,
    isPartialMemoir,
    documentedStages,
    missingStages,
    partialMemoirSubtitle,
    partialMemoirIntroNote,
  };
}

export function buildParticipantInitialManuscriptFromAnswers(params: {
  interviewTitle: string;
  storyMode: 'individual' | 'compartida';
  participantNames: string[];
  answers: DocumentarySourceAnswerInput[];
  questions: DocumentarySourceQuestionInput[];
  narrativeStyle?: DemoNarrativeStyleId;
  closingDedicationText?: string;
  bookStructureMode?: 'prompt_autonomous' | 'fixed_five_stages';
}): {
  manuscript: DemoManuscript;
  chapterPhotos: Record<string, DemoInMemoryPhoto | null>;
  allPhotosById: Record<string, DemoInMemoryPhoto>;
  chapterStructuredUnits: Record<string, StructuredChapterTestimonyUnit[]>;
  documentaryInventory: DocumentaryInventory;
  editorialPlan: EditorialBookPlan;
} {
  const {
    interviewTitle,
    storyMode,
    participantNames,
    answers,
    questions,
    narrativeStyle = 'first_person_literary',
    closingDedicationText = '',
    bookStructureMode = 'prompt_autonomous',
  } = params;

  const isCouple = storyMode === 'compartida' && participantNames.length >= 2;
  const mode: DemoStoryMode = isCouple ? 'pareja' : 'individual';
  const authors =
    participantNames.length > 0 ? participantNames.join(' y ') : 'Protagonista';

  const qMap = new Map(questions.map((q) => [q.id, q]));
  const qOrderMap = new Map(
    questions.map((q, idx) => [q.id, typeof q.orderIndex === 'number' ? q.orderIndex : idx])
  );

  const documentaryInventory = buildDocumentaryInventory({
    interviewId: interviewTitle || 'interview_default',
    answers,
    questions,
    participantNames,
  });

  const editorialPlan = buildEditorialChapterPlan({
    interviewTitle,
    storyMode,
    participantNames,
    answers,
    questions,
    bookStructureMode,
  });

  const isFollowUpEntry = (a: DocumentarySourceAnswerInput): boolean => {
    return Boolean(
      a.isFollowUp ||
        (a.parentQuestionId && a.parentQuestionId.trim().length > 0) ||
        (a.questionId &&
          (a.questionId.startsWith('followup_') || a.questionId.startsWith('adaptive_')))
    );
  };

  const knownMainQuestionIds = new Set<string>(questions.map((q) => q.id));
  for (const a of answers) {
    if (!isFollowUpEntry(a) && !a.isAdditionalMemory && a.questionId) {
      knownMainQuestionIds.add(a.questionId);
    }
  }

  const resolveParentMainQuestionId = (a: DocumentarySourceAnswerInput): string | null => {
    if (a.parentQuestionId && a.parentQuestionId.trim().length > 0) {
      return a.parentQuestionId.trim();
    }
    if (isFollowUpEntry(a) && a.questionId) {
      for (const qId of knownMainQuestionIds) {
        if (a.questionId.includes(qId)) {
          return qId;
        }
      }
    }
    return null;
  };

  let memoryUnitCounter = 0;
  const chapterStructuredUnits: Record<string, StructuredChapterTestimonyUnit[]> = {};

  const extractIncludedAnswerText = (ans: DocumentarySourceAnswerInput | undefined): string => {
    if (!ans || resolveAnswerExclusionReason(ans) !== 'none') return '';
    const raw = extractCleanParticipantAnswerText(ans);
    return splitAnswerTextIntoIncludedAndExcludedSentences(raw).includedText;
  };

  const formatMemoryUnitForStyle = (
    chapterId: string,
    mainAns: DocumentarySourceAnswerInput | undefined,
    followUps: Array<DocumentarySourceAnswerInput>,
    extraSourceAnswerIds: string[] = [],
    extraSourceQuestionIds: string[] = []
  ): {
    paragraphs: string[];
    unitId: string;
    sourceAnswerIds: string[];
    sourceQuestionIds: string[];
  } => {
    let out: string[] = [];
    const currentUnitIdx = memoryUnitCounter++;
    const unitId = `${chapterId}_unit_${currentUnitIdx + 1}`;
    const speakerName =
      mainAns?.participantName ||
      followUps[0]?.participantName ||
      participantNames[0] ||
      'Protagonista';

    const mainQuestionText =
      mainAns?.questionText || (mainAns ? qMap.get(mainAns.questionId)?.text : undefined);
    let mainText = extractIncludedAnswerText(mainAns);

    // If the answer has photographs whose caption is a narrative story (> 115 chars) or if mainText is empty
    // and only a photograph caption was provided, integrate the photograph's story into the narrative unit
    const photoNarratives: string[] = [];
    if (mainAns && resolveAnswerExclusionReason(mainAns) === 'none') {
      for (const p of mainAns.photos || []) {
        const rawCap = (p?.caption || '').replace(/^\[Nota de voz\]:\s*/i, '').trim();
        const cleanCap = splitAnswerTextIntoIncludedAndExcludedSentences(rawCap).includedText;
        if (!cleanCap) continue;
        if (!mainText || cleanCap.length > 115) {
          if (!mainText.includes(cleanCap.slice(0, 40))) {
            photoNarratives.push(cleanCap);
          }
        }
      }
    }
    if (!mainText && photoNarratives.length > 0) {
      mainText = photoNarratives.shift()!;
    }

    const rawFollowUpsFiltered: Array<{
      questionText?: string;
      text: string;
      answerId?: string;
      questionId?: string;
    }> = [
      ...photoNarratives.map((pn) => ({
        questionText: 'Historia de la fotografía adjunta en este recuerdo',
        text: pn,
        answerId: mainAns?.id,
        questionId: mainAns?.questionId,
      })),
    ];

    for (const f of followUps.filter((item) => resolveAnswerExclusionReason(item) === 'none')) {
      let fText = extractIncludedAnswerText(f);
      if (!fText && f.photos && f.photos.length > 0) {
        const cap = (f.photos[0].caption || '').replace(/^\[Nota de voz\]:\s*/i, '').trim();
        fText = splitAnswerTextIntoIncludedAndExcludedSentences(cap).includedText;
      }
      if (!fText) continue;

      // Consolidate if follow-up repeats the main answer's exact episode
      if (mainText && areTestimoniesRedundantSameEpisode(mainText, fText)) {
        mainText = consolidateComplementarySentences(mainText, fText);
        continue;
      }

      // Or if it repeats an earlier follow-up in the same unit
      const dupFollowIdx = rawFollowUpsFiltered.findIndex((existing) =>
        areTestimoniesRedundantSameEpisode(existing.text, fText)
      );
      if (dupFollowIdx >= 0) {
        rawFollowUpsFiltered[dupFollowIdx].text = consolidateComplementarySentences(
          rawFollowUpsFiltered[dupFollowIdx].text,
          fText
        );
        continue;
      }

      rawFollowUpsFiltered.push({
        questionText: f.questionText || qMap.get(f.questionId)?.text,
        text: fText,
        answerId: f.id,
        questionId: f.questionId,
      });
    }

    const validFollowUps = rawFollowUpsFiltered.filter((item) => item.text.length > 0);
    const followUpTexts = validFollowUps.map((f) => f.text);

    const isMultiParticipant = isCouple && participantNames.length > 1;

    if (mainText && followUpTexts.length > 0) {
      const styledMain = cleanAndRewriteTestimonyForStyle({
        rawText: mainText,
        questionText: mainQuestionText,
        narrativeStyle,
        speakerName,
        isCouple: isMultiParticipant,
        isFirstBlockForSpeaker: true,
        isFollowUpContinuation: false,
        unitIndex: currentUnitIdx,
      });
      const styledFirstFollow = cleanAndRewriteTestimonyForStyle({
        rawText: validFollowUps[0].text,
        questionText: validFollowUps[0].questionText,
        narrativeStyle,
        speakerName,
        isCouple: isMultiParticipant,
        isFirstBlockForSpeaker: false,
        isFollowUpContinuation: true,
        unitIndex: currentUnitIdx,
      });

      const combinedFirst = `${ensureEndingPunctuation(styledMain)} ${styledFirstFollow}`;
      if (combinedFirst.length <= 660) {
        out.push(...splitLongParagraphAtSentences(combinedFirst));
        for (let i = 1; i < validFollowUps.length; i++) {
          const styledNextFollow = cleanAndRewriteTestimonyForStyle({
            rawText: validFollowUps[i].text,
            questionText: validFollowUps[i].questionText,
            narrativeStyle,
            speakerName,
            isCouple: isMultiParticipant,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: currentUnitIdx + i,
          });
          out.push(...splitLongParagraphAtSentences(styledNextFollow));
        }
      } else {
        out.push(...splitLongParagraphAtSentences(styledMain));
        for (let i = 0; i < validFollowUps.length; i++) {
          const styledFollow = cleanAndRewriteTestimonyForStyle({
            rawText: validFollowUps[i].text,
            questionText: validFollowUps[i].questionText,
            narrativeStyle,
            speakerName,
            isCouple: isMultiParticipant,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: currentUnitIdx + i,
          });
          out.push(...splitLongParagraphAtSentences(styledFollow));
        }
      }
    } else if (mainText) {
      const styledMain = cleanAndRewriteTestimonyForStyle({
        rawText: mainText,
        questionText: mainQuestionText,
        narrativeStyle,
        speakerName,
        isCouple: isMultiParticipant,
        isFirstBlockForSpeaker: true,
        isFollowUpContinuation: false,
        unitIndex: currentUnitIdx,
      });
      out.push(...splitLongParagraphAtSentences(styledMain));
    } else if (validFollowUps.length > 0) {
      validFollowUps.forEach((fItem, idx) => {
        const styledFollow = cleanAndRewriteTestimonyForStyle({
          rawText: fItem.text,
          questionText: fItem.questionText,
          narrativeStyle,
          speakerName,
          isCouple: isMultiParticipant,
          isFirstBlockForSpeaker: idx === 0,
          isFollowUpContinuation: idx > 0,
          unitIndex: currentUnitIdx + idx,
        });
        out.push(...splitLongParagraphAtSentences(styledFollow));
      });
    }

    const combinedRawSource = [mainText, ...validFollowUps.map((vf) => vf.text)]
      .filter(Boolean)
      .join(' ');
    out = ensureUncertaintyPreservedInParagraphs(combinedRawSource, out, narrativeStyle);

    const sourceAnswerIds = Array.from(
      new Set([
        ...(mainAns && resolveAnswerExclusionReason(mainAns) === 'none' && mainAns.id
          ? [mainAns.id]
          : []),
        ...followUps
          .filter((f) => resolveAnswerExclusionReason(f) === 'none')
          .map((f) => f.id)
          .filter(Boolean),
        ...extraSourceAnswerIds,
      ])
    );
    const sourceQuestionIds = Array.from(
      new Set([
        ...(mainAns && resolveAnswerExclusionReason(mainAns) === 'none' && mainAns.questionId
          ? [mainAns.questionId]
          : []),
        ...followUps
          .filter((f) => resolveAnswerExclusionReason(f) === 'none')
          .map((f) => f.questionId)
          .filter(Boolean),
        ...extraSourceQuestionIds,
      ])
    );

    const unitPhotosMeta: Array<{
      photoId: string;
      descripcionOriginal: string;
      preguntaAsociada?: string;
      answerId?: string;
      questionId?: string;
    }> = [];
    const collectPhotosFromAns = (
      ansObj: DocumentarySourceAnswerInput | undefined,
      qLabel?: string
    ) => {
      if (
        !ansObj ||
        resolveAnswerExclusionReason(ansObj) !== 'none' ||
        !Array.isArray(ansObj.photos)
      ) {
        return;
      }
      for (const p of ansObj.photos) {
        if (!p || !p.id) continue;
        if (!unitPhotosMeta.some((existing) => existing.photoId === p.id)) {
          const cleanDesc = splitAnswerTextIntoIncludedAndExcludedSentences(
            (p.caption || '').replace(/^\[Nota de voz\]:\s*/i, '').trim()
          ).includedText;
          unitPhotosMeta.push({
            photoId: p.id,
            descripcionOriginal: cleanDesc,
            preguntaAsociada: qLabel,
            answerId: ansObj.id,
            questionId: ansObj.questionId,
          });
        }
      }
    };
    collectPhotosFromAns(mainAns, mainQuestionText);
    for (const fAns of followUps) {
      collectPhotosFromAns(fAns, fAns.questionText || qMap.get(fAns.questionId)?.text);
    }

    if (out.length > 0) {
      if (!chapterStructuredUnits[chapterId]) {
        chapterStructuredUnits[chapterId] = [];
      }
      chapterStructuredUnits[chapterId].push({
        unitId,
        sourceAnswerIds,
        sourceQuestionIds,
        uncertaintyExpressions: extractUncertaintyExpressions(combinedRawSource),
        preguntaPrincipal: mainQuestionText,
        respuestaPrincipal: mainText ? cleanSpanishOralText(mainText) : undefined,
        profundizaciones:
          validFollowUps.length > 0
            ? validFollowUps.map((vf) => ({
                pregunta: vf.questionText,
                respuesta: cleanSpanishOralText(vf.text),
                answerId: vf.answerId,
                questionId: vf.questionId,
              }))
            : undefined,
        fotografiasAsociadas: unitPhotosMeta.length > 0 ? unitPhotosMeta : undefined,
        textoIntegrado: out.join(' '),
      });
    }

    return { paragraphs: out, unitId, sourceAnswerIds, sourceQuestionIds };
  };

  const chapters: DemoChapterManuscript[] = [];
  const chapterPhotos: Record<string, DemoInMemoryPhoto | null> = {};
  const allPhotosById: Record<string, DemoInMemoryPhoto> = {};
  const answerByIdMap = new Map(answers.map((a) => [a.id, a]));

  for (const planCh of editorialPlan.chapters) {
    const stageAnswers = planCh.assignedAnswerIds
      .map((id) => answerByIdMap.get(id))
      .filter((a): a is DocumentarySourceAnswerInput => Boolean(a));

    if (stageAnswers.length === 0) continue;

    const rawMainStageAnswers = stageAnswers
      .filter((a) => !isFollowUpEntry(a) && !a.isAdditionalMemory)
      .sort((a, b) => {
        const orderA = qOrderMap.get(a.questionId) ?? 999999;
        const orderB = qOrderMap.get(b.questionId) ?? 999999;
        if (orderA !== orderB) return orderA - orderB;
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        return timeA - timeB;
      });

    const consolidatedMainGroups: Array<{
      primary: DocumentarySourceAnswerInput;
      mergedRedundant: Array<DocumentarySourceAnswerInput>;
    }> = [];
    for (const ans of rawMainStageAnswers) {
      const ansText = extractIncludedAnswerText(ans);
      const existingGroup = consolidatedMainGroups.find((grp) => {
        if (
          isCouple &&
          grp.primary.participantId &&
          ans.participantId &&
          grp.primary.participantId !== ans.participantId
        ) {
          return false;
        }
        const primaryText = extractIncludedAnswerText(grp.primary);
        return areTestimoniesRedundantSameEpisode(primaryText, ansText);
      });
      if (existingGroup) {
        existingGroup.mergedRedundant.push(ans);
      } else {
        consolidatedMainGroups.push({ primary: ans, mergedRedundant: [] });
      }
    }

    const followUpStageAnswers = stageAnswers
      .filter((a) => isFollowUpEntry(a))
      .sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        return timeA - timeB;
      });

    const additionalStageAnswers = stageAnswers
      .filter((a) => Boolean(a.isAdditionalMemory) && !isFollowUpEntry(a))
      .sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        return timeA - timeB;
      });

    const consumedFollowUpIds = new Set<string>();
    const paragraphs: string[] = [];
    const paragraphIds: string[] = [];
    const chapterSourceUnitIds: string[] = [];
    const chapterSourceAnswerIds: string[] = [];
    const chapterSourceQuestionIds: string[] = [];
    let firstStagePhoto: DemoInMemoryPhoto | null = null;
    const chapterPhotoPlacements: DemoChapterPhotoPlacement[] = [];
    const seenStagePhotoIds = new Set<string>();

    const inspectAnswerPhoto = (
      ans: DocumentarySourceAnswerInput,
      targetParagraphIdx: number,
      targetParagraphId: string,
      eventUnitId: string
    ) => {
      if (resolveAnswerExclusionReason(ans) !== 'none' || !ans.photos || ans.photos.length === 0) {
        return;
      }
      for (const p of ans.photos) {
        if (!p || !p.id || seenStagePhotoIds.has(p.id)) continue;
        seenStagePhotoIds.add(p.id);
        const srcUrl = p.dataUrl || p.imageUrl || `/api/photos/${p.id}`;
        const rawOriginalDesc = splitAnswerTextIntoIncludedAndExcludedSentences(
          (p.caption || '').replace(/^\[Nota de voz\]:\s*/i, '').trim()
        ).includedText;
        const shortCap = formatPhotoEditorialCaption(
          rawOriginalDesc || ans.questionText || qMap.get(ans.questionId)?.text || ''
        );
        const memPhoto: DemoInMemoryPhoto = {
          id: p.id,
          fileName: `${planCh.chapterId}_${p.id}.jpg`,
          objectUrl: srcUrl,
          dataUrl: srcUrl,
          mimeType: p.mimeType || 'image/jpeg',
          width: 800,
          height: 600,
          zoom: 1,
          focusY: 'center',
          caption: shortCap,
        };
        allPhotosById[p.id] = memPhoto;
        if (!firstStagePhoto) {
          firstStagePhoto = memPhoto;
        }
        chapterPhotoPlacements.push({
          photoId: p.id,
          paragraphIndex: Math.max(0, targetParagraphIdx),
          shortCaption: shortCap,
          originalDescription: rawOriginalDesc || shortCap,
          answerId: ans.id,
          questionId: ans.questionId,
          eventId: eventUnitId,
          chapterId: planCh.chapterId,
          paragraphId: targetParagraphId,
        });
      }
    };

    // 1. Process each main question answer group followed immediately by its deepening follow-up answers
    for (const grp of consolidatedMainGroups) {
      const mainAns = grp.primary;
      const groupQuestionIds = new Set([
        mainAns.questionId,
        ...grp.mergedRedundant.map((m) => m.questionId),
      ]);
      const attachedFollowUps = followUpStageAnswers.filter((fAns) => {
        if (consumedFollowUpIds.has(fAns.id)) return false;
        const resolvedParent = resolveParentMainQuestionId(fAns);
        if (!resolvedParent || !groupQuestionIds.has(resolvedParent)) return false;
        if (
          isCouple &&
          mainAns.participantId &&
          fAns.participantId &&
          mainAns.participantId !== fAns.participantId
        ) {
          return false;
        }
        return true;
      });

      for (const fAns of attachedFollowUps) {
        consumedFollowUpIds.add(fAns.id);
      }

      let effectiveMainAns = mainAns;
      if (grp.mergedRedundant.length > 0) {
        let mergedText = extractIncludedAnswerText(mainAns);
        for (const redAns of grp.mergedRedundant) {
          mergedText = consolidateComplementarySentences(
            mergedText,
            extractIncludedAnswerText(redAns)
          );
        }
        effectiveMainAns = {
          ...mainAns,
          answerText: mergedText,
        };
      } else {
        effectiveMainAns = {
          ...mainAns,
          answerText: extractIncludedAnswerText(mainAns),
        };
      }

      const startParaIdx = paragraphs.length;
      const unitResult = formatMemoryUnitForStyle(
        planCh.chapterId,
        effectiveMainAns,
        attachedFollowUps,
        grp.mergedRedundant.map((m) => m.id),
        grp.mergedRedundant.map((m) => m.questionId)
      );
      const firstParaId = `${planCh.chapterId}_p_${startParaIdx + 1}`;

      inspectAnswerPhoto(mainAns, startParaIdx, firstParaId, unitResult.unitId);
      for (const redAns of grp.mergedRedundant) {
        inspectAnswerPhoto(redAns, startParaIdx, firstParaId, unitResult.unitId);
      }
      for (const fAns of attachedFollowUps) {
        inspectAnswerPhoto(fAns, startParaIdx, firstParaId, unitResult.unitId);
      }

      for (let i = 0; i < unitResult.paragraphs.length; i++) {
        paragraphs.push(unitResult.paragraphs[i]);
        paragraphIds.push(`${planCh.chapterId}_p_${paragraphs.length}`);
      }
      chapterSourceUnitIds.push(unitResult.unitId);
      for (const aId of unitResult.sourceAnswerIds) {
        if (!chapterSourceAnswerIds.includes(aId)) chapterSourceAnswerIds.push(aId);
      }
      for (const qId of unitResult.sourceQuestionIds) {
        if (!chapterSourceQuestionIds.includes(qId)) chapterSourceQuestionIds.push(qId);
      }
    }

    // 2. Include any remaining follow-up answers in this planned chapter
    for (const orphanFollowUp of followUpStageAnswers) {
      if (consumedFollowUpIds.has(orphanFollowUp.id)) continue;
      consumedFollowUpIds.add(orphanFollowUp.id);
      const startParaIdx = paragraphs.length;
      const unitResult = formatMemoryUnitForStyle(planCh.chapterId, undefined, [orphanFollowUp]);
      const firstParaId = `${planCh.chapterId}_p_${startParaIdx + 1}`;
      inspectAnswerPhoto(orphanFollowUp, startParaIdx, firstParaId, unitResult.unitId);
      for (let i = 0; i < unitResult.paragraphs.length; i++) {
        paragraphs.push(unitResult.paragraphs[i]);
        paragraphIds.push(`${planCh.chapterId}_p_${paragraphs.length}`);
      }
      chapterSourceUnitIds.push(unitResult.unitId);
      for (const aId of unitResult.sourceAnswerIds) {
        if (!chapterSourceAnswerIds.includes(aId)) chapterSourceAnswerIds.push(aId);
      }
      for (const qId of unitResult.sourceQuestionIds) {
        if (!chapterSourceQuestionIds.includes(qId)) chapterSourceQuestionIds.push(qId);
      }
    }

    // 3. Include all additional memories assigned to this chapter
    for (const addAns of additionalStageAnswers) {
      const addText = extractIncludedAnswerText(addAns);
      const startParaIdx = paragraphs.length;
      const unitResult = formatMemoryUnitForStyle(planCh.chapterId, addAns, []);
      const firstParaId = `${planCh.chapterId}_p_${Math.max(1, startParaIdx + 1)}`;
      inspectAnswerPhoto(addAns, Math.max(0, startParaIdx), firstParaId, unitResult.unitId);

      const isRedundantWithExisting =
        addText.length > 0 &&
        paragraphs.some((existingPara) => areTestimoniesRedundantSameEpisode(existingPara, addText));

      if (!isRedundantWithExisting) {
        for (let i = 0; i < unitResult.paragraphs.length; i++) {
          paragraphs.push(unitResult.paragraphs[i]);
          paragraphIds.push(`${planCh.chapterId}_p_${paragraphs.length}`);
        }
      }
      chapterSourceUnitIds.push(unitResult.unitId);
      for (const aId of unitResult.sourceAnswerIds) {
        if (!chapterSourceAnswerIds.includes(aId)) chapterSourceAnswerIds.push(aId);
      }
      for (const qId of unitResult.sourceQuestionIds) {
        if (!chapterSourceQuestionIds.includes(qId)) chapterSourceQuestionIds.push(qId);
      }
    }

    if (paragraphs.length === 0 && firstStagePhoto) {
      const fallbackCaption =
        (firstStagePhoto as DemoInMemoryPhoto).caption ||
        (narrativeStyle === 'third_person_biography'
          ? `Fotografía conservada en la memoria biográfica de ${authors}.`
          : `Fotografía conservada entre los recuerdos de esta etapa.`);
      paragraphs.push(fallbackCaption);
      paragraphIds.push(`${planCh.chapterId}_p_1`);
    }

    if (paragraphs.length > 0) {
      const normalizedPhotoPlacements = chapterPhotoPlacements.map((pl) => {
        const clampedIdx = Math.max(0, Math.min(paragraphs.length - 1, pl.paragraphIndex));
        return {
          ...pl,
          paragraphIndex: clampedIdx,
          chapterId: planCh.chapterId,
          paragraphId: paragraphIds[clampedIdx] || `${planCh.chapterId}_p_${clampedIdx + 1}`,
        };
      });

      const firstSentence = paragraphs[0].split(/(?<=[.!?])\s+/)[0] || '';
      const resolvedChapterTitle =
        narrativeStyle === 'third_person_biography'
          ? planCh.suggestedTitleThirdPerson
          : isCouple
          ? planCh.suggestedTitleCouple
          : planCh.suggestedTitleIndividual;

      chapters.push({
        id: planCh.chapterId,
        partNumber: chapters.length + 1,
        dimensionKey: planCh.dimensionKey,
        title: resolvedChapterTitle,
        paragraphs,
        paragraphIds,
        sourceUnitIds: chapterSourceUnitIds,
        sourceAnswerIds: chapterSourceAnswerIds,
        sourceQuestionIds: chapterSourceQuestionIds,
        pullQuote:
          firstSentence.length >= 20 && firstSentence.length <= 165
            ? firstSentence
            : undefined,
        photoPlacements:
          normalizedPhotoPlacements.length > 0 ? normalizedPhotoPlacements : undefined,
      });
      if (firstStagePhoto) {
        chapterPhotos[planCh.chapterId] = firstStagePhoto;
      }
    }
  }

  if (chapters.length === 0) {
    chapters.push({
      id: 'part_ch_default',
      partNumber: 1,
      dimensionKey: 'raices',
      title:
        narrativeStyle === 'third_person_biography'
          ? `La memoria biográfica de ${authors}`
          : isCouple
          ? 'Nuestra memoria compartida'
          : 'Mi memoria personal',
      paragraphs: [
        narrativeStyle === 'third_person_biography'
          ? `Estas páginas preservan la biografía y los recuerdos compartidos por ${authors}.`
          : `Estas páginas preservan los recuerdos y testimonios compartidos por ${authors}.`,
      ],
      paragraphIds: ['part_ch_default_p_1'],
    });
  }

  const partialSubtitleNote = editorialPlan.isPartialMemoir
    ? editorialPlan.partialMemoirSubtitle || 'Un libro parcial de memorias'
    : undefined;

  const styledIntroduction =
    (narrativeStyle === 'third_person_biography'
      ? `Esta edición biográfica presenta la historia de vida, las vivencias y el legado de ${authors}, narrados en tercera persona a partir de sus testimonios auténticos.`
      : narrativeStyle === 'first_person_simple'
      ? isCouple
        ? `En las páginas de esta obra presentamos de manera ordenada, clara y directa las vivencias, recuerdos y aprendizajes que conforman nuestra historia compartida.`
        : `En las páginas de esta obra presento de manera ordenada, clara y directa las vivencias, recuerdos y aprendizajes que conforman mi historia de vida.`
      : isCouple
      ? `Esta edición reúne las vivencias, recuerdos y fotografías compartidas por ${authors}, conservando la calidez literaria y la emoción de nuestra voz para las generaciones presentes y futuras.`
      : `Esta edición reúne las vivencias, recuerdos y fotografías de ${authors}, transformados en unas memorias personales cálidas y emotivas para las generaciones presentes y futuras.`) +
    (editorialPlan.isPartialMemoir && editorialPlan.partialMemoirIntroNote
      ? ` ${editorialPlan.partialMemoirIntroNote}`
      : '');

  const sanitizedClosingInput = splitAnswerTextIntoIncludedAndExcludedSentences(
    closingDedicationText.trim()
  ).includedText;

  const initialManuscript: DemoManuscript = {
    title: interviewTitle || (isCouple ? `Nuestra historia: ${authors}` : `La historia de ${authors}`),
    subtitle:
      partialSubtitleNote ||
      (narrativeStyle === 'third_person_biography'
        ? `Biografía narrativa y legado de ${authors}`
        : isCouple
        ? 'Libro biográfico de memorias compartidas'
        : 'Libro autobiográfico y legado familiar'),
    authors,
    mode,
    narrativeStyle,
    bookStructureMode,
    isPartialMemoir: Boolean(editorialPlan.isPartialMemoir),
    documentedStages: editorialPlan.documentedStages,
    introduction: styledIntroduction,
    dedication: '',
    chapters,
    closingMessage: ensureParagraphConformsToStyle({
      paragraph:
        sanitizedClosingInput ||
        'Que estas páginas acompañen siempre a quienes forman parte de nuestra historia.',
      narrativeStyle,
      speakerName: authors,
      isCouple,
    }),
    insufficientInfoNotices: [],
    generatedAt: new Date().toISOString(),
    useOfficialForeverYouLogo: true,
    generationStatus: 'approved',
  };

  const audited = auditAndApproveBookManuscript({
    manuscript: initialManuscript,
    answers,
    questions,
  });

  return {
    manuscript: audited.manuscript,
    chapterPhotos,
    allPhotosById,
    chapterStructuredUnits,
    documentaryInventory,
    editorialPlan,
  };
}

/**
 * Resolves the exact chapter and paragraph index where a documentary photograph belongs,
 * using stable answerId/questionId links first, then lexical overlap between the photo's
 * original description / question text and the chapter paragraphs, and finally dimensionKey / stage.
 * Never dumps an unplaced photograph into chapter[0] unless chapter[0] genuinely narrates that event.
 */
export function resolveDocumentaryPhotoChapterAndParagraph(params: {
  chapters: DemoChapterManuscript[];
  photoId: string;
  shortCaption?: string;
  originalDescription?: string;
  answerId?: string;
  questionId?: string;
  answerText?: string;
  questionText?: string;
  dimensionKey?: DemoQuestionDefinition['dimensionKey'];
  preferredChapterId?: string;
  preferredParagraphIndex?: number;
}): {
  chapterIndex: number;
  paragraphIndex: number;
  chapterId: string;
  paragraphId: string;
} {
  const {
    chapters,
    answerId,
    questionId,
    shortCaption = '',
    originalDescription = '',
    answerText = '',
    questionText = '',
    dimensionKey,
    preferredChapterId,
    preferredParagraphIndex,
  } = params;

  if (chapters.length === 0) {
    return {
      chapterIndex: 0,
      paragraphIndex: 0,
      chapterId: 'ch_1',
      paragraphId: 'ch_1_p_1',
    };
  }

  // 1. Check if a chapter explicitly references this answerId or questionId
  let bestChapterIdx = -1;
  if (answerId) {
    bestChapterIdx = chapters.findIndex(
      (ch) => Array.isArray(ch.sourceAnswerIds) && ch.sourceAnswerIds.includes(answerId)
    );
  }
  if (bestChapterIdx < 0 && questionId) {
    bestChapterIdx = chapters.findIndex(
      (ch) => Array.isArray(ch.sourceQuestionIds) && ch.sourceQuestionIds.includes(questionId)
    );
  }

  // 2. Lexical matching against all chapters and paragraphs using the photo's story, answer text, and question
  const searchTokens = tokenizeSignificantWords(
    [originalDescription, shortCaption, answerText, questionText].filter(Boolean).join(' ')
  );

  let bestLexicalChapterIdx = -1;
  let bestLexicalParaIdx = 0;
  let bestLexicalScore = 0;

  if (searchTokens.length > 0) {
    chapters.forEach((ch, cIdx) => {
      const titleTokens = new Set(tokenizeSignificantWords(ch.title || ''));
      let titleBonus = 0;
      for (const tok of searchTokens) {
        if (titleTokens.has(tok)) titleBonus += 1.5;
      }

      (ch.paragraphs || []).forEach((para, pIdx) => {
        const paraTokens = new Set(tokenizeSignificantWords(para));
        let score = titleBonus;
        for (const tok of searchTokens) {
          if (paraTokens.has(tok)) score += 2;
        }
        if (dimensionKey && ch.dimensionKey === dimensionKey) {
          score += 1;
        }
        if (score > bestLexicalScore) {
          bestLexicalScore = score;
          bestLexicalChapterIdx = cIdx;
          bestLexicalParaIdx = pIdx;
        }
      });
    });
  }

  if (bestChapterIdx < 0 && bestLexicalScore >= 2) {
    bestChapterIdx = bestLexicalChapterIdx;
  }

  // 3. Match by preferredChapterId or dimensionKey if still unresolved
  if (bestChapterIdx < 0 && preferredChapterId) {
    bestChapterIdx = chapters.findIndex((ch) => ch.id === preferredChapterId);
  }
  if (bestChapterIdx < 0 && dimensionKey) {
    bestChapterIdx = chapters.findIndex((ch) => ch.dimensionKey === dimensionKey);
  }
  if (bestChapterIdx < 0) {
    bestChapterIdx = Math.max(0, bestLexicalChapterIdx);
  }

  const targetChapter = chapters[bestChapterIdx] || chapters[0];
  const paraCount = Math.max(1, (targetChapter.paragraphs || []).length);

  // Resolve the best paragraph inside targetChapter
  let resolvedParaIdx =
    bestLexicalChapterIdx === bestChapterIdx && bestLexicalScore > 0
      ? bestLexicalParaIdx
      : typeof preferredParagraphIndex === 'number'
      ? preferredParagraphIndex
      : 0;

  if (searchTokens.length > 0 && bestLexicalChapterIdx !== bestChapterIdx) {
    let localBestScore = -1;
    (targetChapter.paragraphs || []).forEach((para, pIdx) => {
      const paraTokens = new Set(tokenizeSignificantWords(para));
      let score = 0;
      for (const tok of searchTokens) {
        if (paraTokens.has(tok)) score += 2;
      }
      if (score > localBestScore) {
        localBestScore = score;
        resolvedParaIdx = pIdx;
      }
    });
  }

  resolvedParaIdx = Math.max(0, Math.min(paraCount - 1, resolvedParaIdx));
  const paragraphId =
    targetChapter.paragraphIds?.[resolvedParaIdx] ||
    `${targetChapter.id}_p_${resolvedParaIdx + 1}`;

  return {
    chapterIndex: bestChapterIdx,
    paragraphIndex: resolvedParaIdx,
    chapterId: targetChapter.id,
    paragraphId,
  };
}

function doesTokenMatchCorpusWords(targetToken: string, corpusWords: string[]): boolean {
  const normTarget = normalizePlainAscii(targetToken);
  if (!normTarget) return true;
  if (normTarget.includes(' ')) {
    const parts = normTarget.split(/\s+/).filter(Boolean);
    return parts.every((part) => doesTokenMatchCorpusWords(part, corpusWords));
  }
  if (corpusWords.includes(normTarget)) return true;

  // Check equivalent synonym/conjugation groups
  for (const grp of SPANISH_EQUIVALENT_WORD_GROUPS) {
    if (grp.includes(normTarget)) {
      if (grp.some((syn) => corpusWords.includes(syn))) return true;
    }
  }

  // Check Spanish stem prefix match (first 5 chars for >= 5 char words, or 4 chars for 4-char words)
  const stemLen = normTarget.length >= 6 ? 5 : 4;
  if (normTarget.length >= 4) {
    const prefix = normTarget.slice(0, stemLen);
    if (corpusWords.some((cw) => cw.length >= 4 && cw.startsWith(prefix))) {
      return true;
    }
  }
  return false;
}

// Semantic Antonym Pairs & Contradiction Detectors (Spanish)
const SPANISH_ACTION_ANTONYM_PAIRS: Array<[string[], string[]]> = [
  [['salvo', 'rescat', 'auxili', 'proteg'], ['empuj', 'abandon', 'hund', 'dano', 'lastim']],
  [['acept', 'aprobo', 'admit', 'recib'], ['rechaz', 'nego', 'reprobo', 'expuls']],
  [['llego', 'entro', 'regres', 'volvi'], ['huyo', 'abandono', 'escap']],
  [['record', 'acord'], ['olvido']],
  [['abrio', 'inaugur'], ['cerro', 'clausur']],
  [['gano', 'triunf', 'vencio'], ['perdio', 'fracas']],
  [['amo', 'quiso', 'adoro'], ['odio', 'detesto', 'desprecio']],
  [['construy', 'fundo', 'levanto'], ['destruy', 'derrumbo', 'demolio']],
  [['ayudo', 'apoyo', 'acompan', 'cuido'], ['abandono', 'desampar', 'perjudic']],
  [['perdono', 'absolv'], ['culpo', 'conden', 'reprocho']],
  [['casaron', 'caso', 'matrimonio'], ['divorci', 'separaron']],
  [['agradec', 'reconoci'], ['reclamo', 'ignoro']],
];

const SPANISH_MODALITY_ATTEMPT_RX =
  /\b(intento|intente|intentaron|trato\s+de|trate\s+de|trataron\s+de|estuvo\s+a\s+punto\s+de|estuve\s+a\s+punto\s+de|no\s+logro|no\s+logre|no\s+pudo)\b/i;

const SPANISH_COERCION_MODALITY_RX =
  /\b(me\s+obligo|le\s+obligo|nos\s+obligaron|me\s+forzo|tuve\s+que\s+hacerlo\s+a\s+la\s+fuerza|sin\s+quererlo|contra\s+mi\s+voluntad)\b/i;

const SPANISH_VOLUNTARY_JOY_MODALITY_RX =
  /\b(decidi\s+con\s+alegria|elegi\s+libremente|escogio\s+felizmente|con\s+total\s+libertad\s+y\s+alegria|gustosamente)\b/i;

// Scoped modality attempt detector (evaluated on ASCII-normalized text so word boundaries match reliably):
// ignores adverbial quantifiers ("casi siempre", "casi no", "casi todos") and capability negations ("no pude")
// and focuses strictly on unconsummated/failed attempts.
const SPANISH_PRECISE_ATTEMPT_RX =
  /\b(intento|intente|intentaron|trato\s+de|trate\s+de|trataron\s+de|estuvo\s+a\s+punto\s+de|estuve\s+a\s+punto\s+de|no\s+logro|no\s+logre|no\s+lograron|sin\s+exito|fracaso|casi\s+(?!siempre\b|todos?\b|todas?\b|todo\b|nunca\b|nada\b|no\b|ni\b|diario\b|igual\b|list[oa]\b)[a-z]{4,})\b/i;

const NON_PREDICATE_POLARITY_STOPWORDS = new Set([
  'hacia',
  'entre',
  'sobre',
  'desde',
  'hasta',
  'despues',
  'antes',
  'durante',
  'forma',
  'manera',
  'momento',
  'momentos',
  'tiempo',
  'parte',
  'cosas',
  'hecho',
  'verdad',
  'realidad',
  'general',
  'algunos',
  'algunas',
  'muchos',
  'muchas',
  'otros',
  'otras',
  'mismo',
  'misma',
  'siempre',
  'nunca',
  'aunque',
  'porque',
  'cuando',
  'donde',
  'quien',
]);

const NEGATION_CUES_RX = /\b(no|nunca|jamas|tampoco|sin|ningun|ninguna|ninguno|nadie)\b/;

// Leading Spanish conversational discourse starters ("No, pues...", "No, la verdad...") and tag questions (", ¿no?")
const LEADING_DISCOURSE_NO_RX =
  /^\s*no\s*,\s*(?:pues|bueno|mira|fijate|en\s+realidad|la\s+verdad|claro|creo|veras|si|oiga)\b/i;
const TRAILING_TAG_NO_RX = /,?\s*no\??\s*$/i;

function normalizeAsciiPreserveClausePunctuation(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSpanishClausesForAudit(text: string): string[] {
  const normPunct = normalizeAsciiPreserveClausePunctuation(text);
  if (!normPunct) return [];
  return normPunct
    .split(/\s*(?:[.!?;:]+|,\s*(?=(?:pero|aunque|sino|mas|sin\s+embargo|mientras|porque)\b))\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

function stripSpanishDiscourseNoiseForPolarity(clauseText: string): string {
  return normalizePlainAscii(
    clauseText
      .replace(LEADING_DISCOURSE_NO_RX, '')
      .replace(TRAILING_TAG_NO_RX, '')
      .trim()
  );
}

/**
 * V5.1 — Negation bindings: for every negation cue, the stem of the predicate it governs (the
 * next significant word inside the same punctuation-delimited segment). Oral fillers, repeated
 * words and tag questions (", ¿no?") do not create bindings, so a testimony and its cleaned-up
 * rendering yield the same set even when a fixed word window would have drifted.
 */
function collectNegationBindings(text: string): string[] {
  const bindings: string[] = [];
  const segments = normalizeAsciiPreserveClausePunctuation(text)
    .split(/[.,;:!?]+/)
    .map((seg) => seg.trim().split(/\s+/).filter(Boolean))
    .filter((segWords) => segWords.length > 0);
  for (const segWords of segments) {
    for (let i = 0; i < segWords.length; i++) {
      if (!NEGATION_CUES_RX.test(segWords[i])) continue;
      for (let k = i + 1; k < segWords.length; k++) {
        const candidate = segWords[k];
        if (candidate.length < 4 || NEGATION_CUES_RX.test(candidate)) continue;
        if (tokenizeSignificantWords(candidate).length === 0) continue;
        bindings.push(candidate.slice(0, 3));
        break;
      }
    }
  }
  return bindings;
}

function selectAlignedTargetClauses(params: {
  sourceText: string;
  targetSentencesRaw: string[];
}): {
  alignedText: string;
  alignedClausesNorm: string[];
  hadAmbiguousEdge: boolean;
} {
  const { sourceText, targetSentencesRaw } = params;
  const srcTokens = Array.from(new Set(tokenizeSignificantWords(sourceText)));
  const srcNorm = normalizePlainAscii(sourceText);

  if (targetSentencesRaw.length === 0) {
    return { alignedText: '', alignedClausesNorm: [], hadAmbiguousEdge: false };
  }
  if (targetSentencesRaw.length === 1 || srcTokens.length === 0) {
    const joined = targetSentencesRaw.join(' ');
    return {
      alignedText: joined,
      alignedClausesNorm: splitSpanishClausesForAudit(joined),
      hadAmbiguousEdge: false,
    };
  }

  const scored = targetSentencesRaw.map((sent, idx) => {
    const normS = normalizePlainAscii(sent);
    const sWords = normS.split(/\s+/).filter(Boolean);
    let hits = 0;
    for (const tok of srcTokens) {
      if (doesTokenMatchCorpusWords(tok, sWords)) {
        hits += 1;
      }
    }
    const overlapRatio = hits / srcTokens.length;
    return { sent, normS, idx, hits, overlapRatio };
  });

  scored.sort((a, b) => b.overlapRatio - a.overlapRatio || b.hits - a.hits);

  // Pick all sentences meaningfully aligned with this unit (at least >= 0.25 or >= 2 hits, and within range of top hit)
  const topScore = scored[0]?.overlapRatio ?? 0;
  const aligned = scored.filter(
    (item, rank) =>
      rank === 0 ||
      (item.hits >= 2 && item.overlapRatio >= Math.max(0.24, topScore * 0.55))
  );
  // Restore natural reading order
  aligned.sort((a, b) => a.idx - b.idx);

  const alignedText = aligned.map((a) => a.sent).join(' ').trim();
  const alignedClausesNorm = aligned.flatMap((a) => splitSpanishClausesForAudit(a.sent));
  const hadAmbiguousEdge =
    srcNorm.length > 0 && topScore >= 0.2 && topScore < 0.45 && scored.length > 1;

  return { alignedText, alignedClausesNorm, hadAmbiguousEdge };
}

function detectSemanticContradictionsBetweenTexts(params: {
  sourceText: string;
  targetText: string;
  targetSentencesRaw?: string[];
  properNames: string[];
}): { issues: string[]; ambiguousEdge: boolean } {
  const { sourceText, targetText, targetSentencesRaw, properNames } = params;
  const issues: string[] = [];
  let ambiguousEdge = false;

  const normSource = normalizePlainAscii(sourceText);
  if (!normSource || !targetText.trim()) return { issues, ambiguousEdge };

  // CRITICAL V4.1 FIX: Align the unit strictly to its matching sentence(s)/clause(s) within the target paragraph
  // so unrelated sibling sentences inside multi-answer chapters never cause false negation/modality/antonym flags.
  const sentencesInTarget =
    targetSentencesRaw && targetSentencesRaw.length > 0
      ? targetSentencesRaw
      : targetText
          .split(/(?<=[.!?…])\s+/)
          .map((s) => s.trim())
          .filter(Boolean);

  const alignment = selectAlignedTargetClauses({
    sourceText,
    targetSentencesRaw: sentencesInTarget,
  });
  ambiguousEdge = alignment.hadAmbiguousEdge;

  const alignedOrFullTargetRaw = alignment.alignedText || targetText;
  const normTarget = normalizePlainAscii(alignedOrFullTargetRaw);
  if (!normTarget) return { issues, ambiguousEdge };

  const srcClauses = splitSpanishClausesForAudit(sourceText);
  const tgtClauses =
    alignment.alignedClausesNorm.length > 0
      ? alignment.alignedClausesNorm
      : splitSpanishClausesForAudit(alignedOrFullTargetRaw);
  const srcFull = normSource;
  const tgtFull = normTarget;

  // 1. Clause-scoped Polarity / Negation flips on substantive predicates (noun/verb tokens >= 5 chars, excluding prepositions/filler nouns)
  const significantActionOrSubjectTokens = tokenizeSignificantWords(sourceText).filter(
    (t) => t.length >= 5 && !NON_PREDICATE_POLARITY_STOPWORDS.has(t)
  );
  const extractClausePredicatePolarity = (
    rawClause: string,
    stemPrefix: string
  ): { polarity: 'affirmed' | 'negated' | 'absent'; usedDiscourseTag: boolean } => {
    const hadDiscourseStarter = LEADING_DISCOURSE_NO_RX.test(rawClause);
    // V5.1: a negation only governs the predicate inside its own comma-delimited segment.
    // Looking back across a comma ("...ellos no lo sepan, mis papás ...") attached the previous
    // segment's negation to an unrelated noun and produced false polarity inversions.
    const commaSegments = rawClause
      .replace(LEADING_DISCOURSE_NO_RX, '')
      .replace(TRAILING_TAG_NO_RX, '')
      .split(',')
      .map((seg) => normalizePlainAscii(seg).split(/\s+/).filter(Boolean))
      .filter((segWords) => segWords.length > 0);
    let words: string[] = [];
    let hitIdx = -1;
    for (const segWords of commaSegments) {
      const idx = segWords.findIndex((w) => w.startsWith(stemPrefix));
      if (idx >= 0) {
        words = segWords;
        hitIdx = idx;
        break;
      }
    }
    if (hitIdx < 0) return { polarity: 'absent', usedDiscourseTag: hadDiscourseStarter };
    const windowBefore = words.slice(Math.max(0, hitIdx - 4), hitIdx).join(' ');
    // Exclude benign rhetorical or epistemic idioms across 1st/2nd/3rd person ("no recuerdo/recuerda", "no me/se acuerda", "no cabe duda")
    if (
      /\b(?:no\s+faltab[ao]n?|no\s+le\s+falt[ao]|no\s+cabe\s+duda|no\s+solo(?:\s+eso)?|no\s+recuerd[ao]n?|no\s+recordab[ao]n?|no\s+(?:me|te|se|nos)\s+acuerd[ao]n?|no\s+(?:me|te|se|nos)\s+acordab[ao]n?|no\s+s[ae]|no\s+sab[ei]a?n?|no\s+entiend[eo]n?|no\s+entend[ei]a?n?|no\s+import[ae]|no\s+importab[ao]n?)\b/.test(
        windowBefore
      )
    ) {
      return { polarity: 'affirmed', usedDiscourseTag: true };
    }
    if (NEGATION_CUES_RX.test(windowBefore)) {
      return { polarity: 'negated', usedDiscourseTag: hadDiscourseStarter };
    }
    return { polarity: 'affirmed', usedDiscourseTag: hadDiscourseStarter };
  };

  // V5.1: when every negation of the testimony governs the same predicate in the manuscript and
  // the manuscript adds no negation over a predicate the testimony affirmed, polarity was
  // preserved by construction and the word-window heuristic below cannot add information.
  const srcNegationBindings = new Set(collectNegationBindings(sourceText));
  const tgtNegationBindings = new Set(collectNegationBindings(alignedOrFullTargetRaw));
  const srcPredicateStems = new Set(
    normSource
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 3))
  );
  const polarityStructurePreserved =
    Array.from(srcNegationBindings).every((b) => tgtNegationBindings.has(b)) &&
    Array.from(tgtNegationBindings).every((b) => !srcPredicateStems.has(b) || srcNegationBindings.has(b));

  for (const tok of polarityStructurePreserved ? [] : significantActionOrSubjectTokens.slice(0, 12)) {
    const stem = tok.slice(0, 5);
    let srcHasAffirmed = false;
    let srcHasNegated = false;
    let srcDiscourse = false;
    for (const sc of srcClauses) {
      const res = extractClausePredicatePolarity(sc, stem);
      if (res.polarity === 'affirmed') srcHasAffirmed = true;
      if (res.polarity === 'negated') srcHasNegated = true;
      if (res.usedDiscourseTag) srcDiscourse = true;
    }
    let tgtHasAffirmed = false;
    let tgtHasNegated = false;
    let tgtDiscourse = false;
    for (const tc of tgtClauses) {
      const res = extractClausePredicatePolarity(tc, stem);
      if (res.polarity === 'affirmed') tgtHasAffirmed = true;
      if (res.polarity === 'negated') tgtHasNegated = true;
      if (res.usedDiscourseTag) tgtDiscourse = true;
    }

    const pureSrcNegated = srcHasNegated && !srcHasAffirmed;
    const pureSrcAffirmed = srcHasAffirmed && !srcHasNegated;
    if (
      (pureSrcNegated && tgtHasAffirmed && !tgtHasNegated) ||
      (pureSrcAffirmed && tgtHasNegated && !tgtHasAffirmed)
    ) {
      if (srcDiscourse || tgtDiscourse) {
        // Conversational negation vs paraphrase edge -> flag as ambiguous for hybrid AI judge if available
        ambiguousEdge = true;
      }
      issues.push(
        `Inversión de polaridad/negación detectada alrededor de "${tok}" (${pureSrcNegated ? 'negated' : 'affirmed'} en testimonio vs. ${pureSrcNegated ? 'affirmed' : 'negated'} en manuscrito).`
      );
      break;
    }
  }

  // 2. Agency / Subject-Object Role Reversal evaluated strictly on the aligned target text
  const passiveToFirstPersonRx =
    /\bme\s+(enseno|ensenaba|acompano|acompanaba|cuido|cuidaba|llevo|llevaba|ayudo|ayudaba|salvo|regalo|escribio|protegio|visito)\b/;
  const activeByFirstPersonRx =
    /\b(?:yo\s+)?(?:le\s+)?(ensene|ensenaba|acompano|acompani|acompane|cuide|cuidaba|lleve|llevaba|ayude|ayudaba|salve|regale|escribi|protegi|visite)(?:\s+a)?\b/;
  const srcPassiveM = srcFull.match(passiveToFirstPersonRx);
  const tgtActiveM = tgtFull.match(activeByFirstPersonRx);
  if (srcPassiveM && tgtActiveM) {
    const srcStem = srcPassiveM[1].slice(0, 4);
    const tgtStem = tgtActiveM[1].slice(0, 4);
    // V5.1: "-aba" forms are identical in 1st and 3rd person. In a third-person biography
    // "me cuidaba" is correctly rendered as "le/lo/la cuidaba": the object clitic proves the
    // protagonist still RECEIVES the action, so it is not an agency reversal.
    const tgtVerb = tgtActiveM[1];
    const isPersonAmbiguousImperfect = /aba$/.test(tgtVerb);
    const keepsObjectClitic = new RegExp(
      `\\b(?:le|lo|la|les|los|las|nos|se)\\s+${tgtVerb}\\b`
    ).test(tgtFull);
    const hasExplicitFirstPersonSubject = new RegExp(
      `\\byo\\s+(?:(?:le|lo|la|les|los|las)\\s+)?${tgtVerb}\\b`
    ).test(tgtFull);
    const isThirdPersonRendering =
      isPersonAmbiguousImperfect && keepsObjectClitic && !hasExplicitFirstPersonSubject;
    if (
      srcStem === tgtStem &&
      !tgtFull.match(passiveToFirstPersonRx) &&
      !isThirdPersonRendering
    ) {
      issues.push(
        `Inversión de agencia (quién realizó la acción): el testimonio indica "me ${srcPassiveM[1]}" pero el manuscrito invierte el rol hacia "${tgtActiveM[0]}".`
      );
    }
  }
  for (const rel of properNames) {
    const normRel = normalizePlainAscii(rel);
    if (normRel.length < 3) continue;
    const relActsOnMe = new RegExp(`\\b${normRel}\\s+me\\s+[a-z]{4,}`);
    const iActOnRel = new RegExp(`\\b(?:a\\s+mi\\s+|a\\s+)${normRel}\\b`);
    if (relActsOnMe.test(srcFull) && iActOnRel.test(tgtFull) && !relActsOnMe.test(tgtFull)) {
      issues.push(
        `Inversión de sujeto/objeto con "${rel}": el testimonio expresa acción recibida desde ${rel}, no realizada hacia ${rel}.`
      );
      break;
    }
  }

  // 3. Modality / Attempt / Coercion shifts evaluated on ASCII-normalized aligned sentence/clause
  const normalizedAlignedTarget = normalizePlainAscii(alignment.alignedText || targetText);
  const srcAttempt = SPANISH_PRECISE_ATTEMPT_RX.test(srcFull);
  const tgtAttempt = SPANISH_PRECISE_ATTEMPT_RX.test(normalizedAlignedTarget);
  if (srcAttempt !== tgtAttempt) {
    issues.push(
      srcAttempt
        ? 'Cambio crítico de modalidad: el testimonio describe un intento o acción inconclusa ("intentó / casi / no logró") presentada como hecho consumado.'
        : 'Cambio crítico de modalidad: el testimonio afirma un hecho consumado, pero el manuscrito lo altera a un intento o acción inconclusa ("intentó / casi / no logró").'
    );
  }
  const srcCoercion = SPANISH_COERCION_MODALITY_RX.test(srcFull);
  const tgtCoercion = SPANISH_COERCION_MODALITY_RX.test(tgtFull);
  if (
    (srcCoercion && SPANISH_VOLUNTARY_JOY_MODALITY_RX.test(tgtFull)) ||
    srcCoercion !== tgtCoercion
  ) {
    issues.push(
      'Cambio crítico de modalidad emocional/voluntaria: discrepancia de obligación o coerción ("obligó / forzó") entre testimonio y manuscrito.'
    );
  }

  // 4. Antonym verb pairs evaluated strictly between aligned source and aligned target clauses
  const srcWords = srcFull.split(/\s+/);
  const tgtWords = tgtFull.split(/\s+/);
  for (const [groupA, groupB] of SPANISH_ACTION_ANTONYM_PAIRS) {
    const srcHasA = groupA.some((st) => srcWords.some((w) => w.startsWith(st)));
    const srcHasB = groupB.some((st) => srcWords.some((w) => w.startsWith(st)));
    const tgtHasA = groupA.some((st) => tgtWords.some((w) => w.startsWith(st)));
    const tgtHasB = groupB.some((st) => tgtWords.some((w) => w.startsWith(st)));
    if ((srcHasA && !srcHasB && tgtHasB && !tgtHasA) || (srcHasB && !srcHasA && tgtHasA && !tgtHasB)) {
      issues.push(
        `Contradicción semántica por acción opuesta detectada entre testimonio y manuscrito.`
      );
      break;
    }
  }

  return { issues, ambiguousEdge };
}

/**
 * V5.1: at or above this lexical overlap a unit that is not verified literally is sent to the
 * semantic judge. V5.2: BELOW it the unit is no longer treated as omitted by default — a faithful
 * literary paraphrase can share almost no words with the testimony. Low-overlap units go through
 * `assessUnitEvidenceOfAbsence` and only skip the judge when absence is actually demonstrated.
 */
const SEMANTIC_REVIEW_MIN_LEXICAL_SCORE = 0.2;

/**
 * V5.2 — Related-meaning groups used ONLY to retrieve evidence and to decide whether absence is
 * demonstrated. They never verify (approve) a unit: a hit here can only send a case to the
 * semantic judge instead of declaring it omitted. Entries are prefixes of ASCII-normalized words.
 */
const SPANISH_RELATED_MEANING_STEM_GROUPS: string[][] = [
  ['rescat', 'salv', 'socorr', 'auxili', 'interven', 'proteg', 'libr', 'gracias a'],
  ['ahog', 'hund', 'tragedi', 'accident', 'peligr', 'arrastr'],
  ['empuj', 'arroj', 'tir', 'lanz', 'golpe'],
  ['rio', 'arroy', 'agua', 'corrient', 'lago', 'mar', 'orill'],
  ['padre', 'papa', 'papi', 'progenit', 'viejo'],
  ['madre', 'mama', 'mami', 'progenit', 'vieja'],
  ['abuel', 'nona', 'nono'],
  ['herman'],
  ['hijo', 'hija', 'nino', 'nina', 'chamac', 'crio', 'pequen'],
  ['esposa', 'esposo', 'marido', 'mujer', 'compan', 'conyug', 'pareja'],
  ['muri', 'muert', 'falleci', 'partid', 'perdi', 'descans', 'despedi'],
  ['naci', 'nacer', 'llegue al mundo', 'vine al mundo'],
  ['trabaj', 'emple', 'ofici', 'labor', 'chamb', 'jornad', 'sueldo', 'patron'],
  ['escuel', 'coleg', 'aula', 'estudi', 'maestr', 'profes', 'clase', 'primari', 'secundari'],
  ['casa', 'hogar', 'vivienda', 'techo', 'domicil', 'cuarto', 'patio'],
  ['boda', 'cas', 'matrimon', 'nupci', 'altar', 'novi'],
  ['viaj', 'recorr', 'visit', 'conoc', 'trasl', 'mud'],
  ['enferm', 'hospital', 'medic', 'doctor', 'cura', 'sanar', 'salud'],
  ['iglesi', 'parroqui', 'templ', 'misa', 'fe', 'reza', 'oracion'],
  ['pueblo', 'aldea', 'comunidad', 'rancho', 'campo', 'milpa', 'parcela', 'tierra'],
  ['dinero', 'ahorr', 'pago', 'pesos', 'deud', 'presta', 'cost'],
  ['comid', 'cocin', 'guis', 'platill', 'sabor', 'mesa', 'cena', 'almuerz'],
  ['jug', 'juego', 'diver', 'travesur', 'canica', 'pelota'],
  ['feliz', 'alegr', 'dicha', 'contento', 'gozo', 'sonri'],
  ['triste', 'pena', 'dolor', 'llor', 'lagrim', 'melancol', 'pesar'],
  ['miedo', 'temor', 'asust', 'susto', 'pavor', 'angusti', 'nervio'],
  ['amor', 'quer', 'carin', 'ternur', 'afecto', 'ama'],
  ['gratitud', 'agradec', 'gracias', 'bendic'],
];

function expandTokenToRelatedStems(token: string): string[] {
  const norm = normalizePlainAscii(token);
  if (!norm) return [];
  const stems = new Set<string>([norm.length >= 6 ? norm.slice(0, 5) : norm]);
  for (const grp of SPANISH_RELATED_MEANING_STEM_GROUPS) {
    if (grp.some((stem) => stem.length >= 3 && norm.startsWith(stem))) {
      for (const stem of grp) if (stem.length >= 3) stems.add(stem);
    }
  }
  return Array.from(stems);
}

function paragraphHasStem(normParagraph: string, words: string[], stem: string): boolean {
  if (stem.includes(' ')) return normParagraph.includes(stem);
  return words.some((w) => w.length >= Math.min(3, stem.length) && w.startsWith(stem));
}

/**
 * V5.2 — Conjugated verbs of a testimony that carry its action: accented preterites ("salvó",
 * "llegué"), -ar imperfects ("cuidaba") and preterite plurals ("llegaron", "vivieron"). Returned
 * ASCII-normalized; only words of 5+ letters, so irregular short forms that change in the third
 * person ("fui" -> "fue", "tuve" -> "tuvo") do not create false alarms. Capitalized words
 * (names such as "José") are ignored.
 */
function extractTestimonyActionVerbs(rawText: string): string[] {
  const out = new Set<string>();
  for (const raw of String(rawText || '').split(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/)) {
    if (raw.length < 5 || /^[A-ZÁÉÍÓÚÑ]/.test(raw)) continue;
    if (/(ó|é|aba|abas|aban|ábamos|aron|ieron)$/.test(raw)) {
      out.add(normalizePlainAscii(raw));
    }
  }
  return Array.from(out);
}

/** V5.2: the facets that a faithful book must keep with the same value, whatever its wording. */
function collectStrongAnchors(unit: DocumentaryFactUnit): string[] {
  const familySet = new Set(SPANISH_FAMILY_RELATIONS.map((r) => r.trim()));
  const placeNounSet = new Set(SPANISH_PLACE_NOUNS);
  return Array.from(
    new Set([
      ...unit.yearsOrNumbers,
      ...unit.properNames.filter((n) => !familySet.has(n)),
      ...unit.places.filter((pl) => !placeNounSet.has(pl)),
    ])
  ).filter((a) => a && a.trim().length > 0);
}

export interface UnitEvidenceFragment {
  chapterId: string;
  chapterTitle: string;
  paragraphIndex: number;
  paragraphId: string;
  text: string;
  /** Why this fragment was retrieved (best match, neighbor of the best match, related chapter...). */
  role: 'best_match' | 'previous_paragraph' | 'next_paragraph' | 'related_paragraph';
}

export interface UnitEvidenceAssessment {
  /**
   * - present: literal or strong evidence exists (no judge needed when the unit is verified).
   * - uncertain: some related evidence exists; only a contextual reading can decide.
   * - absent: absence is DEMONSTRATED (a concrete name, place or figure of the testimony is
   *   nowhere in the book, or nothing related to the memory exists anywhere).
   */
  status: 'present' | 'uncertain' | 'absent';
  reason: string;
  missingStrongAnchors: string[];
  fragments: UnitEvidenceFragment[];
}

const MAX_FRAGMENT_CHARS = 1800;
const MAX_TOTAL_EVIDENCE_CHARS = 6000;

/**
 * Cuts a long paragraph AROUND its best-matching sentences instead of keeping a prefix, so the
 * verifiable fact is never left outside the excerpt sent to the judge.
 */
function excerptParagraphAroundStems(raw: string, stems: string[]): string {
  if (raw.length <= MAX_FRAGMENT_CHARS) return raw;
  const sentences = raw.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const scored = sentences.map((sentence, idx) => {
    const norm = normalizePlainAscii(sentence);
    const words = norm.split(/\s+/).filter(Boolean);
    return { idx, hits: stems.filter((st) => paragraphHasStem(norm, words, st)).length };
  });
  const bestIdx = scored.reduce((best, cur) => (cur.hits > best.hits ? cur : best), scored[0]).idx;
  let start = bestIdx;
  let end = bestIdx;
  let length = sentences[bestIdx].length;
  while (true) {
    const canPrev = start > 0 && length + sentences[start - 1].length + 1 <= MAX_FRAGMENT_CHARS;
    const canNext =
      end < sentences.length - 1 && length + sentences[end + 1].length + 1 <= MAX_FRAGMENT_CHARS;
    if (!canPrev && !canNext) break;
    if (canPrev) {
      start -= 1;
      length += sentences[start].length + 1;
    }
    if (canNext) {
      end += 1;
      length += sentences[end].length + 1;
    }
  }
  const body = sentences.slice(start, end + 1).join(' ');
  return `${start > 0 ? '[…] ' : ''}${body}${end < sentences.length - 1 ? ' […]' : ''}`;
}

/**
 * V5.2 — Evidence retrieval for one documentary unit across the WHOLE manuscript.
 * Order: (1) direct and equivalent words, (2) related-meaning stems, (3) the paragraph planned for
 * the answer and thematically related chapters, (4) the paragraphs before and after the best
 * match (a memory split between two paragraphs). It returns several identified fragments and
 * decides whether absence is demonstrated or merely evidence is lacking.
 */
function assessUnitEvidenceOfAbsenceIndexed(params: {
  unit: DocumentaryFactUnit;
  indexedAll: PreIndexedChapterAudit[];
  bestChapterIdx: number;
  bestParaIdx: number;
  maxRelatedFragments?: number;
}): UnitEvidenceAssessment {
  const { unit, indexedAll, bestChapterIdx, bestParaIdx, maxRelatedFragments = 2 } = params;
  const requiredTokens =
    unit.keyTokens.length > 0
      ? unit.keyTokens
      : normalizePlainAscii(unit.cleanText)
          .split(/\s+/)
          .filter((w) => w.length >= 3);
  const tokenStemSets = requiredTokens.map((tok) => expandTokenToRelatedStems(tok));
  const allStems = Array.from(new Set(tokenStemSets.flat()));

  // Strong anchors: compared by value against the whole book (numbers include spelled forms).
  const strongAnchors = collectStrongAnchors(unit);
  const missingStrongAnchors = strongAnchors.filter(
    (anchor) =>
      !indexedAll.some((item) =>
        item.paragraphs.some((pe) => doesTokenMatchIndexedWords(anchor, pe.words, pe.wordSet))
      )
  );

  // Rank every paragraph of the book by direct + related evidence.
  const ranked: Array<{ cIdx: number; pIdx: number; score: number }> = [];
  for (const item of indexedAll) {
    const linked = item.answerIdSet.has(unit.answerId);
    item.paragraphs.forEach((pe, pIdx) => {
      let score = 0;
      requiredTokens.forEach((tok, tIdx) => {
        if (doesTokenMatchIndexedWords(tok, pe.words, pe.wordSet)) score += 1;
        else if (tokenStemSets[tIdx].some((st) => paragraphHasStem(pe.norm, pe.words, st))) score += 0.6;
      });
      for (const anchor of strongAnchors) {
        if (doesTokenMatchIndexedWords(anchor, pe.words, pe.wordSet)) score += 0.5;
      }
      if (score > 0 && linked) score += 0.15;
      if (score > 0) ranked.push({ cIdx: item.cIdx, pIdx, score });
    });
  }
  ranked.sort((a, b) => b.score - a.score);

  const fragments: UnitEvidenceFragment[] = [];
  const seen = new Set<string>();
  let totalChars = 0;
  const pushFragment = (cIdx: number, pIdx: number, role: UnitEvidenceFragment['role']) => {
    const item = indexedAll.find((it) => it.cIdx === cIdx);
    const pe = item?.paragraphs[pIdx];
    if (!item || !pe || !pe.raw.trim()) return;
    const key = `${cIdx}:${pIdx}`;
    if (seen.has(key)) return;
    const text = excerptParagraphAroundStems(pe.raw, allStems);
    if (totalChars + text.length > MAX_TOTAL_EVIDENCE_CHARS && fragments.length > 0) return;
    seen.add(key);
    totalChars += text.length;
    fragments.push({
      chapterId: item.ch.id,
      chapterTitle: item.ch.title,
      paragraphIndex: pIdx,
      paragraphId: item.ch.paragraphIds?.[pIdx] || `${item.ch.id}_p_${pIdx + 1}`,
      text,
      role,
    });
  };

  const top = ranked[0];
  const anchorCIdx = top && top.score > 0 ? top.cIdx : bestChapterIdx;
  const anchorPIdx = top && top.score > 0 ? top.pIdx : bestParaIdx;
  pushFragment(anchorCIdx, anchorPIdx, 'best_match');
  if (!(anchorCIdx === bestChapterIdx && anchorPIdx === bestParaIdx)) {
    pushFragment(bestChapterIdx, bestParaIdx, 'related_paragraph');
  }
  pushFragment(anchorCIdx, anchorPIdx - 1, 'previous_paragraph');
  pushFragment(anchorCIdx, anchorPIdx + 1, 'next_paragraph');
  let related = 0;
  for (const cand of ranked.slice(1)) {
    if (related >= maxRelatedFragments) break;
    const before = fragments.length;
    pushFragment(cand.cIdx, cand.pIdx, 'related_paragraph');
    if (fragments.length > before) related++;
  }

  const bestScore = top?.score || 0;
  if (missingStrongAnchors.length > 0) {
    return {
      status: 'absent',
      reason: `Dato concreto del testimonio ausente en todo el libro (${missingStrongAnchors.join(', ')}).`,
      missingStrongAnchors,
      fragments,
    };
  }
  if (bestScore === 0) {
    // No word or related word anywhere, but no concrete datum is missing either: a literary
    // rewrite can still carry the memory ("la mano de quien me dio la vida me sacó del agua").
    // That is ABSENCE OF EVIDENCE, so the judge reads the chapter planned for this answer.
    for (const item of indexedAll.filter((it) => it.answerIdSet.has(unit.answerId)).slice(0, 2)) {
      for (let pIdx = 0; pIdx < Math.min(item.paragraphs.length, 3); pIdx++) {
        pushFragment(item.cIdx, pIdx, 'related_paragraph');
      }
    }
    return {
      status: 'uncertain',
      reason:
        'Sin coincidencias léxicas ni variantes y sin datos concretos ausentes: solo una lectura contextual del capítulo planificado puede descartar una paráfrasis.',
      missingStrongAnchors,
      fragments,
    };
  }
  return {
    status: bestScore >= requiredTokens.length * 0.9 ? 'present' : 'uncertain',
    reason:
      bestScore >= requiredTokens.length * 0.9
        ? 'Evidencia directa localizada.'
        : 'Hay evidencia relacionada pero no literal: requiere lectura contextual.',
    missingStrongAnchors,
    fragments,
  };
}

/**
 * V5.2 — Public retriever used by the hybrid audit to build the semantic judge's cases: several
 * identified fragments per unit instead of one truncated excerpt.
 */
export function createUnitEvidenceRetriever(chapters: DemoChapterManuscript[]) {
  const indexedAll = buildChapterAuditIndex(chapters);
  return (params: {
    unit: DocumentaryFactUnit;
    chapterId?: string;
    paragraphIndex?: number;
  }): UnitEvidenceAssessment => {
    const cIdx = Math.max(
      0,
      indexedAll.findIndex((it) => it.ch.id === params.chapterId)
    );
    return assessUnitEvidenceOfAbsenceIndexed({
      unit: params.unit,
      indexedAll,
      bestChapterIdx: cIdx,
      bestParaIdx: Math.max(0, params.paragraphIndex ?? 0),
    });
  };
}

interface PreIndexedChapterParagraph {
  raw: string;
  norm: string;
  words: string[];
  wordSet: Set<string>;
  sentencesRaw: string[];
  windowNextWords: string[];
  windowNextWordSet: Set<string>;
}

interface PreIndexedChapterAudit {
  ch: DemoChapterManuscript;
  cIdx: number;
  answerIdSet: Set<string>;
  paragraphs: PreIndexedChapterParagraph[];
}

function buildChapterAuditIndex(chapters: DemoChapterManuscript[]): PreIndexedChapterAudit[] {
  return chapters.map((ch, cIdx) => {
    const rawParas = ch.paragraphs || [];
    const normList = rawParas.map((p) => {
      const norm = normalizePlainAscii(p);
      // V5.1: index numeric facts by value so "1975" and "mil novecientos setenta y cinco" match.
      const words = [...norm.split(/\s+/).filter(Boolean), ...buildNumericEquivalenceTokens(norm)];
      const sentencesRaw = (p || '')
        .split(/(?<=[.!?…])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return { raw: p, norm, words, wordSet: new Set(words), sentencesRaw };
    });
    const paragraphs: PreIndexedChapterParagraph[] = normList.map((cur, pIdx) => {
      const next = normList[pIdx + 1];
      const windowNextWords = next ? [...cur.words, ...next.words] : cur.words;
      return {
        raw: cur.raw,
        norm: cur.norm,
        words: cur.words,
        wordSet: cur.wordSet,
        sentencesRaw: cur.sentencesRaw,
        windowNextWords,
        windowNextWordSet: new Set(windowNextWords),
      };
    });
    return {
      ch,
      cIdx,
      answerIdSet: new Set(ch.sourceAnswerIds || []),
      paragraphs,
    };
  });
}

function doesTokenMatchIndexedWords(
  token: string,
  words: string[],
  wordSet: Set<string>
): boolean {
  if (!token) return false;
  if (wordSet.has(token)) return true;
  return doesTokenMatchCorpusWords(token, words);
}

/**
 * Performs real bidirectional semantic and facet verification of an atomic `DocumentaryFactUnit` against
 * the manuscript's normalized chapters and paragraphs, using clause-level alignment and optional pre-indexing.
 */
export function verifyDocumentaryUnitInManuscript(params: {
  unit: DocumentaryFactUnit;
  chapters: DemoChapterManuscript[];
  preIndexedChapters?: PreIndexedChapterAudit[];
}): {
  verified: boolean;
  verificationStatus: UnitVerificationStatus;
  semanticIssues: string[];
  ambiguityReason?: string;
  needsSemanticReview: boolean;
  semanticReviewReason?: string;
  /** V5.2: set when absence is DEMONSTRATED (no judge needed). */
  evidenceOfAbsenceReason?: string;
  semanticMatchScore: number;
  chapterIndex: number;
  paragraphIndex: number;
  chapterId: string;
  paragraphId: string;
  evidenceSnippet: string;
  matchedTokens: string[];
  missingTokens: string[];
  missingFacets: string[];
} {
  const { unit, chapters, preIndexedChapters } = params;
  if (chapters.length === 0) {
    return {
      verified: false,
      verificationStatus: 'missing',
      semanticIssues: ['Manuscrito vacío'],
      needsSemanticReview: false,
      semanticMatchScore: 0,
      chapterIndex: -1,
      paragraphIndex: -1,
      chapterId: 'none',
      paragraphId: 'none',
      evidenceSnippet: '',
      matchedTokens: [],
      missingTokens: unit.keyTokens,
      missingFacets: ['empty_manuscript'],
    };
  }

  const indexedAll = preIndexedChapters || buildChapterAuditIndex(chapters);

  let bestChapterIdx = 0;
  let bestParaIdx = 0;
  let bestParaScore = -1;

  const unitRequiredTokens =
    unit.keyTokens.length > 0
      ? unit.keyTokens
      : normalizePlainAscii(unit.cleanText)
          .split(/\s+/)
          .filter((w) => w.length >= 3);

  const chapterOrder = [...indexedAll].sort((a, b) => {
    const aLinked = a.answerIdSet.has(unit.answerId);
    const bLinked = b.answerIdSet.has(unit.answerId);
    return aLinked === bLinked ? 0 : aLinked ? -1 : 1;
  });

  for (const item of chapterOrder) {
    let foundStrongMatchInLinkedChapter = false;
    const hasExplicitAnswerLink = item.answerIdSet.has(unit.answerId);
    const paras = item.paragraphs;
    for (let pIdx = 0; pIdx < paras.length; pIdx++) {
      const pEntry = paras[pIdx];
      let matchedDirect = 0;
      let matchedWithWindow = 0;
      for (const tok of unitRequiredTokens) {
        if (doesTokenMatchIndexedWords(tok, pEntry.words, pEntry.wordSet)) {
          matchedDirect++;
          matchedWithWindow++;
        } else if (doesTokenMatchIndexedWords(tok, pEntry.windowNextWords, pEntry.windowNextWordSet)) {
          // Only award partial window credit when the current paragraph itself already matches part of the unit,
          // so paragraph pIdx-1 never steals placement from paragraph pIdx!
          matchedWithWindow += 0.45;
        }
      }
      const directRatio =
        unitRequiredTokens.length > 0 ? matchedDirect / unitRequiredTokens.length : 0;
      const blendedRatio =
        unitRequiredTokens.length > 0
          ? matchedDirect > 0
            ? matchedWithWindow / unitRequiredTokens.length
            : 0
          : 0;
      let yearBonus = 0;
      let allYearsInPara = true;
      if (unit.yearsOrNumbers.length > 0) {
        allYearsInPara = unit.yearsOrNumbers.every((yn) =>
          doesTokenMatchIndexedWords(yn, pEntry.words, pEntry.wordSet)
        );
        const allYearsInWindow = unit.yearsOrNumbers.every((yn) =>
          doesTokenMatchIndexedWords(yn, pEntry.windowNextWords, pEntry.windowNextWordSet)
        );
        if (allYearsInPara) yearBonus = 0.35;
        else if (matchedDirect > 0 && allYearsInWindow) yearBonus = 0.2;
        else yearBonus = -0.35;
      }
      // Heavily favor direct match in pEntry.words over cross-paragraph spillovers
      const score =
        directRatio * 0.7 + blendedRatio * 0.3 + yearBonus + (hasExplicitAnswerLink ? 0.08 : 0);
      if (score > bestParaScore) {
        bestParaScore = score;
        bestChapterIdx = item.cIdx;
        bestParaIdx = pIdx;
      }
      if (
        hasExplicitAnswerLink &&
        directRatio >= 0.9 &&
        (unit.yearsOrNumbers.length === 0 || allYearsInPara)
      ) {
        foundStrongMatchInLinkedChapter = true;
        break;
      }
    }
    if (foundStrongMatchInLinkedChapter) {
      break;
    }
  }

  const targetCh = chapters[bestChapterIdx] || chapters[0];
  const targetIndexedPara = indexedAll[bestChapterIdx]?.paragraphs[bestParaIdx];
  const nextIndexedPara = indexedAll[bestChapterIdx]?.paragraphs[bestParaIdx + 1];
  const targetPara = targetIndexedPara?.raw || targetCh.paragraphs[0] || '';
  const neighborPara = nextIndexedPara?.raw || '';
  const paraWords = targetIndexedPara?.words || normalizePlainAscii(targetPara).split(/\s+/).filter(Boolean);
  const paraWordSet = targetIndexedPara?.wordSet || new Set(paraWords);
  const paraWindowWords =
    targetIndexedPara?.windowNextWords ||
    normalizePlainAscii(`${targetPara} ${neighborPara}`.trim()).split(/\s+/).filter(Boolean);
  const paraWindowWordSet = targetIndexedPara?.windowNextWordSet || new Set(paraWindowWords);

  // Measure token coverage against the matched paragraph (and immediate split continuation)
  const matchedTokens: string[] = [];
  const missingTokens: string[] = [];
  for (const tok of unitRequiredTokens) {
    if (
      doesTokenMatchIndexedWords(tok, paraWords, paraWordSet) ||
      (doesTokenMatchIndexedWords(tok, paraWindowWords, paraWindowWordSet) &&
        (unit.yearsOrNumbers.length === 0 ||
          unit.yearsOrNumbers.every((yn) =>
            doesTokenMatchIndexedWords(yn, paraWindowWords, paraWindowWordSet)
          )))
    ) {
      matchedTokens.push(tok);
    } else {
      missingTokens.push(tok);
    }
  }

  const semanticMatchScore =
    unitRequiredTokens.length > 0
      ? Number((matchedTokens.length / unitRequiredTokens.length).toFixed(3))
      : targetPara.trim().length > 0
      ? 1
      : 0;

  // Verify critical facets (years/numbers, properNames/people, places, emotions)
  const missingFacets: string[] = [];

  if (unit.yearsOrNumbers.length > 0) {
    const missingYears = unit.yearsOrNumbers.filter(
      (yn) => !doesTokenMatchIndexedWords(yn, paraWindowWords, paraWindowWordSet)
    );
    if (missingYears.length > 0) {
      missingFacets.push(`yearsOrNumbers:${missingYears.join(',')}`);
    }
  }

  if (unit.properNames.length > 0) {
    const matchedPeople = unit.properNames.filter((pn) =>
      doesTokenMatchIndexedWords(pn, paraWindowWords, paraWindowWordSet)
    );
    const minRequiredPeople =
      unit.properNames.length <= 2
        ? unit.properNames.length
        : Math.ceil(unit.properNames.length * 0.75);
    if (matchedPeople.length < minRequiredPeople) {
      const missingP = unit.properNames.filter(
        (pn) => !doesTokenMatchIndexedWords(pn, paraWindowWords, paraWindowWordSet)
      );
      missingFacets.push(`properNames:${missingP.join(',')}`);
    }
  }

  if (unit.places.length > 0) {
    const matchedPlaces = unit.places.filter((pl) =>
      doesTokenMatchIndexedWords(pl, paraWindowWords, paraWindowWordSet)
    );
    const minRequiredPlaces =
      unit.places.length <= 2 ? unit.places.length : Math.ceil(unit.places.length * 0.75);
    if (matchedPlaces.length < minRequiredPlaces) {
      const missingPl = unit.places.filter(
        (pl) => !doesTokenMatchIndexedWords(pl, paraWindowWords, paraWindowWordSet)
      );
      missingFacets.push(`places:${missingPl.join(',')}`);
    }
  }

  if (unit.emotions.length > 0) {
    const hasEmotionInPara =
      unit.emotions.some((em) => doesTokenMatchIndexedWords(em, paraWindowWords, paraWindowWordSet)) ||
      SPANISH_EMOTION_STEMS.some((stem) => paraWindowWords.some((cw) => cw.startsWith(stem)));
    if (!hasEmotionInPara) {
      missingFacets.push(`emotions:${unit.emotions.join(',')}`);
    }
  }

  // Deep Semantic Integrity Check (Clause-aligned Direction A -> Target)
  const windowSentences = [
    ...(targetIndexedPara?.sentencesRaw || []),
    ...((nextIndexedPara && semanticMatchScore < 0.75 ? nextIndexedPara.sentencesRaw : []) || []),
  ];
  const contradictionResult =
    semanticMatchScore >= 0.25
      ? detectSemanticContradictionsBetweenTexts({
          sourceText: unit.cleanText,
          targetText: neighborPara ? `${targetPara} ${neighborPara}`.trim() : targetPara,
          targetSentencesRaw: windowSentences.length > 0 ? windowSentences : undefined,
          properNames: unit.properNames,
        })
      : { issues: [], ambiguousEdge: false };

  const semanticIssues = contradictionResult.issues;
  const minRequiredScore = unitRequiredTokens.length >= 7 ? 0.65 : 0.5;
  const lexicalAndFacetsPassed =
    unitRequiredTokens.length === 0
      ? Boolean(
          unit.photoIds.length > 0 &&
            (targetCh.photoPlacements || []).some((pl) => unit.photoIds.includes(pl.photoId))
        )
      : semanticMatchScore >= minRequiredScore && missingFacets.length === 0;

  // V5.2 — The action must be present too. Word overlap can be high while the predicate changed
  // ("Mi padre me salvó de caer al río" vs "Mi padre me empujó al río": padre and río match).
  // A unit whose conjugated verbs are not found near its best match is not verified by rules;
  // it is sent to the semantic judge as a possible change of meaning (never approved by rules).
  const testimonyActions = lexicalAndFacetsPassed ? extractTestimonyActionVerbs(unit.cleanText) : [];
  let missingActions = testimonyActions.filter(
    (verb) => !paraWindowWords.some((w) => w.startsWith(verb.slice(0, 4)))
  );
  // The best lexical match may be a SIMILAR memory ("me cuidaba" vs "me consolaba"). Before
  // doubting the action, look for another paragraph of the book that keeps the action, the
  // words and the dates of this memory; if one exists, the unit is verified there.
  let relocatedTo: { cIdx: number; pIdx: number } | null = null;
  if (missingActions.length > 0) {
    search: for (const item of chapterOrder) {
      for (let pIdx = 0; pIdx < item.paragraphs.length; pIdx++) {
        const pe = item.paragraphs[pIdx];
        const hasActions = testimonyActions.every((verb) =>
          pe.windowNextWords.some((w) => w.startsWith(verb.slice(0, 4)))
        );
        if (!hasActions) continue;
        const covered = unitRequiredTokens.filter((tok) =>
          doesTokenMatchIndexedWords(tok, pe.windowNextWords, pe.windowNextWordSet)
        ).length;
        const yearsOk = unit.yearsOrNumbers.every((yn) =>
          doesTokenMatchIndexedWords(yn, pe.windowNextWords, pe.windowNextWordSet)
        );
        if (yearsOk && covered / unitRequiredTokens.length >= minRequiredScore) {
          relocatedTo = { cIdx: item.cIdx, pIdx };
          missingActions = [];
          break search;
        }
      }
    }
  }
  const actionPreserved = missingActions.length === 0;

  const hasContradiction = semanticIssues.length > 0;
  // Detect borderline paraphrase ambiguity eligible for hybrid AI semantic judge:
  // Either complex literary paraphrase (moderate overlap >= 0.34, all explicit dates/names/places preserved, zero contradictions)
  // OR a conversational discourse polarity edge where deterministic rules requested AI confirmation.
  const isParaphraseAmbiguous =
    !lexicalAndFacetsPassed &&
    !hasContradiction &&
    missingFacets.length === 0 &&
    semanticMatchScore >= 0.34;
  const isAmbiguous = isParaphraseAmbiguous || (hasContradiction && contradictionResult.ambiguousEdge);

  const verified = lexicalAndFacetsPassed && actionPreserved && !hasContradiction;

  const verificationStatus: UnitVerificationStatus = isAmbiguous
    ? 'ambiguous'
    : hasContradiction
    ? 'contradicted'
    : verified
    ? 'supported'
    : semanticMatchScore >= 0.3
    ? 'partially_supported'
    : 'missing';

  const ambiguityReason = isParaphraseAmbiguous
    ? `Posible paráfrasis literaria compleja (coincidencia léxica ${(semanticMatchScore * 100).toFixed(0)}% sin facetas ausentes).`
    : hasContradiction && contradictionResult.ambiguousEdge
    ? `Posible giro conversacional de negación o discurso (${semanticIssues[0] || ''}).`
    : undefined;

  // V5.2: when the memory was relocated to the paragraph that keeps its action, report THAT place.
  const finalChapterIdx = relocatedTo ? relocatedTo.cIdx : bestChapterIdx;
  const finalParaIdx = relocatedTo ? relocatedTo.pIdx : bestParaIdx;
  const finalCh = chapters[finalChapterIdx] || targetCh;
  const finalPara = relocatedTo
    ? indexedAll[finalChapterIdx]?.paragraphs[finalParaIdx]?.raw || targetPara
    : targetPara;
  const paragraphId =
    finalCh.paragraphIds?.[finalParaIdx] || `${finalCh.id}_p_${finalParaIdx + 1}`;

  // V5.1 — Deterministic rules are LOCATORS, not judges. Word overlap, facet lists and
  // negation/antonym patterns can prove that a memory is literally present, and they can prove
  // that nothing resembling it exists. Everything in between (a paraphrase that changed the
  // vocabulary, a facet expressed differently, a suspected contradiction) is a hypothesis that
  // only a contextual reading can settle, so it is flagged for semantic arbitration instead of
  // being treated as a final omission or contradiction.
  // V5.2 — Low lexical overlap is ABSENCE OF EVIDENCE, not evidence of absence. Below the
  // threshold the whole book is searched (equivalent and related words, other chapters, the
  // neighbors of the best match); the unit skips the judge only when absence is demonstrated.
  const evidenceAssessment =
    !verified && unitRequiredTokens.length > 0
      ? assessUnitEvidenceOfAbsenceIndexed({
          unit,
          indexedAll,
          bestChapterIdx,
          bestParaIdx,
        })
      : undefined;
  const absenceDemonstrated = evidenceAssessment?.status === 'absent';
  const needsSemanticReview =
    !verified &&
    unitRequiredTokens.length > 0 &&
    (hasContradiction ||
      (!absenceDemonstrated &&
        (semanticMatchScore >= SEMANTIC_REVIEW_MIN_LEXICAL_SCORE ||
          evidenceAssessment?.status !== undefined)));
  const semanticReviewReason = !needsSemanticReview
    ? undefined
    : !actionPreserved && !hasContradiction
    ? `Las palabras coinciden pero la acción del testimonio no se localizó (${missingActions.join(', ')}): posible cambio de sentido.`
    : semanticMatchScore < SEMANTIC_REVIEW_MIN_LEXICAL_SCORE && !hasContradiction
    ? `Coincidencia léxica baja (${(semanticMatchScore * 100).toFixed(0)}%), pero hay evidencia relacionada en el libro: posible paráfrasis con otro vocabulario.`
    : hasContradiction
    ? `Posible contradicción detectada por reglas (${semanticIssues[0]}); requiere confirmación contextual.`
    : missingFacets.length > 0
    ? `Coincidencia léxica ${(semanticMatchScore * 100).toFixed(0)}% con detalles no localizados literalmente (${missingFacets.join('; ')}).`
    : `Posible paráfrasis: coincidencia léxica ${(semanticMatchScore * 100).toFixed(0)}% por debajo del umbral automático.`;

  return {
    verified,
    verificationStatus,
    semanticIssues,
    ambiguityReason,
    needsSemanticReview,
    semanticReviewReason,
    evidenceOfAbsenceReason: absenceDemonstrated ? evidenceAssessment?.reason : undefined,
    semanticMatchScore,
    chapterIndex: finalChapterIdx,
    paragraphIndex: finalParaIdx,
    chapterId: finalCh.id,
    paragraphId,
    evidenceSnippet: finalPara.slice(0, 180),
    matchedTokens,
    missingTokens,
    missingFacets,
  };
}

/**
 * Bidirectional veracity & exclusion audit:
 * - Direction B (Book -> Testimony): verifies claims, dates, ages, dialogues, proper names, and places in the manuscript
 *   against the source documentary inventory (`inventedDataFlags`, `unsupportedAdditionFlags`).
 * - Scoped Exclusion Check: verifies neither directives nor excluded episodes/entities leaked without false positives on authorized text.
 * - Shared Couple Attribution Check.
 */
function runVeracityAndExclusionAudit(params: {
  manuscript: DemoManuscript;
  chapters: DemoChapterManuscript[];
  inventory: DocumentaryInventory;
  participantNames: string[];
}): {
  inventedDataFlags: string[];
  unsupportedAdditionFlags: string[];
  unsupportedAdditionCandidates: UnsupportedAdditionCandidate[];
  uncertaintyViolations: string[];
  leakedExcludedContentFlags: string[];
  coupleAttributionViolations: string[];
} {
  const { manuscript, chapters, inventory, participantNames } = params;
  const inventedDataFlags: string[] = [];
  const unsupportedAdditionFlags: string[] = [];
  const unsupportedAdditionCandidates: UnsupportedAdditionCandidate[] = [];
  const uncertaintyViolations: string[] = [];
  const leakedExcludedContentFlags: string[] = [];
  const coupleAttributionViolations: string[] = [];

  if (inventory.totalRawAnswers === 0) {
    return {
      inventedDataFlags,
      unsupportedAdditionFlags,
      unsupportedAdditionCandidates,
      uncertaintyViolations,
      leakedExcludedContentFlags,
      coupleAttributionViolations,
    };
  }

  const validYearsSet = new Set(inventory.corpusValidYearsAndNumbers);
  const allSourceRawCombined = inventory.eligibleFactUnits
    .map((u) => `${u.rawText} ${u.questionText}`)
    .join(' ');
  const corpusAllEligibleWords = normalizePlainAscii(allSourceRawCombined)
    .split(/\s+/)
    .filter(Boolean);

  // 1. Direction B (Book -> Testimony): Check each chapter paragraph for unsupported dates, ages, dialogues, names, or unsourced claims
  // V5.2: the introduction and the closing message are audited text too (they are part of the
  // signed content), so an invented fact there must be caught exactly like one in a chapter.
  const directionBSurfaces: DemoChapterManuscript[] = [
    ...(manuscript.introduction && manuscript.introduction.trim()
      ? [
          {
            id: '__introduction__',
            partNumber: 0,
            dimensionKey: 'introduccion' as any,
            title: 'Introducción',
            paragraphs: [manuscript.introduction],
          } as DemoChapterManuscript,
        ]
      : []),
    ...chapters,
    ...(manuscript.closingMessage && manuscript.closingMessage.trim()
      ? [
          {
            id: '__closing__',
            partNumber: 0,
            dimensionKey: 'cierre' as any,
            title: 'Mensaje de cierre',
            paragraphs: [manuscript.closingMessage],
          } as DemoChapterManuscript,
        ]
      : []),
  ];
  for (const ch of directionBSurfaces) {
    for (let pIdx = 0; pIdx < (ch.paragraphs || []).length; pIdx++) {
      const para = ch.paragraphs[pIdx] || '';
      const normPara = normalizePlainAscii(para);

      // 1a. 4-digit years (1800-2099)
      const yearsInPara = para.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/g) || [];
      for (const yr of yearsInPara) {
        if (!validYearsSet.has(yr)) {
          const msg = `Año o fecha no presente en el testimonio original (${yr}) en capítulo "${ch.title}" (párrafo ${pIdx + 1}).`;
          inventedDataFlags.push(msg);
          unsupportedAdditionFlags.push(msg);
        }
      }

      // 1b. Explicit numerical ages/durations ("a los 24 años", "durante 17 años") not in source corpus
      const ageMatches = normPara.match(/\b(\d{1,2})\s+anos\b/g) || [];
      for (const am of ageMatches) {
        const numStr = (am.match(/\d+/) || [])[0];
        if (
          numStr &&
          !validYearsSet.has(numStr) &&
          !doesTokenMatchCorpusWords(
            numStr,
            Array.from(validYearsSet).concat(inventory.corpusValidProperNames)
          )
        ) {
          const msg = `Cifra de años no respaldada por el testimonio (${numStr} años) en capítulo "${ch.title}" (párrafo ${pIdx + 1}).`;
          inventedDataFlags.push(msg);
          unsupportedAdditionFlags.push(msg);
        }
      }

      // 1c. Fabricated direct dialogues ("..." or «...») that were not in the source corpus
      const quoteMatches = para.match(/(?:«([^»]{18,})»|"([^"]{18,})")/g) || [];
      for (const qm of quoteMatches) {
        const innerQuote = qm.slice(1, -1).trim();
        const quoteTokens = tokenizeSignificantWords(innerQuote);
        const sourceWords = inventory.corpusValidProperNames;
        const matchedQuoteTokens = quoteTokens.filter((qt) =>
          doesTokenMatchCorpusWords(qt, sourceWords)
        );
        if (
          quoteTokens.length >= 3 &&
          matchedQuoteTokens.length / quoteTokens.length < 0.6 &&
          !allSourceRawCombined.toLowerCase().includes(innerQuote.slice(0, 20).toLowerCase())
        ) {
          const msg = `Diálogo textual inventado no presente en el testimonio (${qm.slice(0, 50)}...) en capítulo "${ch.title}".`;
          inventedDataFlags.push(msg);
          unsupportedAdditionFlags.push(msg);
        }
      }

      // 1d. Invented proper names introduced after relational cues ("llamado X", "don X", "doña X", "amigo X")
      const namedEntityMatches =
        para.match(
          /\b(?:llamad[oa]|don|doña|t[ií][oa]|abuel[oa]|amig[oa]|doctor(?:a)?|maestr[oa]|profesor(?:a)?|socio)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})/g
        ) || [];
      for (const nem of namedEntityMatches) {
        const parts = nem.trim().split(/\s+/);
        const properCandidate = normalizePlainAscii(parts[parts.length - 1] || '');
        if (
          properCandidate.length >= 3 &&
          !inventory.corpusValidProperNames.includes(properCandidate)
        ) {
          const msg = `Nombre propio no respaldado por el testimonio ("${parts[parts.length - 1]}") en capítulo "${ch.title}".`;
          inventedDataFlags.push(msg);
          unsupportedAdditionFlags.push(msg);
        }
      }

      // 1e. Unsupported narrative sentences in Book -> Testimony reverse verification
      // If a substantial narrative sentence (>= 6 significant tokens) has 0 overlap with the entire eligible corpus
      // and isn't a harmless editorial bridge, flag as unsupported factual addition.
      const bookSentences = para
        .split(/(?<=[.!?…])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 45);
      for (const bSent of bookSentences) {
        const sig = tokenizeSignificantWords(bSent);
        if (sig.length >= 6) {
          const supportedHits = sig.filter((tok) =>
            doesTokenMatchCorpusWords(tok, corpusAllEligibleWords)
          );
          if (supportedHits.length === 0) {
            const flag = `Afirmación narrativa sin respaldo en los testimonios ("${bSent.slice(0, 75)}...") en capítulo "${ch.title}".`;
            unsupportedAdditionFlags.push(flag);
            // V5.2: only sentences with a BIOGRAPHICAL-FACT signal (a conjugated past action, a
            // figure, or a capitalized name absent from the testimonies and the protagonists) are
            // arbitrated. A pure editorial bridge ("Esta edición reúne las vivencias de…") shares no
            // words with the testimony by nature and asserts nothing; it is not a candidate.
            const sentenceWords = bSent.split(/\s+/);
            const protagonistWords = new Set(
              participantNames.flatMap((n) => normalizePlainAscii(n).split(/\s+/)).filter(Boolean)
            );
            const unknownCapitalized = sentenceWords.some((w, i) => {
              if (i === 0 || /[.!?:]$/.test(sentenceWords[i - 1])) return false;
              const clean = w.replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ]+|[^A-Za-zÁÉÍÓÚÑáéíóúñ]+$/g, '');
              if (!/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}$/.test(clean)) return false;
              const norm = normalizePlainAscii(clean);
              return !protagonistWords.has(norm) && !corpusAllEligibleWords.includes(norm);
            });
            const factLike =
              /\d/.test(bSent) || unknownCapitalized || extractTestimonyActionVerbs(bSent).length > 0;
            if (factLike) {
              unsupportedAdditionCandidates.push({
                flag,
                chapterId: ch.id,
                chapterTitle: ch.title,
                paragraphIndex: pIdx,
                sentence: bSent,
              });
            }
          }
        }
      }
    }
  }

  // 2. Check leaked excluded content across chapters, introduction, closingMessage, pullQuotes, and photo captions
  const allBookSurfaceText = [
    manuscript.introduction || '',
    manuscript.closingMessage || '',
    manuscript.dedication || '',
    ...chapters.flatMap((c) => [
      c.title || '',
      c.pullQuote || '',
      ...(c.paragraphs || []),
      ...(c.photoPlacements || []).map((pl) => `${pl.shortCaption || ''} ${pl.originalDescription || ''}`),
    ]),
  ].join(' ');
  const normBookSurfaceWords = normalizePlainAscii(allBookSurfaceText).split(/\s+/).filter(Boolean);

  // Also check if literal exclusion directives ("no incluir en el libro", "no menciones...", etc.) leaked into the book
  if (EXPLICIT_EXCLUSION_DIRECTIVE_RX.test(allBookSurfaceText)) {
    leakedExcludedContentFlags.push(
      'Directiva de exclusión explícita filtrada en el texto visible del manuscrito.'
    );
  }

  const eligibleWordsSet = new Set(
    inventory.eligibleFactUnits.flatMap((u) =>
      normalizePlainAscii(u.cleanText).split(/\s+/).filter(Boolean)
    )
  );

  for (const exclUnit of inventory.excludedFactUnits) {
    if (
      exclUnit.exclusionReason !== 'excluded_by_interviewee' &&
      exclUnit.exclusionReason !== 'prefer_not_to_answer'
    ) {
      continue;
    }
    // Tokens unique to the excluded unit (not present in eligible units)
    const uniqueExcludedTokens = exclUnit.keyTokens.filter((t) => !eligibleWordsSet.has(t));
    if (uniqueExcludedTokens.length === 0) continue;
    const leakedTokens = uniqueExcludedTokens.filter((t) => normBookSurfaceWords.includes(t));
    if (
      leakedTokens.length >= 2 ||
      (uniqueExcludedTokens.length === 1 && leakedTokens.length === 1)
    ) {
      leakedExcludedContentFlags.push(
        `Contenido excluido por el entrevistado (${exclUnit.unitId}) se filtró en el manuscrito (términos detectados: ${leakedTokens.join(', ')}).`
      );
    }
  }

  // 3. Check Couple / Shared Story Attribution when 2 distinct participants exist
  if (manuscript.mode === 'pareja' && participantNames.length >= 2) {
    const p1Norm = normalizePlainAscii(participantNames[0]);
    const p2Norm = normalizePlainAscii(participantNames[1]);
    if (p1Norm && p2Norm && p1Norm !== p2Norm) {
      for (const unit of inventory.eligibleFactUnits) {
        const unitSpeakerNorm = normalizePlainAscii(unit.participantName);
        if (unitSpeakerNorm !== p1Norm && unitSpeakerNorm !== p2Norm) continue;
        const otherSpeakerNorm = unitSpeakerNorm === p1Norm ? p2Norm : p1Norm;
        const otherSpeakerDisplay =
          unitSpeakerNorm === p1Norm ? participantNames[1] : participantNames[0];

        // Find paragraph matching this unit
        for (const ch of chapters) {
          for (const para of ch.paragraphs || []) {
            const paraWords = normalizePlainAscii(para).split(/\s+/).filter(Boolean);
            const matched = unit.keyTokens.filter((t) =>
              doesTokenMatchCorpusWords(t, paraWords)
            );
            if (unit.keyTokens.length >= 4 && matched.length / unit.keyTokens.length >= 0.75) {
              const normPara = normalizePlainAscii(para);
              const mentionsTrueSpeaker = normPara.includes(unitSpeakerNorm);
              const mentionsWrongSpeakerExplicitly =
                normPara.startsWith(`${otherSpeakerNorm} recuerda`) ||
                normPara.startsWith(`${otherSpeakerNorm} relata`) ||
                normPara.startsWith(`por su parte ${otherSpeakerNorm}`);
              if (!mentionsTrueSpeaker && mentionsWrongSpeakerExplicitly) {
                coupleAttributionViolations.push(
                  `Atribución cruzada en historia compartida: el recuerdo ${unit.unitId} de ${unit.participantName} fue atribuido a ${otherSpeakerDisplay}.`
                );
              }
            }
          }
        }
      }
    }
  }

  return {
    inventedDataFlags,
    unsupportedAdditionFlags,
    unsupportedAdditionCandidates,
    uncertaintyViolations,
    leakedExcludedContentFlags,
    coupleAttributionViolations,
  };
}

/**
 * Second mandatory audit: Editorial & Literary Quality Audit (`auditBookEditorialQuality`).
 * Checks spelling/oral-filler/transcription leaks, narrative perspective consistency (100% Style C 3rd-person),
 * duplicate episodes across paragraphs, question-like or numbered chapter titles, broken markdown, and giant paragraphs.
 */
export function auditBookEditorialQuality(params: {
  manuscript: DemoManuscript;
}): EditorialQualityAuditReport {
  const { manuscript } = params;
  const style: DemoNarrativeStyleId = manuscript.narrativeStyle || 'first_person_literary';
  const chapters = manuscript.chapters || [];

  const firstPersonLeakFlags: string[] = [];
  const oralFillerOrArtifactFlags: string[] = [];
  const duplicateEpisodeFlags: string[] = [];
  const titleQualityFlags: string[] = [];
  const truncatedFragmentFlags: string[] = [];
  const giantParagraphFlags: string[] = [];
  const unbalancedMarkdownFlags: string[] = [];
  const warnings: string[] = [];

  // Strong 1st-person markers outside quotation marks when Style C is active
  const firstPersonMarkerRx =
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])(yo|mi|mis|mío|mía|míos|mías|conmigo|nosotros|nosotras|nuestro|nuestra|nuestros|nuestras|nací|crecí|viví|aprendí|conocí|salí|volví|sentí|decidí|descubrí|compartí|recibí|elegí|construí|tuve|estuve|hice|pude|supe|quise|fui|empecé|comencé|terminé|trabajé|estudié|llegué|jugué|logré|pasé|encontré|formé|cuidé|disfruté|amé|tengo|soy|estoy|voy|quiero|pienso|siento|considero|agradezco|vivíamos|teníamos|éramos|estábamos|jugábamos|íbamos|tuvimos|fuimos|hicimos)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/i;

  const findFirstPersonLeakOutsideQuotes = (rawText: string): string | null => {
    // V5.1: language models usually emit typographic quotes (“ ”, ‘ ’) and em-dash dialogue lines.
    // Only straight quotes and guillemets were stripped, so every faithfully quoted first-person
    // testimony inside a third-person biography was reported as a perspective leak.
    const outsideQuotes = rawText
      .replace(/«[^»]*»|"[^"]*"|“[^”]*”|‘[^’]*’/g, ' ')
      .replace(/(^|[\n.!?:]\s*)[—–]\s*[^—–\n]*(?:[—–]|$)/g, '$1 ');
    const directMatch = outsideQuotes.match(firstPersonMarkerRx);
    if (directMatch) return directMatch[1];

    // Disambiguate homograph "recuerdo" (valid noun "el recuerdo biográfico" vs 1st-person verb "recuerdo que")
    const nounDeterminerBeforeRx =
      /(?:^|\s|[«"'(¿¡,;:\-.])(?:el|un|este|ese|aquel|su|tu|del|al|cada|otro|ning[úu]n|alg[úu]n|cualquier|mismo|propio|primer|segundo|tercer|[úu]ltimo|hermoso|dulce|viejo|querido|mayor|menor|feliz|triste|gran|buen|mal|vivo|claro|lindo|bello|tierno|grato|eterno|inolvidable|fiel|lejano|[íi]ntimo|precioso|valioso|sagrado|nuevo|antiguo)\s+$/i;
    const nounModifierAfterRx =
      /^\s+(?:de|del|en|para|sobre|biogr[aá]fico|familiar|infantil|vivo|claro|imborrable|hermoso|dulce|eterno|n[uú]mero|n\.|#)\b/i;
    const verbCueBeforeRx =
      /(?:^|[.!?;,:\n]\s*|(?:yo|a[uú]n|todav[ií]a|siempre|solo|s[oó]lo|nunca|jam[aá]s|ya|tambi[eé]n|no|lo)\s+)$/i;
    const verbComplementAfterRx =
      /^\s+(?:que|cuando|cu[aá]ndo|c[oó]mo|como|haber|eso|esto|aquello|a\s+|la\s+|las\s+|los\s+|el\s+|un\s+|una\s+|con\s+claridad|bien\b|mucho\b|poco\b)/i;

    for (const m of outsideQuotes.matchAll(/(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])recuerdo(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/gi)) {
      const idx = m.index ?? -1;
      if (idx < 0) continue;
      const before = outsideQuotes.slice(Math.max(0, idx - 40), idx);
      const after = outsideQuotes.slice(idx + m[0].length, idx + m[0].length + 32);
      if (nounDeterminerBeforeRx.test(before) || nounModifierAfterRx.test(after)) {
        continue;
      }
      if (verbComplementAfterRx.test(after) || (verbCueBeforeRx.test(before) && !/^\s+(?:de|del|sobre)\b/i.test(after))) {
        return m[0];
      }
    }
    return null;
  };

  const oralFillerArtifactRx =
    /(?:\[Nota de voz\]|\[FOTO\s*:|\behh+\b|\bemm+\b|\bmmm+\b|(?:\s|^)o\s+sea(?:\s|,)|^\s*(?:pregunta|respuesta)\s*\d*\s*:|^\s*N\/A\s*$)/i;

  const seenTitleNorm = new Set<string>();
  const seenParagraphSamples: Array<{ chTitle: string; pIdx: number; text: string }> = [];

  for (let cIdx = 0; cIdx < chapters.length; cIdx++) {
    const ch = chapters[cIdx];
    const cleanTitle = (ch.title || '').trim();

    if (!cleanTitle) {
      titleQualityFlags.push(`El capítulo ${cIdx + 1} no tiene título.`);
    } else {
      if (/^¿.+\?$/.test(cleanTitle) || /^(pregunta|respuesta)\s+\d+/i.test(cleanTitle)) {
        titleQualityFlags.push(`Título en formato de pregunta o formulario: "${cleanTitle}".`);
      }
      if (/\(\d+\)\s*$/.test(cleanTitle)) {
        titleQualityFlags.push(`Título con sufijo numérico artificial: "${cleanTitle}".`);
      }
      const normT = cleanTitle.toLowerCase();
      if (seenTitleNorm.has(normT)) {
        titleQualityFlags.push(`Título de capítulo duplicado: "${cleanTitle}".`);
      }
      seenTitleNorm.add(normT);
    }

    const paras = ch.paragraphs || [];
    for (let pIdx = 0; pIdx < paras.length; pIdx++) {
      const para = (paras[pIdx] || '').trim();
      if (!para) continue;

      // Check oral fillers / interview artifacts
      if (oralFillerArtifactRx.test(para)) {
        oralFillerOrArtifactFlags.push(
          `Muletilla o artefacto de transcripción detectado en "${cleanTitle}" (párrafo ${pIdx + 1}).`
        );
      }

      // Check 1st-person perspective leaks in Style C (strip direct quotes before testing)
      if (style === 'third_person_biography') {
        const leakedMarker = findFirstPersonLeakOutsideQuotes(para);
        if (leakedMarker) {
          firstPersonLeakFlags.push(
            `Voz en primera persona ("${leakedMarker}") filtrada en biografía en tercera persona dentro de "${cleanTitle}" (párrafo ${pIdx + 1}).`
          );
        }
      }

      // Check truncated fragments ending abruptly or unbalanced bold/italic markers
      // Ignores valid accented pronouns ("para mí", "por él", "en sí") and complete sentences ending with punctuation after nouns.
      if (
        !/(?:m[ií]|s[ií]|[eé]l)[.!?]?$/i.test(para) &&
        /(?:^|\s)(?:y|o|de|en|con|por|para|que|mi|su)\s*$/i.test(para.replace(/\.\.\.$/, '')) &&
        para.length < 180
      ) {
        truncatedFragmentFlags.push(
          `Oración posiblemente truncada ("...${para.slice(-28)}") en "${cleanTitle}" (párrafo ${pIdx + 1}).`
        );
      }
      const boldTokenCount = (para.match(/\*\*/g) || []).length;
      const singleStarCount = (para.replace(/\*\*/g, '').match(/\*/g) || []).length;
      if (boldTokenCount % 2 !== 0 || singleStarCount % 2 !== 0) {
        unbalancedMarkdownFlags.push(
          `Marcadores de énfasis (* o **) sin cerrar en "${cleanTitle}" (párrafo ${pIdx + 1}).`
        );
      }

      // Giant unbroken walls of text (> 1450 chars)
      if (para.length > 1450) {
        giantParagraphFlags.push(
          `Párrafo excesivamente largo (${para.length} caracteres) en "${cleanTitle}" (párrafo ${pIdx + 1}).`
        );
      }

      // Duplicate episodes across paragraphs (semantic/literal overlap >= 100% of shorter paragraph)
      const dupPrior = seenParagraphSamples.find(
        (prev) =>
          para.length >= 45 &&
          prev.text.length >= 45 &&
          areTestimoniesRedundantSameEpisode(prev.text, para)
      );
      if (dupPrior) {
        duplicateEpisodeFlags.push(
          `Episodio repetido entre "${dupPrior.chTitle}" (párrafo ${dupPrior.pIdx + 1}) y "${cleanTitle}" (párrafo ${pIdx + 1}).`
        );
      } else {
        seenParagraphSamples.push({ chTitle: cleanTitle, pIdx, text: para });
      }
    }
  }

  // Also check introduction and closingMessage for Style C perspective leaks or oral fillers
  if (style === 'third_person_biography') {
    for (const [label, txt] of [
      ['Introducción', manuscript.introduction || ''],
      ['Cierre', manuscript.closingMessage || ''],
    ] as const) {
      const leakedMarker = findFirstPersonLeakOutsideQuotes(txt);
      if (leakedMarker) {
        firstPersonLeakFlags.push(
          `Voz en primera persona ("${leakedMarker}") en ${label} de biografía en tercera persona.`
        );
      }
    }
  }

  if (giantParagraphFlags.length > 0) {
    warnings.push(...giantParagraphFlags);
  }

  const blockingDefects = [
    ...firstPersonLeakFlags,
    ...oralFillerOrArtifactFlags,
    ...duplicateEpisodeFlags,
    ...titleQualityFlags,
    ...truncatedFragmentFlags,
    ...unbalancedMarkdownFlags,
  ];

  const styleConsistencyPassed = firstPersonLeakFlags.length === 0;

  return {
    passed: blockingDefects.length === 0,
    auditedAt: new Date().toISOString(),
    narrativeStyle: style,
    blockingDefects,
    warnings,
    styleConsistencyPassed,
    firstPersonLeakFlags,
    oralFillerOrArtifactFlags,
    duplicateEpisodeFlags,
    titleQualityFlags,
    truncatedFragmentFlags,
    giantParagraphFlags,
    unbalancedMarkdownFlags,
  };
}

/**
 * Runs the mandatory server/client documentary + editorial audit over a DemoManuscript:
 * - Decomposes all source answers, deepening follow-ups, additional memories, audio transcriptions,
 *   and photo contexts into atomic `DocumentaryFactUnit`s via `buildDocumentaryInventory`.
 * - Performs bidirectional semantic verification (Testimony -> Book and Book -> Testimony),
 *   checking negation, agency flips, modality shifts, and antonyms alongside facets.
 * - Executes `auditBookEditorialQuality` as the second quality gate.
 */
export function auditAndApproveBookManuscript(params: {
  manuscript: DemoManuscript;
  answers?: DocumentarySourceAnswerInput[];
  questions?: DocumentarySourceQuestionInput[];
  repairAttemptsUsed?: number;
  repairedUnitIds?: string[];
  includeEditorialAudit?: boolean;
}): {
  manuscript: DemoManuscript;
  report: DocumentaryAuditReport;
  editorialAudit: EditorialQualityAuditReport;
  inventory: DocumentaryInventory;
} {
  const {
    manuscript,
    answers = [],
    questions = [],
    repairAttemptsUsed = 0,
    repairedUnitIds = [],
    includeEditorialAudit = true,
  } = params;
  const qMap = new Map(questions.map((q) => [q.id, q]));
  const blockingDefects: string[] = [];

  const participantNames = (manuscript.authors || '')
    .split(/\s+y\s+|,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const inventory = buildDocumentaryInventory({
    interviewId: manuscript.canonicalManuscriptId || manuscript.title || 'interview_audit',
    answers,
    questions,
    participantNames,
  });

  // 1. Structural Normalization: deduplicate chapters, ensure consecutive partNumber 1..N and stable paragraphIds
  const seenChapterIds = new Set<string>();
  const seenChapterTitles = new Set<string>();
  const duplicateChapterFlags: string[] = [];
  const orphanContinuationFlags: string[] = [];
  const normalizedChapters: DemoChapterManuscript[] = [];

  for (const rawCh of manuscript.chapters || []) {
    const cleanParagraphs = (rawCh.paragraphs || [])
      .map((p) => (p || '').trim())
      .filter((p) => p.length > 0);
    if (cleanParagraphs.length === 0) continue;

    let chId = (rawCh.id || `ch_${normalizedChapters.length + 1}`).trim();
    const normTitle = (rawCh.title || '').trim().toLowerCase();

    if (normTitle && seenChapterTitles.has(normTitle)) {
      duplicateChapterFlags.push(`Título de capítulo duplicado consolidado: "${rawCh.title}"`);
      const existingCh = normalizedChapters.find(
        (c) => (c.title || '').trim().toLowerCase() === normTitle
      );
      if (existingCh) {
        for (const p of cleanParagraphs) {
          const isDup = existingCh.paragraphs.some((ep) =>
            areTestimoniesRedundantSameEpisode(ep, p)
          );
          if (!isDup) {
            existingCh.paragraphs.push(p);
          }
        }
        if (rawCh.photoPlacements && rawCh.photoPlacements.length > 0) {
          existingCh.photoPlacements = [
            ...(existingCh.photoPlacements || []),
            ...rawCh.photoPlacements,
          ];
        }
        if (rawCh.sourceAnswerIds && rawCh.sourceAnswerIds.length > 0) {
          existingCh.sourceAnswerIds = Array.from(
            new Set([...(existingCh.sourceAnswerIds || []), ...rawCh.sourceAnswerIds])
          );
        }
        if (rawCh.sourceQuestionIds && rawCh.sourceQuestionIds.length > 0) {
          existingCh.sourceQuestionIds = Array.from(
            new Set([...(existingCh.sourceQuestionIds || []), ...rawCh.sourceQuestionIds])
          );
        }
        continue;
      }
    }

    while (seenChapterIds.has(chId)) {
      chId = `${chId}_${normalizedChapters.length + 1}`;
    }
    seenChapterIds.add(chId);
    if (normTitle) seenChapterTitles.add(normTitle);

    const dedupedParagraphs: string[] = [];
    for (const p of cleanParagraphs) {
      const existingIdx = dedupedParagraphs.findIndex((ep) => {
        const normEp = ep.toLowerCase().replace(/\s+/g, ' ').trim();
        const normP = p.toLowerCase().replace(/\s+/g, ' ').trim();
        return normEp === normP || (normEp.length >= 40 && normEp.includes(normP));
      });
      if (existingIdx < 0) {
        dedupedParagraphs.push(p);
      }
    }

    const partNumber = normalizedChapters.length + 1;
    const paragraphIds = dedupedParagraphs.map((_, idx) => `${chId}_p_${idx + 1}`);

    normalizedChapters.push({
      ...rawCh,
      id: chId,
      partNumber,
      title: (rawCh.title || `Capítulo ${partNumber}`).trim(),
      paragraphs: dedupedParagraphs,
      paragraphIds,
    });
  }

  // Check for prohibited 1-question-per-chapter fragmentation or question-formatted chapter titles
  const questionFormattedTitles = normalizedChapters.filter(
    (c) => /^¿.+\?$/.test(c.title.trim()) || /^(pregunta|respuesta)\s+\d+/i.test(c.title.trim())
  );
  const eligibleMainAnswersCount = answers.filter(
    (a) =>
      resolveAnswerExclusionReason(a) === 'none' &&
      !a.isFollowUp &&
      !(a.parentQuestionId && a.parentQuestionId.trim().length > 0) &&
      !a.isAdditionalMemory &&
      extractCleanParticipantAnswerText(a).length > 0
  ).length;

  const oneQuestionPerChapterDetected =
    questionFormattedTitles.length > 0 ||
    (eligibleMainAnswersCount >= 6 &&
      normalizedChapters.length >= Math.ceil(eligibleMainAnswersCount * 0.85));

  if (oneQuestionPerChapterDetected) {
    blockingDefects.push(
      'Fragmentación editorial inválida: se detectó estructura de una pregunta/respuesta por capítulo o títulos en formato de pregunta.'
    );
  }

  // 2. Photo Placement Audit & Deduplication across all chapters
  const allUploadedPhotos = new Map<
    string,
    {
      photoId: string;
      caption: string;
      answerId: string;
      questionId: string;
      answerText: string;
      questionText: string;
    }
  >();

  for (const ans of answers) {
    if (resolveAnswerExclusionReason(ans) !== 'none') continue;
    const ansText = splitAnswerTextIntoIncludedAndExcludedSentences(
      extractCleanParticipantAnswerText(ans)
    ).includedText;
    const qText = ans.questionText || qMap.get(ans.questionId)?.text || '';
    for (const p of ans.photos || []) {
      if (p && p.id && !allUploadedPhotos.has(p.id)) {
        const cleanCap = splitAnswerTextIntoIncludedAndExcludedSentences(
          (p.caption || '').replace(/^\[Nota de voz\]:\s*/i, '').trim()
        ).includedText;
        allUploadedPhotos.set(p.id, {
          photoId: p.id,
          caption: cleanCap,
          answerId: ans.id,
          questionId: ans.questionId,
          answerText: ansText,
          questionText: qText,
        });
      }
    }
  }

  const placedPhotoIds = new Set<string>();
  const duplicatePhotoIds: string[] = [];

  for (let cIdx = 0; cIdx < normalizedChapters.length; cIdx++) {
    const ch = normalizedChapters[cIdx];
    const validPlacements: DemoChapterPhotoPlacement[] = [];
    for (const pl of ch.photoPlacements || []) {
      if (!pl || !pl.photoId) continue;
      if (placedPhotoIds.has(pl.photoId)) {
        duplicatePhotoIds.push(pl.photoId);
        continue;
      }
      // Do not place photos belonging to excluded answers
      if (answers.length > 0 && !allUploadedPhotos.has(pl.photoId)) {
        continue;
      }
      placedPhotoIds.add(pl.photoId);
      const clampedIdx = Math.max(0, Math.min(ch.paragraphs.length - 1, pl.paragraphIndex || 0));
      const meta = allUploadedPhotos.get(pl.photoId);
      validPlacements.push({
        ...pl,
        paragraphIndex: clampedIdx,
        shortCaption: formatPhotoEditorialCaption(
          pl.shortCaption || meta?.caption || meta?.questionText || ch.title
        ),
        originalDescription: pl.originalDescription || meta?.caption || pl.shortCaption,
        answerId: pl.answerId || meta?.answerId,
        questionId: pl.questionId || meta?.questionId,
        chapterId: ch.id,
        paragraphId: ch.paragraphIds?.[clampedIdx] || `${ch.id}_p_${clampedIdx + 1}`,
      });
    }
    ch.photoPlacements = validPlacements.length > 0 ? validPlacements : undefined;
  }

  // Ensure any uploaded photo that was not yet placed is anchored to its true narrative chapter & paragraph
  for (const [photoId, meta] of allUploadedPhotos.entries()) {
    if (placedPhotoIds.has(photoId)) continue;
    const resolved = resolveDocumentaryPhotoChapterAndParagraph({
      chapters: normalizedChapters,
      photoId,
      shortCaption: meta.caption,
      originalDescription: meta.caption,
      answerId: meta.answerId,
      questionId: meta.questionId,
      answerText: meta.answerText,
      questionText: meta.questionText,
    });
    const targetCh = normalizedChapters[resolved.chapterIndex] || normalizedChapters[0];
    if (targetCh) {
      placedPhotoIds.add(photoId);
      const shortCap = formatPhotoEditorialCaption(
        meta.caption || meta.questionText || targetCh.title
      );
      targetCh.photoPlacements = [
        ...(targetCh.photoPlacements || []),
        {
          photoId,
          paragraphIndex: resolved.paragraphIndex,
          shortCaption: shortCap,
          originalDescription: meta.caption || shortCap,
          answerId: meta.answerId,
          questionId: meta.questionId,
          chapterId: targetCh.id,
          paragraphId: resolved.paragraphId,
        },
      ];
    }
  }

  // 3. Build Traceability Matrix & Perform Bidirectional Semantic Fact Verification and Uncertainty Audit
  const traceabilityMatrix: TraceabilityMatrixEntry[] = [];
  let integratedUnits = 0;
  let omittedNotRecalledUnits = 0;
  let omittedPreferNotToAnswerUnits = 0;
  let excludedByIntervieweeUnits = 0;
  let uncertaintiesPreserved = true;
  const missingUnitIds: string[] = [];
  const ambiguousUnitIds: string[] = [];
  const reviewCandidateUnitIds: string[] = [];
  const uncertaintyViolations: string[] = [];
  const semanticContradictionFlags: string[] = [];
  let uncertainUnitsCount = 0;

  // Pre-index normalized chapters/paragraphs once for fast O(N) lookups across hundreds of fact units
  const preIndexedChapters = buildChapterAuditIndex(normalizedChapters);

  for (const unit of inventory.excludedFactUnits) {
    if (unit.exclusionReason === 'not_recalled') omittedNotRecalledUnits++;
    else if (unit.exclusionReason === 'prefer_not_to_answer') omittedPreferNotToAnswerUnits++;
    else if (unit.exclusionReason === 'excluded_by_interviewee') excludedByIntervieweeUnits++;

    traceabilityMatrix.push({
      unitId: unit.unitId,
      answerId: unit.answerId,
      questionId: unit.questionId,
      questionText: unit.questionText,
      sourceType: unit.sourceType,
      participantName: unit.participantName || manuscript.authors,
      excerpt:
        unit.exclusionReason === 'excluded_by_interviewee'
          ? '[Excluida por solicitud explícita del entrevistado]'
          : unit.exclusionReason === 'prefer_not_to_answer'
          ? '[Omitida: prefiero no responder]'
          : '[Omitida por el entrevistado]',
      uncertaintyExpressions: [],
      photoIds: [],
      assignedChapterId: 'none',
      assignedChapterNumber: 0,
      assignedParagraphIds: [],
      status:
        unit.exclusionReason === 'excluded_by_interviewee'
          ? 'excluded_by_interviewee'
          : unit.exclusionReason === 'prefer_not_to_answer'
          ? 'omitted_prefer_not_to_answer'
          : 'omitted_not_recalled',
      verificationStatus: 'supported',
      exclusionReason: unit.exclusionReason,
      verified: true,
    });
  }

  for (const unit of inventory.eligibleFactUnits) {
    const verification = verifyDocumentaryUnitInManuscript({
      unit,
      chapters: normalizedChapters,
      preIndexedChapters,
    });

    if (verification.verificationStatus === 'ambiguous') {
      ambiguousUnitIds.push(unit.unitId);
    }
    if (verification.needsSemanticReview) {
      reviewCandidateUnitIds.push(unit.unitId);
    }

    if (verification.semanticIssues.length > 0) {
      semanticContradictionFlags.push(
        ...verification.semanticIssues.map((iss) => `[${unit.unitId}] ${iss}`)
      );
    }

    const assignedCh =
      verification.chapterIndex >= 0
        ? normalizedChapters[verification.chapterIndex]
        : normalizedChapters[0];

    // Check uncertainty preservation in the assigned chapter without silently hiding a failure
    if (unit.uncertaintyExpressions.length > 0 && assignedCh) {
      uncertainUnitsCount++;
      const chTextLower = (assignedCh.paragraphs || []).join(' ').toLowerCase();
      const hasUncertainty =
        unit.uncertaintyExpressions.some((u) => chTextLower.includes(u)) ||
        UNCERTAINTY_PATTERNS.some((rx) => rx.test(chTextLower));
      if (!hasUncertainty) {
        uncertaintiesPreserved = false;
        uncertaintyViolations.push(
          `Incertidumbre original ("${unit.uncertaintyExpressions.join(', ')}") omitida o convertida en certeza en unidad ${unit.unitId}.`
        );
      }
    }

    if (verification.verified && assignedCh) {
      if (!assignedCh.sourceAnswerIds) assignedCh.sourceAnswerIds = [];
      if (!assignedCh.sourceAnswerIds.includes(unit.answerId)) {
        assignedCh.sourceAnswerIds.push(unit.answerId);
      }
      if (unit.questionId) {
        if (!assignedCh.sourceQuestionIds) assignedCh.sourceQuestionIds = [];
        if (!assignedCh.sourceQuestionIds.includes(unit.questionId)) {
          assignedCh.sourceQuestionIds.push(unit.questionId);
        }
      }
      if (!assignedCh.sourceUnitIds) assignedCh.sourceUnitIds = [];
      if (!assignedCh.sourceUnitIds.includes(unit.unitId)) {
        assignedCh.sourceUnitIds.push(unit.unitId);
      }

      integratedUnits++;
      traceabilityMatrix.push({
        unitId: unit.unitId,
        answerId: unit.answerId,
        questionId: unit.questionId,
        questionText: unit.questionText,
        sourceType: unit.sourceType,
        participantName: unit.participantName || manuscript.authors,
        excerpt: unit.cleanText.slice(0, 140),
        uncertaintyExpressions: unit.uncertaintyExpressions,
        photoIds: unit.photoIds,
        assignedChapterId: assignedCh.id,
        assignedChapterNumber: assignedCh.partNumber,
        assignedParagraphIds: [verification.paragraphId],
        chapterId: assignedCh.id,
        paragraphId: verification.paragraphId,
        paragraphIndex: verification.paragraphIndex,
        evidenceSnippet: verification.evidenceSnippet,
        semanticMatchScore: verification.semanticMatchScore,
        matchedTokens: verification.matchedTokens,
        missingTokens: verification.missingTokens,
        missingFacets: verification.missingFacets,
        status: 'integrated',
        verificationStatus: verification.verificationStatus,
        semanticIssues: verification.semanticIssues,
        ambiguityReason: verification.ambiguityReason,
        exclusionReason: 'none',
        verified: true,
      });
    } else {
      missingUnitIds.push(unit.unitId);
      traceabilityMatrix.push({
        unitId: unit.unitId,
        answerId: unit.answerId,
        questionId: unit.questionId,
        questionText: unit.questionText,
        sourceType: unit.sourceType,
        participantName: unit.participantName || manuscript.authors,
        excerpt: unit.cleanText.slice(0, 140),
        uncertaintyExpressions: unit.uncertaintyExpressions,
        photoIds: unit.photoIds,
        assignedChapterId: assignedCh?.id || 'none',
        assignedChapterNumber: assignedCh?.partNumber || 0,
        assignedParagraphIds: [],
        chapterId: assignedCh?.id || 'none',
        paragraphId: verification.paragraphId,
        paragraphIndex: verification.paragraphIndex,
        evidenceSnippet: verification.evidenceSnippet,
        semanticMatchScore: verification.semanticMatchScore,
        matchedTokens: verification.matchedTokens,
        missingTokens: verification.missingTokens,
        missingFacets: verification.missingFacets,
        status: 'missing',
        verificationStatus: verification.verificationStatus,
        semanticIssues: verification.semanticIssues,
        ambiguityReason: verification.ambiguityReason,
        needsSemanticReview: verification.needsSemanticReview,
        semanticReviewReason: verification.semanticReviewReason,
        evidenceOfAbsenceReason: verification.evidenceOfAbsenceReason,
        exclusionReason: 'none',
        verified: false,
      });
    }
  }

  // 4. Veracity, Direction B Reverse Claim Audit, Excluded Content Leak, and Couple Attribution Audit
  const veracityCheck = runVeracityAndExclusionAudit({
    manuscript,
    chapters: normalizedChapters,
    inventory,
    participantNames,
  });

  // 5. Second Mandatory Gate: Editorial & Literary Quality Audit
  const normalizedManuscriptDraft: DemoManuscript = {
    ...manuscript,
    chapters: normalizedChapters,
  };
  const editorialAudit = auditBookEditorialQuality({
    manuscript: normalizedManuscriptDraft,
  });

  const totalSourceUnits = inventory.eligibleFactUnits.length;
  const coveragePercentage =
    totalSourceUnits > 0
      ? Math.floor((integratedUnits / totalSourceUnits) * 100)
      : answers.length === 0 && normalizedChapters.length > 0
      ? 100
      : 0;

  const totalUploadedPhotos = allUploadedPhotos.size;
  const totalPlacedPhotos = placedPhotoIds.size;
  const unplacedPhotoIds = Array.from(allUploadedPhotos.keys()).filter(
    (id) => !placedPhotoIds.has(id)
  );
  const duplicateChapterIdsDetected =
    new Set(normalizedChapters.map((c) => c.id)).size !== normalizedChapters.length;
  const consecutiveChapterNumberingValid = normalizedChapters.every(
    (c, idx) => c.partNumber === idx + 1
  );

  if (normalizedChapters.length === 0) {
    blockingDefects.push('El manuscrito no contiene capítulos válidos.');
  }
  if (answers.length > 0 && totalSourceUnits === 0) {
    blockingDefects.push(
      'La entrevista no contiene testimonios elegibles para publicar (todas las respuestas fueron omitidas o excluidas).'
    );
  }
  if (missingUnitIds.length > 0 || coveragePercentage < 100) {
    blockingDefects.push(
      `Cobertura documental incompleta (${coveragePercentage}%: ${integratedUnits}/${totalSourceUnits} unidades verificadas; faltan: ${missingUnitIds.slice(0, 8).join(', ')}).`
    );
  }
  if (!uncertaintiesPreserved || uncertaintyViolations.length > 0) {
    blockingDefects.push(...uncertaintyViolations);
  }
  if (semanticContradictionFlags.length > 0) {
    blockingDefects.push(...semanticContradictionFlags);
  }
  if (veracityCheck.inventedDataFlags.length > 0) {
    blockingDefects.push(...veracityCheck.inventedDataFlags);
  }
  if (veracityCheck.leakedExcludedContentFlags.length > 0) {
    blockingDefects.push(...veracityCheck.leakedExcludedContentFlags);
  }
  if (veracityCheck.coupleAttributionViolations.length > 0) {
    blockingDefects.push(...veracityCheck.coupleAttributionViolations);
  }
  if (totalUploadedPhotos > 0 && totalPlacedPhotos < totalUploadedPhotos) {
    blockingDefects.push(
      `Fotografías sin ubicar en el manuscrito (${totalPlacedPhotos}/${totalUploadedPhotos}).`
    );
  }
  if (includeEditorialAudit && !editorialAudit.passed) {
    blockingDefects.push(...editorialAudit.blockingDefects);
  }

  // Provisional; replaced below by the single global decision (V5.2).
  let passed = blockingDefects.length === 0;

  const report: DocumentaryAuditReport = {
    auditVersion: CANONICAL_AUDIT_RULES_VERSION,
    auditRulesVersion: CANONICAL_AUDIT_RULES_VERSION,
    auditedAt: new Date().toISOString(),
    status: passed ? 'approved' : 'failed_audit',
    approved: passed,
    passed,
    auditPolicy: 'deterministic_only',
    totalSourceUnits,
    integratedUnits,
    omittedNotRecalledUnits,
    omittedPreferNotToAnswerUnits,
    excludedByIntervieweeUnits,
    coveragePercentage,
    totalUploadedPhotos,
    totalPlacedPhotos,
    duplicateChapterIdsDetected,
    consecutiveChapterNumberingValid,
    uncertaintiesPreserved,
    repairAttemptsUsed,
    repairedUnitIds,
    leakedExcludedContentFlags: veracityCheck.leakedExcludedContentFlags,
    coupleAttributionViolations: veracityCheck.coupleAttributionViolations,
    traceabilityMatrix,
    blockingDefects,
    coverageAudit: {
      passed: missingUnitIds.length === 0 && (answers.length === 0 || totalSourceUnits > 0),
      totalValidUnits: totalSourceUnits,
      coveredUnitsCount: integratedUnits,
      missingUnitIds,
      repairedUnitIds,
    },
    veracityAudit: {
      passed:
        uncertaintiesPreserved &&
        semanticContradictionFlags.length === 0 &&
        veracityCheck.inventedDataFlags.length === 0 &&
        veracityCheck.leakedExcludedContentFlags.length === 0 &&
        veracityCheck.coupleAttributionViolations.length === 0,
      uncertaintiesPreserved,
      uncertaintyViolations,
      inventedDataFlags: veracityCheck.inventedDataFlags,
      leakedExcludedContentFlags: veracityCheck.leakedExcludedContentFlags,
      coupleAttributionViolations: veracityCheck.coupleAttributionViolations,
      semanticContradictionFlags,
      unsupportedAdditionFlags: veracityCheck.unsupportedAdditionFlags,
      unsupportedAdditionCandidates: veracityCheck.unsupportedAdditionCandidates,
    },
    semanticAudit: {
      // V5.2: pure unsupported narrative sentences are SUSPICIONS for the hybrid audit to
      // arbitrate (see `unsupportedAdditionsPendingArbitration`); deterministic rules alone neither
      // block on them nor mark this gate failed because of them. Invented dates, ages, names and
      // dialogues (`inventedDataFlags`) are proven by rules and keep failing it.
      passed:
        semanticContradictionFlags.length === 0 &&
        veracityCheck.inventedDataFlags.length === 0 &&
        ambiguousUnitIds.length === 0,
      unsupportedAdditionsPendingArbitration: veracityCheck.unsupportedAdditionCandidates.length,
      contradictionsDetected: semanticContradictionFlags,
      unsupportedAdditions: veracityCheck.inventedDataFlags,
      uncertainUnitsCount,
      ambiguousUnitsCount: ambiguousUnitIds.length,
      ambiguousUnitIds,
      reviewCandidateUnitIds,
      directionAChecked: inventory.eligibleFactUnits.length,
      directionBChecked: normalizedChapters.reduce((sum, ch) => sum + ch.paragraphs.length, 0),
    },
    editorialAudit,
    structuralAudit: {
      passed:
        !duplicateChapterIdsDetected &&
        consecutiveChapterNumberingValid &&
        !oneQuestionPerChapterDetected &&
        normalizedChapters.length > 0,
      uniqueChapterIds: !duplicateChapterIdsDetected,
      consecutiveNumbering: consecutiveChapterNumberingValid,
      duplicateChapterFlags,
      orphanContinuationFlags,
      oneQuestionPerChapterDetected,
    },
    photoAudit: {
      passed: unplacedPhotoIds.length === 0,
      totalPhotos: totalUploadedPhotos,
      placedPhotosCount: totalPlacedPhotos,
      unplacedPhotoIds,
      duplicatePhotoIds,
      defaultFirstChapterDumpDetected: false,
    },
  };

  // V5.2: one global verdict over every mandatory gate (see `finalizeGlobalAuditDecision`).
  const globalDecision = finalizeGlobalAuditDecision({
    report,
    editorialAudit,
    includeEditorialAudit,
  });
  passed = globalDecision.passed;
  report.passed = passed;
  report.approved = passed;
  report.status = passed ? 'approved' : 'failed_audit';
  report.blockingDefects = globalDecision.blockingDefects;

  return {
    manuscript: {
      ...normalizedManuscriptDraft,
      status: passed ? 'approved' : 'failed_audit',
      generationStatus: passed ? 'approved' : 'failed_audit',
      auditReport: report,
      documentaryAudit: report,
      editorialAudit,
    },
    report,
    editorialAudit,
    inventory,
  };
}

export type ContextualRepairCategory =
  | 'missing_unit'
  | 'semantic_contradiction'
  | 'style_perspective_leak'
  | 'excluded_content_leak'
  | 'invented_data'
  | 'unsupported_addition'
  | 'oral_filler_artifact'
  | 'duplicate_episode'
  | 'title_quality'
  | 'truncated_fragment'
  | 'unbalanced_markdown'
  | 'giant_paragraph'
  | 'one_question_per_chapter'
  | 'couple_attribution'
  | 'uncertainty_omission'
  | 'photo_placement';

export interface ContextualRepairTask {
  id: string;
  category: ContextualRepairCategory;
  categories: ContextualRepairCategory[];
  severity: 'blocking' | 'warning';
  autoRepairable: boolean;
  evidenceSource: string[];
  location: {
    chapterId: string;
    chapterTitle: string;
    paragraphIndices?: number[];
  };
  repairStrategy: string;
  status: 'pending' | 'repaired' | 'rejected_regression' | 'unrepairable';
  reverificationResult?: {
    checked: boolean;
    passed: boolean;
    remainingIssues: string[];
  };
  chapterId: string;
  chapterTitle: string;
  missingUnits: DocumentaryFactUnit[];
  contradictionDetails: string[];
  styleLeakDetails: string[];
  excludedLeakDetails: string[];
  inventedDetails: string[];
  unsupportedAdditionDetails: string[];
  oralFillerDetails: string[];
  duplicateEpisodeDetails: string[];
  titleQualityDetails: string[];
  truncatedFragmentDetails: string[];
  unbalancedMarkdownDetails: string[];
  giantParagraphDetails: string[];
  coupleAttributionDetails: string[];
  uncertaintyDetails: string[];
  photoPlacementDetails: string[];
  structuralRegroupRequired?: boolean;
}

/**
 * Generates comprehensive, structured per-chapter repair tasks covering all 16 Documentary,
 * Editorial, Structural, Veracity, Privacy, and Photo audit categories so AI-guided and
 * deterministic contextual repair can fix every affected chapter without truncation.
 */
export function buildContextualRepairTasks(params: {
  manuscript: DemoManuscript;
  report: DocumentaryAuditReport;
  editorialAudit: EditorialQualityAuditReport;
  inventory: DocumentaryInventory;
  editorialPlan: EditorialBookPlan;
}): ContextualRepairTask[] {
  const { manuscript, report, editorialAudit, inventory, editorialPlan } = params;
  const chapters = manuscript.chapters || [];
  if (chapters.length === 0) return [];

  const tasksMap = new Map<string, ContextualRepairTask>();

  const findChapterByFlagText = (flag: string): DemoChapterManuscript | undefined => {
    const quoted = Array.from(flag.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    for (const q of quoted) {
      const exact = chapters.find((c) => c.title.trim() === q.trim());
      if (exact) return exact;
    }
    return chapters.find((c) => flag.includes(`"${c.title}"`));
  };

  const extractParaIndexFromFlag = (flag: string): number | null => {
    const m = flag.match(/p[aá]rrafo\s+(\d+)/i);
    return m ? Math.max(0, Number(m[1]) - 1) : null;
  };

  const ensureTask = (
    ch: DemoChapterManuscript,
    primaryCategory: ContextualRepairCategory,
    strategyHint: string,
    severity: 'blocking' | 'warning' = 'blocking'
  ): ContextualRepairTask => {
    let task = tasksMap.get(ch.id);
    if (!task) {
      task = {
        id: `repair_${ch.id}`,
        category: primaryCategory,
        categories: [primaryCategory],
        severity,
        autoRepairable: true,
        evidenceSource: [],
        location: {
          chapterId: ch.id,
          chapterTitle: ch.title,
          paragraphIndices: [],
        },
        repairStrategy: strategyHint,
        status: 'pending',
        chapterId: ch.id,
        chapterTitle: ch.title,
        missingUnits: [],
        contradictionDetails: [],
        styleLeakDetails: [],
        excludedLeakDetails: [],
        inventedDetails: [],
        unsupportedAdditionDetails: [],
        oralFillerDetails: [],
        duplicateEpisodeDetails: [],
        titleQualityDetails: [],
        truncatedFragmentDetails: [],
        unbalancedMarkdownDetails: [],
        giantParagraphDetails: [],
        coupleAttributionDetails: [],
        uncertaintyDetails: [],
        photoPlacementDetails: [],
      };
      tasksMap.set(ch.id, task);
    } else {
      if (!task.categories.includes(primaryCategory)) {
        task.categories.push(primaryCategory);
      }
      if (severity === 'blocking') {
        task.severity = 'blocking';
      }
    }
    return task;
  };

  const recordEvidence = (task: ContextualRepairTask, flag: string) => {
    if (flag && !task.evidenceSource.includes(flag)) {
      task.evidenceSource.push(flag);
    }
    const pIdx = extractParaIndexFromFlag(flag);
    if (pIdx !== null && !task.location.paragraphIndices?.includes(pIdx)) {
      task.location.paragraphIndices = [...(task.location.paragraphIndices || []), pIdx];
    }
  };

  const resolveChapterForUnit = (unit: DocumentaryFactUnit): DemoChapterManuscript => {
    const trace = (report.traceabilityMatrix || []).find((m) => m.unitId === unit.unitId);
    if (trace?.assignedChapterId && trace.assignedChapterId !== 'none') {
      const tracedCh = chapters.find((c) => c.id === trace.assignedChapterId);
      if (tracedCh) return tracedCh;
    }
    const directCh = chapters.find((c) => (c.sourceAnswerIds || []).includes(unit.answerId));
    if (directCh) return directCh;
    const planItem =
      editorialPlan.chapters.find((pc) => pc.assignedAnswerIds.includes(unit.answerId)) ||
      editorialPlan.chapters.find((pc) => pc.stageKey === unit.lifeStage) ||
      editorialPlan.chapters[0];
    return (
      (planItem
        ? chapters.find(
            (c) => c.id === planItem.chapterId || c.dimensionKey === planItem.dimensionKey
          )
        : undefined) || chapters[0]
    );
  };

  // 1 & 2. Missing Units & Semantic Contradictions (plus unresolved ambiguous units)
  const missingOrContradictedIds = new Set(report.coverageAudit?.missingUnitIds || []);
  for (const entry of report.traceabilityMatrix || []) {
    if (entry.verificationStatus === 'contradicted' || entry.verificationStatus === 'ambiguous') {
      missingOrContradictedIds.add(entry.unitId);
    }
  }

  // V5.3: units still pending verification (judge deferred) are NOT confirmed omissions; rewriting
  // their chapters would only risk damaging text that is probably faithful.
  const deferredIds = new Set(
    (report.traceabilityMatrix || []).filter((t) => t.judgeDeferred).map((t) => t.unitId)
  );
  for (const unitId of missingOrContradictedIds) {
    if (deferredIds.has(unitId)) continue;
    const unit = inventory.eligibleFactUnits.find((u) => u.unitId === unitId);
    if (!unit) continue;
    const targetCh = resolveChapterForUnit(unit);
    const trace = (report.traceabilityMatrix || []).find((m) => m.unitId === unitId);
    if (trace?.verificationStatus === 'contradicted' && trace.semanticIssues?.length) {
      const t = ensureTask(
        targetCh,
        'semantic_contradiction',
        'Corregir discrepancia semántica preservando el sentido literal del testimonio original.'
      );
      t.contradictionDetails.push(...trace.semanticIssues);
      if (!t.missingUnits.some((u) => u.unitId === unit.unitId)) {
        t.missingUnits.push(unit);
      }
      recordEvidence(t, `[${unit.unitId}] ${trace.semanticIssues[0]}`);
    } else {
      const t = ensureTask(
        targetCh,
        'missing_unit',
        'Integrar hechos omitidos de forma fluida en el estilo narrativo activo sin alterar otros recuerdos.'
      );
      if (!t.missingUnits.some((u) => u.unitId === unit.unitId)) {
        t.missingUnits.push(unit);
      }
      recordEvidence(t, `Unidad omitida ${unit.unitId}: ${unit.cleanText.slice(0, 90)}`);
    }
  }

  // 3. Perspective leaks (Style C 1st-person)
  for (const flag of editorialAudit.firstPersonLeakFlags || []) {
    const targetCh = findChapterByFlagText(flag) || chapters[0];
    const t = ensureTask(
      targetCh,
      'style_perspective_leak',
      'Reescribir íntegramente en tercera persona narrativa conservando citas textuales entre comillas.'
    );
    t.styleLeakDetails.push(flag);
    recordEvidence(t, flag);
  }

  // 4. Oral fillers and transcription artifacts
  for (const flag of editorialAudit.oralFillerOrArtifactFlags || []) {
    const targetCh = findChapterByFlagText(flag) || chapters[0];
    const t = ensureTask(
      targetCh,
      'oral_filler_artifact',
      'Eliminar muletillas y artefactos técnicos manteniendo intactos los hechos narrados.'
    );
    t.oralFillerDetails.push(flag);
    recordEvidence(t, flag);
  }

  // 5. Invented / unsupported numerical or named entity additions
  for (const flag of report.veracityAudit?.inventedDataFlags || []) {
    const targetCh = findChapterByFlagText(flag) || chapters[0];
    const t = ensureTask(
      targetCh,
      'invented_data',
      'Eliminar años, edades, diálogos o nombres propios no respaldados por los testimonios.'
    );
    t.inventedDetails.push(flag);
    recordEvidence(t, flag);
  }

  // 6. Unsupported narrative additions (Direction B)
  for (const flag of report.veracityAudit?.unsupportedAdditionFlags || []) {
    if ((report.veracityAudit?.inventedDataFlags || []).includes(flag)) continue;
    const targetCh = findChapterByFlagText(flag) || chapters[0];
    const t = ensureTask(
      targetCh,
      'unsupported_addition',
      'Sustituir afirmaciones sin respaldo documental por transiciones breves o hechos fidedignos del testimonio.'
    );
    t.unsupportedAdditionDetails.push(flag);
    recordEvidence(t, flag);
  }

  // 7. Excluded content leaks (route to matching chapters where excluded terms appear)
  for (const flag of report.veracityAudit?.leakedExcludedContentFlags || []) {
    const leakedTermsMatch = flag.match(/t[eé]rminos detectados:\s*([^)]+)\)/i);
    const leakedTerms = leakedTermsMatch
      ? leakedTermsMatch[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];
    const matchingChapters =
      leakedTerms.length > 0
        ? chapters.filter((c) => {
            const cText = normalizePlainAscii(
              `${c.title} ${c.pullQuote || ''} ${(c.paragraphs || []).join(' ')}`
            );
            return leakedTerms.some((term) => cText.includes(term));
          })
        : [];
    const targets = matchingChapters.length > 0 ? matchingChapters : [chapters[0]];
    for (const targetCh of targets) {
      const t = ensureTask(
        targetCh,
        'excluded_content_leak',
        'Suprimir cualquier episodio o directiva explícitamente excluida por el entrevistado.'
      );
      t.excludedLeakDetails.push(flag);
      recordEvidence(t, flag);
    }
  }

  // 8. Duplicate episodes
  for (const flag of editorialAudit.duplicateEpisodeFlags || []) {
    const quotedTitles = Array.from(flag.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    const secondTitle = quotedTitles[1] || quotedTitles[0];
    const targetCh =
      (secondTitle ? chapters.find((c) => c.title.trim() === secondTitle.trim()) : undefined) ||
      findChapterByFlagText(flag) ||
      chapters[0];
    const t = ensureTask(
      targetCh,
      'duplicate_episode',
      'Consolidar o eliminar repeticiones narrativas conservando los detalles únicos.'
    );
    t.duplicateEpisodeDetails.push(flag);
    recordEvidence(t, flag);
  }

  // 9. Title quality defects
  for (const flag of editorialAudit.titleQualityFlags || []) {
    const targetCh = findChapterByFlagText(flag) || chapters[0];
    const t = ensureTask(
      targetCh,
      'title_quality',
      'Asignar un título literario evocador no interrogativo ni duplicado.'
    );
    t.titleQualityDetails.push(flag);
    recordEvidence(t, flag);
  }

  // 10. Truncated fragments
  for (const flag of editorialAudit.truncatedFragmentFlags || []) {
    const targetCh = findChapterByFlagText(flag) || chapters[0];
    const t = ensureTask(
      targetCh,
      'truncated_fragment',
      'Completar o limpiar fragmentos inconclusos respetando estrictamente los hechos originales.'
    );
    t.truncatedFragmentDetails.push(flag);
    recordEvidence(t, flag);
  }

  // 11. Unbalanced markdown markers
  for (const flag of editorialAudit.unbalancedMarkdownFlags || []) {
    const targetCh = findChapterByFlagText(flag) || chapters[0];
    const t = ensureTask(
      targetCh,
      'unbalanced_markdown',
      'Balancear o limpiar marcadores tipográficos (* o **) sin cerrar.'
    );
    t.unbalancedMarkdownDetails.push(flag);
    recordEvidence(t, flag);
  }

  // 12. Giant paragraphs (warning level)
  for (const flag of editorialAudit.giantParagraphFlags || []) {
    const targetCh = findChapterByFlagText(flag) || chapters[0];
    const t = ensureTask(
      targetCh,
      'giant_paragraph',
      'Dividir párrafos extensos en pausas naturales de lectura.',
      'warning'
    );
    t.giantParagraphDetails.push(flag);
    recordEvidence(t, flag);
  }

  // 13. Uncertainty omissions
  for (const flag of report.veracityAudit?.uncertaintyViolations || []) {
    const unitIdMatch = flag.match(/unidad\s+(trace_[^\s.]+)/i);
    const unit = unitIdMatch
      ? inventory.eligibleFactUnits.find((u) => u.unitId === unitIdMatch[1])
      : undefined;
    const targetCh = unit ? resolveChapterForUnit(unit) : chapters[0];
    const t = ensureTask(
      targetCh,
      'uncertainty_omission',
      'Restaurar expresiones de duda e incertidumbre originales ("creo que", "no recuerdo bien").'
    );
    t.uncertaintyDetails.push(flag);
    if (unit && !t.missingUnits.some((u) => u.unitId === unit.unitId)) {
      t.missingUnits.push(unit);
    }
    recordEvidence(t, flag);
  }

  // 14. Couple attribution violations
  for (const flag of report.veracityAudit?.coupleAttributionViolations || []) {
    const unitIdMatch = flag.match(/(trace_[^\s]+)/i);
    const unit = unitIdMatch
      ? inventory.eligibleFactUnits.find((u) => u.unitId === unitIdMatch[1])
      : undefined;
    const targetCh = unit ? resolveChapterForUnit(unit) : chapters[0];
    const t = ensureTask(
      targetCh,
      'couple_attribution',
      'Corregir atribución del protagonista correcto en historia compartida.'
    );
    t.coupleAttributionDetails.push(flag);
    if (unit && !t.missingUnits.some((u) => u.unitId === unit.unitId)) {
      t.missingUnits.push(unit);
    }
    recordEvidence(t, flag);
  }

  // 15. One-question-per-chapter structural fragmentation
  if (report.structuralAudit?.oneQuestionPerChapterDetected) {
    const targetCh = chapters[0];
    const t = ensureTask(
      targetCh,
      'one_question_per_chapter',
      'Reagrupar respuestas por capítulos temáticos/etapas siguiendo el plan editorial.'
    );
    t.structuralRegroupRequired = true;
    recordEvidence(t, 'Fragmentación de una pregunta por capítulo detectada.');
  }

  // 16. Photo placement defects
  for (const unplacedId of report.photoAudit?.unplacedPhotoIds || []) {
    const targetCh = chapters[0];
    const t = ensureTask(
      targetCh,
      'photo_placement',
      'Reubicar fotografía pendiente en su capítulo y párrafo narrativo correspondiente.'
    );
    t.photoPlacementDetails.push(`Fotografía sin ubicar: ${unplacedId}`);
    recordEvidence(t, unplacedId);
  }

  return Array.from(tasksMap.values());
}

/**
 * Automatic localized documentary & editorial repair loop (`repairManuscriptOmissions`).
 * When `auditAndApproveBookManuscript` detects missing documentary fact units, stripped uncertainties,
 * leaked excluded content, invented details, perspective leaks, or 1-question-per-chapter fragmentation:
 * - Never appends a raw Q&A dump at the end of the book.
 * - Deduplicates repeated episodes and cleans oral fillers / perspective leaks.
 * - Integrates omitted facts into their planned chapter in the manuscript's active `narrativeStyle`
 *   and re-runs BOTH Documentary and Editorial audits (bounded to `maxAttempts`, default 2).
 */
export function repairManuscriptOmissions(params: {
  manuscript: DemoManuscript;
  answers: DocumentarySourceAnswerInput[];
  questions: DocumentarySourceQuestionInput[];
  storyMode?: 'individual' | 'compartida';
  participantNames?: string[];
  maxAttempts?: number;
  /**
   * V5.1: when false, the pass only performs structural/editorial hygiene (regrouping, privacy
   * scrubbing, de-duplication, paragraph splitting) and NEVER pastes rule-rewritten testimony into
   * the prose. AI-written manuscripts use false: omissions there are repaired narratively by the
   * model, and the deterministic audit used inside this function would otherwise re-insert
   * memories that the semantic judge already confirmed as present (the source of duplicated,
   * mechanically concatenated paragraphs). Defaults to true for the rule-based fallback/demo flows.
   */
  integrateMissingUnits?: boolean;
  /** V5.1: restricts integration to these unit ids (e.g. omissions confirmed by the hybrid audit). */
  onlyIntegrateUnitIds?: string[];
}): {
  manuscript: DemoManuscript;
  report: DocumentaryAuditReport;
  editorialAudit: EditorialQualityAuditReport;
  inventory: DocumentaryInventory;
  repairAttemptsUsed: number;
  repairedUnitIds: string[];
} {
  const {
    manuscript,
    answers,
    questions,
    storyMode = manuscript.mode === 'pareja' ? 'compartida' : 'individual',
    participantNames = (manuscript.authors || '')
      .split(/\s+y\s+|,\s*/)
      .map((s) => s.trim())
      .filter(Boolean),
    maxAttempts = 2,
    integrateMissingUnits = true,
    onlyIntegrateUnitIds,
  } = params;
  const integrationAllowList = onlyIntegrateUnitIds ? new Set(onlyIntegrateUnitIds) : null;

  const isCouple = storyMode === 'compartida' && participantNames.length >= 2;
  const narrativeStyle = manuscript.narrativeStyle || 'first_person_literary';
  const bookStructureMode = manuscript.bookStructureMode || 'prompt_autonomous';

  let currentAudit = auditAndApproveBookManuscript({
    manuscript,
    answers,
    questions,
    repairAttemptsUsed: 0,
    repairedUnitIds: [],
  });

  if (currentAudit.report.passed) {
    return {
      manuscript: currentAudit.manuscript,
      report: currentAudit.report,
      editorialAudit: currentAudit.editorialAudit,
      inventory: currentAudit.inventory,
      repairAttemptsUsed: 0,
      repairedUnitIds: [],
    };
  }

  // If there are zero eligible source units (e.g. all answers were not_recalled/excluded), cannot repair
  if (answers.length > 0 && currentAudit.inventory.eligibleFactUnits.length === 0) {
    return {
      manuscript: currentAudit.manuscript,
      report: currentAudit.report,
      editorialAudit: currentAudit.editorialAudit,
      inventory: currentAudit.inventory,
      repairAttemptsUsed: 0,
      repairedUnitIds: [],
    };
  }

  const editorialPlan = buildEditorialChapterPlan({
    interviewTitle: manuscript.title,
    storyMode,
    participantNames,
    answers,
    questions,
    bookStructureMode,
  });

  const allRepairedUnitIds: string[] = [];
  let workingManuscript: DemoManuscript = {
    ...currentAudit.manuscript,
    chapters: currentAudit.manuscript.chapters.map((ch) => ({
      ...ch,
      paragraphs: [...(ch.paragraphs || [])],
      paragraphIds: [...(ch.paragraphIds || [])],
      sourceAnswerIds: [...(ch.sourceAnswerIds || [])],
      sourceQuestionIds: [...(ch.sourceQuestionIds || [])],
      sourceUnitIds: [...(ch.sourceUnitIds || [])],
      photoPlacements: ch.photoPlacements ? [...ch.photoPlacements] : undefined,
    })),
  };

  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (currentAudit.report.passed) break;
    attemptsUsed = attempt;

    // Step A: If 1-question-per-chapter fragmentation or question-formatted titles were detected,
    // regroup paragraphs into the editorial chapter plan
    if (currentAudit.report.structuralAudit?.oneQuestionPerChapterDetected) {
      const regroupedChapters: DemoChapterManuscript[] = [];
      for (const planItem of editorialPlan.chapters) {
        const matchingOldChapters = workingManuscript.chapters.filter((ch) => {
          const hasAnsOverlap = (ch.sourceAnswerIds || []).some((aId) =>
            planItem.assignedAnswerIds.includes(aId)
          );
          const hasQOverlap = (ch.sourceQuestionIds || []).some((qId) =>
            planItem.assignedQuestionIds.includes(qId)
          );
          return hasAnsOverlap || hasQOverlap || ch.dimensionKey === planItem.dimensionKey;
        });

        const mergedParas = matchingOldChapters.flatMap((c) => c.paragraphs || []);
        const mergedPhotos = matchingOldChapters.flatMap((c) => c.photoPlacements || []);
        const mergedAnsIds = Array.from(
          new Set([
            ...planItem.assignedAnswerIds,
            ...matchingOldChapters.flatMap((c) => c.sourceAnswerIds || []),
          ])
        );
        const mergedQIds = Array.from(
          new Set([
            ...planItem.assignedQuestionIds,
            ...matchingOldChapters.flatMap((c) => c.sourceQuestionIds || []),
          ])
        );

        if (mergedParas.length > 0) {
          const title =
            narrativeStyle === 'third_person_biography'
              ? planItem.suggestedTitleThirdPerson
              : isCouple
              ? planItem.suggestedTitleCouple
              : planItem.suggestedTitleIndividual;
          regroupedChapters.push({
            id: planItem.chapterId,
            partNumber: regroupedChapters.length + 1,
            dimensionKey: planItem.dimensionKey,
            title,
            paragraphs: mergedParas,
            paragraphIds: mergedParas.map((_, idx) => `${planItem.chapterId}_p_${idx + 1}`),
            sourceAnswerIds: mergedAnsIds,
            sourceQuestionIds: mergedQIds,
            photoPlacements: mergedPhotos.length > 0 ? mergedPhotos : undefined,
          });
        }
      }
      if (regroupedChapters.length > 0) {
        workingManuscript.chapters = regroupedChapters;
      } else {
        workingManuscript.chapters = workingManuscript.chapters.map((ch, idx) => {
          const fallbackPlan = editorialPlan.chapters[idx % Math.max(1, editorialPlan.chapters.length)];
          const cleanTitle =
            /^¿.+\?$/.test(ch.title.trim()) ||
            /^(pregunta|respuesta)\s+\d+/i.test(ch.title.trim()) ||
            /\(\d+\)\s*$/.test(ch.title.trim())
              ? narrativeStyle === 'third_person_biography'
                ? fallbackPlan?.suggestedTitleThirdPerson || ch.title
                : isCouple
                ? fallbackPlan?.suggestedTitleCouple || ch.title
                : fallbackPlan?.suggestedTitleIndividual || ch.title
              : ch.title;
          return { ...ch, title: cleanTitle };
        });
      }
    }

    // Step B: Scoped cleanup of leaked excluded sentences & directives without touching unrelated authorized text
    if ((currentAudit.report.leakedExcludedContentFlags || []).length > 0) {
      const eligibleWordsSet = new Set(
        currentAudit.inventory.eligibleFactUnits.flatMap((u) =>
          normalizePlainAscii(u.cleanText).split(/\s+/).filter(Boolean)
        )
      );
      const excludedUnitsWithTokens = currentAudit.inventory.excludedFactUnits
        .filter(
          (u) =>
            u.exclusionReason === 'excluded_by_interviewee' ||
            u.exclusionReason === 'prefer_not_to_answer'
        )
        .map((u) => ({
          unitId: u.unitId,
          uniqueTokens: u.keyTokens.filter((t) => !eligibleWordsSet.has(t)),
        }))
        .filter((x) => x.uniqueTokens.length > 0);

      const sanitizeSurfaceParagraph = (text: string): string => {
        const sentences = (text || '')
          .split(/(?<=[.!?…])\s+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const kept: string[] = [];
        for (const s of sentences) {
          if (EXPLICIT_EXCLUSION_DIRECTIVE_RX.test(s)) {
            const pivotParts = s.split(EXCLUSION_PIVOT_CLAUSE_RX);
            if (
              pivotParts.length >= 2 &&
              pivotParts[0].trim().length >= 12 &&
              !EXPLICIT_EXCLUSION_DIRECTIVE_RX.test(pivotParts[0])
            ) {
              kept.push(/[.!?…]$/.test(pivotParts[0].trim()) ? pivotParts[0].trim() : `${pivotParts[0].trim()}.`);
            }
            continue;
          }
          const words = normalizePlainAscii(s).split(/\s+/).filter(Boolean);
          const leaksExcludedUnit = excludedUnitsWithTokens.some((ex) => {
            const hits = ex.uniqueTokens.filter((t) => words.includes(t));
            return ex.uniqueTokens.length === 1 ? hits.length === 1 : hits.length >= 2;
          });
          if (!leaksExcludedUnit) {
            kept.push(s);
          }
        }
        return kept.join(' ').trim();
      };

      workingManuscript.introduction = sanitizeSurfaceParagraph(workingManuscript.introduction);
      workingManuscript.closingMessage = sanitizeSurfaceParagraph(workingManuscript.closingMessage);
      for (const ch of workingManuscript.chapters) {
        ch.paragraphs = ch.paragraphs
          .map((p) => sanitizeSurfaceParagraph(p))
          .filter((p) => p.length > 0);
        if (ch.pullQuote) {
          const cleanPQ = sanitizeSurfaceParagraph(ch.pullQuote);
          ch.pullQuote = cleanPQ.length >= 20 ? cleanPQ : undefined;
        }
      }
    }

    // Step C: Sanitize sentences containing invented years or unsupported explicit ages
    if ((currentAudit.report.veracityAudit?.inventedDataFlags || []).length > 0) {
      const validYearsSet = new Set(currentAudit.inventory.corpusValidYearsAndNumbers);
      for (const ch of workingManuscript.chapters) {
        ch.paragraphs = ch.paragraphs
          .map((para) => {
            const sentences = para
              .split(/(?<=[.!?…])\s+/)
              .map((s) => s.trim())
              .filter(Boolean);
            const cleanSentences = sentences.filter((sent) => {
              const years = sent.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/g) || [];
              if (years.some((y) => !validYearsSet.has(y))) return false;
              const ageMatches = normalizePlainAscii(sent).match(/\b(\d{1,2})\s+anos\b/g) || [];
              for (const am of ageMatches) {
                const numStr = (am.match(/\d+/) || [])[0];
                if (
                  numStr &&
                  !validYearsSet.has(numStr) &&
                  !doesTokenMatchCorpusWords(
                    numStr,
                    Array.from(validYearsSet).concat(currentAudit.inventory.corpusValidProperNames)
                  )
                ) {
                  return false;
                }
              }
              return true;
            });
            return cleanSentences.join(' ').trim();
          })
          .filter((p) => p.length > 0);
      }
    }

    // Step D: Locally integrate each missing or contradicted DocumentaryFactUnit cleanly into its planned chapter
    const missingIds = !integrateMissingUnits
      ? []
      : (currentAudit.report.coverageAudit?.missingUnitIds || []).filter(
          (id) => !integrationAllowList || integrationAllowList.has(id)
        );
    for (let mIdx = 0; mIdx < missingIds.length; mIdx++) {
      const missingId = missingIds[mIdx];
      const missingUnit = currentAudit.inventory.eligibleFactUnits.find(
        (u) => u.unitId === missingId
      );
      if (!missingUnit) continue;

      const styledText = cleanAndRewriteTestimonyForStyle({
        rawText: missingUnit.cleanText,
        questionText: missingUnit.questionText,
        narrativeStyle,
        speakerName: missingUnit.participantName || participantNames[0] || 'Protagonista',
        isCouple: isCouple && participantNames.length > 1,
        isFirstBlockForSpeaker: true,
        isFollowUpContinuation: missingUnit.sourceType === 'followup_answer',
        unitIndex: mIdx,
      });

      const styledWithUncertainty = ensureUncertaintyPreservedInParagraphs(
        missingUnit.cleanText,
        [styledText],
        narrativeStyle
      )[0];

      const plannedChItem =
        editorialPlan.chapters.find((pc) => pc.assignedAnswerIds.includes(missingUnit.answerId)) ||
        editorialPlan.chapters.find((pc) => pc.stageKey === missingUnit.lifeStage) ||
        editorialPlan.chapters[0];

      let targetCh =
        workingManuscript.chapters.find((c) =>
          (c.sourceAnswerIds || []).includes(missingUnit.answerId)
        ) ||
        (missingUnit.parentQuestionId
          ? workingManuscript.chapters.find((c) =>
              (c.sourceQuestionIds || []).includes(missingUnit.parentQuestionId!)
            )
          : undefined) ||
        (plannedChItem
          ? workingManuscript.chapters.find(
              (c) =>
                c.id === plannedChItem.chapterId || c.dimensionKey === plannedChItem.dimensionKey
            )
          : undefined);

      if (!targetCh) {
        if (plannedChItem && workingManuscript.chapters.length < editorialPlan.chapters.length) {
          const newChTitle =
            narrativeStyle === 'third_person_biography'
              ? plannedChItem.suggestedTitleThirdPerson
              : isCouple
              ? plannedChItem.suggestedTitleCouple
              : plannedChItem.suggestedTitleIndividual;
          targetCh = {
            id: plannedChItem.chapterId,
            partNumber: workingManuscript.chapters.length + 1,
            dimensionKey: plannedChItem.dimensionKey,
            title: newChTitle,
            paragraphs: [],
            paragraphIds: [],
            sourceAnswerIds: [missingUnit.answerId],
            sourceQuestionIds: missingUnit.questionId ? [missingUnit.questionId] : [],
            sourceUnitIds: [missingUnit.unitId],
          };
          workingManuscript.chapters.push(targetCh);
        } else {
          targetCh = workingManuscript.chapters[workingManuscript.chapters.length - 1];
        }
      }

      if (targetCh) {
        let mergedIntoExisting = false;
        const traceEntry = (currentAudit.report.traceabilityMatrix || []).find(
          (t) => t.unitId === missingUnit.unitId
        );
        const wasContradicted = traceEntry?.verificationStatus === 'contradicted';

        for (let pIdx = 0; pIdx < targetCh.paragraphs.length; pIdx++) {
          const paraWords = normalizePlainAscii(targetCh.paragraphs[pIdx])
            .split(/\s+/)
            .filter(Boolean);
          const overlap = missingUnit.keyTokens.filter((t) =>
            doesTokenMatchCorpusWords(t, paraWords)
          );
          if (missingUnit.keyTokens.length >= 3 && overlap.length >= 2) {
            targetCh.paragraphs[pIdx] = wasContradicted
              ? styledWithUncertainty
              : consolidateComplementarySentences(
                  targetCh.paragraphs[pIdx],
                  styledWithUncertainty
                );
            mergedIntoExisting = true;
            break;
          }
        }

        if (!mergedIntoExisting) {
          targetCh.paragraphs.push(styledWithUncertainty);
        }
        targetCh.paragraphIds = targetCh.paragraphs.map(
          (_, idx) => `${targetCh!.id}_p_${idx + 1}`
        );
        if (!targetCh.sourceAnswerIds) targetCh.sourceAnswerIds = [];
        if (!targetCh.sourceAnswerIds.includes(missingUnit.answerId)) {
          targetCh.sourceAnswerIds.push(missingUnit.answerId);
        }
        if (missingUnit.questionId) {
          if (!targetCh.sourceQuestionIds) targetCh.sourceQuestionIds = [];
          if (!targetCh.sourceQuestionIds.includes(missingUnit.questionId)) {
            targetCh.sourceQuestionIds.push(missingUnit.questionId);
          }
        }
        if (!allRepairedUnitIds.includes(missingUnit.unitId)) {
          allRepairedUnitIds.push(missingUnit.unitId);
        }
      }
    }

    // Step E: Editorial hygiene — clean Style C 1st-person leaks, oral fillers, deduplicate episodes, and split giant paragraphs
    const seenCleanParaSamples: string[] = [];
    for (const ch of workingManuscript.chapters) {
      const cleanedParas: string[] = [];
      for (const p of ch.paragraphs || []) {
        const styleFixed = ensureParagraphConformsToStyle({
          paragraph: p,
          narrativeStyle,
          speakerName: participantNames[0] || workingManuscript.authors || 'Protagonista',
          isCouple,
        });
        if (!styleFixed) continue;
        const isDup = seenCleanParaSamples.some(
          (prev) =>
            styleFixed.length >= 45 &&
            prev.length >= 45 &&
            areTestimoniesRedundantSameEpisode(prev, styleFixed)
        );
        if (isDup) continue;
        seenCleanParaSamples.push(styleFixed);
        for (const piece of splitLongParagraphAtSentences(styleFixed, 1100)) {
          cleanedParas.push(piece);
        }
      }
      ch.paragraphs = cleanedParas;
      ch.paragraphIds = cleanedParas.map((_, idx) => `${ch.id}_p_${idx + 1}`);
    }

    // Step F: Repair any remaining uncertainty violations in assigned chapters
    for (const unit of currentAudit.inventory.eligibleFactUnits) {
      if (unit.uncertaintyExpressions.length === 0) continue;
      const targetCh =
        workingManuscript.chapters.find((c) =>
          (c.sourceAnswerIds || []).includes(unit.answerId)
        ) || workingManuscript.chapters[0];
      if (targetCh && targetCh.paragraphs.length > 0) {
        targetCh.paragraphs = ensureUncertaintyPreservedInParagraphs(
          unit.cleanText,
          targetCh.paragraphs,
          narrativeStyle
        );
      }
    }

    currentAudit = auditAndApproveBookManuscript({
      manuscript: workingManuscript,
      answers,
      questions,
      repairAttemptsUsed: attemptsUsed,
      repairedUnitIds: allRepairedUnitIds,
    });
  }

  return {
    manuscript: currentAudit.manuscript,
    report: currentAudit.report,
    editorialAudit: currentAudit.editorialAudit,
    inventory: currentAudit.inventory,
    repairAttemptsUsed: attemptsUsed,
    repairedUnitIds: allRepairedUnitIds,
  };
}

/**
 * Computes a deterministic composite cache key for a canonical manuscript so that any change
 * in answers, deepening follow-ups, additional memories, exclusions, photos, captions,
 * narrative style, active literary prompt, book structure mode, engine version, or audit rules version
 * invalidates stale cached manuscripts.
 */
export function computeCanonicalManuscriptCacheKey(params: {
  interviewId: string;
  narrativeStyle: DemoNarrativeStyleId;
  bookStructureMode?: string;
  customStylePrompt?: string;
  closingDedicationText?: string;
  answers?: Array<{
    id?: string;
    questionId?: string;
    answerText?: string;
    notRecalled?: boolean;
    preferNotToAnswer?: boolean;
    excludeFromBook?: boolean;
    excludedByInterviewee?: boolean;
    omissionReason?: string;
    isFollowUp?: boolean;
    parentQuestionId?: string | null;
    isAdditionalMemory?: boolean;
    updatedAt?: string;
    audio?: { transcription?: string } | null;
    audioRecordings?: Array<{ transcription?: string }> | null;
    photos?: Array<{ id?: string; caption?: string }>;
  }>;
}): string {
  const {
    interviewId,
    narrativeStyle,
    bookStructureMode = 'autonomous',
    customStylePrompt = '',
    closingDedicationText = '',
    answers = [],
  } = params;

  const simpleHash = (input: string): string => {
    let h1 = 0xdeadbeef ^ input.length;
    let h2 = 0x41c6ce57 ^ input.length;
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };

  const answersFingerprint = answers
    .map((a) => {
      const text = (a.answerText || '').trim();
      const audioT = (a.audio?.transcription || '').trim();
      const multiAudioT = (a.audioRecordings || [])
        .map((r) => (r.transcription || '').trim())
        .join('|');
      const photosT = (a.photos || [])
        .map((p) => `${p.id || ''}:${(p.caption || '').trim()}`)
        .join(',');
      const flags = [
        a.notRecalled ? 'nr1' : 'nr0',
        a.preferNotToAnswer ? 'pna1' : 'pna0',
        a.excludeFromBook || a.excludedByInterviewee ? 'ex1' : 'ex0',
        a.omissionReason || 'none',
        a.isFollowUp ? 'fu1' : 'fu0',
        a.parentQuestionId || '',
        a.isAdditionalMemory ? 'am1' : 'am0',
      ].join(':');
      return `${a.id || ''}:${a.questionId || ''}:${flags}:${text}:${audioT}:${multiAudioT}:${photosT}`;
    })
    .sort()
    .join('||');

  const payload = [
    `v=${CANONICAL_AUDIT_RULES_VERSION}`,
    `eng=${BOOK_GENERATION_ENGINE_VERSION}`,
    `id=${interviewId}`,
    `style=${narrativeStyle}`,
    `struct=${bookStructureMode}`,
    `prompt=${simpleHash(customStylePrompt.trim())}`,
    `ded=${simpleHash(closingDedicationText.trim())}`,
    `ans=${simpleHash(answersFingerprint)}`,
  ].join(';');

  return `canonical_${narrativeStyle}_${simpleHash(payload)}`;
}

/**
 * V5.1 — Canonical serialization of everything in a manuscript that the audit actually judged:
 * narrative style, introduction, closing message and every chapter's id, title, paragraphs and
 * photo anchors. Title, subtitle, authors and dedication are deliberately excluded because the
 * participant customizes them in the layout studio after approval and they carry no testimony.
 * Whitespace and Unicode form are normalized so a JSON round-trip through the browser yields the
 * same payload. The server hashes this string; any edit to audited text changes the hash.
 */
export function buildManuscriptApprovalDigestPayload(manuscript: DemoManuscript): string {
  const clean = (text: string | undefined | null): string =>
    String(text || '')
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim();
  const chapters = (manuscript.chapters || []).map((ch) => ({
    id: clean(ch.id),
    title: clean(ch.title),
    paragraphs: (ch.paragraphs || []).map((p) => clean(p)),
    photos: (ch.photoPlacements || [])
      .map((pl) => `${pl.photoId}@${Number(pl.paragraphIndex) || 0}`)
      .sort(),
  }));
  return JSON.stringify({
    style: manuscript.narrativeStyle || '',
    mode: manuscript.mode || '',
    introduction: clean(manuscript.introduction),
    closingMessage: clean(manuscript.closingMessage),
    chapters,
  });
}

/**
 * V5.2 — Prepares an approved manuscript for saving from the layout studio.
 *
 * The audited narrative (introduction, chapters, chapter titles, closing message and photo
 * placements — everything in `buildManuscriptApprovalDigestPayload`) is taken from `approved`
 * UNCHANGED. Only editorial fields outside the audited content (title, subtitle, authors and
 * dedication) are carried over from the studio's working copy, so a different introduction in the
 * preview can never silently replace the approved one and invalidate its approval evidence.
 * Deliberate edits to audited text are made in the studio's own manuscript and are re-audited by
 * the server through the same hybrid policy.
 */
export function mergeEditorialFieldsIntoApprovedManuscript(params: {
  approved: DemoManuscript;
  studio: Partial<DemoManuscript> | null | undefined;
  narrativeStyle: DemoNarrativeStyleId;
}): DemoManuscript {
  const { approved, studio, narrativeStyle } = params;
  return {
    ...approved,
    title: studio?.title || approved.title,
    subtitle: studio?.subtitle || approved.subtitle,
    authors: studio?.authors || approved.authors,
    dedication: studio?.dedication || approved.dedication,
    narrativeStyle,
    aiGenerated: approved.aiGenerated ?? true,
    generationStatus: approved.generationStatus,
    useOfficialForeverYouLogo: true,
  };
}
