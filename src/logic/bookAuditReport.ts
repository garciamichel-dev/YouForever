/**
 * V5.3 — Administrative audit report of ONE saved book version.
 *
 * Built from the real audit results (never altered) when a version is saved, persisted with that
 * version and visible ONLY to authorized administrators. Participants never receive it.
 */
import {
  BOOK_DELIVERY_POLICY_VERSION,
  BOOK_GENERATION_ENGINE_VERSION,
  CANONICAL_AUDIT_RULES_VERSION,
  classifyCoverageCounts,
  evaluateBookDeliveryEligibility,
  type BookDeliveryDecision,
  type CoverageBand,
  type DemoManuscript,
  type DemoNarrativeStyleId,
  type DocumentaryAuditReport,
  type EditorialQualityAuditReport,
} from './demoStoryRules.ts';

export type BookAuditIncidentKind =
  | 'contradiction'
  | 'omission'
  | 'partial'
  | 'pending_verification'
  | 'inconclusive'
  | 'invented_data'
  | 'unsupported_addition'
  | 'uncertainty'
  | 'editorial'
  | 'photo'
  | 'privacy';

export type BookAuditIncidentStatus =
  | 'possible_contradiction'
  | 'confirmed_by_audit'
  | 'inconclusive'
  | 'pending'
  | 'reviewed_by_admin'
  | 'corrected_in_later_version';

export const BOOK_AUDIT_INCIDENT_STATUS_LABELS: Record<BookAuditIncidentStatus, string> = {
  possible_contradiction: 'Posible contradicción',
  confirmed_by_audit: 'Confirmada por auditoría',
  inconclusive: 'Verificación inconclusa',
  pending: 'Pendiente',
  reviewed_by_admin: 'Revisada por administrador',
  corrected_in_later_version: 'Corregida en una versión posterior',
};

export const BOOK_AUDIT_INCIDENT_KIND_LABELS: Record<BookAuditIncidentKind, string> = {
  contradiction: 'Contradicción',
  omission: 'Omisión',
  partial: 'Integración parcial',
  pending_verification: 'Verificación pendiente',
  inconclusive: 'Verificación inconclusa',
  invented_data: 'Dato sin respaldo',
  unsupported_addition: 'Afirmación sin respaldo',
  uncertainty: 'Incertidumbre no conservada',
  editorial: 'Editorial',
  photo: 'Fotografía',
  privacy: 'Privacidad',
};

export const COVERAGE_BAND_LABELS: Record<CoverageBand, string> = {
  pending_review: 'Pendiente de revisión',
  orange: 'Naranja',
  yellow: 'Amarillo',
  green: 'Verde',
};

export interface BookAuditIncident {
  incidentId: string;
  kind: BookAuditIncidentKind;
  severity: 'alta' | 'media' | 'baja';
  unitId?: string;
  answerId?: string;
  testimony?: string;
  excerpt?: string;
  chapterId?: string;
  chapterTitle?: string;
  paragraphIndex?: number;
  judgeVerdict?: string;
  judgeRationale?: string;
  detail?: string;
  verifiedAt: string;
  adminStatus: BookAuditIncidentStatus;
  correctedInVersionId?: string;
  adminNotes: Array<{ note: string; by: string; at: string }>;
  statusHistory: Array<{ status: BookAuditIncidentStatus; by: string; at: string; note?: string }>;
}

export interface BookAuditReport {
  reportVersion: 1;
  identification: {
    bookId: string;
    interviewId: string;
    versionId: string;
    versionNumber: number;
    protagonistName: string;
    narrativeStyle: DemoNarrativeStyleId;
    generatedAt?: string;
    savedAt: string;
    provider?: string;
    model?: string;
    engineVersion: string;
    rulesVersion: string;
    deliveryPolicyVersion: string;
    generationJobId?: string;
    approvalPath?: string;
    source: 'generated_on_save' | 'reconstructed_from_saved_version' | 'restored_without_audit';
  };
  delivery: BookDeliveryDecision;
  coverage: {
    exactPercent: number;
    band: CoverageBand;
    eligibleUnits: number;
    verifiedUnits: number;
    notVerifiedUnits: number;
    omittedUnits: number;
    partialUnits: number;
    ambiguousUnits: number;
    pendingVerificationUnits: number;
    contradictions: number;
    incidentsCorrected: number;
    incidentsPending: number;
    exclusions: Array<{ unitId: string; answerId: string; reason: string }>;
    photosAvailable: number;
    photosIntegrated: number;
    photosPending: number;
  };
  strictAudit: {
    documentaryPassed: boolean;
    editorialPassed: boolean;
    blockingDefects: string[];
  };
  incidents: BookAuditIncident[];
  repair: Record<string, unknown> | null;
  operations: Record<string, unknown> | null;
  adminNotes: Array<{ note: string; by: string; at: string }>;
  correctionRequests: Array<{ requestId: string; incidentIds: string[]; note: string; by: string; at: string; status: 'requested' }>;
  history: Array<{ event: string; by: string; at: string; detail?: string }>;
  /**
   * V5.3.1 — Where this report (and its version) really lives. `durable` is true only when the
   * version document (which embeds this report) and the interview counters are in Firestore, or
   * when the local disk is declared persistent. `pending` is what the remote copy itself carries
   * while it is being written; it is replaced by `written` when the report is loaded back.
   */
  durability?: {
    remoteStatus: 'written' | 'local_only' | 'unknown' | 'pending';
    checkedAt: string;
    durable?: boolean;
    localDisk?: string;
    versionDocument?: { status: string; bytes: number; chunks: number };
    interviewDocument?: string;
  };
}

const severityOf = (kind: BookAuditIncidentKind): BookAuditIncident['severity'] =>
  kind === 'contradiction' || kind === 'invented_data' || kind === 'privacy'
    ? 'alta'
    : kind === 'omission' || kind === 'unsupported_addition' || kind === 'uncertainty' || kind === 'inconclusive'
    ? 'media'
    : 'baja';

const chapterTitleFromFlag = (flag: string): string | undefined => {
  const m = flag.match(/cap[ií]tulo\s+"([^"]+)"/i);
  return m ? m[1] : undefined;
};

const stableId = (parts: string[]): string => {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
};

/**
 * Lists every observation of the real audit as an incident. Nothing is resolved, removed or
 * reclassified here: an unverified unit is "pending", never "covered".
 */
export function buildBookAuditIncidents(params: {
  report: DocumentaryAuditReport;
  editorialAudit?: EditorialQualityAuditReport | null;
  manuscript: DemoManuscript;
}): BookAuditIncident[] {
  const { report, editorialAudit, manuscript } = params;
  const at = report.auditedAt || new Date().toISOString();
  const chapterTitle = (id?: string) => manuscript.chapters.find((c) => c.id === id)?.title;
  const incidents: BookAuditIncident[] = [];
  const push = (inc: Omit<BookAuditIncident, 'severity' | 'verifiedAt' | 'adminNotes' | 'statusHistory'>) => {
    incidents.push({
      ...inc,
      severity: severityOf(inc.kind),
      verifiedAt: at,
      adminNotes: [],
      statusHistory: [{ status: inc.adminStatus, by: 'sistema', at }],
    });
  };

  for (const t of report.traceabilityMatrix || []) {
    if ((t.exclusionReason || 'none') !== 'none' || t.verified) continue;
    const base = {
      unitId: t.unitId,
      answerId: t.answerId,
      testimony: t.excerpt,
      excerpt: t.evidenceSnippet,
      chapterId: t.chapterId,
      chapterTitle: chapterTitle(t.chapterId),
      paragraphIndex: t.paragraphIndex,
      judgeVerdict: t.aiJudgeVerdict,
      judgeRationale: t.aiJudgeRationale,
    };
    if (t.aiJudgeVerdict === 'contradicted' || t.verificationStatus === 'contradicted') {
      push({
        ...base,
        incidentId: `contradiction_${t.unitId}`,
        kind: 'contradiction',
        adminStatus: t.aiJudgeVerdict === 'contradicted' ? 'confirmed_by_audit' : 'possible_contradiction',
        detail: (t.semanticIssues || []).join(' ') || undefined,
      });
    } else if (t.judgeDeferred) {
      push({
        ...base,
        incidentId: `pending_${t.unitId}`,
        kind: 'pending_verification',
        adminStatus: 'pending',
        detail: t.semanticReviewReason,
      });
    } else if (t.aiJudgeUnavailable || t.aiJudgeVerdict === 'inconclusive') {
      push({
        ...base,
        incidentId: `inconclusive_${t.unitId}`,
        kind: 'inconclusive',
        adminStatus: 'inconclusive',
        detail: t.semanticReviewReason || t.ambiguityReason,
      });
    } else if (t.verificationStatus === 'partially_supported' && t.aiJudgeVerdict !== 'omitted') {
      push({
        ...base,
        incidentId: `partial_${t.unitId}`,
        kind: 'partial',
        adminStatus: 'pending',
        detail: (t.missingFacets || []).join(', ') || undefined,
      });
    } else {
      push({
        ...base,
        incidentId: `omission_${t.unitId}`,
        kind: 'omission',
        adminStatus: 'pending',
        detail: t.evidenceOfAbsenceReason || t.aiJudgeRationale,
      });
    }
  }

  const ver = report.veracityAudit;
  const inventedSet = new Set(ver?.inventedDataFlags || []);
  const flagIncidents: Array<[BookAuditIncidentKind, string[]]> = [
    ['invented_data', ver?.inventedDataFlags || []],
    ['unsupported_addition', (ver?.unsupportedAdditionFlags || []).filter((f) => !inventedSet.has(f))],
    ['uncertainty', ver?.uncertaintyViolations || []],
    ['privacy', ver?.leakedExcludedContentFlags || []],
    ['editorial', editorialAudit?.blockingDefects || []],
  ];
  for (const [kind, flags] of flagIncidents) {
    for (const flag of flags) {
      const title = chapterTitleFromFlag(flag);
      push({
        incidentId: `${kind}_${stableId([flag])}`,
        kind,
        chapterTitle: title,
        chapterId: manuscript.chapters.find((c) => c.title === title)?.id,
        detail: flag,
        adminStatus: 'pending',
      });
    }
  }
  for (const photoId of report.photoAudit?.unplacedPhotoIds || []) {
    push({
      incidentId: `photo_${photoId}`,
      kind: 'photo',
      detail: `Fotografía sin ubicar: ${photoId}`,
      adminStatus: 'pending',
    });
  }
  return incidents;
}

export function buildBookAuditReport(params: {
  versionId: string;
  versionNumber: number;
  interviewId: string;
  protagonistName: string;
  manuscript: DemoManuscript;
  savedAt: string;
  approvalPath?: string;
  generation?: {
    provider?: string;
    model?: string;
    generatedAt?: string;
    jobId?: string;
    metrics?: Record<string, unknown> | null;
    repairSummary?: Record<string, unknown> | null;
  } | null;
  source?: BookAuditReport['identification']['source'];
}): BookAuditReport {
  const { manuscript } = params;
  const report = manuscript.documentaryAudit;
  const editorial = manuscript.editorialAudit || report?.editorialAudit || null;
  const emptyReport: DocumentaryAuditReport = {
    auditedAt: params.savedAt,
    passed: false,
    totalSourceUnits: 0,
    integratedUnits: 0,
    omittedNotRecalledUnits: 0,
    coveragePercentage: 0,
    totalUploadedPhotos: 0,
    totalPlacedPhotos: 0,
    duplicateChapterIdsDetected: false,
    consecutiveChapterNumberingValid: true,
    uncertaintiesPreserved: true,
    traceabilityMatrix: [],
    blockingDefects: ['Esta versión no conserva resultados de auditoría.'],
  };
  const effective = report || emptyReport;
  const delivery =
    manuscript.deliveryDecision ||
    evaluateBookDeliveryEligibility({ report: effective, editorialAudit: editorial, manuscript });
  const incidents = report ? buildBookAuditIncidents({ report, editorialAudit: editorial, manuscript }) : [];
  const trace = effective.traceabilityMatrix || [];
  const eligibleTrace = trace.filter((t) => (t.exclusionReason || 'none') === 'none');
  const count = (kind: BookAuditIncidentKind) => incidents.filter((i) => i.kind === kind).length;
  return {
    reportVersion: 1,
    identification: {
      bookId: params.versionId,
      interviewId: params.interviewId,
      versionId: params.versionId,
      versionNumber: params.versionNumber,
      protagonistName: params.protagonistName,
      narrativeStyle: manuscript.narrativeStyle,
      generatedAt: params.generation?.generatedAt || manuscript.generatedAt,
      savedAt: params.savedAt,
      provider: params.generation?.provider,
      model: params.generation?.model,
      engineVersion: BOOK_GENERATION_ENGINE_VERSION,
      rulesVersion: effective.auditVersion || CANONICAL_AUDIT_RULES_VERSION,
      deliveryPolicyVersion: delivery.policyVersion || BOOK_DELIVERY_POLICY_VERSION,
      generationJobId: params.generation?.jobId,
      approvalPath: params.approvalPath,
      source: params.source || (report ? 'generated_on_save' : 'restored_without_audit'),
    },
    delivery,
    coverage: {
      exactPercent: delivery.coverageExactPercent,
      band: classifyCoverageCounts(delivery.verifiedUnits, delivery.eligibleUnits),
      eligibleUnits: delivery.eligibleUnits,
      verifiedUnits: delivery.verifiedUnits,
      notVerifiedUnits: Math.max(0, delivery.eligibleUnits - delivery.verifiedUnits),
      omittedUnits: count('omission'),
      partialUnits: count('partial'),
      ambiguousUnits: count('inconclusive'),
      pendingVerificationUnits: count('pending_verification'),
      contradictions: count('contradiction'),
      incidentsCorrected: 0,
      incidentsPending: incidents.length,
      exclusions: trace
        .filter((t) => (t.exclusionReason || 'none') !== 'none')
        .map((t) => ({ unitId: t.unitId, answerId: t.answerId, reason: String(t.exclusionReason) })),
      photosAvailable: effective.totalUploadedPhotos || 0,
      photosIntegrated: effective.totalPlacedPhotos || 0,
      photosPending: (effective.photoAudit?.unplacedPhotoIds || []).length,
    },
    strictAudit: {
      documentaryPassed: effective.passed === true,
      editorialPassed: editorial ? editorial.passed === true : false,
      blockingDefects: effective.blockingDefects || [],
    },
    incidents,
    repair: (params.generation?.repairSummary as Record<string, unknown>) || null,
    operations: (params.generation?.metrics as Record<string, unknown>) || null,
    adminNotes: [],
    correctionRequests: [],
    history: [
      { event: 'report_created', by: 'sistema', at: params.savedAt, detail: params.approvalPath },
    ],
  };
  // (eligibleTrace kept for future per-stage breakdowns)
  void eligibleTrace;
}

/** Recomputes the corrected/pending counters after an administrative change. */
export function refreshBookAuditReportCounters(report: BookAuditReport): BookAuditReport {
  const corrected = report.incidents.filter((i) => i.adminStatus === 'corrected_in_later_version').length;
  const reviewed = report.incidents.filter((i) => i.adminStatus === 'reviewed_by_admin').length;
  report.coverage.incidentsCorrected = corrected;
  report.coverage.incidentsPending = report.incidents.length - corrected - reviewed;
  return report;
}
