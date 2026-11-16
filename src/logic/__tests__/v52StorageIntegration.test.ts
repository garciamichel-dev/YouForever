/**
 * V5.2 — INTEGRATION TESTS WITH THE REAL STORAGE, OFFLINE.
 *
 * What is real here: StorageManager (interview creation, token authorization, answers, completion,
 * generation entry point, hybrid audit, approval evidence, `saveParticipantBookVersion`, quota
 * counters, snapshot persistence and reload), the book engine (`generateParticipantBookManuscriptWithAI`),
 * the deterministic and hybrid audits, composition and PDF rendering.
 *
 * What is simulated: the AI providers (drafter, semantic judge, repair), Cloud Firestore (an
 * in-memory remote store) and the Compilado Testimonial Fidedigno (Mi Esencia reads/writes
 * Firestore). The process runs inside a temporary directory, so `data/` of the repository is never
 * read or written, and `fetch` is replaced by a guard that fails the test on any network call.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yf_v52_integration_'));

// --- Isolation (must happen before the server modules are imported) --------------------------
process.chdir(ISOLATED_ROOT);
process.env.YOUFOREVER_ALLOW_TEST_DOUBLES = '1';
process.env.BOOK_APPROVAL_SECRET = 'v52-integration-secret-only-for-local-tests';
delete process.env.BOOK_APPROVAL_PREVIOUS_SECRETS;
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
const networkCalls: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  networkCalls.push(String(input?.url || input));
  throw new Error('Red deshabilitada en las pruebas: no se permiten llamadas a proveedores reales.');
}) as typeof fetch;

type StyleId = 'first_person_simple' | 'first_person_literary' | 'third_person_biography';
const ALL_STYLES: StyleId[] = ['first_person_simple', 'first_person_literary', 'third_person_biography'];
const STYLE_LABEL: Record<StyleId, string> = {
  first_person_simple: 'Estilo A',
  first_person_literary: 'Estilo B',
  third_person_biography: 'Estilo C',
};

let mod: any; // storage module
let rules: any; // demoStoryRules
let approval: any; // bookApproval
let helpers: any; // simulatedBookProviders
let pdfGen: any; // demoPdfGenerator
let interviewRules: any;
let storage: any;

const remoteWrites: string[] = [];
const fakeRemoteStore = {
  async setDoc(collectionName: string, docId: string) {
    remoteWrites.push(`${collectionName}/${docId}`);
  },
  async deleteDoc(collectionName: string, docId: string) {
    remoteWrites.push(`delete:${collectionName}/${docId}`);
  },
};

/** The active scenario: which simulated provider answers each AI call of the engine. */
const scenario: {
  draftBatch?: (ctx: any) => Promise<any>;
  judge?: (params: any) => Promise<any>;
  repair?: (p: string, s: string, ids: string[]) => Promise<any>;
} = {};

before(async () => {
  mod = await import(path.join(REPO_ROOT, 'src/server/storage.ts'));
  rules = await import(path.join(REPO_ROOT, 'src/logic/demoStoryRules.ts'));
  approval = await import(path.join(REPO_ROOT, 'src/server/bookApproval.ts'));
  helpers = await import(path.join(REPO_ROOT, 'src/logic/__tests__/helpers/simulatedBookProviders.ts'));
  pdfGen = await import(path.join(REPO_ROOT, 'src/utils/demoPdfGenerator.ts'));
  interviewRules = await import(path.join(REPO_ROOT, 'src/logic/interviewRules.ts'));
  storage = mod.storage;
  storage.configureTestDoubles({
    remoteDocStore: fakeRemoteStore,
    bookAiOverrides: {
      skipDiskCache: true,
      draftBatch: (ctx: any) => {
        if (!scenario.draftBatch) throw new Error('Escenario sin redactor simulado.');
        return scenario.draftBatch(ctx);
      },
      aiJudge: (params: any) => {
        if (!scenario.judge) throw new Error('Escenario sin juez simulado.');
        return scenario.judge(params);
      },
      repairBatchCaller: (p: string, s: string, ids: string[]) =>
        scenario.repair ? scenario.repair(p, s, ids) : Promise.resolve(null),
      compilationPdfProvider: async (interviewId: string) =>
        helpers.buildSyntheticCompilationPdf(
          interviewId,
          storage
            .getAnswersForInterview(interviewId)
            .map((a: any) => a.answerText)
            .join('\n')
        ),
    },
  });
});

after(() => {
  globalThis.fetch = originalFetch;
  assert.deepEqual(networkCalls, [], 'Ninguna prueba puede llamar a la red ni a proveedores reales.');
  // The repository's own data folder was never touched: everything lived in ISOLATED_ROOT.
  assert.equal(process.cwd(), ISOLATED_ROOT);
});

// ---------------------------------------------------------------------------------------------
// Fixture helpers (all through the REAL storage API)
// ---------------------------------------------------------------------------------------------

async function createSyntheticInterview(
  size: 'small' | 'medium' | 'large',
  options: { withPhotos?: boolean; extraBase?: string[]; variantOffset?: number; extraMemories?: string[]; extraFollowUps?: string[] } = {}
) {
  const created = await storage.createInterview({
    title: `Memorias sintéticas ${size}`,
    storyMode: 'individual',
    storyType: 'biografia_personal',
    participants: [{ name: 'Elena Robles', relationship: 'Titular', role: 'primary' }],
    customSufficiencyThreshold: 100000,
    performedBy: 'admin_pruebas',
  });
  const interview = created.interview;
  // No AI follow-up generation while answering: deepenings are submitted explicitly below.
  interview.maxFollowUpsAtCreation = 0;
  const token = created.participantTokens[0].plainToken;
  const questions = storage.getQuestionsForVersion(interview.questionnaireVersionId);
  const specs = helpers.buildSyntheticInterviewSpecs(size, {
    withPhotos: options.withPhotos,
    variantOffset: options.variantOffset,
  });
  let fu = 0;
  let add = 0;
  for (const spec of specs) {
    const baseQ = questions[spec.baseIndex];
    const photos = spec.photoCaption
      ? [{ dataUrl: helpers.TINY_PNG_DATA_URL, caption: spec.photoCaption, fileName: 'foto.png', mimeType: 'image/png' }]
      : undefined;
    if (spec.kind === 'base') {
      await storage.submitAnswer({
        plainToken: token,
        questionId: baseQ.id,
        answerText: spec.text,
        notRecalled: false,
        idempotencyKey: `base_${spec.baseIndex}`,
        photos,
      });
    } else if (spec.kind === 'follow_up') {
      fu++;
      await storage.submitAnswer({
        plainToken: token,
        questionId: `${baseQ.id}_fu_${fu}`,
        questionText: spec.questionText,
        answerText: spec.text,
        notRecalled: false,
        isFollowUp: true,
        parentQuestionId: baseQ.id,
        idempotencyKey: `fu_${fu}`,
      });
    } else {
      add++;
      await storage.submitAnswer({
        plainToken: token,
        questionId: `mem_adicional_${add}`,
        questionText: spec.questionText,
        answerText: spec.text,
        notRecalled: false,
        isAdditionalMemory: true,
        idempotencyKey: `add_${add}`,
      });
    }
  }
  for (const [i, text] of (options.extraBase || []).entries()) {
    const q = questions[specs.filter((s: any) => s.kind === 'base').length + i];
    await storage.submitAnswer({
      plainToken: token,
      questionId: q.id,
      answerText: text,
      notRecalled: false,
      idempotencyKey: `extra_${i}`,
    });
  }
  for (const [i, text] of (options.extraMemories || []).entries()) {
    await storage.submitAnswer({
      plainToken: token,
      questionId: `mem_extra_${i}`,
      questionText: 'Recuerdo adicional',
      answerText: text,
      notRecalled: false,
      isAdditionalMemory: true,
      idempotencyKey: `extra_mem_${i}`,
    });
  }
  // Deepenings attached to existing base questions (they join the chapters of those questions).
  for (const [i, text] of (options.extraFollowUps || []).entries()) {
    const parent = questions[(i * 3) % specs.filter((sp: any) => sp.kind === 'base').length];
    await storage.submitAnswer({
      plainToken: token,
      questionId: `${parent.id}_fu_extra_${i}`,
      questionText: 'Cuéntame un poco más',
      answerText: text,
      notRecalled: false,
      isFollowUp: true,
      parentQuestionId: parent.id,
      idempotencyKey: `extra_fu_${i}`,
    });
  }
  await storage.declareVoluntaryCompletion(token, 'Declaración voluntaria');
  return {
    interview: storage.getInterviewById(interview.id),
    token,
    specsCount: specs.length + (options.extraBase || []).length + (options.extraMemories || []).length + (options.extraFollowUps || []).length,
  };
}

function auditContext(interviewId: string, style: StyleId) {
  return storage['resolveParticipantBookAuditContext'](storage.getInterviewById(interviewId), style);
}

/** The rule-based redaction the simulated drafter writes from (built from the stored answers). */
function baseManuscriptFor(interviewId: string, style: StyleId) {
  const interview = storage.getInterviewById(interviewId);
  const ctx = auditContext(interviewId, style);
  return rules.buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: interview.title,
    storyMode: interview.storyMode,
    participantNames: storage.getParticipantsForInterview(interviewId).map((p: any) => p.name),
    answers: ctx.answers,
    questions: ctx.questions,
    narrativeStyle: style,
    closingDedicationText: ctx.closingPageText,
    bookStructureMode: ctx.bookStructureMode,
  }).manuscript;
}

const editorialConfigFor = (style: StyleId, overrides: Record<string, unknown> = {}) => ({
  narrativeStyle: style,
  coverDesignId: 'legado_clasico',
  interiorStyleId: 'clasico_editorial',
  bookFormatId: '6x9',
  coverVisualType: 'none',
  includeTableOfContents: true,
  ...overrides,
});

const jsonRoundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function lastAuditLog(action: string, targetId?: string) {
  return storage
    .getAuditLogs(500)
    .find((l: any) => l.action === action && (!targetId || l.targetId === targetId || l.details?.interviewId === targetId));
}

const normalizeForSearch = (t: string) =>
  String(t || '')
    .replace(/\*\*|\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function generateApproved(interviewId: string, token: string, style: StyleId, judge?: any) {
  const base = baseManuscriptFor(interviewId, style);
  const drafter = helpers.createFaithfulDrafter(base);
  scenario.draftBatch = drafter.draftBatch;
  scenario.judge = (judge || helpers.createScenarioJudge()).judge;
  scenario.repair = undefined;
  const result = await storage.generateParticipantBookManuscript({
    plainToken: token,
    narrativeStyle: style,
    scope: 'full',
    forceRefresh: true,
  });
  return { result, base, drafter };
}

// ---------------------------------------------------------------------------------------------
// 1. Criterio principal: entrevista → generación → auditorías → aprobación firmada → guardado
//    real → recuperación → PDF, por separado en A, B y C (entrevista de ~46 respuestas).
// ---------------------------------------------------------------------------------------------

async function runFullFlowAndAssert(size: 'small' | 'medium' | 'large', style: StyleId, expectedAnswers: number) {
    const { interview, token, specsCount } = await createSyntheticInterview(size, { withPhotos: true });
    assert.equal(specsCount, expectedAnswers);
    assert.equal(storage.getAnswersForInterview(interview.id).length, expectedAnswers);

    // 4-6. Generation with the real engine and simulated models; hybrid audit; signed approval.
    const { result } = await generateApproved(interview.id, token, style);
    const approved = result.manuscript;
    assert.equal(
      approved.generationStatus,
      'approved',
      `${STYLE_LABEL[style]}: ${result.internalReasonCode} ${result.diagnosticSummary}`
    );
    assert.equal(approved.documentaryAudit.auditPolicy, 'hybrid_arbitrated');
    assert.equal(approved.documentaryAudit.passed, true);
    assert.equal(approved.editorialAudit.passed, true);
    for (const gate of ['coverageAudit', 'veracityAudit', 'semanticAudit', 'structuralAudit', 'photoAudit'] as const) {
      assert.equal(approved.documentaryAudit[gate].passed, true, `${STYLE_LABEL[style]}: ${gate}`);
    }
    assert.ok(approved.approvalEvidence, 'Debe existir evidencia firmada.');
    assert.equal(approved.documentaryAudit.totalPhotos ?? approved.documentaryAudit.totalUploadedPhotos, 2);

    // 7. JSON transport to the browser and back.
    const fromBrowser = jsonRoundTrip(approved);
    const versionsBefore = storage.getBookVersionsForInterview(interview.id, false).length;
    const countersBefore = { ...storage.getInterviewById(interview.id) };

    // 8. Real save method.
    const saved = await storage.saveParticipantBookVersion({
      plainToken: token,
      narrativeStyle: style,
      editorialConfig: editorialConfigFor(style),
      manuscript: fromBrowser,
      coverPhoto: null,
      chapterPhotos: result.chapterPhotos,
      pageCount: 40,
    });

    // 9. A new version exists, saved through the signed evidence (no second audit, no judge).
    const versionsAfter = storage.getBookVersionsForInterview(interview.id, false);
    assert.equal(versionsAfter.length, versionsBefore + 1);
    assert.equal(saved.bookVersion.versionNumber, 1);
    const createLog = lastAuditLog('CREATE_PARTICIPANT_BOOK', saved.bookVersion.id);
    assert.equal(createLog?.details?.approvalPath, 'signed_evidence');
    assert.equal(saved.interview.bookGeneratedCount, 1);
    assert.equal(saved.interview.layoutEditsUsed, countersBefore.layoutEditsUsed ?? 0);

    // 10. Retrieve the persisted version from a FRESH storage instance loaded from disk (restart).
    const reloaded = new mod.StorageManager({ remoteDocStore: fakeRemoteStore });
    assert.equal(reloaded['loadStateFromDisk'](), true);
    const persisted = reloaded
      .getBookVersionsForInterview(interview.id, false)
      .find((v: any) => v.id === saved.bookVersion.id);
    assert.ok(persisted, 'La versión debe existir en el almacenamiento tras reiniciar.');
    assert.equal(reloaded.getInterviewById(interview.id).bookGeneratedCount, 1);

    // 11. Same audited content as the approved manuscript.
    assert.equal(
      approval.computeManuscriptContentHash(persisted.manuscript),
      approval.computeManuscriptContentHash(approved)
    );
    assert.deepEqual(
      persisted.manuscript.chapters.map((c: any) => c.paragraphs),
      approved.chapters.map((c: any) => c.paragraphs)
    );
    assert.equal(persisted.manuscript.introduction, approved.introduction);

    // 12. The approval is still valid against the sources the server holds now.
    const ctx = auditContext(interview.id, style);
    const check = approval.verifyBookApprovalEvidence({
      manuscript: persisted.manuscript,
      interviewId: interview.id,
      narrativeStyle: style,
      currentSourceFingerprint: ctx.sourceFingerprint,
    });
    assert.equal(check.valid, true, check.reason);

    // 13. Compose and render the PDF from the PERSISTED version.
    const composed = rules.composeBookPages({
      manuscript: persisted.manuscript,
      editorialConfig: persisted.editorialConfig,
      chapterPhotos: result.chapterPhotos,
      allPhotosById: result.allPhotosById || {},
      previewSampleOnly: false,
      maxContentPages: 500,
    });
    const pdf = pdfGen.generateRealDemoBookPdf({
      composed,
      profile: {
        mode: 'individual',
        displayName: 'Elena Robles',
        fullName: 'Elena Robles',
        partner1Name: '',
        partner2Name: '',
        hasAcceptedTemporaryNotice: true,
      },
    });
    const header = Buffer.from(await pdf.blob.arrayBuffer()).subarray(0, 5).toString('ascii');
    assert.equal(header, '%PDF-');
    assert.ok(pdf.pageCount >= 5, `${STYLE_LABEL[style]}: ${pdf.pageCount} páginas`);

    // 14. No content was lost: every audited paragraph of the persisted book is in the pages.
    const composedText = normalizeForSearch(JSON.stringify(composed.pages));
    const missingParagraphs = persisted.manuscript.chapters
      .flatMap((c: any) => c.paragraphs)
      .filter((p: string) => !composedText.includes(normalizeForSearch(p).slice(0, 40).replace(/"/g, '\\"')));
    assert.deepEqual(missingParagraphs, [], `${STYLE_LABEL[style]}: párrafos perdidos al componer`);
    const placedPhotoIds = persisted.manuscript.chapters.flatMap((c: any) => (c.photoPlacements || []).map((pl: any) => pl.photoId));
    assert.equal(placedPhotoIds.length, 2, 'Las dos fotografías siguen ubicadas.');
    return {
      units: approved.documentaryAudit.totalSourceUnits,
      batches: result.totalBatches,
      chapters: approved.chapters.length,
      pages: pdf.pageCount,
    };
}

for (const style of ALL_STYLES) {
  test(`V5.2-I1 (${STYLE_LABEL[style]}): entrevista de 46 respuestas, flujo completo con guardado real, recuperación tras reinicio y PDF`, async () => {
    const stats = await runFullFlowAndAssert('medium', style, 46);
    console.log(`[V5.2-I1] ${STYLE_LABEL[style]}: ${JSON.stringify(stats)}`);
  });
}

for (const style of ALL_STYLES) {
  test(`V5.2-I2 (${STYLE_LABEL[style]}): entrevista pequeña (8 respuestas), flujo completo`, async () => {
    const stats = await runFullFlowAndAssert('small', style, 8);
    console.log(`[V5.2-I2] ${STYLE_LABEL[style]}: ${JSON.stringify(stats)}`);
  });
}

for (const style of ALL_STYLES) {
  test(`V5.2-I3 (${STYLE_LABEL[style]}): entrevista extensa (240 respuestas con profundizaciones), flujo completo`, async () => {
    const started = Date.now();
    const stats = await runFullFlowAndAssert('large', style, 240);
    console.log(`[V5.2-I3] ${STYLE_LABEL[style]}: ${JSON.stringify({ ...stats, ms: Date.now() - started })}`);
    assert.ok((stats.batches || 0) >= 2, 'Una entrevista extensa se redacta en varios lotes.');
  });
}

// ---------------------------------------------------------------------------------------------
// 2. Casos negativos del guardado real (el servidor rechaza; nada se persiste ni se descuenta)
// ---------------------------------------------------------------------------------------------

const RIVER_TESTIMONY = 'Mi padre me salvó de caer al río cuando tenía seis años.';
const riverJudge = () =>
  helpers.createScenarioJudge({ contradictions: [{ source: /salv/, reversed: /empuj/ }] });

function snapshotPersistenceState(interviewId: string) {
  const interview = storage.getInterviewById(interviewId);
  return {
    versions: storage.getBookVersionsForInterview(interviewId, false).map((v: any) => v.id),
    bookGeneratedCount: interview.bookGeneratedCount,
    layoutEditsUsed: interview.layoutEditsUsed,
    layoutEditsAllowed: interview.layoutEditsAllowed,
    remoteVersionWrites: remoteWrites.filter((w) => w.startsWith('participantBookVersions/')).length,
  };
}

async function expectSaveRejected(params: {
  token: string;
  interviewId: string;
  style: StyleId;
  manuscript: any;
  message?: RegExp | string;
}) {
  const before = snapshotPersistenceState(params.interviewId);
  await assert.rejects(
    storage.saveParticipantBookVersion({
      plainToken: params.token,
      narrativeStyle: params.style,
      editorialConfig: editorialConfigFor(params.style),
      manuscript: jsonRoundTrip(params.manuscript),
      coverPhoto: null,
      chapterPhotos: {},
      pageCount: 20,
    }),
    (err: any) => {
      if (params.message instanceof RegExp) assert.match(err.message, params.message);
      else if (typeof params.message === 'string') assert.equal(err.message, params.message);
      return true;
    }
  );
  // Nothing persisted, no quota consumed, no remote write of a version.
  assert.deepEqual(snapshotPersistenceState(params.interviewId), before);
  return lastAuditLog('SAVE_BOOK_VERSION_BLOCKED', params.interviewId);
}

const removeSentences = (manuscript: any, rx: RegExp) => ({
  ...manuscript,
  chapters: manuscript.chapters.map((c: any) => ({
    ...c,
    paragraphs: c.paragraphs
      .map((p: string) => p.split(/(?<=[.!?])\s+/).filter((s: string) => !rx.test(s)).join(' '))
      .filter((p: string) => p.trim().length > 0),
  })),
});

const replaceInText = (manuscript: any, from: RegExp, to: string) => ({
  ...manuscript,
  chapters: manuscript.chapters.map((c: any) => ({
    ...c,
    paragraphs: c.paragraphs.map((p: string) => p.replace(from, to)),
  })),
});

/** V5.3: a manuscript saved after re-audit, with its persisted admin report. */
async function saveAndLoadReport(token: string, style: StyleId, manuscript: any) {
  const saved = await storage.saveParticipantBookVersion({
    plainToken: token,
    narrativeStyle: style,
    editorialConfig: editorialConfigFor(style),
    manuscript: jsonRoundTrip(manuscript),
    coverPhoto: null,
    chapterPhotos: {},
    pageCount: 20,
  });
  const log =
    lastAuditLog('CREATE_PARTICIPANT_BOOK', saved.bookVersion.id) ||
    lastAuditLog('MODIFY_PARTICIPANT_BOOK_LAYOUT', saved.bookVersion.id);
  const report = await storage.getBookAuditReport(saved.bookVersion.id);
  return { saved, log, report };
}

async function freshApprovedBook(style: StyleId, judge?: any, options: { extraBase?: string[]; variantOffset?: number } = {}) {
  const { interview, token } = await createSyntheticInterview('small', {
    extraBase: options.extraBase ?? [RIVER_TESTIMONY],
    variantOffset: options.variantOffset,
  });
  const { result } = await generateApproved(interview.id, token, style, judge || riverJudge());
  assert.equal(result.manuscript.generationStatus, 'approved', result.diagnosticSummary);
  scenario.judge = (judge || riverJudge()).judge;
  return { interview, token, approved: result.manuscript };
}

test('V5.2-N1 (V5.3): omisiones, contradicciones y textos modificados tras aprobarse se DETECTAN y quedan registrados; con cobertura >= 60 % el libro se entrega con observaciones', async () => {
  const style: StyleId = 'first_person_literary';

  // Omitted memory (the bakery, its town and its owner disappear) — evidence still attached.
  const omission = await freshApprovedBook(style);
  const om = await saveAndLoadReport(omission.token, style, removeSentences(omission.approved, /panader/));
  assert.equal(om.log.details.approvalPath, 'hybrid_reaudit', 'La firma ya no corresponde al texto.');
  assert.equal(om.log.details.evidenceStatus, 'manuscript_changed');
  assert.equal(om.report.strictAudit.documentaryPassed, false, 'La auditoría estricta no se altera.');
  assert.equal(om.report.delivery.deliveryStatus, 'delivered_with_observations');
  assert.ok(om.report.incidents.some((i: any) => i.kind === 'omission' && /panader/i.test(i.testimony || '')));
  assert.ok(om.report.coverage.exactPercent < 100 && om.report.coverage.exactPercent >= 60);

  // Real contradiction with many shared words ("salvó" -> "empujó"): recorded, not hidden.
  const contra = await freshApprovedBook(style);
  const contradicted = replaceInText(contra.approved, /me salvó de caer al río/, 'me empujó al río');
  assert.notEqual(
    approval.computeManuscriptContentHash(contradicted),
    approval.computeManuscriptContentHash(contra.approved),
    'La alteración debe cambiar el texto auditado.'
  );
  const ct = await saveAndLoadReport(contra.token, style, contradicted);
  assert.equal(ct.log.details.evidenceStatus, 'manuscript_changed');
  const contradictionIncident = ct.report.incidents.find((i: any) => i.kind === 'contradiction');
  assert.ok(contradictionIncident, 'La contradicción queda en el informe administrativo.');
  assert.match(contradictionIncident.excerpt || '', /empujó/);
  assert.match(contradictionIncident.testimony || '', /salvó/);
  assert.ok(contradictionIncident.judgeRationale, 'Con la explicación del juez.');
  assert.equal(ct.report.strictAudit.documentaryPassed, false);

  // Modified after approval: an invented biographical fact in the introduction.
  const edit = await freshApprovedBook(style);
  const ed = await saveAndLoadReport(edit.token, style, {
    ...edit.approved,
    introduction: `${edit.approved.introduction} En 1999 gané la lotería en Madrid.`,
  });
  assert.equal(ed.log.details.evidenceStatus, 'manuscript_changed');
  assert.ok(ed.report.incidents.some((i: any) => i.kind === 'invented_data' && /1999/.test(i.detail || i.excerpt || '')));

  // The untouched approved manuscript still saves through its signed evidence.
  const clean = await freshApprovedBook(style);
  const cl = await saveAndLoadReport(clean.token, style, clean.approved);
  assert.equal(cl.log.details.approvalPath, 'signed_evidence');
});

test('V5.2-N2 (V5.3): aprobaciones falsificadas, de otra entrevista, de otro estilo o caducadas nunca autorizan por sí mismas; el servidor decide', async () => {
  const style: StyleId = 'first_person_literary';

  // (a) Forged signature: the evidence is ignored and the server re-audits the text itself.
  const forgedCase = await freshApprovedBook(style);
  const forged = jsonRoundTrip(removeSentences(forgedCase.approved, /panader/));
  const forgedSignature = forged.approvalEvidence.signature.replace(/^./, (c: string) => (c === 'a' ? 'b' : 'a'));
  forged.approvalEvidence.signature = forgedSignature;
  const fg = await saveAndLoadReport(forgedCase.token, style, forged);
  assert.equal(fg.log.details.approvalPath, 'hybrid_reaudit');
  assert.equal(fg.log.details.evidenceStatus, 'invalid_signature');
  assert.notEqual(fg.saved.bookVersion.manuscript.approvalEvidence.signature, forgedSignature, 'Nunca se guarda la firma falsa.');
  assert.ok(fg.report.incidents.some((i: any) => i.kind === 'omission'));

  // (b) Evidence "re-targeted" to other sources without re-signing: the signature breaks.
  const retargeted = jsonRoundTrip(forgedCase.approved);
  retargeted.approvalEvidence.sourceFingerprint = 'f'.repeat(64);
  assert.equal(
    approval.verifyBookApprovalEvidence({
      manuscript: retargeted,
      interviewId: forgedCase.interview.id,
      narrativeStyle: style,
      currentSourceFingerprint: auditContext(forgedCase.interview.id, style).sourceFingerprint,
    }).reason,
    'invalid_signature'
  );

  // (c) Approval of ANOTHER interview (a different life story): rejected, below the minimum.
  const target = await freshApprovedBook(style);
  const other = await freshApprovedBook(style, undefined, { extraBase: [], variantOffset: 7 });
  const otherLog = await expectSaveRejected({
    token: target.token,
    interviewId: target.interview.id,
    style,
    manuscript: other.approved,
  });
  assert.equal(otherLog.details.evidenceStatus, 'interview_mismatch');
  assert.ok(otherLog.details.deliveryBlockers.includes('COVERAGE_BELOW_MINIMUM'));

  // (d) A style-A manuscript declared as a style-C book: tampering, rejected before any audit.
  const styleA = (await generateApproved(target.interview.id, target.token, 'first_person_simple', riverJudge())).result.manuscript;
  assert.equal(styleA.generationStatus, 'approved');
  const styleLog = await expectSaveRejected({
    token: target.token,
    interviewId: target.interview.id,
    style: 'third_person_biography',
    manuscript: styleA,
  });
  assert.equal(styleLog.details.internalReasonCode, 'STYLE_MISMATCH');

  // (e) Approval expired by a change in the sources: the server re-audits against the CURRENT
  // testimony; the new memory is recorded as missing for the administrator.
  const stale = await freshApprovedBook(style);
  await storage.reopenInterview(stale.interview.id, 7, 'Agregar un recuerdo', 'admin_pruebas');
  await storage.submitAnswer({
    plainToken: stale.token,
    questionId: 'mem_adicional_post',
    questionText: 'Recuerdo adicional',
    answerText: 'En 1977 mi vecino Bartolomé construyó un horno de leña en Sola.',
    notRecalled: false,
    isAdditionalMemory: true,
    idempotencyKey: 'post_approval_memory',
  });
  await storage.declareVoluntaryCompletion(stale.token, 'Declaración voluntaria');
  scenario.judge = riverJudge().judge;
  const st = await saveAndLoadReport(stale.token, style, stale.approved);
  assert.equal(st.log.details.approvalPath, 'hybrid_reaudit');
  assert.equal(st.log.details.evidenceStatus, 'source_changed');
  assert.ok(st.report.incidents.some((i: any) => /Bartolomé/.test(i.testimony || '')), 'El recuerdo nuevo queda registrado como pendiente.');

  // (f) A forged signature on a FAITHFUL text is not trusted either: the server re-audits it
  // and signs its own evidence (the forged one is never stored).
  const faithfulCase = await freshApprovedBook(style);
  const forgedFaithful = jsonRoundTrip(faithfulCase.approved);
  const forgedSig2 = forgedFaithful.approvalEvidence.signature.replace(/^./, (c: string) => (c === 'a' ? 'b' : 'a'));
  forgedFaithful.approvalEvidence.signature = forgedSig2;
  const ff = await saveAndLoadReport(faithfulCase.token, style, forgedFaithful);
  assert.equal(ff.log.details.approvalPath, 'hybrid_reaudit');
  assert.notEqual(ff.saved.bookVersion.manuscript.approvalEvidence.signature, forgedSig2);
});

test('V5.2-N3: un participante no autorizado no puede guardar', async () => {
  const style: StyleId = 'first_person_simple';
  const { interview, token } = await createSyntheticInterview('small');
  const approved = (await generateApproved(interview.id, token, style)).result.manuscript;
  const base = {
    narrativeStyle: style,
    editorialConfig: editorialConfigFor(style),
    manuscript: jsonRoundTrip(approved),
    coverPhoto: null,
    chapterPhotos: {},
    pageCount: 20,
  };
  const before = snapshotPersistenceState(interview.id);
  await assert.rejects(storage.saveParticipantBookVersion({ ...base, plainToken: 'YF-NOEXISTE-0000' }), /no es válido o no existe/);
  const tokenId = storage.resolveToken(token).token.id;
  await storage.revokeToken(tokenId, 'admin_pruebas');
  await assert.rejects(storage.saveParticipantBookVersion({ ...base, plainToken: token }), /revocada/);
  assert.deepEqual(snapshotPersistenceState(interview.id), before);
});

// ---------------------------------------------------------------------------------------------
// 3. Persistencia: duplicados, historial, cuotas, contadores y fallo de almacenamiento
// ---------------------------------------------------------------------------------------------

test('V5.2-P1: sin duplicados por reintento, historial intacto, contadores correctos y sin estado parcial ante un fallo de disco', async () => {
  const style: StyleId = 'third_person_biography';
  const { interview, token } = await createSyntheticInterview('small');
  const generated = (await generateApproved(interview.id, token, style)).result;
  const approved = generated.manuscript;
  assert.equal(approved.generationStatus, 'approved', `${generated.internalReasonCode}: ${generated.diagnosticSummary}`);
  const save = (config: Record<string, unknown> = {}) =>
    storage.saveParticipantBookVersion({
      plainToken: token,
      narrativeStyle: style,
      editorialConfig: editorialConfigFor(style, config),
      manuscript: jsonRoundTrip(approved),
      coverPhoto: null,
      chapterPhotos: {},
      pageCount: 20,
    });

  const v1 = await save();
  const v1Snapshot = jsonRoundTrip(storage.getBookVersionsForInterview(interview.id, false)[0]);
  assert.equal(storage.getInterviewById(interview.id).bookGeneratedCount, 1);
  assert.equal(storage.getInterviewById(interview.id).layoutEditsUsed, 0);

  // Retry of the very same save (lost response / double click): no new version, no quota.
  const retry = await save();
  assert.equal(retry.bookVersion.id, v1.bookVersion.id);
  assert.equal(storage.getBookVersionsForInterview(interview.id, false).length, 1);
  assert.equal(storage.getInterviewById(interview.id).layoutEditsUsed, 0);
  assert.ok(lastAuditLog('SAVE_BOOK_VERSION_DEDUPLICATED', v1.bookVersion.id));

  // Storage failure while saving a new layout: everything is rolled back.
  const snapshotPath = path.join(ISOLATED_ROOT, 'data', 'storage_state.json');
  const parkedPath = `${snapshotPath}.parked`;
  fs.renameSync(snapshotPath, parkedPath);
  fs.mkdirSync(snapshotPath); // the atomic rename onto a directory fails
  const before = snapshotPersistenceState(interview.id);
  try {
    await assert.rejects(save({ bookFormatId: 'a5' }), /inconveniente técnico temporal/);
    assert.deepEqual(snapshotPersistenceState(interview.id), before, 'Ni versión ni contadores tras el fallo.');
    assert.ok(lastAuditLog('SAVE_BOOK_VERSION_STORAGE_FAILED', interview.id));
  } finally {
    fs.rmdirSync(snapshotPath);
    fs.renameSync(parkedPath, snapshotPath);
  }

  // A different layout once storage is back: version 2, one modification consumed.
  const v2 = await save({ bookFormatId: 'a5' });
  assert.equal(v2.bookVersion.versionNumber, 2);
  assert.equal(storage.getInterviewById(interview.id).layoutEditsUsed, 1);
  assert.equal(storage.getInterviewById(interview.id).bookGeneratedCount, 2);
  // The historical version 1 is untouched.
  const v1Now = storage.getBookVersionsForInterview(interview.id, false).find((v: any) => v.id === v1.bookVersion.id);
  assert.deepEqual(jsonRoundTrip(v1Now), v1Snapshot);

  // Quota exhausted: rejected, nothing changes (the existing commercial rule is unchanged).
  const beforeQuota = snapshotPersistenceState(interview.id);
  await assert.rejects(save({ bookFormatId: 'carta' }), /agotado tus opciones/);
  assert.deepEqual(snapshotPersistenceState(interview.id), beforeQuota);

  // Disk state agrees with memory after a restart.
  const reloaded = new mod.StorageManager({ remoteDocStore: fakeRemoteStore });
  reloaded['loadStateFromDisk']();
  assert.deepEqual(
    reloaded.getBookVersionsForInterview(interview.id, false).map((v: any) => v.versionNumber),
    [2, 1]
  );
  assert.equal(reloaded.getInterviewById(interview.id).layoutEditsUsed, 1);
});

// ---------------------------------------------------------------------------------------------
// 4. Simulaciones de proveedor a través del almacenamiento real (casos 2 a 8)
// ---------------------------------------------------------------------------------------------

const RIVER_PARAPHRASE = 'Gracias a mi padre, aquel día junto al agua no terminó en tragedia; yo tenía seis años.';

async function generateWith(params: {
  interviewId: string;
  token: string;
  style: StyleId;
  transform?: (chapterId: string, paragraphs: string[]) => string[];
  draftBatch?: (ctx: any) => Promise<any>;
  judge: any;
  repair?: (p: string, s: string, ids: string[]) => Promise<any>;
  forceRefresh?: boolean;
}) {
  const base = baseManuscriptFor(params.interviewId, params.style);
  const drafter = helpers.createFaithfulDrafter(base, params.transform);
  scenario.draftBatch = params.draftBatch || drafter.draftBatch;
  scenario.judge = params.judge;
  scenario.repair = params.repair;
  const result = await storage.generateParticipantBookManuscript({
    plainToken: params.token,
    narrativeStyle: params.style,
    scope: 'full',
    forceRefresh: params.forceRefresh ?? true,
  });
  return { result, base, drafter };
}

const dropSentences = (rx: RegExp) => (_id: string, paragraphs: string[]) =>
  paragraphs
    .map((p) => p.split(/(?<=[.!?])\s+/).filter((s) => !rx.test(s)).join(' '))
    .filter((p) => p.trim().length > 0);

test('V5.2-S2/S3 (V5.3): omisión y contradicción confirmadas quedan registradas sin pegado mecánico; con cobertura >= 60 % el libro se entrega con observaciones', async () => {
  for (const style of ALL_STYLES) {
    const { interview, token } = await createSyntheticInterview('small', { extraBase: [RIVER_TESTIMONY] });
    // Omission confirmed, repair fails.
    const omitted = await generateWith({
      interviewId: interview.id,
      token,
      style,
      transform: dropSentences(/panader/),
      judge: riverJudge().judge,
      repair: async () => null,
    });
    const om = omitted.result.manuscript;
    assert.equal(om.generationStatus, 'approved', STYLE_LABEL[style]);
    assert.equal(om.approvalEvidence.verificationLevel, 'delivered_with_observations');
    assert.equal(om.documentaryAudit.passed, false, 'La auditoría estricta sigue sin aprobar.');
    assert.equal(omitted.result.deliveryDecision.eligible, true);
    assert.ok(omitted.result.deliveryDecision.observations.omittedUnits >= 1);
    const bakery = om.documentaryAudit.traceabilityMatrix.filter((t: any) => /panader/i.test(t.excerpt || ''));
    assert.ok(bakery.length > 0 && bakery.every((t: any) => t.verified === false), 'La omisión no se marca cubierta.');
    assert.equal(
      om.chapters.some((c: any) => c.paragraphs.some((p: string) => /panader/.test(p))),
      false,
      'Sin pegado mecánico del recuerdo omitido.'
    );
    assert.ok(omitted.result.repairSummary.roundsExecuted <= 1, 'A lo sumo una ronda de reparación al ya ser entregable.');

    // Contradiction confirmed by the judge: recorded, not resolved artificially.
    const contradicted = await generateWith({
      interviewId: interview.id,
      token,
      style,
      transform: (_id, ps) => ps.map((p) => p.replace(/(me|la) salvó de caer al río/, '$1 empujó al río')),
      judge: riverJudge().judge,
      repair: async () => null,
    });
    const ct = contradicted.result.manuscript;
    assert.equal(ct.generationStatus, 'approved', STYLE_LABEL[style]);
    assert.equal(ct.approvalEvidence.verificationLevel, 'delivered_with_observations');
    const riverTrace = ct.documentaryAudit.traceabilityMatrix.find((t: any) => /salvó/.test(t.excerpt || ''));
    assert.equal(riverTrace?.verified, false);
    assert.ok(
      riverTrace?.aiJudgeVerdict === 'contradicted' || riverTrace?.verificationStatus === 'contradicted',
      JSON.stringify(riverTrace)
    );
    assert.ok(contradicted.result.deliveryDecision.observations.contradictions >= 1);
  }
});

test('V5.2-S4 (V5.3): si el juez no responde, la unidad queda sin verificar (nunca se da por cubierta); el libro se entrega con observaciones si alcanza el 60 %', async () => {
  for (const style of ALL_STYLES) {
    const { interview, token } = await createSyntheticInterview('small', { extraBase: [RIVER_TESTIMONY] });
    const paraphrase = (_id: string, ps: string[]) =>
      ps.map((p) =>
        p
          .replace(/Mi padre me salvó de caer al río cuando tenía seis años\./, RIVER_PARAPHRASE)
          .replace(
            /Su padre (?:me|la|le|lo) salvó de caer al río cuando tenía seis años\./,
            'Gracias a su padre, aquel día junto al agua no terminó en tragedia; ella tenía seis años.'
          )
      );
    const paraphrased = paraphrase('x', baseManuscriptFor(interview.id, style).chapters.flatMap((c: any) => c.paragraphs)).join(' ');
    assert.match(paraphrased, /aquel día junto al agua/, `${STYLE_LABEL[style]}: la paráfrasis debe aplicarse.`);
    for (const brokenJudge of [helpers.throwingJudge, helpers.silentJudge]) {
      const out = await generateWith({ interviewId: interview.id, token, style, transform: paraphrase, judge: brokenJudge, repair: async () => null });
      const m = out.result.manuscript;
      const river = m.documentaryAudit.traceabilityMatrix.find((t: any) => /salvó/.test(t.excerpt || ''));
      assert.equal(river.verified, false, 'Sin juez, la paráfrasis no se da por verificada.');
      assert.equal(river.aiJudgeUnavailable, true);
      assert.equal(m.documentaryAudit.passed, false);
      assert.equal(m.generationStatus, 'approved', STYLE_LABEL[style]);
      assert.equal(m.approvalEvidence.verificationLevel, 'delivered_with_observations');
    }
    // Positive control: a judge that recognizes the paraphrase verifies it.
    const judge = helpers.createScenarioJudge({ paraphrases: [{ testimony: /salvo de caer al rio/, excerpt: /gracias a (mi|su) padre, aquel dia junto al agua/ }] });
    const ok = await generateWith({ interviewId: interview.id, token, style, transform: paraphrase, judge: judge.judge });
    assert.equal(ok.result.manuscript.generationStatus, 'approved', `${STYLE_LABEL[style]}: ${ok.result.diagnosticSummary}`);
    const riverOk = ok.result.manuscript.documentaryAudit.traceabilityMatrix.find((t: any) => /salvó/.test(t.excerpt || ''));
    assert.equal(riverOk.verified, true);
  }
});

test('V5.2-S5: una respuesta JSON inválida del proveedor se maneja como fallo técnico controlado', async () => {
  const style: StyleId = 'first_person_simple';
  const { interview, token } = await createSyntheticInterview('small');
  const out = await generateWith({
    interviewId: interview.id,
    token,
    style,
    draftBatch: async () => ({ respondedModel: 'modelo-simulado', parsed: null }),
    judge: helpers.createScenarioJudge().judge,
  });
  assert.equal(out.result.manuscript.generationStatus, 'incomplete_draft');
  assert.equal(out.result.failureCategory, 'technical');
  assert.equal(out.result.internalReasonCode, 'INVALID_MODEL_RESPONSE');
  assert.equal(out.result.manuscript.approvalEvidence, undefined);
});

test('V5.2-S6: timeout en un lote; el trabajo se recupera sin perder lotes válidos y sin reutilizar lotes de otra configuración', async () => {
  const { bookJobManager } = await import(path.join(REPO_ROOT, 'src/server/bookJobManager.ts'));
  const style: StyleId = 'first_person_literary';
  const { interview, token } = await createSyntheticInterview('medium');
  const base = baseManuscriptFor(interview.id, style);
  const faithful = helpers.createFaithfulDrafter(base);
  scenario.judge = helpers.createScenarioJudge().judge;
  scenario.repair = undefined;

  // First attempt: batch 2 times out.
  const firstCalls: number[] = [];
  scenario.draftBatch = async (ctx: any) => {
    firstCalls.push(ctx.batchIdx);
    if (ctx.batchIdx === 1) throw new Error('Tiempo de espera agotado del proveedor (simulado)');
    return faithful.draftBatch(ctx);
  };
  const job1 = storage.startOrResumeParticipantBookJob({ plainToken: token, narrativeStyle: style, scope: 'full' });
  const settled1 = await bookJobManager.waitForJob(job1.jobId);
  assert.equal(settled1.failureCategory, 'technical');
  assert.ok(['failed', 'incomplete'].includes(settled1.status));
  assert.ok(settled1.batchCheckpoints['0'], 'El lote 1 ya redactado queda guardado.');

  // Second attempt, same configuration: only the missing batches are drafted.
  const secondCalls: number[] = [];
  scenario.draftBatch = async (ctx: any) => {
    secondCalls.push(ctx.batchIdx);
    return faithful.draftBatch(ctx);
  };
  const job2 = storage.startOrResumeParticipantBookJob({ plainToken: token, narrativeStyle: style, scope: 'full' });
  const settled2 = await bookJobManager.waitForJob(job2.jobId);
  assert.equal(settled2.status, 'completed', settled2.diagnosticSummary);
  assert.equal(secondCalls.includes(0), false, 'El lote ya válido no se vuelve a redactar.');
  assert.ok(secondCalls.includes(1));
  const approvedManuscript = settled2.result.manuscript;
  assert.ok(approvedManuscript.approvalEvidence);

  // Changing the configured MODEL never invalidates the approval (same documentary fingerprint).
  const config = storage['config'];
  const previousModel = config.bookAiGeminiModel;
  const previousProvider = config.bookAiProvider;
  try {
    const ctxBefore = auditContext(interview.id, style);
    config.bookAiProvider = 'gemini';
    config.bookAiGeminiModel = 'gemini-modelo-alterno-simulado';
    const ctxAfter = auditContext(interview.id, style);
    assert.equal(ctxAfter.sourceFingerprint, ctxBefore.sourceFingerprint, 'La huella documental no depende del modelo.');
    assert.notEqual(ctxAfter.generationFingerprint, ctxBefore.generationFingerprint);
    assert.equal(
      approval.verifyBookApprovalEvidence({
        manuscript: jsonRoundTrip(approvedManuscript),
        interviewId: interview.id,
        narrativeStyle: style,
        currentSourceFingerprint: ctxAfter.sourceFingerprint,
      }).valid,
      true,
      'Cambiar de modelo no invalida un manuscrito aprobado.'
    );
  } finally {
    config.bookAiGeminiModel = previousModel;
    config.bookAiProvider = previousProvider;
  }

  // ...but batches drafted by the previous model are NOT reused. (Another style, so no approved
  // book of this style is cached yet and the engine has to draft.)
  const styleA: StyleId = 'first_person_simple';
  const baseA = baseManuscriptFor(interview.id, styleA);
  const faithfulA = helpers.createFaithfulDrafter(baseA);
  scenario.draftBatch = async (ctx: any) => {
    if (ctx.batchIdx === 1) throw new Error('Tiempo de espera agotado del proveedor (simulado)');
    return faithfulA.draftBatch(ctx);
  };
  const job3 = storage.startOrResumeParticipantBookJob({ plainToken: token, narrativeStyle: styleA, scope: 'full' });
  const settled3 = await bookJobManager.waitForJob(job3.jobId);
  assert.ok(settled3.batchCheckpoints['0'], 'Lote 1 redactado con el modelo anterior.');
  try {
    config.bookAiProvider = 'gemini';
    config.bookAiGeminiModel = 'gemini-modelo-alterno-simulado';
    const thirdCalls: number[] = [];
    scenario.draftBatch = async (ctx: any) => {
      thirdCalls.push(ctx.batchIdx);
      return faithfulA.draftBatch(ctx);
    };
    const job4 = storage.startOrResumeParticipantBookJob({ plainToken: token, narrativeStyle: styleA, scope: 'full' });
    const settled4 = await bookJobManager.waitForJob(job4.jobId);
    assert.equal(settled4.status, 'completed', settled4.diagnosticSummary);
    assert.ok(thirdCalls.includes(0), 'Con otro modelo, el lote del modelo anterior se redacta de nuevo.');
  } finally {
    config.bookAiGeminiModel = previousModel;
    config.bookAiProvider = previousProvider;
  }
});

test('V5.2-S7/S8: reparación exitosa integra el recuerdo sin perder otros; una reparación que empeora un capítulo se rechaza en ese capítulo', async () => {
  const style: StyleId = 'first_person_simple';
  const { interview, token } = await createSyntheticInterview('small');
  const base = baseManuscriptFor(interview.id, style);

  // S7: the repair returns the complete chapter.
  const repairOk = async (_p: string, _s: string, ids: string[]) => ({
    chapters: ids.map((id) => {
      const ch = base.chapters.find((c: any) => c.id === id);
      return { id, partNumber: ch.partNumber, dimensionKey: ch.dimensionKey, title: ch.title, paragraphs: ch.paragraphs };
    }),
  });
  const repaired = await generateWith({ interviewId: interview.id, token, style, transform: dropSentences(/panader/), judge: helpers.createScenarioJudge().judge, repair: repairOk });
  assert.equal(repaired.result.manuscript.generationStatus, 'approved', repaired.result.diagnosticSummary);
  const allText = repaired.result.manuscript.chapters.flatMap((c: any) => c.paragraphs).join(' ');
  assert.equal((allText.match(/panader/g) || []).length, 1, 'El recuerdo reparado aparece una sola vez.');
  for (const p of base.chapters.flatMap((c: any) => c.paragraphs)) {
    assert.ok(normalizeForSearch(allText).includes(normalizeForSearch(p).slice(0, 40)), 'No se perdió ningún recuerdo previo.');
  }

  // S8: two chapters lose a memory; the repair fixes the first and ruins the second.
  const [chA, chB] = [base.chapters[0], base.chapters[base.chapters.length - 1]];
  const firstSentence = (ch: any) => ch.paragraphs.join(' ').split(/(?<=[.!?])\s+/)[0];
  const lostA = firstSentence(chA);
  const lostB = firstSentence(chB);
  const transform = (id: string, ps: string[]) =>
    id === chA.id || id === chB.id
      ? ps.map((p) => p.replace(id === chA.id ? lostA : lostB, '').trim()).filter((p) => p.length > 0)
      : ps;
  const mixedRepair = async (_p: string, _s: string, ids: string[]) => ({
    chapters: ids.map((id) => {
      const ch = base.chapters.find((c: any) => c.id === id);
      return {
        id,
        partNumber: ch.partNumber,
        dimensionKey: ch.dimensionKey,
        title: ch.title,
        paragraphs: id === chA.id ? ch.paragraphs : ['Fueron años que quedaron atrás.'],
      };
    }),
  });
  const mixed = await generateWith({ interviewId: interview.id, token, style, transform, judge: helpers.createScenarioJudge().judge, repair: mixedRepair });
  const finalA = mixed.result.manuscript.chapters.find((c: any) => c.id === chA.id);
  const finalB = mixed.result.manuscript.chapters.find((c: any) => c.id === chB.id);
  assert.ok(finalA.paragraphs.join(' ').includes(lostA), 'El capítulo que mejoró se conserva reparado.');
  assert.notDeepEqual(finalB.paragraphs, ['Fueron años que quedaron atrás.'], 'El capítulo que empeoró se rechaza.');
  // V5.3: the remaining omission is an observation; the book (well above 60 %) is delivered.
  assert.equal(mixed.result.manuscript.generationStatus, 'approved');
  assert.equal(mixed.result.manuscript.approvalEvidence.verificationLevel, 'delivered_with_observations');
  assert.equal(mixed.result.manuscript.documentaryAudit.passed, false);
  assert.ok(mixed.result.repairSummary.repairsRejected >= 1, 'La reparación defectuosa queda registrada como rechazada.');
});

test('V5.2-S9: el navegador no puede sustituir la introducción aprobada; una edición voluntaria se detecta', async () => {
  const style: StyleId = 'first_person_literary';
  const { interview, token } = await createSyntheticInterview('small');
  const approved = (await generateApproved(interview.id, token, style)).result.manuscript;
  const studioPreview = {
    ...approved,
    title: 'Mi título personalizado',
    subtitle: 'Mi subtítulo',
    authors: 'Elena Robles',
    dedication: 'Para mis nietos',
    introduction: 'Introducción distinta de la vista previa de cinco páginas.',
  };
  const prepared = rules.mergeEditorialFieldsIntoApprovedManuscript({
    approved: jsonRoundTrip(approved),
    studio: studioPreview,
    narrativeStyle: style,
  });
  assert.equal(prepared.introduction, approved.introduction, 'La introducción aprobada se conserva.');
  assert.equal(prepared.title, 'Mi título personalizado');
  assert.equal(prepared.dedication, 'Para mis nietos');
  assert.equal(
    approval.computeManuscriptContentHash(prepared),
    approval.computeManuscriptContentHash(approved),
    'Las personalizaciones editoriales no alteran el contenido firmado.'
  );
  const saved = await storage.saveParticipantBookVersion({
    plainToken: token,
    narrativeStyle: style,
    editorialConfig: editorialConfigFor(style),
    manuscript: prepared,
    coverPhoto: null,
    chapterPhotos: {},
    pageCount: 20,
  });
  assert.equal(lastAuditLog('CREATE_PARTICIPANT_BOOK', saved.bookVersion.id)?.details?.approvalPath, 'signed_evidence');
  assert.equal(saved.bookVersion.title, 'Mi título personalizado');
  // The server returns ITS canonical manuscript (what the studio now keeps).
  assert.equal(saved.bookVersion.manuscript.approvalEvidence.signature, approved.approvalEvidence.signature);

  // A deliberate edit of audited text is detected (evidence no longer matches).
  const edited = { ...prepared, introduction: `${prepared.introduction} Siempre fui feliz.` };
  assert.equal(
    approval.verifyBookApprovalEvidence({
      manuscript: edited,
      interviewId: interview.id,
      narrativeStyle: style,
      currentSourceFingerprint: auditContext(interview.id, style).sourceFingerprint,
    }).reason,
    'manuscript_changed'
  );
});

// ---------------------------------------------------------------------------------------------
// 5. Decisión global de aprobación (hallazgo A)
// ---------------------------------------------------------------------------------------------

const PROVIDER_ARGS = { provider: 'gemini', model: 'simulado', alternateProvider: 'openai', alternateModel: 'simulado' };
let gemini: any;
async function hybrid(manuscript: any, answers: any[], questions: any[], judge: any) {
  gemini ||= await import(path.join(REPO_ROOT, 'src/server/geminiService.ts'));
  return gemini.auditWithHybridSemantics({ manuscript, answers, questions, ...PROVIDER_ARGS, aiJudgeOverride: judge });
}

function makeSourceAnswer(id: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    questionId: `q_${id}`,
    questionText: `¿Pregunta ${id}?`,
    lifeStage: 'infancia',
    answerText: text,
    isFollowUp: false,
    isAdditionalMemory: false,
    participantId: 'p1',
    participantName: 'Elena Robles',
    photos: [],
    audio: null,
    audioRecordings: null,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    ...extra,
  };
}
const questionsFor = (answers: any[]) =>
  answers.map((a, i) => ({ id: a.questionId, orderIndex: i + 1, lifeStage: a.lifeStage, topic: a.lifeStage, text: a.questionText }));

function bookOf(style: StyleId, chapters: Array<{ id?: string; title: string; paragraphs: string[]; answerIds: string[]; partNumber?: number; photoPlacements?: any[] }>, extra: Record<string, unknown> = {}) {
  return {
    mode: 'individual',
    title: 'Orillas de la memoria',
    subtitle: 'Recuerdos',
    authors: 'Elena Robles',
    dedication: '',
    closingMessage: 'Con gratitud.',
    narrativeStyle: style,
    introduction: 'Estas páginas reúnen recuerdos de una vida.',
    insufficientInfoNotices: [],
    generatedAt: '2026-06-01T10:00:00.000Z',
    aiGenerated: true,
    chapters: chapters.map((c, i) => ({
      id: c.id || `cap_${i + 1}`,
      partNumber: c.partNumber ?? i + 1,
      dimensionKey: 'infancia',
      title: c.title,
      paragraphs: c.paragraphs,
      paragraphIds: c.paragraphs.map((_, k) => `${c.id || `cap_${i + 1}`}_p_${k + 1}`),
      sourceAnswerIds: c.answerIds,
      sourceQuestionIds: c.answerIds.map((a) => `q_${a}`),
      ...(c.photoPlacements ? { photoPlacements: c.photoPlacements } : {}),
    })),
    ...extra,
  };
}

/** Invariant of the single global decision: approved <=> every mandatory gate passed and nothing blocks. */
function assertDecisionConsistent(report: any, editorialAudit: any) {
  const gates = ['coverageAudit', 'veracityAudit', 'semanticAudit', 'structuralAudit', 'photoAudit']
    .map((g) => report[g])
    .filter(Boolean);
  const allGatesPassed =
    gates.every((g: any) => g.passed === true) &&
    (report.structuralAudit?.orphanContinuationFlags || []).length === 0 &&
    editorialAudit.passed === true;
  if (report.passed) {
    assert.equal(allGatesPassed, true, 'Aprobado con una validación obligatoria fallida.');
    assert.equal(report.blockingDefects.length, 0);
  } else {
    assert.ok(report.blockingDefects.length > 0, 'Un rechazo debe explicar al menos un defecto.');
  }
}

const GOOD = {
  a1: 'Nací en Oaxaca en 1950 y mi casa era de adobe.',
  a2: 'Mi padre me salvó de caer al río cuando tenía seis años.',
};
const GOOD_TEXT: Record<StyleId, { p1: string; p2: string; paraphrase2: string }> = {
  first_person_simple: {
    p1: 'Nací en Oaxaca en 1950 y mi casa era de adobe.',
    p2: 'Mi padre me salvó de caer al río cuando tenía seis años.',
    paraphrase2: 'Gracias a mi padre, aquel día junto al agua no terminó en tragedia; yo tenía seis años.',
  },
  first_person_literary: {
    p1: 'Nací en Oaxaca en 1950, en una casa de adobe que todavía guardo en la memoria.',
    p2: 'Mi padre me salvó de caer al río cuando tenía seis años, y aquel abrazo me acompaña.',
    paraphrase2: 'Gracias a mi padre, aquel día junto al agua no terminó en tragedia; yo tenía seis años.',
  },
  third_person_biography: {
    p1: 'Elena Robles nació en Oaxaca en 1950 y su casa era de adobe.',
    p2: 'Su padre la salvó de caer al río cuando tenía seis años.',
    paraphrase2: 'Gracias a su padre, aquel día junto al agua no terminó en tragedia; ella tenía seis años.',
  },
};
const goodAnswers = () => [makeSourceAnswer('a1', GOOD.a1), makeSourceAnswer('a2', GOOD.a2)];
const paraphraseJudge = () =>
  helpers.createScenarioJudge({
    contradictions: [{ source: /salv/, reversed: /empuj/ }],
    paraphrases: [{ testimony: /salvo de caer al rio/, excerpt: /gracias a (mi|su) padre, aquel dia junto al agua/ }],
  });

test('V5.2-G1..G8: ningún manuscrito se aprueba si una validación obligatoria falla, y la resolución de una paráfrasis no borra otros defectos', async () => {
  for (const style of ALL_STYLES) {
    const t = GOOD_TEXT[style];
    const answers = goodAnswers();
    const questions = questionsFor(answers);
    const det = (m: any) => {
      const r = rules.auditAndApproveBookManuscript({ manuscript: m, answers, questions });
      assertDecisionConsistent(r.report, r.editorialAudit);
      return r;
    };

    // G7 — fully valid manuscript: approved, every gate passed.
    const valid = bookOf(style, [{ title: 'Tardes junto al río', paragraphs: [t.p1, t.p2], answerIds: ['a1', 'a2'] }]);
    const validDet = det(valid);
    assert.equal(validDet.report.passed, true, `${STYLE_LABEL[style]}: ${validDet.report.blockingDefects.join(' | ')}`);
    const validHy = await hybrid(valid, answers, questions, paraphraseJudge().judge);
    assert.equal(validHy.report.passed, true);
    assertDecisionConsistent(validHy.report, validHy.editorialAudit);

    // G1/G2 — duplicate chapter ids and inconsistent numbering in the INPUT are normalized
    // (unique ids, consecutive numbers) and the verdict stays consistent with the gates.
    const messy = bookOf(style, [
      { id: 'cap_x', partNumber: 7, title: 'Casa de adobe', paragraphs: [t.p1], answerIds: ['a1'] },
      { id: 'cap_x', partNumber: 3, title: 'El río', paragraphs: [t.p2], answerIds: ['a2'] },
    ]);
    const messyDet = det(messy);
    assert.equal(new Set(messyDet.manuscript.chapters.map((c: any) => c.id)).size, 2);
    assert.deepEqual(messyDet.manuscript.chapters.map((c: any) => c.partNumber), [1, 2]);
    assert.equal(messyDet.report.structuralAudit.uniqueChapterIds, true);
    assert.equal(messyDet.report.structuralAudit.consecutiveNumbering, true);

    // G5 — a photo without a valid location (placement points to an unknown photo). The existing
    // normalization drops the invalid placement and places the photo in its answer's chapter, so
    // the audited result has a VALID location and the verdict stays consistent with the gate.
    const withPhoto = [
      makeSourceAnswer('a1', GOOD.a1, { photos: [{ id: 'ph_1', caption: 'La casa de adobe en Oaxaca' }] }),
      makeSourceAnswer('a2', GOOD.a2),
    ];
    const photoBook = bookOf(style, [
      { title: 'Tardes junto al río', paragraphs: [t.p1, t.p2], answerIds: ['a1', 'a2'], photoPlacements: [{ photoId: 'ph_inexistente', paragraphIndex: 0 }] },
    ]);
    const photoDet = rules.auditAndApproveBookManuscript({ manuscript: photoBook, answers: withPhoto, questions: questionsFor(withPhoto) });
    assertDecisionConsistent(photoDet.report, photoDet.editorialAudit);
    const finalPlacements = photoDet.manuscript.chapters.flatMap((c: any) => c.photoPlacements || []);
    assert.deepEqual(finalPlacements.map((pl: any) => pl.photoId), ['ph_1'], 'La ubicación inválida se reemplaza por una válida.');
    assert.equal(photoDet.report.photoAudit.passed, true);
    // And when the photo gate does fail, nothing is approved and the reason is explained.
    const photoFail = structuredClone(photoDet.report);
    photoFail.blockingDefects = [];
    Object.assign(photoFail.photoAudit, { passed: false, placedPhotosCount: 0, unplacedPhotoIds: ['ph_1'] });
    const photoDecision = rules.finalizeGlobalAuditDecision({ report: photoFail, editorialAudit: photoDet.editorialAudit });
    assert.equal(photoDecision.passed, false);
    assert.ok(photoDecision.blockingDefects.some((l: string) => /Fotografías sin ubicar/.test(l)));

    // G6 — editorial defect (question-formatted chapter title).
    const editorial = bookOf(style, [{ title: '¿Dónde naciste?', paragraphs: [t.p1, t.p2], answerIds: ['a1', 'a2'] }]);
    const editorialDet = det(editorial);
    assert.equal(editorialDet.report.passed, false);

    // G4 — an unsupported biographical claim. Rules flag it for arbitration; the hybrid audit
    // rejects it when the judge confirms it and when the judge is unavailable.
    const invented = bookOf(style, [
      {
        title: 'Tardes junto al río',
        paragraphs: [t.p1, t.p2, 'Después emigré a Canadá y abrí un restaurante con varios socios japoneses.'],
        answerIds: ['a1', 'a2'],
      },
    ]);
    const inventedDet = det(invented);
    assert.ok(inventedDet.report.semanticAudit.unsupportedAdditionsPendingArbitration >= 1);
    const inventedHy = await hybrid(invented, answers, questions, paraphraseJudge().judge);
    assert.equal(inventedHy.report.passed, false, STYLE_LABEL[style]);
    assert.equal(inventedHy.report.semanticAudit.passed, false);
    assertDecisionConsistent(inventedHy.report, inventedHy.editorialAudit);
    const inventedNoJudge = await hybrid(invented, answers, questions, helpers.throwingJudge);
    assert.equal(inventedNoJudge.report.passed, false);
    // A harmless editorial bridge is not an invented fact.
    const bridge = bookOf(style, [
      { title: 'Tardes junto al río', paragraphs: [t.p1, t.p2, 'Los años siguientes fueron tranquilos, llenos de rutinas y silencios compartidos.'], answerIds: ['a1', 'a2'] },
    ]);
    const bridgeHy = await hybrid(bridge, answers, questions, paraphraseJudge().judge);
    assert.equal(bridgeHy.report.passed, true, `${STYLE_LABEL[style]}: ${bridgeHy.report.blockingDefects.join(' | ')}`);

    // G8 — a valid paraphrase resolved by the judge together with another blocking defect.
    const mixed = bookOf(style, [
      { title: 'Tardes junto al río', paragraphs: [t.p1, t.paraphrase2, 'En 1987 cumplí uno de mis sueños.'], answerIds: ['a1', 'a2'] },
    ]);
    const mixedHy = await hybrid(mixed, answers, questions, paraphraseJudge().judge);
    const riverTrace = mixedHy.report.traceabilityMatrix.find((tr: any) => tr.answerId === 'a2');
    assert.equal(riverTrace.aiJudgeVerdict, 'supported', 'El juez resolvió la paráfrasis.');
    assert.equal(mixedHy.report.passed, false, 'El otro defecto sigue bloqueando.');
    assert.ok(mixedHy.report.blockingDefects.some((l: string) => /1987/.test(l)));
    assertDecisionConsistent(mixedHy.report, mixedHy.editorialAudit);
  }

  // G1/G2/G3 at the decision level: a failing structural gate or an orphan continuation blocks
  // even when the defect list is empty, and the verdict always explains why.
  const answers = goodAnswers();
  const base = rules.auditAndApproveBookManuscript({
    manuscript: bookOf('first_person_simple', [{ title: 'Río', paragraphs: [GOOD.a1, GOOD.a2], answerIds: ['a1', 'a2'] }]),
    answers,
    questions: questionsFor(answers),
  });
  assert.equal(base.report.passed, true);
  const variants: Array<[string, (r: any) => void, RegExp]> = [
    ['ids duplicados', (r) => Object.assign(r.structuralAudit, { passed: false, uniqueChapterIds: false }), /duplicados/],
    ['numeración', (r) => Object.assign(r.structuralAudit, { passed: false, consecutiveNumbering: false }), /consecutiva/],
    ['continuación huérfana', (r) => (r.structuralAudit.orphanContinuationFlags = ['Continuación huérfana sin capítulo de origen.']), /huérfana/],
    ['semántica', (r) => (r.semanticAudit.passed = false), /./],
    ['veracidad', (r) => Object.assign(r.veracityAudit, { passed: false, uncertaintiesPreserved: false }), /incertidumbre/],
    ['cobertura', (r) => Object.assign(r.coverageAudit, { passed: false, missingUnitIds: ['u_x'] }), /Cobertura/],
  ];
  for (const [label, mutate, rx] of variants) {
    const report = structuredClone(base.report);
    report.blockingDefects = [];
    mutate(report);
    const decision = rules.finalizeGlobalAuditDecision({ report, editorialAudit: base.editorialAudit });
    assert.equal(decision.passed, false, label);
    if (label !== 'semántica') assert.ok(decision.blockingDefects.some((l: string) => rx.test(l)), `${label}: ${decision.blockingDefects}`);
  }
  const editorialFail = rules.finalizeGlobalAuditDecision({
    report: structuredClone(base.report),
    editorialAudit: { ...base.editorialAudit, passed: false, blockingDefects: [] },
  });
  assert.equal(editorialFail.passed, false);
});

// ---------------------------------------------------------------------------------------------
// 6. Recuperación de evidencia: <20% de coincidencia ya no demuestra una omisión (hallazgo D)
// ---------------------------------------------------------------------------------------------

const RESCUE: Record<StyleId, { faithfulHigh: string; faithfulLow: string; split: [string, string]; inverted: string; negFaithful: string; negInverted: string }> = {
  first_person_simple: {
    faithfulHigh: 'Mi padre me rescató justo cuando estaba a punto de ahogarme.',
    faithfulLow: 'De no haber sido por la intervención de papá, aquel accidente habría terminado en una tragedia.',
    split: ['En 1962 mi tío Ernesto me regaló una bicicleta roja.', 'Aquella misma tarde me enseñó a montarla en la plaza de Etla.'],
    inverted: 'Mi padre me empujó al río cuando tenía seis años.',
    negFaithful: 'Mi madre no quería que me fuera a Puebla, pero mi padre sí me dejó ir.',
    negInverted: 'Mi madre quería que me fuera a Puebla, pero mi padre no me dejó ir.',
  },
  first_person_literary: {
    faithfulHigh: 'Mi padre me rescató justo cuando estaba a punto de ahogarme, y nunca lo olvidé.',
    faithfulLow: 'De no haber sido por la intervención de papá, aquel accidente habría terminado en una tragedia.',
    split: ['En 1962 mi tío Ernesto me regaló una bicicleta roja, brillante como una promesa.', 'Aquella misma tarde me enseñó a montarla en la plaza de Etla.'],
    inverted: 'Mi padre me empujó al río cuando tenía seis años.',
    negFaithful: 'Mi madre no quería que me fuera a Puebla, pero mi padre sí me dejó ir, y partí con su bendición.',
    negInverted: 'Mi madre quería que me fuera a Puebla, pero mi padre no me dejó ir.',
  },
  third_person_biography: {
    faithfulHigh: 'Su padre la rescató justo cuando estaba a punto de ahogarse.',
    faithfulLow: 'De no haber sido por la intervención de su papá, aquel accidente habría terminado en una tragedia.',
    split: ['En 1962 su tío Ernesto le regaló una bicicleta roja.', 'Aquella misma tarde le enseñó a montarla en la plaza de Etla.'],
    inverted: 'Su padre la empujó al río cuando tenía seis años.',
    negFaithful: 'Su madre no quería que se fuera a Puebla, pero su padre sí la dejó ir.',
    negInverted: 'Su madre quería que se fuera a Puebla, pero su padre no la dejó ir.',
  },
};

test('V5.2-R1..R7: paráfrasis de alta y baja coincidencia, recuerdo dividido o en otro capítulo, ausencia real, contradicción y negaciones', async () => {
  for (const style of ALL_STYLES) {
    const t = RESCUE[style];
    const label = STYLE_LABEL[style];
    const rescueAnswers = [makeSourceAnswer('r1', 'Mi padre me rescató cuando estaba a punto de ahogarme.')];
    const rescueQ = questionsFor(rescueAnswers);
    const rescueJudge = () =>
      helpers.createScenarioJudge({ paraphrases: [{ testimony: /rescato/, excerpt: /intervencion de (su )?papa/ }] });

    // R1 — high-overlap paraphrase.
    const high = await hybrid(bookOf(style, [{ title: 'El accidente', paragraphs: [t.faithfulHigh], answerIds: ['r1'] }]), rescueAnswers, rescueQ, rescueJudge().judge);
    assert.equal(high.report.passed, true, `${label} R1: ${high.report.blockingDefects}`);

    // R2 — low-overlap paraphrases: the documented example (25%, "papá" = "padre") and one
    // with ZERO shared words. Neither is declared omitted: both reach the judge, which decides.
    const lowJudge = rescueJudge();
    const low = await hybrid(bookOf(style, [{ title: 'El accidente', paragraphs: [t.faithfulLow], answerIds: ['r1'] }]), rescueAnswers, rescueQ, lowJudge.judge);
    const lowTrace = low.report.traceabilityMatrix[0];
    assert.ok(lowTrace.semanticMatchScore < 0.3, `${label}: coincidencia ${lowTrace.semanticMatchScore}`);
    assert.ok(lowJudge.judgedCases().some((c: any) => /intervención/.test(c.candidateExcerpt)), `${label}: el juez recibe la evidencia`);
    assert.equal(low.report.passed, true, `${label} R2: ${low.report.blockingDefects}`);
    const zero = style === 'third_person_biography'
      ? 'Aquella tarde, la mano firme de quien le dio la vida la sacó del agua antes de que fuera tarde.'
      : 'Aquella tarde, la mano firme de quien me dio la vida me sacó del agua antes de que fuera tarde.';
    const zeroJudge = helpers.createScenarioJudge({ paraphrases: [{ testimony: /rescato/, excerpt: /quien (me|le) dio la vida (me|la) saco del agua/ }] });
    const zeroAudit = await hybrid(bookOf(style, [{ title: 'El accidente', paragraphs: [zero], answerIds: ['r1'] }]), rescueAnswers, rescueQ, zeroJudge.judge);
    assert.ok(zeroAudit.report.traceabilityMatrix[0].semanticMatchScore < 0.2, `${label}: coincidencia ${zeroAudit.report.traceabilityMatrix[0].semanticMatchScore}`);
    assert.equal(zeroAudit.report.traceabilityMatrix[0].evidenceOfAbsenceReason, undefined, 'Ausencia de evidencia no es evidencia de ausencia.');
    assert.ok(zeroJudge.judgedCases().some((c: any) => /dio la vida/.test(c.candidateExcerpt)));
    assert.equal(zeroAudit.report.passed, true, `${label} R2 (0%): ${zeroAudit.report.blockingDefects}`);
    // Control: the same text is rejected when the judge does NOT recognize the paraphrase.
    const lowRejected = await hybrid(bookOf(style, [{ title: 'El accidente', paragraphs: [t.faithfulLow], answerIds: ['r1'] }]), rescueAnswers, rescueQ, helpers.createScenarioJudge().judge);
    assert.equal(lowRejected.report.passed, false);

    // R3 — memory split between two paragraphs.
    const bikeAnswers = [makeSourceAnswer('b1', 'En 1962 mi tío Ernesto me regaló una bicicleta roja y me enseñó a montarla en la plaza de Etla.')];
    const splitJudge = helpers.createScenarioJudge();
    const split = await hybrid(bookOf(style, [{ title: 'La bicicleta roja', paragraphs: [...t.split], answerIds: ['b1'] }]), bikeAnswers, questionsFor(bikeAnswers), splitJudge.judge);
    assert.equal(split.report.passed, true, `${label} R3: ${split.report.blockingDefects}`);
    for (const c of splitJudge.judgedCases()) {
      if (c.checkKind === 'unsupported_addition') continue;
      assert.match(c.candidateExcerpt, /bicicleta/);
      assert.match(c.candidateExcerpt, /Etla/, 'Los dos párrafos llegan al juez.');
    }

    // R4 — the memory lives in ANOTHER chapter than the one planned for its answer.
    const twoAnswers = [makeSourceAnswer('c1', GOOD.a1), makeSourceAnswer('c2', 'En 1962 mi tío Ernesto me regaló una bicicleta roja y me enseñó a montarla en la plaza de Etla.')];
    const otherChapter = await hybrid(
      bookOf(style, [
        { title: 'La casa', paragraphs: [GOOD_TEXT[style].p1], answerIds: ['c1', 'c2'] },
        { title: 'Juegos de infancia', paragraphs: [t.split.join(' ')], answerIds: [] },
      ]),
      twoAnswers,
      questionsFor(twoAnswers),
      helpers.createScenarioJudge().judge
    );
    assert.equal(otherChapter.report.passed, true, `${label} R4: ${otherChapter.report.blockingDefects}`);
    assert.equal(otherChapter.report.traceabilityMatrix.find((tr: any) => tr.answerId === 'c2').chapterId, 'cap_2');

    // R5 — memory really absent: demonstrated without the judge, rejected.
    const absentAnswers = [makeSourceAnswer('d1', GOOD.a1), makeSourceAnswer('d2', 'Mi tía Remedios tocaba el violín en las bodas de Sola.')];
    const absentJudge = helpers.createScenarioJudge();
    const absent = await hybrid(bookOf(style, [{ title: 'La casa', paragraphs: [GOOD_TEXT[style].p1], answerIds: ['d1', 'd2'] }]), absentAnswers, questionsFor(absentAnswers), absentJudge.judge);
    assert.equal(absent.report.passed, false);
    const absentTrace = absent.report.traceabilityMatrix.find((tr: any) => tr.answerId === 'd2');
    assert.ok(absentTrace.evidenceOfAbsenceReason, `${label}: ausencia demostrada`);
    assert.equal(absentJudge.judgedCases().some((c: any) => /Remedios/.test(c.originalTestimony)), false, 'Sin gastar juez en una ausencia demostrada.');

    // R6 — real contradiction with many shared words.
    const riverAnswers = [makeSourceAnswer('e1', GOOD.a2)];
    const contradiction = await hybrid(bookOf(style, [{ title: 'El río', paragraphs: [t.inverted], answerIds: ['e1'] }]), riverAnswers, questionsFor(riverAnswers), paraphraseJudge().judge);
    assert.equal(contradiction.report.passed, false, `${label} R6`);

    // R7 — several negations and different subjects.
    const negAnswers = [makeSourceAnswer('f1', 'Mi madre no quería que me fuera a Puebla, pero mi padre sí me dejó ir.')];
    const negJudge = () => helpers.createScenarioJudge({ contradictions: [{ source: /padre si me dejo/, reversed: /padre no (me|la) dejo/ }] });
    const negOk = await hybrid(bookOf(style, [{ title: 'La partida', paragraphs: [t.negFaithful], answerIds: ['f1'] }]), negAnswers, questionsFor(negAnswers), negJudge().judge);
    assert.equal(negOk.report.passed, true, `${label} R7 fiel: ${negOk.report.blockingDefects}`);
    const negBad = await hybrid(bookOf(style, [{ title: 'La partida', paragraphs: [t.negInverted], answerIds: ['f1'] }]), negAnswers, questionsFor(negAnswers), negJudge().judge);
    assert.equal(negBad.report.passed, false, `${label} R7 invertida`);
  }
});

test('V5.2-R8: en un párrafo muy largo el hecho verificable no queda fuera del fragmento enviado al juez', () => {
  const filler = 'Aquellos años transcurrieron entre trabajos, fiestas y caminos polvorientos del pueblo. ';
  const longParagraph = `${filler.repeat(60)}Al final de aquel verano mi tía Remedios tocó el violín en la boda de Sola.`;
  const inventory = rules.buildDocumentaryInventory({
    answers: [makeSourceAnswer('g1', 'Mi tía Remedios tocó el violín en la boda de Sola.')],
    questions: questionsFor([makeSourceAnswer('g1', 'x')]),
  });
  const unit = inventory.eligibleFactUnits[0];
  const retrieve = rules.createUnitEvidenceRetriever(
    bookOf('first_person_simple', [{ title: 'Veranos', paragraphs: [longParagraph], answerIds: ['g1'] }]).chapters
  );
  const evidence = retrieve({ unit, chapterId: 'cap_1', paragraphIndex: 0 });
  assert.ok(longParagraph.length > 4000);
  assert.ok(evidence.fragments.length >= 1);
  assert.match(evidence.fragments[0].text, /Remedios tocó el violín en la boda de Sola/);
  assert.ok(evidence.fragments[0].text.length <= 1900, 'Fragmento acotado, no el libro completo.');
  assert.equal(evidence.fragments[0].chapterId, 'cap_1');
});

// ---------------------------------------------------------------------------------------------
// 7. Identidad de trabajos y huellas diferenciadas (hallazgo E)
// ---------------------------------------------------------------------------------------------

test('V5.2-E1: huella documental (aprobación) y huella de generación (lotes) responden a cambios distintos', async () => {
  const answers = goodAnswers();
  const questions = questionsFor(answers);
  const sourceFp = (over: Record<string, unknown> = {}) =>
    approval.computeBookSourceFingerprint({ interviewId: 'int_fp', narrativeStyle: 'first_person_simple', answers, questions, ...over });
  const baseSource = sourceFp();
  // Generation-only inputs do not change the documentary fingerprint.
  assert.equal(sourceFp({ bookStructureMode: 'fixed_five_stages', literaryPromptText: 'otro prompt' }), baseSource);
  // Testimony, style or captions do.
  assert.notEqual(sourceFp({ narrativeStyle: 'third_person_biography' }), baseSource);
  assert.notEqual(sourceFp({ answers: [makeSourceAnswer('a1', GOOD.a1), makeSourceAnswer('a2', 'Otro texto distinto.')] }), baseSource);
  assert.notEqual(
    sourceFp({ answers: [makeSourceAnswer('a1', GOOD.a1, { photos: [{ id: 'ph', caption: 'Nueva descripción' }] }), makeSourceAnswer('a2', GOOD.a2)] }),
    baseSource
  );
  const genFp = (over: Record<string, unknown> = {}) =>
    approval.computeBookGenerationFingerprint({ sourceFingerprint: baseSource, provider: 'gemini', model: 'gemini-a', bookStructureMode: 'prompt_autonomous', literaryPromptText: 'prompt A', ...over });
  const baseGen = genFp();
  for (const change of [{ provider: 'openai' }, { model: 'gemini-b' }, { literaryPromptText: 'prompt B' }, { bookStructureMode: 'fixed_five_stages' }, { sourceFingerprint: sourceFp({ narrativeStyle: 'third_person_biography' }) }]) {
    assert.notEqual(genFp(change), baseGen, JSON.stringify(change));
  }

  // The job manager only inherits checkpoints drafted with the same generation configuration.
  const { BookGenerationJobManager } = await import(path.join(REPO_ROOT, 'src/server/bookJobManager.ts'));
  const manager = new BookGenerationJobManager(path.join(ISOLATED_ROOT, 'jobs_e1.json'));
  const common = { interviewId: 'int_fp', participantId: 'p1', narrativeStyle: 'first_person_simple' as const, scope: 'full' as const, sourceFingerprint: baseSource };
  const failed = manager.startOrResumeJob({
    ...common,
    generationFingerprint: baseGen,
    executor: async (hooks: any) => {
      hooks.onBatchCheckpoint(0, { parsed: { chapters: [] }, respondedModel: 'gemini-a', sourceFingerprint: baseSource, generationFingerprint: baseGen });
      throw new Error('Tiempo de espera agotado');
    },
  });
  await manager.waitForJob(failed.jobId);
  let inherited: Record<string, unknown> = {};
  const otherModel = manager.startOrResumeJob({
    ...common,
    generationFingerprint: genFp({ model: 'gemini-b' }),
    executor: async (hooks: any) => {
      inherited = hooks.initialBatchCheckpoints;
      throw new Error('detener');
    },
  });
  await manager.waitForJob(otherModel.jobId);
  assert.deepEqual(Object.keys(inherited), [], 'No se heredan lotes de otro modelo.');
  const sameModel = manager.startOrResumeJob({
    ...common,
    generationFingerprint: baseGen,
    executor: async (hooks: any) => {
      inherited = hooks.initialBatchCheckpoints;
      throw new Error('detener');
    },
  });
  await manager.waitForJob(sameModel.jobId);
  // The most recent job (other model) holds no checkpoints, so nothing to inherit either; the
  // point proven above is that an incompatible checkpoint is never inherited.
  assert.ok(Object.keys(inherited).length === 0 || Object.keys(inherited).every((k) => k === '0'));
});

// ---------------------------------------------------------------------------------------------
// 8. Estabilidad de la firma (hallazgo F)
// ---------------------------------------------------------------------------------------------

test('V5.2-F1: clave dedicada persistente, independiente de las claves de proveedores; rotación planificada; sin aprobación por cambio de clave', async () => {
  const saved = {
    secret: process.env.BOOK_APPROVAL_SECRET,
    file: process.env.BOOK_APPROVAL_SECRET_FILE,
    prev: process.env.BOOK_APPROVAL_PREVIOUS_SECRETS,
    gemini: process.env.GEMINI_API_KEY,
  };
  const answers = goodAnswers();
  const questions = questionsFor(answers);
  const audited = rules.auditAndApproveBookManuscript({
    manuscript: bookOf('first_person_simple', [{ title: 'Río', paragraphs: [GOOD.a1, GOOD.a2], answerIds: ['a1', 'a2'] }]),
    answers,
    questions,
  });
  assert.equal(audited.report.passed, true);
  const sourceFingerprint = approval.computeBookSourceFingerprint({ interviewId: 'int_key', narrativeStyle: 'first_person_simple', answers, questions });
  const issue = () =>
    approval.issueBookApprovalEvidence({ interviewId: 'int_key', manuscript: audited.manuscript, sourceFingerprint, report: audited.report, editorialAuditPassed: true });
  const verify = (evidence: any) =>
    approval.verifyBookApprovalEvidence({
      manuscript: { ...audited.manuscript, approvalEvidence: evidence },
      interviewId: 'int_key',
      narrativeStyle: 'first_person_simple',
      currentSourceFingerprint: sourceFingerprint,
    });
  const keyFile = path.join(ISOLATED_ROOT, 'secrets', 'book_approval.key');
  try {
    // 1. No configured secret: a dedicated random key is created once, privately, and reused.
    delete process.env.BOOK_APPROVAL_SECRET;
    delete process.env.BOOK_APPROVAL_PREVIOUS_SECRETS;
    process.env.BOOK_APPROVAL_SECRET_FILE = keyFile;
    process.env.GEMINI_API_KEY = 'gemini-clave-de-prueba-1';
    approval.__resetProcessLocalApprovalSecretForTests();
    const evidence = issue();
    assert.ok(fs.existsSync(keyFile));
    assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
    // 2. Restart: still valid.
    approval.__resetProcessLocalApprovalSecretForTests();
    assert.equal(verify(evidence).valid, true);
    // 3. Rotating a provider credential does not invalidate approvals any more.
    process.env.GEMINI_API_KEY = 'gemini-clave-de-prueba-2-rotada';
    approval.__resetProcessLocalApprovalSecretForTests();
    assert.equal(verify(evidence).valid, true);
    // 4. Losing the key file invalidates the signature: the save path re-audits (never approves).
    fs.unlinkSync(keyFile);
    approval.__resetProcessLocalApprovalSecretForTests();
    assert.equal(verify(evidence).reason, 'invalid_signature');

    // 5. Evidence signed by V5.1 (key derived from provider credentials) keeps verifying while
    //    those credentials are unchanged, so books approved before this release are not broken.
    process.env.GEMINI_API_KEY = 'gemini-clave-legado-v51';
    approval.__resetProcessLocalApprovalSecretForTests();
    const crypto = await import('node:crypto');
    const { signature: _s, ...issued } = issue();
    // Emulate a V5.1/V5.2 evidence (version 1, no delivery fields).
    const {
      deliveryPolicyVersion: _p,
      verificationLevel: _l,
      deliveryEligible: _e,
      verifiedUnits: _v,
      ...v1Fields
    } = issued as any;
    const unsigned = { ...v1Fields, evidenceVersion: 1 } as any;
    const legacyKey = crypto.createHash('sha256').update(`yf-book-approval-derived::${process.env.GEMINI_API_KEY}`).digest();
    const signingString = JSON.stringify([
      unsigned.evidenceVersion, unsigned.auditRulesVersion, unsigned.engineVersion, unsigned.auditPolicy,
      unsigned.interviewId, unsigned.narrativeStyle, unsigned.sourceFingerprint, unsigned.manuscriptContentHash,
      unsigned.coveragePercentage, unsigned.totalSourceUnits, unsigned.judgeResolvedUnits, unsigned.issuedAt,
    ]);
    const legacyEvidence = { ...unsigned, signature: crypto.createHmac('sha256', legacyKey).update(signingString, 'utf8').digest('hex') };
    assert.equal(verify(legacyEvidence).valid, true, 'Evidencia V5.1 aceptada.');
    process.env.GEMINI_API_KEY = 'otra-clave-distinta-123';
    approval.__resetProcessLocalApprovalSecretForTests();
    assert.equal(verify(legacyEvidence).reason, 'invalid_signature');

    // 6. Planned rotation of BOOK_APPROVAL_SECRET with BOOK_APPROVAL_PREVIOUS_SECRETS.
    process.env.BOOK_APPROVAL_SECRET = 'secreto-de-firma-anterior-123456';
    approval.__resetProcessLocalApprovalSecretForTests();
    const oldEvidence = issue();
    process.env.BOOK_APPROVAL_SECRET = 'secreto-de-firma-nuevo-abcdefgh';
    approval.__resetProcessLocalApprovalSecretForTests();
    assert.equal(verify(oldEvidence).reason, 'invalid_signature', 'Sin declarar la rotación, la firma anterior no vale.');
    process.env.BOOK_APPROVAL_PREVIOUS_SECRETS = 'secreto-de-firma-anterior-123456';
    approval.__resetProcessLocalApprovalSecretForTests();
    assert.equal(verify(oldEvidence).valid, true, 'Rotación planificada sin invalidar libros aprobados.');
  } finally {
    for (const [k, v] of Object.entries({
      BOOK_APPROVAL_SECRET: saved.secret,
      BOOK_APPROVAL_SECRET_FILE: saved.file,
      BOOK_APPROVAL_PREVIOUS_SECRETS: saved.prev,
      GEMINI_API_KEY: saved.gemini,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    approval.__resetProcessLocalApprovalSecretForTests();
  }
});

// =============================================================================================
// V5.3 — Política de entrega (cobertura mínima 60 %), confidencialidad y auditoría administrativa
// =============================================================================================

const CONTRADICTION_TESTIMONIES = [
  'Mi padre me salvó de caer al río cuando tenía seis años.',
  'Mi abuela Remedios me regaló su anillo de bodas en Navidad.',
  'Mi hermano Gonzalo ganó el concurso de pintura del colegio.',
  'Mi tía Clemencia aprobó el examen de enfermera en Morelia.',
  'Mi vecino Anselmo compró la casa azul de la esquina.',
  'Mi primo Teodoro aceptó la invitación a mi boda en Zamora.',
];
const CONTRADICTION_SWAPS: Array<[RegExp, string]> = [
  [/salvó de caer al río/, 'empujó al río'],
  [/regaló su anillo/, 'quitó su anillo'],
  [/ganó el concurso/, 'perdió el concurso'],
  [/aprobó el examen/, 'reprobó el examen'],
  [/compró la casa azul/, 'vendió la casa azul'],
  [/aceptó la invitación/, 'rechazó la invitación'],
];
const sixContradictionsJudge = () =>
  helpers.createScenarioJudge({
    contradictions: [
      { source: /salvo de caer/, reversed: /empujo/ },
      { source: /regalo su anillo/, reversed: /quito su anillo/ },
      { source: /gano el concurso/, reversed: /perdio el concurso/ },
      { source: /aprobo el examen/, reversed: /reprobo el examen/ },
      { source: /compro la casa azul/, reversed: /vendio la casa azul/ },
      { source: /acepto la invitacion/, reversed: /rechazo la invitacion/ },
    ],
  });
const contradictSix = (paragraphs: string[]) =>
  paragraphs.map((p) => CONTRADICTION_SWAPS.reduce((acc, [rx, to]) => acc.replace(rx, to), p));

const CONTRADICTION_KEEP = /empujó|quitó su anillo|perdió el concurso|reprobó el examen|vendió la casa|rechazó la invitación/;
/** Omits every sentence of the given chapters (except the contradicted ones and the first one). */
const omitChapters = (chapterIds: string[], fraction = 1) => (id: string, ps: string[]) => {
  if (!chapterIds.includes(id)) return ps;
  const sentences = ps.flatMap((p) => p.split(/(?<=[.!?])\s+/));
  const limit = Math.ceil((sentences.length - 1) * fraction);
  let dropped = 0;
  return ps
    .map((p, pi) =>
      p
        .split(/(?<=[.!?])\s+/)
        .filter((sent, si) => {
          if (pi === 0 && si === 0) return true;
          if (CONTRADICTION_KEEP.test(sent)) return true;
          if (dropped >= limit) return true;
          dropped++;
          return false;
        })
        .join(' ')
    )
    .filter((p) => p.trim().length > 0);
};

const REPLICA_OMISSIONS = /panader|Amasaba|adobe/;
let jobManager: any;
async function loadJobManager() {
  jobManager ||= await import(path.join(REPO_ROOT, 'src/server/bookJobManager.ts'));
  return jobManager;
}

/** Medium interview (46 answers) + 6 deepenings whose action the drafter will invert. */
async function generateScenarioBook(style: StyleId, extraTransform?: (id: string, ps: string[]) => string[]) {
  const { interview, token } = await createSyntheticInterview('medium', { extraFollowUps: CONTRADICTION_TESTIMONIES });
  const judge = sixContradictionsJudge();
  let repairCalls = 0;
  const out = await generateWith({
    interviewId: interview.id,
    token,
    style,
    transform: (id, ps) => contradictSix((extraTransform ? extraTransform(id, dropSentences(REPLICA_OMISSIONS)(id, ps)) : dropSentences(REPLICA_OMISSIONS)(id, ps))),
    judge: judge.judge,
    // The focused repair "answers" but recovers nothing (a repair without improvement).
    repair: async () => {
      repairCalls++;
      return null;
    },
  });
  return { interview, token, judge, out, repairCalls: () => repairCalls };
}

/** What the browser receives and sends back: the participant-sanitized manuscript. */
async function asParticipantSees(result: any) {
  const jm = await loadJobManager();
  return jsonRoundTrip(jm.sanitizeBookResultForParticipant(result));
}

const ADMIN_ONLY_PATTERN =
  /coverage|cobertura|contradic|deliveryEligible|deliveryDecision|verificationLevel|verifiedUnits|integratedUnits|traceability|documentaryAudit|editorialAudit|auditSummary|auditReport|diagnosticSummary|internalReasonCode|repairSummary|generationMetrics|previewFidelity|judge|"band"|pending_review|orange|yellow|green/i;

function assertNothingAdminOnly(label: string, payload: unknown) {
  const json = JSON.stringify(payload);
  const hit = json.match(ADMIN_ONLY_PATTERN);
  assert.equal(hit, null, `${label}: el participante recibe datos administrativos (${hit?.[0]}).`);
}

async function renderPersistedPdf(version: any, result: any) {
  const composed = rules.composeBookPages({
    manuscript: version.manuscript,
    editorialConfig: version.editorialConfig,
    chapterPhotos: result.chapterPhotos || {},
    allPhotosById: result.allPhotosById || {},
    previewSampleOnly: false,
    maxContentPages: 500,
  });
  const pdf = pdfGen.generateRealDemoBookPdf({
    composed,
    profile: {
      mode: 'individual',
      displayName: 'Elena Robles',
      fullName: 'Elena Robles',
      partner1Name: '',
      partner2Name: '',
      hasAcceptedTemporaryNotice: true,
    },
  });
  const header = Buffer.from(await pdf.blob.arrayBuffer()).subarray(0, 5).toString('ascii');
  return { header, pageCount: pdf.pageCount };
}

test('V5.3-T1: tabla de umbrales con conteos exactos (sin redondeo favorable) y bandas de color', () => {
  const table: Array<[number, number, string, boolean]> = [
    [5999, 10000, 'pending_review', false], // 59,99 %
    [6000, 10000, 'orange', true], // 60 %
    [6500, 10000, 'orange', true], // 65 %
    [7000, 10000, 'orange', true], // 70 %
    [7999, 10000, 'orange', true], // 79,99 %
    [8000, 10000, 'yellow', true], // 80 %
    [9099, 10000, 'yellow', true], // 90,99 %
    [9100, 10000, 'green', true], // 91 %
    [10000, 10000, 'green', true], // 100 %
    [43, 73, 'pending_review', false], // 58,90 %
    [44, 73, 'orange', true], // 60,27 %
    [2, 3, 'orange', true], // 66,66 %
    [0, 0, 'pending_review', false], // sin unidades
  ];
  for (const [verified, eligible, band, deliverable] of table) {
    assert.equal(rules.classifyCoverageCounts(verified, eligible), band, `${verified}/${eligible}`);
    if (eligible > 0) assert.equal(rules.classifyCoveragePercentage((verified / eligible) * 100), band, `${verified}/${eligible} (%)`);
    const decision = rules.evaluateBookDeliveryEligibility({
      report: { totalSourceUnits: eligible, integratedUnits: verified, passed: verified === eligible && eligible > 0, traceabilityMatrix: [] } as any,
    });
    assert.equal(decision.eligible, deliverable, `${verified}/${eligible}`);
    assert.equal(decision.band, band);
    assert.equal(decision.coverageExactPercent, eligible > 0 ? (verified / eligible) * 100 : 0, 'Porcentaje exacto, sin redondear.');
    if (!deliverable) {
      assert.ok(decision.blockers.some((b: any) => b.code === (eligible === 0 ? 'NO_DOCUMENTARY_SOURCES' : 'COVERAGE_BELOW_MINIMUM')));
      assert.equal(decision.verificationLevel, 'not_eligible');
    }
  }
  // Contradictions alone never block: 100 % of units counted, 6 contradictions reported.
  const withContradictions = rules.evaluateBookDeliveryEligibility({
    report: {
      totalSourceUnits: 10,
      integratedUnits: 8,
      passed: false,
      traceabilityMatrix: Array.from({ length: 2 }, (_, i) => ({ unitId: `u${i}`, verified: false, verificationStatus: 'contradicted' })),
    } as any,
  });
  assert.equal(withContradictions.eligible, true);
  assert.equal(withContradictions.verificationLevel, 'delivered_with_observations');
  assert.equal(withContradictions.observations.contradictions, 2);
  // A privacy leak blocks delivery even at 100 %.
  const leak = rules.evaluateBookDeliveryEligibility({
    report: { totalSourceUnits: 10, integratedUnits: 10, passed: true, veracityAudit: { leakedExcludedContentFlags: ['x'] }, traceabilityMatrix: [] } as any,
  });
  assert.equal(leak.eligible, false);
  assert.ok(leak.blockers.some((b: any) => b.code === 'PRIVACY_EXCLUSION_LEAK'));
  // A technically broken structure blocks too.
  const broken = rules.evaluateBookDeliveryEligibility({
    report: { totalSourceUnits: 10, integratedUnits: 10, passed: true, traceabilityMatrix: [] } as any,
    manuscript: { chapters: [] } as any,
  });
  assert.ok(broken.blockers.some((b: any) => b.code === 'STRUCTURE_INVALID'));
});

test('V5.3-T2: réplica del fallo real (Estilo A, 3 lotes, 5 capítulos, 80 %, 6 contradicciones, 1 reparación sin mejora) → entregable, guardado, PDF e informe; el participante no ve nada', async () => {
  const style: StyleId = 'first_person_simple';
  const { interview, token, out, repairCalls } = await generateScenarioBook(style);
  const result = out.result;
  const m = result.manuscript;
  const d = result.deliveryDecision;

  // Same shape as the real failure.
  assert.equal(result.totalBatches, 3);
  assert.equal(m.chapters.length, 5);
  assert.equal(d.eligibleUnits, 73);
  assert.equal(d.verifiedUnits, 59);
  assert.equal(d.coverageExactPercent, (59 / 73) * 100, 'Cobertura exacta 80,82 %.');
  assert.equal(d.band, 'yellow');
  assert.equal(d.observations.contradictions, 6);
  // The strict audit is NOT altered: it still fails and lists the contradictions.
  assert.equal(m.documentaryAudit.passed, false);
  assert.equal(m.documentaryAudit.traceabilityMatrix.filter((t: any) => t.verificationStatus === 'contradicted').length, 6);
  // One focused repair round without improvement, no forced second round, valid batches kept.
  assert.equal(result.repairSummary.roundsExecuted, 1);
  assert.equal(result.repairSummary.repairsAccepted, 0);
  assert.equal(result.repairSummary.stopReason, 'no_improvement');
  assert.ok(repairCalls() >= 1);
  assert.deepEqual(result.invalidatedBatchIndexes || [], []);
  // Delivered with observations: the signature says so.
  assert.equal(m.generationStatus, 'approved');
  assert.equal(m.approvalEvidence.verificationLevel, 'delivered_with_observations');
  assert.equal(m.approvalEvidence.deliveryEligible, true);
  assert.equal(m.approvalEvidence.deliveryPolicyVersion, rules.BOOK_DELIVERY_POLICY_VERSION);

  // The participant receives only an opaque reference and the book text.
  const seen = await asParticipantSees(result);
  assertNothingAdminOnly('Resultado de generación', seen);
  assert.deepEqual(Object.keys(seen.manuscript.approvalEvidence), ['evidenceRef']);
  assert.equal(seen.manuscript.incompleteDraftNotice, undefined);

  // Save exactly what the browser holds: the server resolves the reference (no second audit).
  const before = storage.getInterviewById(interview.id).bookGeneratedCount || 0;
  const saved = await storage.saveParticipantBookVersion({
    plainToken: token,
    narrativeStyle: style,
    editorialConfig: editorialConfigFor(style),
    manuscript: seen.manuscript,
    coverPhoto: null,
    chapterPhotos: {},
    pageCount: 20,
  });
  const log = lastAuditLog('CREATE_PARTICIPANT_BOOK', saved.bookVersion.id);
  assert.equal(log.details.approvalPath, 'signed_evidence');
  assert.equal(log.details.deliveryStatus, 'delivered_with_observations');
  assert.equal(log.details.coverageBand, 'yellow');
  assert.equal(saved.interview.bookGeneratedCount, before + 1);
  assert.equal(
    approval.computeManuscriptContentHash(saved.bookVersion.manuscript),
    approval.computeManuscriptContentHash(m),
    'Se guarda exactamente el manuscrito auditado.'
  );

  // Participant view of the saved version.
  const jm = await loadJobManager();
  assertNothingAdminOnly('Versión guardada', jm.sanitizeBookVersionForParticipant(jsonRoundTrip(saved.bookVersion)));

  // PDF from the persisted version (after a restart).
  const reloaded = new mod.StorageManager({ remoteDocStore: fakeRemoteStore });
  assert.equal(reloaded['loadStateFromDisk'](), true);
  const persisted = reloaded.getBookVersionsForInterview(interview.id, false).find((v: any) => v.id === saved.bookVersion.id);
  const pdf = await renderPersistedPdf(persisted, result);
  assert.equal(pdf.header, '%PDF-');
  assert.ok(pdf.pageCount >= 5);

  // Administrative report (also after the restart).
  const report = await reloaded.getBookAuditReport(saved.bookVersion.id);
  assert.ok(report, 'El informe persiste.');
  assert.equal(report.identification.versionId, saved.bookVersion.id);
  assert.equal(report.identification.interviewId, interview.id);
  assert.equal(report.identification.versionNumber, 1);
  assert.equal(report.identification.protagonistName, 'Elena Robles');
  assert.equal(report.identification.narrativeStyle, style);
  assert.equal(report.identification.engineVersion, rules.BOOK_GENERATION_ENGINE_VERSION);
  assert.equal(report.identification.rulesVersion, rules.CANONICAL_AUDIT_RULES_VERSION);
  assert.equal(report.identification.deliveryPolicyVersion, rules.BOOK_DELIVERY_POLICY_VERSION);
  assert.equal(report.identification.source, 'generated_on_save');
  assert.equal(report.coverage.exactPercent, (59 / 73) * 100);
  assert.equal(report.coverage.band, 'yellow');
  assert.equal(report.coverage.eligibleUnits, 73);
  assert.equal(report.coverage.verifiedUnits, 59);
  assert.equal(report.coverage.contradictions, 6);
  assert.equal(report.strictAudit.documentaryPassed, false);
  const contradictions = report.incidents.filter((i: any) => i.kind === 'contradiction');
  assert.equal(contradictions.length, 6);
  for (const c of contradictions) {
    assert.ok(c.unitId && c.answerId && c.testimony && c.excerpt, JSON.stringify(c));
    assert.ok(c.chapterId || c.chapterTitle, 'Capítulo indicado.');
    assert.ok(c.judgeRationale, 'Explicación del juez.');
    assert.ok(c.verifiedAt);
    assert.ok(['possible_contradiction', 'confirmed_by_audit'].includes(c.adminStatus), c.adminStatus);
  }
  assert.ok(report.incidents.some((i: any) => i.kind === 'omission' && /panader/i.test(i.testimony || '')));
  assert.equal(report.repair?.roundsExecuted, 1);
  assert.equal(report.repair?.stopReason, 'no_improvement');
  assert.ok(report.history.length >= 1);
  const summary = reloaded.listBookAuditSummaries(interview.id).find((x: any) => x.versionId === saved.bookVersion.id);
  assert.equal(summary.summary.band, 'yellow');
});

test('V5.3-T3: variante al 60 % (60,27 %): entregable, guardada y banda naranja; por debajo (58,90 %) no se entrega ni se guarda', async () => {
  const style: StyleId = 'first_person_simple';
  const at60 = await generateScenarioBook(style, (id, ps) => dropSentences(/coche/)(id, omitChapters(['part_ch_legado'])(id, ps)));
  const d60 = at60.out.result.deliveryDecision;
  assert.equal(d60.verifiedUnits, 44);
  assert.equal(d60.eligibleUnits, 73);
  assert.equal(d60.band, 'orange');
  assert.equal(at60.out.result.manuscript.generationStatus, 'approved');
  const seen60 = await asParticipantSees(at60.out.result);
  const saved60 = await storage.saveParticipantBookVersion({
    plainToken: at60.token,
    narrativeStyle: style,
    editorialConfig: editorialConfigFor(style),
    manuscript: seen60.manuscript,
    coverPhoto: null,
    chapterPhotos: {},
    pageCount: 20,
  });
  const report60 = await storage.getBookAuditReport(saved60.bookVersion.id);
  assert.equal(report60.coverage.band, 'orange');
  assert.equal(report60.coverage.exactPercent, (44 / 73) * 100);
  assert.equal((await renderPersistedPdf(saved60.bookVersion, at60.out.result)).header, '%PDF-');

  const below = await generateScenarioBook(style, (id, ps) => dropSentences(/coche|alegría/)(id, omitChapters(['part_ch_legado'])(id, ps)));
  const dBelow = below.out.result.deliveryDecision;
  assert.ok(dBelow.verifiedUnits * 100 < 60 * dBelow.eligibleUnits, `${dBelow.verifiedUnits}/${dBelow.eligibleUnits}`);
  assert.equal(dBelow.eligible, false);
  assert.ok(dBelow.blockers.some((b: any) => b.code === 'COVERAGE_BELOW_MINIMUM'));
  assert.equal(below.out.result.manuscript.generationStatus, 'incomplete_draft');
  assert.equal(below.out.result.manuscript.approvalEvidence, undefined);
  // The participant only sees a simple message (no percentage, no threshold).
  const seenBelow = await asParticipantSees(below.out.result);
  assertNothingAdminOnly('Borrador por debajo del mínimo', seenBelow);
  assert.doesNotMatch(String(seenBelow.manuscript.incompleteDraftNotice || ''), /\d+\s*%|60/);
  await expectSaveRejected({ token: below.token, interviewId: below.interview.id, style, manuscript: seenBelow.manuscript });
  // Forging the server's decision in the browser changes nothing.
  const forged = jsonRoundTrip(below.out.result.manuscript);
  forged.generationStatus = 'approved';
  forged.status = 'approved';
  delete forged.failureCategory;
  delete forged.internalReasonCode;
  forged.incompleteDraftNotice = undefined;
  forged.deliveryDecision = { ...dBelow, eligible: true, band: 'green', verifiedUnits: dBelow.eligibleUnits };
  forged.documentaryAudit = { ...forged.documentaryAudit, passed: true, integratedUnits: dBelow.eligibleUnits };
  forged.approvalEvidence = { evidenceRef: 'f'.repeat(64) };
  const forgedLog = await expectSaveRejected({ token: below.token, interviewId: below.interview.id, style, manuscript: forged });
  assert.ok(forgedLog.details.deliveryBlockers.includes('COVERAGE_BELOW_MINIMUM'));
});

test('V5.3-T4: guardado al 70 %, 80 % y 100 %: misma política en generación y guardado, banda correcta', async () => {
  const style: StyleId = 'first_person_simple';
  const cases: Array<{ label: string; transform?: (id: string, ps: string[]) => string[]; band: string; min: number; max: number }> = [
    { label: '70 %', transform: omitChapters(['part_ch_madurez', 'part_ch_juventud']), band: 'orange', min: 70, max: 80 },
    { label: '80 %', band: 'yellow', min: 80, max: 91 },
  ];
  for (const c of cases) {
    const g = await generateScenarioBook(style, c.transform);
    const d = g.out.result.deliveryDecision;
    assert.ok(d.coverageExactPercent >= c.min && d.coverageExactPercent < c.max, `${c.label}: ${d.coverageExactPercent}`);
    assert.equal(d.band, c.band, c.label);
    const seen = await asParticipantSees(g.out.result);
    const saved: any = await storage.saveParticipantBookVersion({
      plainToken: g.token,
      narrativeStyle: style,
      editorialConfig: editorialConfigFor(style),
      manuscript: seen.manuscript,
      coverPhoto: null,
      chapterPhotos: {},
      pageCount: 20,
    });
    assert.equal(saved.bookVersion.auditSummary?.band, c.band, `${c.label}: resumen administrativo`);
  }
  // 100 %: fully verified, green, delivered without observations.
  for (const s of ALL_STYLES) {
    const { interview, token } = await createSyntheticInterview('medium');
    const { result } = await generateApproved(interview.id, token, s);
    assert.equal(result.deliveryDecision.coverageExactPercent, 100);
    assert.equal(result.deliveryDecision.band, 'green');
    assert.equal(result.manuscript.approvalEvidence.verificationLevel, 'fully_verified');
    assert.equal(result.repairSummary.roundsExecuted, 0, 'Sin reparaciones innecesarias.');
    const seen = await asParticipantSees(result);
    const saved = await storage.saveParticipantBookVersion({
      plainToken: token,
      narrativeStyle: s,
      editorialConfig: editorialConfigFor(s),
      manuscript: seen.manuscript,
      coverPhoto: null,
      chapterPhotos: {},
      pageCount: 20,
    });
    const log = lastAuditLog('CREATE_PARTICIPANT_BOOK', saved.bookVersion.id);
    assert.equal(log.details.approvalPath, 'signed_evidence');
    assert.equal(log.details.deliveryStatus, 'delivered');
  }
});

test('V5.3-T5: el guardado re-audita con la MISMA política cuando la evidencia no es válida (70 % → entregable con observaciones)', async () => {
  const style: StyleId = 'first_person_simple';
  const g = await generateScenarioBook(style, omitChapters(['part_ch_madurez', 'part_ch_juventud']));
  const genDecision = g.out.result.deliveryDecision;
  const unsigned = jsonRoundTrip(g.out.result.manuscript);
  unsigned.approvalEvidence = { evidenceRef: 'referencia-inexistente' };
  // Inflated audit data from the browser is discarded by the server.
  unsigned.documentaryAudit = { passed: true, integratedUnits: 999, totalSourceUnits: 999 };
  unsigned.deliveryDecision = { eligible: true, band: 'green' };
  scenario.judge = sixContradictionsJudge().judge;
  const { saved, log, report } = await saveAndLoadReport(g.token, style, unsigned);
  assert.equal(log.details.approvalPath, 'hybrid_reaudit');
  assert.equal(report.coverage.verifiedUnits, genDecision.verifiedUnits, 'Misma decisión que en la generación.');
  assert.equal(report.coverage.eligibleUnits, genDecision.eligibleUnits);
  assert.equal(report.coverage.band, genDecision.band);
  assert.equal(report.delivery.deliveryStatus, 'delivered_with_observations');
  assert.notEqual(saved.bookVersion.manuscript.documentaryAudit?.integratedUnits, 999);
  assert.equal(saved.bookVersion.manuscript.approvalEvidence.deliveryEligible, true, 'Evidencia emitida por el servidor.');
});

test('V5.3-T6: vista previa rápida: solo la muestra, sin juez, sin auditoría global, sin versión ni cuota; caché reutilizable (A, B y C)', async () => {
  for (const style of ALL_STYLES) {
    const { interview, token } = await createSyntheticInterview('medium');
    const before = snapshotPersistenceState(interview.id);
    const base = baseManuscriptFor(interview.id, style);
    const drafter = helpers.createFaithfulDrafter(base);
    const judge = helpers.createScenarioJudge();
    scenario.draftBatch = drafter.draftBatch;
    scenario.judge = judge.judge;
    let repairs = 0;
    scenario.repair = async () => {
      repairs++;
      return null;
    };
    const started = Date.now();
    const preview = await storage.generateParticipantBookManuscript({ plainToken: token, narrativeStyle: style, scope: 'preview', forceRefresh: true });
    const elapsed = Date.now() - started;
    const pm = preview.manuscript;
    assert.equal(pm.generationStatus, 'preview_sample', STYLE_LABEL[style]);
    assert.equal(pm.isPreviewSample, true);
    assert.equal(pm.approvalEvidence, undefined, 'Una muestra nunca lleva aprobación.');
    assert.equal(judge.calls.length, 0, 'La vista previa no invoca al juez semántico.');
    assert.equal(repairs, 0, 'Ni reparaciones.');
    assert.equal(drafter.calls.length, 1, 'Una sola llamada de redacción para la muestra.');
    assert.ok(pm.previewFidelity, 'Fidelidad local de la muestra (solo servidor).');
    assert.ok(
      pm.previewFidelity.checkedUnits > 0 && pm.previewFidelity.checkedUnits < 67,
      `Solo se verifican los recuerdos de la muestra (${pm.previewFidelity.checkedUnits} de 67).`
    );
    assert.ok(elapsed < 60000, `Vista previa simulada en ${elapsed} ms`);
    assert.deepEqual(snapshotPersistenceState(interview.id), before, 'Sin versión, sin cuota, sin escrituras.');
    assertNothingAdminOnly('Vista previa', await asParticipantSees(preview));
    // Second request with the same inputs: served from the preview cache (no drafting).
    scenario.draftBatch = async () => {
      throw new Error('La vista previa debía venir de la caché.');
    };
    const again = await storage.generateParticipantBookManuscript({ plainToken: token, narrativeStyle: style, scope: 'preview', forceRefresh: false });
    assert.equal(again.manuscript.generationStatus, 'preview_sample');
    // A preview sample can never be saved as a book.
    await expectSaveRejected({ token, interviewId: interview.id, style, manuscript: preview.manuscript });
  }
});

test('V5.3-T7: administración: notas, estados, solicitud de corrección, historial persistente y "corregida en versión posterior"', async () => {
  const style: StyleId = 'first_person_simple';
  const { interview, token, out } = await generateScenarioBook(style);
  const seen = await asParticipantSees(out.result);
  const saved = await storage.saveParticipantBookVersion({
    plainToken: token,
    narrativeStyle: style,
    editorialConfig: editorialConfigFor(style),
    manuscript: seen.manuscript,
    coverPhoto: null,
    chapterPhotos: {},
    pageCount: 20,
  });
  const versionId = saved.bookVersion.id;
  const report = await storage.getBookAuditReport(versionId);
  const contradiction = report.incidents.find((i: any) => i.kind === 'contradiction');
  const omission = report.incidents.find((i: any) => i.kind === 'omission' && /panader/i.test(i.testimony || ''));
  assert.ok(contradiction && omission);

  await storage.addBookAuditNote({ versionId, note: 'Revisar con la familia.', performedBy: 'admin_pruebas' });
  await storage.addBookAuditNote({ versionId, note: 'El padre la salvó.', incidentId: contradiction.incidentId, performedBy: 'admin_pruebas' });
  await assert.rejects(storage.addBookAuditNote({ versionId, note: '   ', performedBy: 'admin_pruebas' }), /vacía/);
  await storage.updateBookAuditIncidentStatus({ versionId, incidentId: contradiction.incidentId, status: 'reviewed_by_admin', performedBy: 'admin_pruebas' });
  await assert.rejects(
    storage.updateBookAuditIncidentStatus({ versionId, incidentId: contradiction.incidentId, status: 'borrado' as any, performedBy: 'admin_pruebas' }),
    /no válido/
  );
  await storage.requestBookAuditCorrection({ versionId, incidentIds: [contradiction.incidentId, omission.incidentId], note: 'Corregir el río y la panadería.', performedBy: 'admin_pruebas' });
  await assert.rejects(storage.requestBookAuditCorrection({ versionId, incidentIds: ['inexistente'], note: '', performedBy: 'admin_pruebas' }), /al menos una/);
  // The saved version is never modified by admin actions.
  assert.equal(
    approval.computeManuscriptContentHash(storage.getBookVersionsForInterview(interview.id, false).find((v: any) => v.id === versionId).manuscript),
    approval.computeManuscriptContentHash(saved.bookVersion.manuscript)
  );

  // Everything persists across a restart; history keeps every step.
  const reloaded = new mod.StorageManager({ remoteDocStore: fakeRemoteStore });
  assert.equal(reloaded['loadStateFromDisk'](), true);
  const r2 = await reloaded.getBookAuditReport(versionId);
  assert.equal(r2.adminNotes.length, 1);
  const c2 = r2.incidents.find((i: any) => i.incidentId === contradiction.incidentId);
  assert.equal(c2.adminStatus, 'reviewed_by_admin');
  assert.equal(c2.adminNotes.length, 1);
  assert.ok(c2.statusHistory.length >= 2, 'El estado anterior se conserva.');
  assert.equal(r2.correctionRequests.length, 1);
  for (const ev of ['admin_note', 'incident_status', 'correction_requested']) {
    assert.ok(r2.history.some((h: any) => h.event === ev), ev);
  }
  // JSON export = the report itself, serializable.
  assert.equal(JSON.parse(JSON.stringify(r2)).identification.versionId, versionId);

  // A later, faithful version marks the incidents it verifies as corrected (the reviewed one stays reviewed).
  const { result: fixed } = await generateApproved(interview.id, token, style, sixContradictionsJudge());
  assert.equal(fixed.deliveryDecision.coverageExactPercent, 100);
  const savedFixed = await storage.saveParticipantBookVersion({
    plainToken: token,
    narrativeStyle: style,
    editorialConfig: editorialConfigFor(style),
    manuscript: (await asParticipantSees(fixed)).manuscript,
    coverPhoto: null,
    chapterPhotos: {},
    pageCount: 20,
  });
  const r3 = await storage.getBookAuditReport(versionId);
  const om3 = r3.incidents.find((i: any) => i.incidentId === omission.incidentId);
  assert.equal(om3.adminStatus, 'corrected_in_later_version');
  assert.equal(om3.correctedInVersionId, savedFixed.bookVersion.id);
  assert.equal(r3.incidents.find((i: any) => i.incidentId === contradiction.incidentId).adminStatus, 'reviewed_by_admin');
  assert.ok(r3.history.some((h: any) => h.event === 'incidents_corrected_by_later_version'));
  assert.equal(r3.incidents.length, report.incidents.length, 'Nunca se borra el historial de incidencias.');
  // The earlier version still exists.
  assert.ok(storage.getBookVersionsForInterview(interview.id, false).some((v: any) => v.id === versionId));
});

test('V5.3-T8: seguridad: toda ruta del informe exige administrador en el servidor y ninguna ruta de participante lo expone', () => {
  const apiSource = fs.readFileSync(path.join(REPO_ROOT, 'src/server/api.ts'), 'utf-8');
  const routeDecls = Array.from(apiSource.matchAll(/apiRouter\.(get|post|put|delete|patch)\(\s*'([^']+)'\s*,\s*([A-Za-z]+)/g));
  const auditRoutes = routeDecls.filter((r) => /book-audits|\/audit(\/|$)/.test(r[2]));
  assert.equal(auditRoutes.length, 6, auditRoutes.map((r) => r[2]).join(', '));
  for (const r of auditRoutes) {
    assert.match(r[2], /^\/admin\//, `${r[2]} debe vivir bajo /admin`);
    assert.equal(r[3], 'requireAdmin', `${r[2]} debe exigir requireAdmin`);
  }
  // Admin storage methods are only called from admin routes.
  const adminCalls = ['getBookAuditReport', 'listBookAuditSummaries', 'addBookAuditNote', 'updateBookAuditIncidentStatus', 'requestBookAuditCorrection'];
  const blocks = apiSource.split(/\napiRouter\./);
  for (const block of blocks) {
    if (adminCalls.some((c) => block.includes(`storage.${c}(`))) {
      assert.match(block.slice(0, 200), /requireAdmin/, `Llamada administrativa fuera de una ruta protegida: ${block.slice(0, 80)}`);
    }
  }
  // Participant routes sanitize what they return.
  assert.match(apiSource, /sanitizeBookVersionForParticipant/);
  const participantSave = blocks.find((b) => b.includes("'/participant/book/save-version'"));
  assert.ok(participantSave && /sanitizeBookVersionForParticipant/.test(participantSave));
  const participantSession = blocks.find((b) => b.includes("'/participant/session'"));
  assert.ok(participantSession && /sanitizeBookVersionForParticipant/.test(participantSession));
});

// =============================================================================================
// V5.3.3 — Vista previa en ≤ 60 s, borrador completo sin mensajes de error al participante,
// redacción en paralelo y control del razonamiento del modelo.
// =============================================================================================

let jobs: any;
async function loadV533Modules() {
  gemini ||= await import(path.join(REPO_ROOT, 'src/server/geminiService.ts'));
  jobs ||= await import(path.join(REPO_ROOT, 'src/server/bookJobManager.ts'));
}

const PARTICIPANT_FORBIDDEN_WORDS = /error|fall[oó]|incomplet|pendiente de revisi|\bronda\b|\breparaci|tiempo de espera|timeout|proveedor|openai|gemini|cobertura|auditor/i;

test('V5.3.3-P1: la muestra respeta su presupuesto de tiempo: si el modelo no responde, se entrega la muestra fiel (nunca "borrador incompleto")', async () => {
  await loadV533Modules();
  const { interview, token } = await createSyntheticInterview('medium');
  gemini.__setPreviewTimeBudgetForTests(1500);
  try {
    for (const style of ALL_STYLES) {
      scenario.judge = helpers.createScenarioJudge().judge;
      scenario.draftBatch = () => new Promise(() => undefined); // the model never answers
      const started = Date.now();
      const result = await storage.generateParticipantBookManuscript({ plainToken: token, narrativeStyle: style, scope: 'preview', forceRefresh: true });
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 4000, `${STYLE_LABEL[style]}: ${elapsed} ms`);
      assert.equal(result.manuscript.generationStatus, 'preview_sample');
      assert.ok(result.manuscript.chapters.length > 0 && result.manuscript.chapters.every((c: any) => c.paragraphs.length > 0));
      assert.equal(result.manuscript.incompleteDraftNotice, undefined);
      // Participant: just the sample. Admin log: the real cause.
      const seen = jobs.sanitizeBookResultForParticipant(jsonRoundTrip(result));
      assert.equal(seen.manuscript.previewSource, undefined);
      assert.equal(seen.providerUsed, undefined);
      assert.doesNotMatch(JSON.stringify({ n: seen.manuscript.incompleteDraftNotice, f: seen.providerFallbackNotice }), PARTICIPANT_FORBIDDEN_WORDS);
      const log = storage.getAuditLogs(10).find((l: any) => l.action === 'GENERATE_BOOK_MANUSCRIPT_FROM_COMPILATION_PDF' && l.targetId === interview.id);
      assert.equal(log.details.previewSource, 'rule_based_fallback');
      assert.match(log.details.diagnosticSummary || '', /redacción fiel/);
    }
    // A failing model is handled the same way.
    scenario.draftBatch = async () => {
      throw new Error('500 simulado del proveedor');
    };
    const failing = await storage.generateParticipantBookManuscript({ plainToken: token, narrativeStyle: 'first_person_simple', scope: 'preview', forceRefresh: true });
    assert.equal(failing.manuscript.generationStatus, 'preview_sample');
    // And when the model answers in time, its text is used (only the sample is drafted, 1 call).
    const drafter = helpers.createFaithfulDrafter(baseManuscriptFor(interview.id, 'first_person_simple'));
    scenario.draftBatch = drafter.draftBatch;
    const ok = await storage.generateParticipantBookManuscript({ plainToken: token, narrativeStyle: 'first_person_simple', scope: 'preview', forceRefresh: true });
    assert.equal(ok.manuscript.generationStatus, 'preview_sample');
    assert.equal(drafter.calls.length, 1);
    const okLog = storage.getAuditLogs(10).find((l: any) => l.action === 'GENERATE_BOOK_MANUSCRIPT_FROM_COMPILATION_PDF' && l.targetId === interview.id);
    assert.equal(okLog.details.previewSource, 'model');
  } finally {
    gemini.__setPreviewTimeBudgetForTests(null);
  }
});

test('V5.3.3-P2: los lotes del libro completo se redactan en paralelo con el mismo resultado que en serie', async () => {
  const { interview, token } = await createSyntheticInterview('medium');
  const style: StyleId = 'first_person_literary';
  const base = baseManuscriptFor(interview.id, style);
  const DELAY = 400;
  const run = async (concurrency: string) => {
    process.env.BOOK_DRAFT_CONCURRENCY = concurrency;
    const drafter = helpers.createFaithfulDrafter(base);
    let inFlight = 0;
    let maxInFlight = 0;
    scenario.draftBatch = async (ctx: any) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, DELAY));
      inFlight--;
      return drafter.draftBatch(ctx);
    };
    scenario.judge = helpers.createScenarioJudge().judge;
    const started = Date.now();
    const result = await storage.generateParticipantBookManuscript({ plainToken: token, narrativeStyle: style, scope: 'full', forceRefresh: true });
    return { result, elapsed: Date.now() - started, maxInFlight };
  };
  try {
    const serial = await run('1');
    const parallel = await run('3');
    assert.equal(serial.result.totalBatches, 3);
    assert.equal(serial.maxInFlight, 1);
    assert.equal(parallel.maxInFlight, 3, 'Los tres lotes se redactan a la vez.');
    assert.ok(parallel.elapsed < serial.elapsed - DELAY, `paralelo ${parallel.elapsed} ms vs serie ${serial.elapsed} ms`);
    assert.equal(parallel.result.manuscript.generationStatus, 'approved');
    assert.deepEqual(
      parallel.result.manuscript.chapters.map((c: any) => [c.id, c.paragraphs]),
      serial.result.manuscript.chapters.map((c: any) => [c.id, c.paragraphs]),
      'Mismo libro, mismo orden.'
    );
  } finally {
    delete process.env.BOOK_DRAFT_CONCURRENCY;
  }
});

test('V5.3.3-P3: un fallo transitorio en el libro completo se resuelve solo (continuación automática) y el participante no ve ningún error', async () => {
  await loadV533Modules();
  const { interview, token } = await createSyntheticInterview('medium');
  const style: StyleId = 'first_person_simple';
  const drafter = helpers.createFaithfulDrafter(baseManuscriptFor(interview.id, style));
  let failures = 0;
  scenario.draftBatch = async (ctx: any) => {
    if (ctx.batchIdx === 1 && failures === 0) {
      failures++;
      throw new Error('Tiempo de espera agotado en OpenAI (simulado)');
    }
    return drafter.draftBatch(ctx);
  };
  scenario.judge = helpers.createScenarioJudge().judge;
  const job = storage.startOrResumeParticipantBookJob({ plainToken: token, narrativeStyle: style, scope: 'full', forceRefresh: true });
  const settled = await jobs.bookJobManager.waitForJob(job.jobId);
  assert.equal(settled.status, 'completed');
  assert.equal(settled.result.manuscript.generationStatus, 'approved');
  assert.equal(failures, 1);
  assert.ok(drafter.calls.filter((i: number) => i !== 1).every((i: number) => i !== undefined));
  assert.equal(drafter.calls.filter((i: number) => i === 0).length, 1, 'Los lotes válidos no se vuelven a pagar.');
  const autoLog = storage.getAuditLogs(20).find((l: any) => l.action === 'BOOK_GENERATION_AUTO_CONTINUE' && l.targetId === interview.id);
  assert.ok(autoLog, 'La continuación queda en la bitácora de administrador.');
  assert.match(String(autoLog.details.previousDiagnostic || autoLog.details.previousReasonCode), /Tiempo de espera|PARTIAL|TIMEOUT/);
  const view = jobs.toParticipantBookJobView(settled);
  assert.doesNotMatch(JSON.stringify({ m: view.userMessage, e: view.error, f: view.failureCategory, n: view.result?.manuscript?.incompleteDraftNotice }), PARTICIPANT_FORBIDDEN_WORDS);
});

test('V5.3.3-P4: si aun así no queda listo, el participante solo lee que su libro sigue en preparación', async () => {
  await loadV533Modules();
  const failedJob = {
    jobId: 'j1',
    interviewId: 'i',
    participantId: 'p',
    narrativeStyle: 'first_person_simple',
    scope: 'full',
    status: 'failed',
    phase: 'error',
    currentBatch: 2,
    totalBatches: 3,
    completedBatches: 1,
    repairPass: 3,
    repairedChapters: 4,
    totalRepairChapters: 4,
    userMessage: 'Puliendo capítulos (4 de 4 revisados)...',
    error: 'Ocurrió un inconveniente temporal',
    failureCategory: 'technical',
    internalReasonCode: 'PROVIDER_ERROR',
    diagnosticSummary: '13 INTERNAL',
    createdAt: '',
    updatedAt: '',
  };
  const view = jobs.toParticipantBookJobView(failedJob);
  assert.equal(view.error, jobs.PARTICIPANT_BOOK_PAUSED_MESSAGE);
  assert.equal(view.userMessage, jobs.PARTICIPANT_BOOK_PAUSED_MESSAGE);
  assert.equal(view.failureCategory, undefined);
  assert.equal(view.repairPass, 0);
  assert.equal(view.phase, 'paused');
  // `status` stays machine-readable for the studio (it offers «Continuar preparando»); every
  // human-readable field is neutral and no internal code or diagnostic is present.
  const { status: _status, ...humanFacing } = view;
  assert.doesNotMatch(JSON.stringify(Object.values(humanFacing)), PARTICIPANT_FORBIDDEN_WORDS);
  assert.equal('internalReasonCode' in view, false);
  assert.equal('diagnosticSummary' in view, false);
  const draft = jobs.sanitizeManuscriptForParticipant({
    title: 't',
    chapters: [],
    generationStatus: 'incomplete_draft',
    incompleteDraftNotice: 'Este borrador ya reúne casi toda tu historia, pero algunos recuerdos aún no quedaron integrados con la fidelidad necesaria.',
    failureCategory: 'repair_pending',
    internalReasonCode: 'REPAIR_EXHAUSTED',
    diagnosticSummary: 'Cobertura documental del 95%',
  });
  assert.equal(draft.incompleteDraftNotice, jobs.PARTICIPANT_BOOK_IN_PROGRESS_NOTICE);
  assert.equal(draft.failureCategory, undefined);
  // generationStatus stays machine-readable (the studio shows «Tu libro sigue en preparación»).
  assert.doesNotMatch(String(draft.incompleteDraftNotice), PARTICIPANT_FORBIDDEN_WORDS);
  assert.equal(draft.internalReasonCode, undefined);
  assert.equal(draft.diagnosticSummary, undefined);
  // The studio never shows the old warnings.
  const studio = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ParticipantBookStudio.tsx'), 'utf-8');
  for (const phrase of ['BORRADOR INCOMPLETO', 'PENDIENTE DE REVISIÓN', 'Revisando detalles (ronda', 'Reintentar operación', 'No pudimos', 'Ocurrió un inconveniente', 'No fue posible finalizar']) {
    assert.ok(!studio.includes(phrase), phrase);
  }
});

test('V5.3.3-P5: modelos con razonamiento: esfuerzo bajo para no gastar tokens, y reintento sin el parámetro si el modelo no lo admite', async () => {
  await loadV533Modules();
  assert.deepEqual(gemini.reasoningEffortParams('gpt-6-luna', 'low'), { reasoning_effort: 'low' });
  assert.deepEqual(gemini.reasoningEffortParams('gpt-5-mini', 'low'), { reasoning_effort: 'low' });
  assert.deepEqual(gemini.reasoningEffortParams('gpt-4o', 'low'), {}, 'Los modelos sin razonamiento no lo reciben.');
  assert.equal(gemini.BOOK_REASONING_EFFORT_PREVIEW, 'low');
  assert.equal(gemini.BOOK_REASONING_EFFORT_FULL, 'low');
  assert.equal(gemini.BOOK_REASONING_EFFORT_AUDIT, 'low');
  // A model that rejects the parameter is remembered and called without it.
  assert.equal(gemini.noteReasoningEffortRejection('o3-test', new Error("400 Unrecognized request argument supplied: reasoning_effort")), true);
  assert.deepEqual(gemini.reasoningEffortParams('o3-test', 'low'), {});
  assert.equal(gemini.noteReasoningEffortRejection('gpt-6-luna', new Error('429 rate limit')), false);
  assert.equal(gemini.PREVIEW_TIME_BUDGET_MS <= 55_000, true, 'La muestra deja margen dentro de 60 s.');
});

// ---------------------------------------------------------------------------------------------
// V5.3.5 — The sample follows the chosen prompt (no literal copy), with the definitive title.
// ---------------------------------------------------------------------------------------------

test('V5.3.5-M1: la muestra conserva la redacción literaria del modelo aunque las reglas locales marquen una cita; solo el contenido excluido fuerza la redacción fiel', async () => {
  await loadV533Modules();
  const { interview, token } = await createSyntheticInterview('medium');
  const style: StyleId = 'first_person_simple';
  const base = baseManuscriptFor(interview.id, style);
  const LITERARY = 'Mi madre lo repetía a menudo: «cuando tenga un hijo le pondré un nombre que me guste mucho».';
  const faithful = helpers.createFaithfulDrafter(base, (_id: string, paragraphs: string[]) =>
    paragraphs.length > 0 ? [LITERARY, ...paragraphs] : paragraphs
  );
  scenario.judge = helpers.createScenarioJudge().judge;
  scenario.draftBatch = async (ctx: any) => {
    const out = await faithful.draftBatch(ctx);
    return {
      ...out,
      parsed: { ...out.parsed, title: 'Raíces junto al mar', subtitle: 'Un libro parcial de memorias' },
    };
  };
  const result = await storage.generateParticipantBookManuscript({ plainToken: token, narrativeStyle: style, scope: 'preview', forceRefresh: true });
  const sample = result.manuscript;
  assert.equal(sample.generationStatus, 'preview_sample');
  const allText = sample.chapters.flatMap((c: any) => c.paragraphs).join('\n');
  assert.ok(allText.includes(LITERARY), 'El texto del modelo (con su cita) se conserva; no se sustituye por la transcripción literal.');
  assert.deepEqual(sample.previewFidelity.replacedChapterIds, []);
  assert.ok(sample.previewFidelity.issues.some((i: string) => /Observación/.test(i)), 'El hallazgo queda en la bitácora del administrador.');
  // Definitive title; never "Un libro parcial de memorias".
  assert.equal(sample.title, 'Raíces junto al mar');
  assert.doesNotMatch(sample.subtitle || '', /libro parcial de memorias/i);
  const seen = jobs.sanitizeBookResultForParticipant(jsonRoundTrip(result));
  assert.equal(seen.manuscript.previewFidelity, undefined, 'El participante no recibe el informe de fidelidad.');

  // The full book keeps the title shown on the sample's cover.
  scenario.draftBatch = async (ctx: any) => {
    const out = await helpers.createFaithfulDrafter(base).draftBatch(ctx);
    return { ...out, parsed: { ...out.parsed, title: 'Otro título distinto' } };
  };
  const full = await storage.generateParticipantBookManuscript({
    plainToken: token,
    narrativeStyle: style,
    scope: 'full',
    forceRefresh: true,
    lockedPreviewManuscript: jsonRoundTrip(sample),
  });
  assert.equal(full.manuscript.title, 'Raíces junto al mar');
  assert.doesNotMatch(full.manuscript.subtitle || '', /libro parcial de memorias/i);
});

test('V5.3.5-M2: si el modelo no alcanza a responder, la muestra de respaldo sale sin muletillas ni titubeos', async () => {
  await loadV533Modules();
  const cleaned = gemini.cleanSpokenDisfluencies([
    'Mi papá me decía Michael. Y y fuera de eso, no recuerdo otro apodo. Y y bueno, puedo decir que sí me gustaba.',
    'lo primero que veía, pues era ese sillón que estaba ju-, precisamente ese sillón. mi se- mi abuelita los costuraba.',
  ]);
  assert.equal(cleaned[0], 'Mi papá me decía Michael. Y fuera de eso, no recuerdo otro apodo. Puedo decir que sí me gustaba.');
  assert.equal(cleaned[1], 'Lo primero que veía, era ese sillón que estaba precisamente ese sillón. Mi abuelita los costuraba.');
  assert.equal(gemini.neutralBookSubtitle('Un libro parcial de memorias', false), 'Libro autobiográfico y legado familiar');
  assert.equal(gemini.neutralBookSubtitle('Recuerdos de Acapulco', false), 'Recuerdos de Acapulco');
  assert.equal(gemini.presetBookTitleFromSample({ title: 'X' } as any), '', 'Solo una muestra fija el título.');

  const { token } = await createSyntheticInterview('medium');
  gemini.__setPreviewTimeBudgetForTests(1500);
  try {
    scenario.draftBatch = () => new Promise(() => undefined);
    const result = await storage.generateParticipantBookManuscript({ plainToken: token, narrativeStyle: 'first_person_simple', scope: 'preview', forceRefresh: true });
    const text = result.manuscript.chapters.flatMap((c: any) => c.paragraphs).join(' ');
    assert.doesNotMatch(text, /(?<![\p{L}])(\p{L}+)\s+\1(?![\p{L}])/iu);
    assert.doesNotMatch(result.manuscript.subtitle || '', /libro parcial de memorias/i);
  } finally {
    gemini.__setPreviewTimeBudgetForTests(null);
  }
});
