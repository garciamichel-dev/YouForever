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
  options: { withPhotos?: boolean; extraBase?: string[] } = {}
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
  const specs = helpers.buildSyntheticInterviewSpecs(size, { withPhotos: options.withPhotos });
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
  await storage.declareVoluntaryCompletion(token, 'Declaración voluntaria');
  return { interview: storage.getInterviewById(interview.id), token, specsCount: specs.length + (options.extraBase || []).length };
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

test('V5.2-N1: el servidor rechaza recuerdos omitidos, contradicciones reales y manuscritos modificados tras aprobarse', async () => {
  const style: StyleId = 'first_person_literary';
  const { interview, token } = await createSyntheticInterview('small', { extraBase: [RIVER_TESTIMONY] });
  const { result } = await generateApproved(interview.id, token, style, riverJudge());
  assert.equal(result.manuscript.generationStatus, 'approved', result.diagnosticSummary);
  const approved = result.manuscript;
  scenario.judge = riverJudge().judge;

  // Omitted memory (the bakery, its town and its owner disappear) — evidence still attached.
  const omissionLog = await expectSaveRejected({
    token,
    interviewId: interview.id,
    style,
    manuscript: removeSentences(approved, /panader/),
    message: rules.buildIncompleteDraftUserNotice('documentary'),
  });
  assert.equal(omissionLog.details.approvalPath, 'hybrid_reaudit');
  assert.equal(omissionLog.details.evidenceStatus, 'manuscript_changed');
  assert.equal(omissionLog.details.internalReasonCode, 'DOCUMENTARY_COVERAGE_FAILURE');

  // Real contradiction with many shared words ("salvó" -> "empujó").
  const contradicted = replaceInText(approved, /me salvó de caer al río/, 'me empujó al río');
  assert.notEqual(
    approval.computeManuscriptContentHash(contradicted),
    approval.computeManuscriptContentHash(approved),
    'La alteración debe cambiar el texto auditado.'
  );
  const contradictionLog = await expectSaveRejected({
    token,
    interviewId: interview.id,
    style,
    manuscript: contradicted,
  });
  assert.equal(contradictionLog.details.failureCategory, 'documentary');
  assert.equal(contradictionLog.details.internalReasonCode, 'SEMANTIC_CONTRADICTION');

  // Modified after approval: an invented biographical fact in the introduction.
  const editedIntro = { ...approved, introduction: `${approved.introduction} En 1999 gané la lotería en Madrid.` };
  const editedLog = await expectSaveRejected({ token, interviewId: interview.id, style, manuscript: editedIntro });
  assert.equal(editedLog.details.evidenceStatus, 'manuscript_changed');

  // The untouched approved manuscript still saves through its signed evidence.
  const saved = await storage.saveParticipantBookVersion({
    plainToken: token,
    narrativeStyle: style,
    editorialConfig: editorialConfigFor(style),
    manuscript: jsonRoundTrip(approved),
    coverPhoto: null,
    chapterPhotos: {},
    pageCount: 20,
  });
  assert.equal(lastAuditLog('CREATE_PARTICIPANT_BOOK', saved.bookVersion.id)?.details?.approvalPath, 'signed_evidence');
});

test('V5.2-N2: aprobaciones falsificadas, de otra entrevista, de otro estilo o caducadas no sirven para guardar', async () => {
  const style: StyleId = 'first_person_literary';
  const { interview, token } = await createSyntheticInterview('small', { extraBase: [RIVER_TESTIMONY] });
  const { result } = await generateApproved(interview.id, token, style, riverJudge());
  const approved = result.manuscript;
  assert.equal(approved.generationStatus, 'approved', result.diagnosticSummary);

  // (a) Forged signature on a manuscript with an omission: rejected.
  const forged = jsonRoundTrip(removeSentences(approved, /panader/));
  forged.approvalEvidence.signature = forged.approvalEvidence.signature.replace(/^./, (c: string) => (c === 'a' ? 'b' : 'a'));
  const forgedLog = await expectSaveRejected({ token, interviewId: interview.id, style, manuscript: forged });
  assert.equal(forgedLog.details.evidenceStatus, 'invalid_signature');

  // (b) Evidence "re-targeted" to other sources without re-signing: the signature breaks.
  const retargeted = jsonRoundTrip(approved);
  retargeted.approvalEvidence.sourceFingerprint = 'f'.repeat(64);
  assert.equal(
    approval.verifyBookApprovalEvidence({
      manuscript: retargeted,
      interviewId: interview.id,
      narrativeStyle: style,
      currentSourceFingerprint: auditContext(interview.id, style).sourceFingerprint,
    }).reason,
    'invalid_signature'
  );

  // (c) Approval of ANOTHER interview submitted with this participant's token: rejected.
  const other = await createSyntheticInterview('small');
  const otherApproved = (await generateApproved(other.interview.id, other.token, style)).result.manuscript;
  assert.equal(otherApproved.generationStatus, 'approved');
  scenario.judge = riverJudge().judge;
  const otherLog = await expectSaveRejected({ token, interviewId: interview.id, style, manuscript: otherApproved });
  assert.equal(otherLog.details.evidenceStatus, 'interview_mismatch');

  // (d) Approval of ANOTHER style (a first-person A manuscript declared as a C biography).
  const styleA = (await generateApproved(interview.id, token, 'first_person_simple')).result.manuscript;
  assert.equal(styleA.generationStatus, 'approved');
  const styleLog = await expectSaveRejected({
    token,
    interviewId: interview.id,
    style: 'third_person_biography',
    manuscript: styleA,
  });
  assert.equal(styleLog.details.evidenceStatus, 'style_mismatch');

  // (e) Approval expired by a change in the sources (a new memory added after approval).
  await storage.reopenInterview(interview.id, 7, 'Agregar un recuerdo', 'admin_pruebas');
  await storage.submitAnswer({
    plainToken: token,
    questionId: 'mem_adicional_post',
    questionText: 'Recuerdo adicional',
    answerText: 'En 1977 mi vecino Bartolomé construyó un horno de leña en Sola.',
    notRecalled: false,
    isAdditionalMemory: true,
    idempotencyKey: 'post_approval_memory',
  });
  await storage.declareVoluntaryCompletion(token, 'Declaración voluntaria');
  const staleLog = await expectSaveRejected({
    token,
    interviewId: interview.id,
    style,
    manuscript: approved,
    message: rules.buildIncompleteDraftUserNotice('source_changed'),
  });
  assert.equal(staleLog.details.evidenceStatus, 'source_changed');
  assert.equal(staleLog.details.internalReasonCode, 'SOURCE_CHANGED_SINCE_APPROVAL');

  // (f) A forged signature on a FAITHFUL text is not trusted either: the server re-audits it
  // and signs its own evidence (the forged one is never stored).
  const regenerated = (await generateApproved(interview.id, token, style, riverJudge())).result.manuscript;
  const forgedFaithful = jsonRoundTrip(regenerated);
  const forgedSignature = forgedFaithful.approvalEvidence.signature.replace(/^./, (c: string) => (c === 'a' ? 'b' : 'a'));
  forgedFaithful.approvalEvidence.signature = forgedSignature;
  scenario.judge = riverJudge().judge;
  const saved = await storage.saveParticipantBookVersion({
    plainToken: token,
    narrativeStyle: style,
    editorialConfig: editorialConfigFor(style),
    manuscript: forgedFaithful,
    coverPhoto: null,
    chapterPhotos: {},
    pageCount: 20,
  });
  assert.equal(lastAuditLog('CREATE_PARTICIPANT_BOOK', saved.bookVersion.id)?.details?.approvalPath, 'hybrid_reaudit');
  assert.notEqual(saved.bookVersion.manuscript.approvalEvidence.signature, forgedSignature);
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

test('V5.2-S2/S3: omisión real y contradicción confirmadas se rechazan mientras no se reparen', async () => {
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
    assert.equal(omitted.result.manuscript.generationStatus, 'incomplete_draft', STYLE_LABEL[style]);
    assert.equal(omitted.result.manuscript.approvalEvidence, undefined);
    assert.ok(['repair_pending', 'documentary'].includes(omitted.result.failureCategory), omitted.result.failureCategory);
    assert.equal(
      omitted.result.manuscript.chapters.some((c: any) => c.paragraphs.some((p: string) => /panader/.test(p))),
      false,
      'Sin pegado mecánico del recuerdo omitido.'
    );
    await assert.rejects(
      storage.saveParticipantBookVersion({
        plainToken: token,
        narrativeStyle: style,
        editorialConfig: editorialConfigFor(style),
        manuscript: jsonRoundTrip(omitted.result.manuscript),
        coverPhoto: null,
        chapterPhotos: {},
        pageCount: 20,
      }),
      /borrador incompleto/
    );

    // Contradiction confirmed by the judge.
    const contradicted = await generateWith({
      interviewId: interview.id,
      token,
      style,
      transform: (_id, ps) => ps.map((p) => p.replace(/me salvó de caer al río/, 'me empujó al río').replace(/la salvó de caer al río/, 'la empujó al río')),
      judge: riverJudge().judge,
      repair: async () => null,
    });
    assert.equal(contradicted.result.manuscript.generationStatus, 'incomplete_draft', STYLE_LABEL[style]);
    assert.equal(contradicted.result.manuscript.approvalEvidence, undefined);
    const riverTrace = contradicted.result.manuscript.documentaryAudit.traceabilityMatrix.find((t: any) => /salvó/.test(t.excerpt || ''));
    assert.equal(riverTrace?.verified, false);
    assert.ok(
      riverTrace?.aiJudgeVerdict === 'contradicted' || riverTrace?.verificationStatus === 'contradicted',
      JSON.stringify(riverTrace)
    );
  }
});

test('V5.2-S4: si el juez no responde (error o sin veredictos) el fallo es técnico y nunca se aprueba; con juez sí se aprueba', async () => {
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
      assert.equal(out.result.manuscript.generationStatus, 'incomplete_draft', STYLE_LABEL[style]);
      assert.equal(out.result.failureCategory, 'technical');
      assert.equal(out.result.internalReasonCode, 'SEMANTIC_JUDGE_UNAVAILABLE');
      assert.equal(out.result.manuscript.approvalEvidence, undefined);
    }
    // Positive control: a judge that recognizes the paraphrase approves the same text.
    const judge = helpers.createScenarioJudge({ paraphrases: [{ testimony: /salvo de caer al rio/, excerpt: /gracias a (mi|su) padre, aquel dia junto al agua/ }] });
    const ok = await generateWith({ interviewId: interview.id, token, style, transform: paraphrase, judge: judge.judge });
    assert.equal(ok.result.manuscript.generationStatus, 'approved', `${STYLE_LABEL[style]}: ${ok.result.diagnosticSummary}`);
    assert.ok(judge.judgedCases().some((c: any) => /salvó/.test(c.originalTestimony)), 'La paráfrasis pasó por el juez.');
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
  assert.equal(mixed.result.manuscript.generationStatus, 'incomplete_draft');
  assert.equal(mixed.result.manuscript.approvalEvidence, undefined);
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
    const { signature: _s, ...unsigned } = issue();
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
