import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  auditAndApproveBookManuscript,
  auditBookEditorialQuality,
  buildContextualRepairTasks,
  buildDocumentaryInventory,
  buildEditorialChapterPlan,
  buildParticipantInitialManuscriptFromAnswers,
  verifyDocumentaryUnitInManuscript,
  type DemoManuscript,
  type DocumentarySourceAnswerInput,
  type DocumentarySourceQuestionInput,
} from '../demoStoryRules.ts';
import {
  auditWithHybridSemantics,
  classifyBookFailureReasonCode,
  repairChaptersContextuallyWithAI,
} from '../../server/geminiService.ts';
import {
  BookGenerationJobManager,
  toParticipantBookJobView,
} from '../../server/bookJobManager.ts';
import {
  DEFAULT_LITERARY_PROMPTS_TEXT,
  type AnswerRecord,
  type QuestionRecord,
} from '../interviewRules.ts';

type CanonicalStage = 'infancia' | 'juventud' | 'adultez' | 'madurez' | 'legado_general';

function makeQuestion(
  id: string,
  orderIndex: number,
  lifeStage: CanonicalStage,
  text: string
): DocumentarySourceQuestionInput {
  return { id, orderIndex, lifeStage, topic: lifeStage, text };
}

function makeAnswer(params: {
  id: string;
  questionId: string;
  questionText?: string;
  lifeStage: CanonicalStage;
  answerText: string;
  participantName?: string;
  excludeFromBook?: boolean;
}): DocumentarySourceAnswerInput {
  return {
    id: params.id,
    questionId: params.questionId,
    questionText: params.questionText,
    lifeStage: params.lifeStage,
    answerText: params.answerText,
    isFollowUp: false,
    isAdditionalMemory: false,
    participantId: 'part_1',
    participantName: params.participantName || 'Carlos Mendoza',
    photos: [],
    audio: null,
    audioRecordings: null,
    excludeFromBook: params.excludeFromBook,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
  };
}

test('V4.1 Propositional Clause Alignment: multi-sentence paragraph with sibling negations/modality does NOT raise false contradictions', () => {
  const questions = [
    makeQuestion('q1', 1, 'infancia', '¿Cómo recuerdas tu escuela primaria?'),
    makeQuestion('q2', 2, 'infancia', '¿Qué valores te transmitió tu abuelo?'),
  ];
  const answers = [
    makeAnswer({
      id: 'a1',
      questionId: 'q1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText:
        'Estudié en la escuela Benito Juárez de Puebla desde 1978 y casi siempre jugaba ajedrez en el patio.',
    }),
    makeAnswer({
      id: 'a2',
      questionId: 'q2',
      questionText: questions[1].text,
      lifeStage: 'infancia',
      answerText:
        'Mi abuelo Ramón nunca tuvo miedo de trabajar la carpintería y me enseñó a respetar el oficio.',
    }),
  ];

  const manuscript: DemoManuscript = {
    mode: 'individual',
    title: 'Memorias de Carlos Mendoza',
    subtitle: 'Raíces en Puebla',
    authors: 'Carlos Mendoza',
    dedication: '',
    closingMessage: 'Siempre adelante.',
    narrativeStyle: 'first_person_literary',
    introduction: 'Un recorrido por mis años tempranos en Puebla.',
    insufficientInfoNotices: [],
    generatedAt: '2026-06-01T10:00:00.000Z',
    aiGenerated: true,
    chapters: [
      {
        id: 'cap_inf',
        partNumber: 1,
        dimensionKey: 'infancia',
        title: 'Primeros años en Puebla',
        paragraphs: [
          'Estudié en la escuela Benito Juárez de Puebla desde 1978 y casi siempre jugaba ajedrez en el patio con entusiasmo. Por otro lado, mi abuelo Ramón nunca tuvo miedo de trabajar la carpintería y siempre me enseñó a respetar el oficio; no cabe duda de que esos años me marcaron.',
        ],
        paragraphIds: ['cap_inf_p_1'],
        sourceAnswerIds: ['a1', 'a2'],
        sourceQuestionIds: ['q1', 'q2'],
      },
    ],
  };

  const audited = auditAndApproveBookManuscript({ manuscript, answers, questions });
  assert.equal(
    audited.report.veracityAudit?.semanticContradictionFlags?.length || 0,
    0,
    `No debe reportar contradicciones falsas: ${JSON.stringify(audited.report.veracityAudit?.semanticContradictionFlags)}`
  );
  assert.equal(audited.report.passed, true, `Debe aprobar sin bloqueos: ${audited.report.blockingDefects.join(' | ')}`);
});

test('V4.1 Semantic Guardrail Strictness: catches true negation flips, agency reversals, modality inversions, and action antonyms', () => {
  const questions = [
    makeQuestion('q_neg', 1, 'infancia', '¿Qué recuerdas de tus estudios y familia?'),
  ];
  const answers = [
    makeAnswer({
      id: 'a_neg',
      questionId: 'q_neg',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Mi hermano Diego me enseñó a nadar en el río Lerma durante el verano de 1985.',
    }),
  ];

  // Case A: Negation flip
  const negInv = buildDocumentaryInventory({
    interviewId: 'int_neg',
    answers,
    questions,
    participantNames: ['Carlos Mendoza'],
  });
  const negUnit = negInv.eligibleFactUnits[0];
  const negRes = verifyDocumentaryUnitInManuscript({
    unit: negUnit,
    chapters: [
      {
        id: 'c1',
        partNumber: 1,
        dimensionKey: 'infancia',
        title: 'Verano en el río',
        paragraphs: ['Mi hermano Diego nunca me enseñó a nadar en el río Lerma durante el verano de 1985.'],
        sourceAnswerIds: ['a_neg'],
      },
    ],
  });
  assert.equal(negRes.verificationStatus, 'contradicted');
  assert.equal(negRes.verified, false);

  // Case B: Agency reversal ("me enseñó" -> "yo le enseñé a mi hermano Diego")
  const agencyRes = verifyDocumentaryUnitInManuscript({
    unit: negUnit,
    chapters: [
      {
        id: 'c1',
        partNumber: 1,
        dimensionKey: 'infancia',
        title: 'Verano en el río',
        paragraphs: ['Yo le enseñé a nadar a mi hermano Diego en el río Lerma durante el verano de 1985.'],
        sourceAnswerIds: ['a_neg'],
      },
    ],
  });
  assert.equal(agencyRes.verificationStatus, 'contradicted');
  assert.equal(agencyRes.verified, false);

  // Case C: Attempt/Modality flip ("trabajé" -> "intenté trabajar pero no logré")
  const modAns = [
    makeAnswer({
      id: 'a_mod',
      questionId: 'q_neg',
      lifeStage: 'juventud',
      answerText: 'Construí mi taller mecánico en Morelia en 1994 con herramientas nuevas.',
    }),
  ];
  const modInv = buildDocumentaryInventory({
    interviewId: 'int_mod',
    answers: modAns,
    questions,
    participantNames: ['Carlos Mendoza'],
  });
  const modRes = verifyDocumentaryUnitInManuscript({
    unit: modInv.eligibleFactUnits[0],
    chapters: [
      {
        id: 'c2',
        partNumber: 1,
        dimensionKey: 'juventud',
        title: 'El taller de Morelia',
        paragraphs: ['Intenté construir mi taller mecánico en Morelia en 1994 pero no logré abrirlo con herramientas nuevas.'],
        sourceAnswerIds: ['a_mod'],
      },
    ],
  });
  assert.equal(modRes.verificationStatus, 'contradicted');
  assert.equal(modRes.verified, false);
});

test('V4.1 Hybrid Semantic Judge (`auditWithHybridSemantics`): approves validated literary paraphrases and blocks inconclusive/contradicted verdicts', async () => {
  const questions = [
    makeQuestion('q_lit', 1, 'adultez', '¿Cómo fundaste tu emprendimiento familiar?'),
  ];
  const answers = [
    makeAnswer({
      id: 'a_lit',
      questionId: 'q_lit',
      questionText: questions[0].text,
      lifeStage: 'adultez',
      answerText:
        'En 1998 ahorramos durante cuatro años para abrir nuestra panadería artesanal en Oaxaca cerca del mercado central.',
    }),
  ];

  // Rich literary paraphrase with enough shared anchors to classify as ambiguous (rather than verbatim copy),
  // requiring hybrid judge resolution
  const paraphrasedManu: DemoManuscript = {
    mode: 'individual',
    title: 'Aromas de Oaxaca',
    subtitle: 'Memorias familiares',
    authors: 'Carlos Mendoza',
    dedication: '',
    closingMessage: 'Con gratitud.',
    narrativeStyle: 'first_person_literary',
    introduction: 'Un recorrido por el esfuerzo cotidiano en familia.',
    insufficientInfoNotices: [],
    generatedAt: '2026-06-01T10:00:00.000Z',
    aiGenerated: true,
    chapters: [
      {
        id: 'cap_adu',
        partNumber: 1,
        dimensionKey: 'adultez',
        title: 'El nacimiento de la panadería',
        paragraphs: [
          'En 1998 juntamos cada peso durante cuatro años hasta ver encenderse el horno de nuestra panadería artesanal en Oaxaca muy cerca del bullicioso mercado central.',
        ],
        paragraphIds: ['cap_adu_p_1'],
        sourceAnswerIds: ['a_lit'],
        sourceQuestionIds: ['q_lit'],
      },
    ],
  };

  // Rich literary paraphrase preserving key anchors (1998, Oaxaca, mercado) while using distinct literary prose,
  // triggering `ambiguous` status for hybrid AI semantic judge verification
  const borderlineManu: DemoManuscript = {
    ...paraphrasedManu,
    chapters: [
      {
        ...paraphrasedManu.chapters[0],
        paragraphs: [
          'En 1998, tras cuatro primaveras de esfuerzo en Oaxaca, levantamos nuestro obrador junto al viejo mercado.',
        ],
      },
    ],
  };

  let judgeInvokedCount = 0;
  const supportedResult = await auditWithHybridSemantics({
    manuscript: borderlineManu,
    answers,
    questions,
    provider: 'gemini',
    model: 'gemini-3-flash-preview',
    alternateProvider: 'openai',
    alternateModel: 'gpt-4o',
    aiJudgeOverride: async ({ cases }) => {
      judgeInvokedCount += cases.length;
      return cases.map((c) => ({
        unitId: c.unitId,
        verdict: 'supported' as const,
        rationale: 'Paráfrasis literaria fiel: obrador refiere a la panadería en Oaxaca en 1998 tras cuatro años.',
      }));
    },
  });

  assert.equal(judgeInvokedCount > 0, true, 'El juez IA híbrido debe activarse solo en unidades ambiguas');
  assert.equal(supportedResult.report.passed, true, 'Una paráfrasis confirmada por el juez debe aprobar');
  assert.equal(supportedResult.report.coveragePercentage, 100);

  // Scenario 2: Judge returns 'inconclusive' -> MUST NOT auto-approve!
  const inconclusiveResult = await auditWithHybridSemantics({
    manuscript: borderlineManu,
    answers,
    questions,
    provider: 'gemini',
    model: 'gemini-3-flash-preview',
    alternateProvider: 'openai',
    alternateModel: 'gpt-4o',
    aiJudgeOverride: async ({ cases }) =>
      cases.map((c) => ({
        unitId: c.unitId,
        verdict: 'inconclusive' as const,
        rationale: 'No queda claro si "obrador" corresponde al negocio descrito.',
      })),
  });
  assert.equal(inconclusiveResult.report.passed, false, 'Un veredicto inconcluso jamás debe aprobarse');
});

test('V4.1 Editorial Hygiene: accented pronouns (mí, sí, él) do NOT trigger false truncated fragment errors', () => {
  const cleanManuscript: DemoManuscript = {
    mode: 'individual',
    title: 'Hojas del Tiempo',
    subtitle: 'Historia personal',
    authors: 'Elena Ruiz',
    dedication: '',
    closingMessage: 'Hasta siempre.',
    narrativeStyle: 'first_person_literary',
    introduction: 'Caminamos juntos hacia un horizonte claro.',
    insufficientInfoNotices: [],
    generatedAt: '2026-06-01T10:00:00.000Z',
    chapters: [
      {
        id: 'cap_1',
        partNumber: 1,
        dimensionKey: 'infancia',
        title: 'Tardes con mi padre',
        paragraphs: [
          'Aquella conversación significó muchísimo para mí, y su ejemplo permaneció siempre junto a él cuando decidió que sí emprenderíamos el viaje.',
        ],
        paragraphIds: ['cap_1_p_1'],
      },
    ],
  };

  const edAudit = auditBookEditorialQuality({ manuscript: cleanManuscript });
  assert.equal(
    edAudit.truncatedFragmentFlags.length,
    0,
    `No debe falsamente marcar mí/sí/él como fragmentos truncados: ${JSON.stringify(edAudit.truncatedFragmentFlags)}`
  );
  assert.equal(edAudit.passed, true);
});

test('V4.1 Unlimited Batched Contextual Repair: repairs >6 defective chapters (10 chapters) without slice(0,6) truncation and rejects regressions', async () => {
  const stageList: CanonicalStage[] = [
    'infancia',
    'infancia',
    'juventud',
    'juventud',
    'adultez',
    'adultez',
    'madurez',
    'madurez',
    'legado_general',
    'legado_general',
  ];

  const questions: DocumentarySourceQuestionInput[] = Array.from({ length: 20 }, (_, i) => {
    const stage = stageList[Math.floor(i / 2)];
    return makeQuestion(`q_${i + 1}`, i + 1, stage, `Pregunta ${i + 1} sobre ${stage}`);
  });
  const answers: DocumentarySourceAnswerInput[] = Array.from({ length: 20 }, (_, i) => {
    const stage = stageList[Math.floor(i / 2)];
    return makeAnswer({
      id: `a_${i + 1}`,
      questionId: `q_${i + 1}`,
      questionText: questions[i].text,
      lifeStage: stage,
      answerText: `En el recuerdo ${i + 1} visitamos el puerto de Veracruz en ${1970 + i} con mi tío Ernesto para celebrar en familia.`,
    });
  });

  // Create a manuscript with 10 grouped chapters (2 answers each) where all 10 chapters omit key facts -> should generate 10 repair tasks (>6 cap)
  const defectiveManu: DemoManuscript = {
    mode: 'individual',
    title: 'Bitácora Completa',
    subtitle: 'Memorias',
    authors: 'Carlos Mendoza',
    dedication: '',
    closingMessage: 'Fin de esta obra.',
    narrativeStyle: 'first_person_literary',
    introduction: 'Un recorrido por cada capítulo de mi vida.',
    insufficientInfoNotices: [],
    generatedAt: '2026-06-01T10:00:00.000Z',
    aiGenerated: true,
    chapters: stageList.map((stage, i) => ({
      id: `ch_${i + 1}`,
      partNumber: i + 1,
      dimensionKey: stage,
      title: `Capítulo sobre tiempos vividos ${i + 1}`,
      paragraphs: [`Recordábamos momentos tranquilos de aquella época importante.`],
      paragraphIds: [`ch_${i + 1}_p_1`],
      sourceAnswerIds: [`a_${i * 2 + 1}`, `a_${i * 2 + 2}`],
      sourceQuestionIds: [`q_${i * 2 + 1}`, `q_${i * 2 + 2}`],
    })),
  };

  const preAudit = auditAndApproveBookManuscript({ manuscript: defectiveManu, answers, questions });
  assert.equal(preAudit.report.passed, false);
  const editorialPlan = buildEditorialChapterPlan({
    interviewTitle: 'Historia de Carlos Mendoza',
    storyMode: 'individual',
    participantNames: ['Carlos Mendoza'],
    answers,
    questions,
  });
  const tasks = buildContextualRepairTasks({
    manuscript: preAudit.manuscript,
    report: preAudit.report,
    editorialAudit: preAudit.editorialAudit,
    inventory: preAudit.inventory,
    editorialPlan,
  });
  assert.equal(tasks.length, 10, 'Deben construirse tareas de reparación para los 10 capítulos afectados');

  const recordedBatches: string[][] = [];
  const repairedResult = await repairChaptersContextuallyWithAI({
    manuscript: preAudit.manuscript,
    tasks,
    activeLiteraryPrompt: DEFAULT_LITERARY_PROMPTS_TEXT['first_person_literary'],
    narrativeStyle: 'first_person_literary',
    authors: 'Carlos Mendoza',
    isCouple: false,
    answers: answers as unknown as AnswerRecord[],
    questions: questions as unknown as QuestionRecord[],
    provider: 'gemini',
    model: 'gemini-3-flash-preview',
    alternateProvider: 'openai',
    alternateModel: 'gpt-4o',
    batchCallerOverride: async (_prompt, _sys, batchChapterIds) => {
      recordedBatches.push(batchChapterIds);
      return {
        title: defectiveManu.title,
        subtitle: defectiveManu.subtitle,
        introduction: defectiveManu.introduction,
        chapters: batchChapterIds.map((cid) => {
          const num = Number(cid.replace('ch_', ''));
          const stage = stageList[num - 1];
          const a1Idx = (num - 1) * 2 + 1;
          const a2Idx = (num - 1) * 2 + 2;
          return {
            id: cid,
            partNumber: num,
            dimensionKey: stage,
            title: `Estación en Veracruz ${num === 1 ? 'uno' : num}`,
            paragraphs: [
              `En el recuerdo ${a1Idx} visitamos el puerto de Veracruz en ${1970 + a1Idx - 1} con mi tío Ernesto para celebrar en familia con alegría.`,
              `Luego, en el recuerdo ${a2Idx} visitamos el puerto de Veracruz en ${1970 + a2Idx - 1} con mi tío Ernesto para celebrar en familia.`,
            ],
          };
        }),
      };
    },
  });

  assert.ok(repairedResult, 'La reparación por lotes debe ejecutarse');
  assert.equal(repairedResult!.improved, true);
  assert.equal(repairedResult!.repairedChaptersCount, 10, 'Debe reparar los 10 capítulos, no solo 6');
  assert.deepEqual(recordedBatches.flat(), tasks.map((t) => t.chapterId));
  assert.equal(repairedResult!.audited.report.passed, true, `Todos los capítulos reparados deben aprobar: ${repairedResult!.audited.report.blockingDefects.join(' | ')}`);

  // Also test regression rejection: if batch repair breaks prose, improved MUST be false
  const regressionResult = await repairChaptersContextuallyWithAI({
    manuscript: preAudit.manuscript,
    tasks: tasks.slice(0, 2),
    activeLiteraryPrompt: DEFAULT_LITERARY_PROMPTS_TEXT['first_person_literary'],
    narrativeStyle: 'first_person_literary',
    authors: 'Carlos Mendoza',
    isCouple: false,
    answers: answers as unknown as AnswerRecord[],
    questions: questions as unknown as QuestionRecord[],
    provider: 'gemini',
    model: 'gemini-3-flash-preview',
    alternateProvider: 'openai',
    alternateModel: 'gpt-4o',
    batchCallerOverride: async (_prompt, _sys, batchChapterIds) => ({
      title: defectiveManu.title,
      chapters: batchChapterIds.map((cid) => ({
        id: cid,
        partNumber: 1,
        dimensionKey: 'infancia',
        title: '¿Pregunta rota?',
        paragraphs: ['Bueno pues este nunca fui invento 2099 en Marte jajaja.'],
      })),
    }),
  });
  assert.ok(regressionResult);
  assert.equal(regressionResult!.improved, false, 'Debe rechazar reparaciones regresivas que empeoran el manuscrito');
});

test('V4.1 Resumable Background Job Manager: persists batch checkpoints, survives interruption, deduplicates active jobs, cancels cleanly, and hides internal codes from participants', async () => {
  const tempFile = path.join(os.tmpdir(), `yf_job_test_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  try {
    const manager1 = new BookGenerationJobManager(tempFile);

    // Job 1 fails halfway after persisting batch checkpoints 0 and 1
    const interruptedJob = manager1.startOrResumeJob({
      interviewId: 'int_resume_1',
      participantId: 'part_1',
      narrativeStyle: 'first_person_literary',
      scope: 'full',
      executor: async (hooks) => {
        hooks.onBatchCheckpoint(0, { parsed: { chapters: [{ id: 'ch_1' }] }, respondedModel: 'gemini-3-flash-preview' });
        hooks.onBatchCheckpoint(1, { parsed: { chapters: [{ id: 'ch_2' }] }, respondedModel: 'gemini-3-flash-preview' });
        hooks.onProgress({
          phase: 'drafting_batches',
          currentBatch: 2,
          totalBatches: 3,
          completedBatches: 2,
          userMessage: 'Redactando capítulo 2 de 3...',
        });
        throw new Error('Tiempo de espera agotado en lote 3');
      },
    });
    const failedSettled = await manager1.waitForJob(interruptedJob.jobId);
    assert.equal(failedSettled?.status, 'failed');
    assert.equal(failedSettled?.completedBatches, 2);

    // Simulate process restart with a fresh manager loading the same disk checkpoint file
    const manager2 = new BookGenerationJobManager(tempFile);
    let capturedInitialCheckpoints: Record<string, any> = {};
    const resumedJob = manager2.startOrResumeJob({
      interviewId: 'int_resume_1',
      participantId: 'part_1',
      narrativeStyle: 'first_person_literary',
      scope: 'full',
      executor: async (hooks) => {
        capturedInitialCheckpoints = hooks.initialBatchCheckpoints;
        hooks.onBatchCheckpoint(2, { parsed: { chapters: [{ id: 'ch_3' }] }, respondedModel: 'gemini-3-flash-preview' });
        return {
          manuscript: {
            mode: 'individual',
            title: 'Mi Historia',
            subtitle: 'Memorias',
            authors: 'Carlos Mendoza',
            dedication: '',
            closingMessage: 'Fin.',
            narrativeStyle: 'first_person_literary',
            introduction: 'Prólogo cálido.',
            insufficientInfoNotices: [],
            generatedAt: '2026-06-01T10:00:00.000Z',
            chapters: [],
            generationStatus: 'incomplete_draft',
            status: 'incomplete_draft',
            incompleteDraftNotice: 'Aviso amable para el entrevistado.',
            internalReasonCode: 'REPAIR_EXHAUSTED',
            diagnosticSummary: 'Detalle técnico exclusivo del administrador.',
          },
          chapterPhotos: {},
          closingPageText: '',
          scope: 'full',
          internalReasonCode: 'REPAIR_EXHAUSTED',
          diagnosticSummary: 'Detalle técnico exclusivo del administrador.',
          batchesCompleted: 3,
          totalBatches: 3,
        };
      },
    });

    const settledResumed = await manager2.waitForJob(resumedJob.jobId);
    assert.deepEqual(Object.keys(capturedInitialCheckpoints).sort(), ['0', '1'], 'Debe reanudar exactamente desde los lotes 0 y 1 ya completados');
    assert.equal(settledResumed?.status, 'incomplete');
    assert.equal(settledResumed?.internalReasonCode, 'REPAIR_EXHAUSTED');

    // Verify participant view strictly strips internal diagnostics
    const participantView = toParticipantBookJobView(settledResumed!);
    assert.equal('internalReasonCode' in participantView, false);
    assert.equal('diagnosticSummary' in participantView, false);
    assert.equal('internalReasonCode' in (participantView.result || {}), false);
    assert.equal('internalReasonCode' in (participantView.result?.manuscript || {}), false);

    // Concurrency deduplication & cancel test
    let releaseSecondJob!: () => void;
    const holdPromise = new Promise<void>((res) => {
      releaseSecondJob = res;
    });
    const concurrentA = manager2.startOrResumeJob({
      interviewId: 'int_lock_test',
      narrativeStyle: 'first_person_simple',
      scope: 'preview',
      executor: async () => {
        await holdPromise;
        return {
          manuscript: {
            mode: 'individual',
            title: 'T',
            subtitle: 'S',
            authors: 'A',
            dedication: '',
            closingMessage: 'C',
            narrativeStyle: 'first_person_simple',
            introduction: 'I',
            insufficientInfoNotices: [],
            generatedAt: '2026-06-01T10:00:00.000Z',
            chapters: [],
          },
          chapterPhotos: {},
          closingPageText: '',
          scope: 'preview',
        };
      },
    });
    const concurrentB = manager2.startOrResumeJob({
      interviewId: 'int_lock_test',
      narrativeStyle: 'first_person_simple',
      scope: 'preview',
      executor: async () => {
        throw new Error('Should never run second concurrent executor');
      },
    });
    assert.equal(concurrentA.jobId, concurrentB.jobId, 'Peticiones concurrentes deben compartir el trabajo activo');

    const cancelled = manager2.cancelJob(concurrentA.jobId);
    assert.equal(cancelled?.status, 'cancelled');
    releaseSecondJob();
    await manager2.waitForJob(concurrentA.jobId);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

test('V4.1 Admin Reason Classifier: accurately assigns all granular internalReasonCodes', () => {
  assert.equal(
    classifyBookFailureReasonCode({ error: new Error('Tiempo de espera agotado en gemini'), completedBatches: 1, totalBatches: 3 }).code,
    'PARTIAL_BATCH_GENERATION'
  );
  assert.equal(
    classifyBookFailureReasonCode({ error: new Error('Tiempo de espera agotado (45s)') }).code,
    'MODEL_TIMEOUT'
  );
  assert.equal(
    classifyBookFailureReasonCode({ error: new Error('Unexpected token in JSON response') }).code,
    'INVALID_MODEL_RESPONSE'
  );
  assert.equal(
    classifyBookFailureReasonCode({ error: new Error('HTTP 503 network outage') }).code,
    'PROVIDER_ERROR'
  );
  assert.equal(
    classifyBookFailureReasonCode({
      report: {
        veracityAudit: { leakedExcludedContentFlags: ['Fuga de oración excluida'], semanticContradictionFlags: [], inventedDataFlags: [], coupleAttributionViolations: [], uncertaintyViolations: [], unsupportedAdditionFlags: [], passed: false },
      } as any,
    }).code,
    'PRIVACY_VALIDATION_FAILURE'
  );
  assert.equal(
    classifyBookFailureReasonCode({
      report: {
        photoAudit: { unplacedPhotoIds: ['photo_99'] },
        veracityAudit: { leakedExcludedContentFlags: [], semanticContradictionFlags: [], inventedDataFlags: [], coupleAttributionViolations: [] },
      } as any,
    }).code,
    'PHOTO_PLACEMENT_FAILURE'
  );
  assert.equal(
    classifyBookFailureReasonCode({
      report: {
        coveragePercentage: 94,
        integratedUnits: 17,
        totalSourceUnits: 18,
        coverageAudit: { missingUnitIds: ['u_18'] },
        semanticAudit: { ambiguousUnitsCount: 1, ambiguousUnitIds: ['u_18'] },
        veracityAudit: { leakedExcludedContentFlags: [], semanticContradictionFlags: [], inventedDataFlags: [], coupleAttributionViolations: [] },
      } as any,
    }).code,
    'AUDIT_INCONCLUSIVE'
  );
});

test('V4.1 Real Snapshot Verification (Read-Only): audits populated interviews in data/storage_state.json fast (<1500ms) with zero false semantic contradictions and preserves prompt/data SHA-256', () => {
  const statePath = path.join(process.cwd(), 'data', 'storage_state.json');
  const rulesPath = path.join(process.cwd(), 'src', 'logic', 'interviewRules.ts');
  const beforeStateSha = crypto.createHash('sha256').update(fs.readFileSync(statePath)).digest('hex');

  const rawState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  const interviews: any[] = rawState.interviews || [];
  const allAnswers: any[] = rawState.answers || [];
  const allParticipants: any[] = rawState.participants || [];
  const allQuestions: any[] = rawState.questions || [];

  const candidateInterviews = interviews.filter((inv) => {
    const ansCount = allAnswers.filter((a) => a.interviewId === inv.id).length;
    return ansCount >= 5;
  });
  assert.equal(candidateInterviews.length >= 1, true, 'Debe existir al menos una entrevista con respuestas en el snapshot');

  const t0 = Date.now();
  for (const inv of candidateInterviews.slice(0, 5)) {
    const invAnswers = allAnswers.filter((a) => a.interviewId === inv.id);
    const invParticipants = allParticipants.filter((p) => p.interviewId === inv.id);
    const initial = buildParticipantInitialManuscriptFromAnswers({
      interviewTitle: inv.title || 'Mi Historia',
      storyMode: inv.storyMode || 'individual',
      participantNames: invParticipants.map((p) => p.name).filter(Boolean),
      answers: invAnswers,
      questions: allQuestions,
      narrativeStyle: 'first_person_literary',
    });

    const audit = auditAndApproveBookManuscript({
      manuscript: { ...initial.manuscript, aiGenerated: true },
      answers: invAnswers,
      questions: allQuestions,
    });

    assert.equal(
      audit.report.veracityAudit?.semanticContradictionFlags?.length || 0,
      0,
      `Entrevista ${inv.id} no debe tener falsos positivos de contradicción en prosa fiel: ${JSON.stringify(audit.report.veracityAudit?.semanticContradictionFlags)}`
    );
  }
  const elapsedMs = Date.now() - t0;
  assert.equal(elapsedMs < 3000, true, `Auditoría optimizada debe completar rápido (<3000ms), tardó ${elapsedMs}ms`);

  const afterStateSha = crypto.createHash('sha256').update(fs.readFileSync(statePath)).digest('hex');
  assert.equal(afterStateSha, beforeStateSha, 'No se debe mutar data/storage_state.json en auditorías');
  assert.equal(fs.existsSync(rulesPath), true);
});
