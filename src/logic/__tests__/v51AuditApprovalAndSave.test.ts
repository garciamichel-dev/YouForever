import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditAndApproveBookManuscript,
  auditBookEditorialQuality,
  buildIncompleteDraftUserNotice,
  buildParticipantInitialManuscriptFromAnswers,
  composeBookPages,
  extractSpanishNumberWordValues,
  repairManuscriptOmissions,
  resolveBookFailureCategory,
  type BookFailureCategory,
  type BookGenerationReasonCode,
  type DemoEditorialConfig,
  type DemoManuscript,
  type DemoNarrativeStyleId,
  type DocumentarySourceAnswerInput,
  type DocumentarySourceQuestionInput,
} from '../demoStoryRules.ts';
import {
  auditWithHybridSemantics,
  classifyBookFailureReasonCode,
  clearSemanticVerdictCache,
  generateParticipantBookManuscriptWithAI,
  repairChaptersContextuallyWithAI,
  type BookBatchCheckpointPayload,
  type SemanticJudgeFunction,
} from '../../server/geminiService.ts';
import {
  __resetProcessLocalApprovalSecretForTests,
  computeBookSourceFingerprint,
  computeManuscriptContentHash,
  issueBookApprovalEvidence,
  verifyBookApprovalEvidence,
} from '../../server/bookApproval.ts';
import { BookGenerationJobManager, toParticipantBookJobView } from '../../server/bookJobManager.ts';
import { generateRealDemoBookPdf } from '../../utils/demoPdfGenerator.ts';
import { buildContextualRepairTasks, buildEditorialChapterPlan } from '../demoStoryRules.ts';
import { DEFAULT_LITERARY_PROMPTS_TEXT } from '../interviewRules.ts';
import { createScenarioJudge } from './helpers/simulatedBookProviders.ts';

// A stable server secret so approval evidence is reproducible inside this test process.
process.env.BOOK_APPROVAL_SECRET = 'v51-test-secret-only-for-automated-tests';

const ALL_STYLES: DemoNarrativeStyleId[] = [
  'first_person_simple',
  'first_person_literary',
  'third_person_biography',
];
const STYLE_LABEL: Record<DemoNarrativeStyleId, string> = {
  first_person_simple: 'Estilo A',
  first_person_literary: 'Estilo B',
  third_person_biography: 'Estilo C',
};

type Stage = 'infancia' | 'juventud' | 'adultez' | 'madurez' | 'legado_general';

const PROVIDER_ARGS = {
  provider: 'gemini' as const,
  model: 'gemini-3-flash-preview',
  alternateProvider: 'openai' as const,
  alternateModel: 'gpt-4o',
};

function makeQuestion(id: string, orderIndex: number, lifeStage: Stage, text: string): DocumentarySourceQuestionInput {
  return { id, orderIndex, lifeStage, topic: lifeStage, text };
}

function makeAnswer(params: {
  id: string;
  questionId: string;
  questionText: string;
  lifeStage: Stage;
  answerText: string;
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
    participantName: 'Carlos Mendoza',
    photos: [],
    audio: null,
    audioRecordings: null,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
  };
}

function singleChapterManuscript(params: {
  style: DemoNarrativeStyleId;
  paragraphs: string[];
  answerIds: string[];
  questionIds: string[];
  title?: string;
}): DemoManuscript {
  return {
    mode: 'individual',
    title: 'Orillas de la memoria',
    subtitle: 'Recuerdos de familia',
    authors: 'Carlos Mendoza',
    dedication: '',
    closingMessage: 'Con gratitud.',
    narrativeStyle: params.style,
    introduction: 'Estas páginas reúnen recuerdos de una vida en familia.',
    insufficientInfoNotices: [],
    generatedAt: '2026-06-01T10:00:00.000Z',
    aiGenerated: true,
    chapters: [
      {
        id: 'cap_inf',
        partNumber: 1,
        dimensionKey: 'infancia' as any,
        title: params.title || 'Tardes junto al río',
        paragraphs: params.paragraphs,
        paragraphIds: params.paragraphs.map((_, i) => `cap_inf_p_${i + 1}`),
        sourceAnswerIds: params.answerIds,
        sourceQuestionIds: params.questionIds,
      },
    ],
  };
}

/** Simulates a competent semantic judge for the documented "padre / río" example. */
const riverJudge: SemanticJudgeFunction = async ({ cases }) =>
  cases.map((c) => {
    const pushed = /empuj/i.test(c.candidateExcerpt);
    return {
      unitId: c.unitId,
      verdict: pushed ? ('contradicted' as const) : ('supported' as const),
      rationale: pushed
        ? 'El fragmento afirma que el padre lo empujó; el testimonio dice que lo salvó.'
        : 'Mismo hecho: el padre evitó la caída al río.',
    };
  });

// ---------------------------------------------------------------------------------------------
// A. Verificación semántica
// ---------------------------------------------------------------------------------------------

test('V5.1-A1: el ejemplo documentado (padre / río) aprueba la paráfrasis fiel y rechaza la contradicción real en los estilos A, B y C', async () => {
  const questions = [makeQuestion('q_rio', 1, 'infancia', '¿Qué recuerdo guardas de tu padre?')];
  const answers = [
    makeAnswer({
      id: 'a_rio',
      questionId: 'q_rio',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Mi padre me salvó de caer al río.',
    }),
  ];

  for (const style of ALL_STYLES) {
    const thirdPerson = style === 'third_person_biography';
    const faithful = thirdPerson
      ? 'Gracias a su padre, Carlos consiguió evitar caer al agua.'
      : 'Gracias a mi padre, conseguí evitar caer al agua.';
    const contradictory = thirdPerson
      ? 'Su padre empujó a Carlos al río.'
      : 'Mi padre me empujó al río.';

    let judgeCalls = 0;
    const countingJudge: SemanticJudgeFunction = async (p) => {
      judgeCalls += p.cases.length;
      return riverJudge(p);
    };

    const paraphrase = await auditWithHybridSemantics({
      manuscript: singleChapterManuscript({ style, paragraphs: [faithful], answerIds: ['a_rio'], questionIds: ['q_rio'] }),
      answers,
      questions,
      ...PROVIDER_ARGS,
      aiJudgeOverride: countingJudge,
    });
    assert.equal(
      paraphrase.report.passed,
      true,
      `${STYLE_LABEL[style]}: la paráfrasis equivalente debe aprobarse. Defectos: ${JSON.stringify(paraphrase.report.blockingDefects)}`
    );
    assert.equal(paraphrase.report.coveragePercentage, 100);
    assert.equal(paraphrase.report.auditPolicy, 'hybrid_arbitrated');
    assert.equal((paraphrase.report.veracityAudit?.semanticContradictionFlags || []).length, 0);

    const contradiction = await auditWithHybridSemantics({
      manuscript: singleChapterManuscript({ style, paragraphs: [contradictory], answerIds: ['a_rio'], questionIds: ['q_rio'] }),
      answers,
      questions,
      ...PROVIDER_ARGS,
      aiJudgeOverride: countingJudge,
    });
    assert.equal(contradiction.report.passed, false, `${STYLE_LABEL[style]}: "me empujó al río" debe rechazarse.`);
    const trace = contradiction.report.traceabilityMatrix.find((t) => t.answerId === 'a_rio');
    assert.equal(trace?.verificationStatus, 'contradicted');
    assert.equal(trace?.aiJudgeVerdict, 'contradicted');
    const diag = classifyBookFailureReasonCode({
      report: contradiction.report,
      editorialAudit: contradiction.editorialAudit,
    });
    assert.equal(diag.code, 'SEMANTIC_CONTRADICTION');
    assert.equal(diag.category, 'documentary');
    assert.equal(judgeCalls >= 1, true, 'La sospecha de contradicción debe ser arbitrada por el juez semántico.');

    // The deterministic rules alone must NEVER approve the contradiction either.
    const deterministicOnly = auditAndApproveBookManuscript({
      manuscript: singleChapterManuscript({ style, paragraphs: [contradictory], answerIds: ['a_rio'], questionIds: ['q_rio'] }),
      answers,
      questions,
    });
    assert.equal(deterministicOnly.report.passed, false);
    assert.equal(deterministicOnly.report.auditPolicy, 'deterministic_only');
  }
});

test('V5.1-A2: una sospecha heurística es un localizador, no un veredicto: el juez la confirma o la descarta', async () => {
  const questions = [makeQuestion('q_esc', 1, 'infancia', '¿Cómo fue tu etapa escolar?')];
  const answers = [
    makeAnswer({
      id: 'a_esc',
      questionId: 'q_esc',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Nunca abandoné la escuela de mi pueblo.',
    }),
  ];
  // Same meaning, different polarity surface: the negation moved from the verb to the noun phrase.
  const faithful = 'Permanecí en la escuela de mi pueblo sin abandonarla jamás.';
  const manuscript = singleChapterManuscript({
    style: 'first_person_literary',
    paragraphs: [faithful],
    answerIds: ['a_esc'],
    questionIds: ['q_esc'],
    title: 'La escuela del pueblo',
  });

  const deterministic = auditAndApproveBookManuscript({ manuscript, answers, questions });
  const detTrace = deterministic.report.traceabilityMatrix.find((t) => t.answerId === 'a_esc');
  if (detTrace?.verified === false) {
    assert.equal(
      detTrace.needsSemanticReview,
      true,
      'Una unidad no verificada pero semejante debe marcarse para arbitraje semántico, no como omisión definitiva.'
    );
    assert.ok(
      (deterministic.report.semanticAudit?.reviewCandidateUnitIds || []).includes(detTrace.unitId)
    );
  }

  const cleared = await auditWithHybridSemantics({
    manuscript,
    answers,
    questions,
    ...PROVIDER_ARGS,
    aiJudgeOverride: async ({ cases }) =>
      cases.map((c) => ({ unitId: c.unitId, verdict: 'supported' as const, rationale: 'Equivalente.' })),
  });
  assert.equal(cleared.report.passed, true, JSON.stringify(cleared.report.blockingDefects));

  const confirmed = await auditWithHybridSemantics({
    manuscript: singleChapterManuscript({
      style: 'first_person_literary',
      paragraphs: ['Abandoné la escuela de mi pueblo.'],
      answerIds: ['a_esc'],
      questionIds: ['q_esc'],
      title: 'La escuela del pueblo',
    }),
    answers,
    questions,
    ...PROVIDER_ARGS,
    aiJudgeOverride: async ({ cases }) =>
      cases.map((c) => ({ unitId: c.unitId, verdict: 'contradicted' as const, rationale: 'Invierte la negación.' })),
  });
  assert.equal(confirmed.report.passed, false);
  assert.equal(
    (confirmed.report.veracityAudit?.semanticContradictionFlags || []).length >= 1,
    true,
    'La contradicción confirmada por el juez debe quedar registrada.'
  );
});

test('V5.1-A3: la evidencia de la auditoría V5 (46 respuestas, 316 unidades) deja de producir contradicciones falsas en los estilos A, B y C', (t) => {
  const statePath = path.join(process.cwd(), 'data', 'storage_state.json');
  // V5.8.5 (#11): the snapshot is runtime data and no longer travels with the repository.
  if (!fs.existsSync(statePath)) {
    t.skip('data/storage_state.json no existe en esta copia (datos locales, fuera de git).');
    return;
  }
  const rawState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  const allAnswers: any[] = rawState.answers || [];
  const target = (rawState.interviews || []).find(
    (inv: any) => allAnswers.filter((a) => a.interviewId === inv.id).length === 46
  );
  if (!target) {
    t.skip('La entrevista de prueba de 46 respuestas no está en el snapshot.');
    return;
  }
  const answers = allAnswers.filter((a) => a.interviewId === target.id);
  const participants = (rawState.participants || []).filter((p: any) => p.interviewId === target.id);

  for (const style of ALL_STYLES) {
    const base = buildParticipantInitialManuscriptFromAnswers({
      interviewTitle: target.title || 'Mi historia',
      storyMode: target.storyMode || 'individual',
      participantNames: participants.map((p: any) => p.name).filter(Boolean),
      answers,
      questions: rawState.questions || [],
      narrativeStyle: style,
    });
    const audit = auditAndApproveBookManuscript({
      manuscript: { ...base.manuscript, aiGenerated: true },
      answers,
      questions: rawState.questions || [],
    });
    // V5 reported 6 / 6 / 10 contradictions and 310 / 310 / 306 covered units for these same
    // faithful base manuscripts. They reproduce the testimony almost literally, so every one of
    // those flags was a false positive.
    assert.equal(
      (audit.report.veracityAudit?.semanticContradictionFlags || []).length,
      0,
      `${STYLE_LABEL[style]}: ${JSON.stringify(audit.report.veracityAudit?.semanticContradictionFlags)}`
    );
    assert.equal(audit.report.totalSourceUnits, 316, 'El inventario no debe reducirse para aprobar.');
    assert.equal(audit.report.integratedUnits, 316);
    assert.equal(audit.report.coveragePercentage, 100);
  }
});

test('V5.1-A4: en biografía en tercera persona, "me cuidaba" -> "le cuidaba" no es inversión de agencia, pero "yo la cuidaba" sí', () => {
  const questions = [makeQuestion('q_cui', 1, 'infancia', '¿Quién te cuidaba de pequeño?')];
  const answers = [
    makeAnswer({
      id: 'a_cui',
      questionId: 'q_cui',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Mi abuela me cuidaba todas las tardes en su casa.',
    }),
  ];
  const faithfulThird = auditAndApproveBookManuscript({
    manuscript: singleChapterManuscript({
      style: 'third_person_biography',
      paragraphs: ['Su abuela le cuidaba todas las tardes en su casa.'],
      answerIds: ['a_cui'],
      questionIds: ['q_cui'],
      title: 'Las tardes con la abuela',
    }),
    answers,
    questions,
  });
  assert.equal(
    (faithfulThird.report.veracityAudit?.semanticContradictionFlags || []).length,
    0,
    JSON.stringify(faithfulThird.report.veracityAudit?.semanticContradictionFlags)
  );

  const reversed = auditAndApproveBookManuscript({
    manuscript: singleChapterManuscript({
      style: 'first_person_literary',
      paragraphs: ['Yo cuidaba a mi abuela todas las tardes en su casa.'],
      answerIds: ['a_cui'],
      questionIds: ['q_cui'],
      title: 'Las tardes con la abuela',
    }),
    answers,
    questions,
  });
  assert.equal(reversed.report.passed, false, 'La inversión real de quién cuida a quién debe seguir detectándose.');
});

test('V5.1-A5: los números se comparan por valor ("1975" = "mil novecientos setenta y cinco") y los años inventados siguen bloqueando', () => {
  assert.deepEqual(extractSpanishNumberWordValues('naci en mil novecientos setenta y cinco'), ['1975']);
  assert.deepEqual(extractSpanishNumberWordValues('tenia veinticinco anos y una casa'), ['25']);

  const questions = [makeQuestion('q_num', 1, 'juventud', '¿Cuándo te casaste?')];
  const answers = [
    makeAnswer({
      id: 'a_num',
      questionId: 'q_num',
      questionText: questions[0].text,
      lifeStage: 'juventud',
      answerText: 'Me casé en mil novecientos setenta y cinco, cuando tenía veinticinco años.',
    }),
  ];
  const digits = auditAndApproveBookManuscript({
    manuscript: singleChapterManuscript({
      style: 'first_person_simple',
      paragraphs: ['Me casé en 1975, cuando tenía 25 años.'],
      answerIds: ['a_num'],
      questionIds: ['q_num'],
      title: 'El día de la boda',
    }),
    answers,
    questions,
  });
  assert.deepEqual(
    digits.report.veracityAudit?.inventedDataFlags,
    [],
    'Escribir en cifras un número que el entrevistado dijo con palabras no es inventar un dato.'
  );

  const invented = auditAndApproveBookManuscript({
    manuscript: singleChapterManuscript({
      style: 'first_person_simple',
      paragraphs: ['Me casé en 1982, cuando tenía 25 años.'],
      answerIds: ['a_num'],
      questionIds: ['q_num'],
      title: 'El día de la boda',
    }),
    answers,
    questions,
  });
  assert.equal(
    (invented.report.veracityAudit?.inventedDataFlags || []).some((f) => f.includes('1982')),
    true,
    'Un año que no está en el testimonio debe seguir señalándose como dato inventado.'
  );
  assert.equal(invented.report.passed, false);
});

test('V5.1-A6: en Estilo C una cita con comillas tipográficas no es fuga de primera persona; la narración en primera persona sí', () => {
  const quoted = auditBookEditorialQuality({
    manuscript: singleChapterManuscript({
      style: 'third_person_biography',
      paragraphs: [
        'Carlos siempre repetía una frase a sus hijos: “Yo nunca dejé de creer en mi familia”. Aquella convicción marcó su manera de vivir.',
      ],
      answerIds: [],
      questionIds: [],
      title: 'Una convicción',
    }),
  });
  assert.deepEqual(quoted.firstPersonLeakFlags, []);

  const leaked = auditBookEditorialQuality({
    manuscript: singleChapterManuscript({
      style: 'third_person_biography',
      paragraphs: ['Yo nunca dejé de creer en mi familia y así lo viví siempre.'],
      answerIds: [],
      questionIds: [],
      title: 'Una convicción',
    }),
  });
  assert.equal(leaked.firstPersonLeakFlags.length >= 1, true);
});

// ---------------------------------------------------------------------------------------------
// B. Omisiones reales y juez no disponible
// ---------------------------------------------------------------------------------------------

test('V5.1-B1: un manuscrito realmente incompleto sigue rechazándose (omisión total sin gastar juez y omisión parcial confirmada)', async () => {
  const questions = [
    makeQuestion('q_a', 1, 'infancia', '¿Dónde naciste?'),
    makeQuestion('q_b', 2, 'infancia', '¿Qué hacías con tu hermana?'),
  ];
  const answers = [
    makeAnswer({
      id: 'a_a',
      questionId: 'q_a',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Nací en Oaxaca en una casa de adobe junto al mercado.',
    }),
    makeAnswer({
      id: 'a_b',
      questionId: 'q_b',
      questionText: questions[1].text,
      lifeStage: 'infancia',
      answerText: 'Con mi hermana Lucía vendíamos tamales los domingos frente a la parroquia.',
    }),
  ];

  // Total omission: nothing about the sister, the tamales or the parish.
  const judgedUnitTexts: string[] = [];
  const totalOmission = await auditWithHybridSemantics({
    manuscript: singleChapterManuscript({
      style: 'first_person_literary',
      paragraphs: ['Nací en Oaxaca en una casa de adobe junto al mercado.'],
      answerIds: ['a_a', 'a_b'],
      questionIds: ['q_a', 'q_b'],
      title: 'La casa de adobe',
    }),
    answers,
    questions,
    ...PROVIDER_ARGS,
    aiJudgeOverride: async ({ cases }) => {
      judgedUnitTexts.push(...cases.map((c) => c.originalTestimony));
      return cases.map((c) => ({ unitId: c.unitId, verdict: 'supported' as const, rationale: 'x' }));
    },
  });
  assert.equal(totalOmission.report.passed, false, 'Una omisión total jamás debe aprobarse.');
  assert.equal(
    judgedUnitTexts.some((t) => /tamales/.test(t)),
    false,
    'Una omisión evidente se decide con reglas, sin consumir tokens del juez.'
  );
  assert.equal(
    classifyBookFailureReasonCode({ report: totalOmission.report, editorialAudit: totalOmission.editorialAudit }).code,
    'DOCUMENTARY_COVERAGE_FAILURE'
  );

  // V5.2 — Partial omission whose lost detail is a concrete name ("Lucía"): the name is nowhere
  // in the book, so absence is DEMONSTRATED and the unit is rejected without spending the judge.
  const judgedForNamedOmission: string[] = [];
  const namedOmission = await auditWithHybridSemantics({
    manuscript: singleChapterManuscript({
      style: 'first_person_literary',
      paragraphs: [
        'Nací en Oaxaca en una casa de adobe junto al mercado.',
        'Con mi hermana vendíamos tamales los domingos.',
      ],
      answerIds: ['a_a', 'a_b'],
      questionIds: ['q_a', 'q_b'],
      title: 'La casa de adobe',
    }),
    answers,
    questions,
    ...PROVIDER_ARGS,
    aiJudgeOverride: async ({ cases }) => {
      judgedForNamedOmission.push(...cases.map((c) => c.originalTestimony));
      return cases.map((c) => ({ unitId: c.unitId, verdict: 'supported' as const, rationale: 'x' }));
    },
  });
  assert.equal(namedOmission.report.passed, false, 'Perder un nombre concreto es una omisión real.');
  const namedTrace = namedOmission.report.traceabilityMatrix.find((tr) => tr.answerId === 'a_b');
  assert.match(namedTrace?.evidenceOfAbsenceReason || '', /lucia/);
  assert.equal(judgedForNamedOmission.some((t) => /Lucía/.test(t)), false);

  // Partial omission of a COMMON detail ("frente a la parroquia"): related evidence exists, so
  // only the judge can decide; it confirms the omission and the draft is rejected.
  const partial = await auditWithHybridSemantics({
    manuscript: singleChapterManuscript({
      style: 'first_person_literary',
      paragraphs: [
        'Nací en Oaxaca en una casa de adobe junto al mercado.',
        'Con mi hermana Lucía vendíamos tamales los domingos.',
      ],
      answerIds: ['a_a', 'a_b'],
      questionIds: ['q_a', 'q_b'],
      title: 'La casa de adobe',
    }),
    answers,
    questions,
    ...PROVIDER_ARGS,
    aiJudgeOverride: async ({ cases }) =>
      cases.map((c) => ({
        unitId: c.unitId,
        verdict: /parroquia/.test(c.candidateExcerpt) ? ('supported' as const) : ('omitted' as const),
        rationale: 'Falta el lugar (frente a la parroquia).',
      })),
  });
  assert.equal(partial.report.passed, false, 'Una omisión parcial confirmada debe rechazarse.');
  const partialTrace = partial.report.traceabilityMatrix.find((tr) => tr.answerId === 'a_b');
  assert.equal(partialTrace?.aiJudgeVerdict, 'omitted');
  assert.equal(partialTrace?.verificationStatus, 'partially_supported');
  assert.ok((partial.report.coverageAudit?.missingUnitIds || []).includes(partialTrace!.unitId));
  assert.equal(
    (partial.report.veracityAudit?.semanticContradictionFlags || []).length,
    0,
    'Una omisión no debe reportarse como contradicción.'
  );
});

test('V5.1-B2: si el juez semántico no responde, el fallo es técnico (no documental) y nunca se aprueba automáticamente', async () => {
  const questions = [makeQuestion('q_pan', 1, 'adultez', '¿Cómo fundaste tu negocio?')];
  const answers = [
    makeAnswer({
      id: 'a_pan',
      questionId: 'q_pan',
      questionText: questions[0].text,
      lifeStage: 'adultez',
      answerText:
        'En 1998 ahorramos durante cuatro años para abrir nuestra panadería artesanal en Oaxaca cerca del mercado central.',
    }),
  ];
  const manuscript = singleChapterManuscript({
    style: 'first_person_literary',
    paragraphs: ['En 1998, tras cuatro primaveras de esfuerzo en Oaxaca, levantamos nuestro obrador junto al viejo mercado.'],
    answerIds: ['a_pan'],
    questionIds: ['q_pan'],
    title: 'El nacimiento de la panadería',
  });

  for (const failingJudge of [
    (async ({ cases }) =>
      cases.map((c) => ({
        unitId: c.unitId,
        verdict: 'inconclusive' as const,
        rationale: 'Proveedor no disponible.',
        unavailable: true,
      }))) as SemanticJudgeFunction,
    (async () => {
      throw new Error('HTTP 503');
    }) as SemanticJudgeFunction,
  ]) {
    const result = await auditWithHybridSemantics({
      manuscript,
      answers,
      questions,
      ...PROVIDER_ARGS,
      aiJudgeOverride: failingJudge,
    });
    assert.equal(result.report.passed, false);
    assert.equal((result.report.semanticAudit?.judgeUnavailableUnitIds || []).length >= 1, true);
    const diag = classifyBookFailureReasonCode({ report: result.report, editorialAudit: result.editorialAudit });
    assert.equal(diag.code, 'SEMANTIC_JUDGE_UNAVAILABLE');
    assert.equal(diag.category, 'technical');
  }
});

// ---------------------------------------------------------------------------------------------
// C. Evidencia de aprobación y política unificada
// ---------------------------------------------------------------------------------------------

function approvedFixture() {
  const questions = [makeQuestion('q_pan', 1, 'adultez', '¿Cómo fundaste tu negocio?')];
  const answers = [
    makeAnswer({
      id: 'a_pan',
      questionId: 'q_pan',
      questionText: questions[0].text,
      lifeStage: 'adultez',
      answerText:
        'En 1998 ahorramos durante cuatro años para abrir nuestra panadería artesanal en Oaxaca cerca del mercado central.',
    }),
  ];
  const manuscript = singleChapterManuscript({
    style: 'first_person_literary',
    paragraphs: ['En 1998, tras cuatro primaveras de esfuerzo en Oaxaca, levantamos nuestro obrador junto al viejo mercado.'],
    answerIds: ['a_pan'],
    questionIds: ['q_pan'],
    title: 'El nacimiento de la panadería',
  });
  const fingerprintOf = (ans: DocumentarySourceAnswerInput[], style: DemoNarrativeStyleId = 'first_person_literary') =>
    computeBookSourceFingerprint({
      interviewId: 'int_evidence',
      narrativeStyle: style,
      bookStructureMode: 'prompt_autonomous',
      literaryPromptText: DEFAULT_LITERARY_PROMPTS_TEXT[style],
      closingDedicationText: '',
      answers: ans as any,
      questions: questions as any,
    });
  return { questions, answers, manuscript, fingerprintOf };
}

test('V5.1-C1: la evidencia de aprobación es verificable y no puede falsificarse ni reutilizarse desde el navegador', async () => {
  const { questions, answers, manuscript, fingerprintOf } = approvedFixture();
  const approved = await auditWithHybridSemantics({
    manuscript,
    answers,
    questions,
    ...PROVIDER_ARGS,
    aiJudgeOverride: async ({ cases }) =>
      cases.map((c) => ({ unitId: c.unitId, verdict: 'supported' as const, rationale: 'Paráfrasis fiel.' })),
  });
  assert.equal(approved.report.passed, true);

  const sourceFingerprint = fingerprintOf(answers);
  const signed: DemoManuscript = {
    ...approved.manuscript,
    generationStatus: 'approved',
    status: 'approved',
  };
  signed.approvalEvidence = issueBookApprovalEvidence({
    interviewId: 'int_evidence',
    manuscript: signed,
    sourceFingerprint,
    report: approved.report,
    editorialAuditPassed: approved.editorialAudit.passed,
  });
  assert.equal(signed.approvalEvidence.judgeResolvedUnits >= 1, true);

  const verify = (m: DemoManuscript, fp = sourceFingerprint, style: DemoNarrativeStyleId = 'first_person_literary') =>
    verifyBookApprovalEvidence({ manuscript: m, interviewId: 'int_evidence', narrativeStyle: style, currentSourceFingerprint: fp });

  // 1. Survives the JSON round-trip through the browser, and layout-only edits (title, dedication).
  const roundTripped: DemoManuscript = JSON.parse(JSON.stringify(signed));
  assert.equal(verify(roundTripped).valid, true);
  assert.equal(
    verify({ ...roundTripped, title: 'Otro título elegido en maquetación', dedication: 'Para mis nietos.' }).valid,
    true
  );

  // 2. Editing audited text invalidates it.
  const editedText: DemoManuscript = JSON.parse(JSON.stringify(signed));
  editedText.chapters[0].paragraphs[0] += ' Además, ganamos un premio nacional en 2001.';
  assert.deepEqual(verify(editedText), { valid: false, reason: 'manuscript_changed' });

  // 3. Changing the testimony after approval invalidates it.
  const changedAnswers = [{ ...answers[0], answerText: `${answers[0].answerText} Mi socio fue mi hermano Raúl.` }];
  assert.deepEqual(verify(roundTripped, fingerprintOf(changedAnswers)), { valid: false, reason: 'source_changed' });

  // 4. It cannot be moved to another style or interview.
  assert.equal(verify(roundTripped, fingerprintOf(answers, 'third_person_biography'), 'third_person_biography').reason, 'style_mismatch');
  assert.equal(
    verifyBookApprovalEvidence({
      manuscript: roundTripped,
      interviewId: 'int_other',
      narrativeStyle: 'first_person_literary',
      currentSourceFingerprint: sourceFingerprint,
    }).reason,
    'interview_mismatch'
  );

  // 5. A browser cannot forge it: status flags alone, a tampered field or a made-up signature fail.
  const { approvalEvidence: _dropped, ...withoutEvidence } = roundTripped;
  assert.equal(verify({ ...withoutEvidence, generationStatus: 'approved', status: 'approved' } as DemoManuscript).reason, 'missing_evidence');
  const retargeted: DemoManuscript = JSON.parse(JSON.stringify(editedText));
  (retargeted.approvalEvidence as any).manuscriptContentHash = computeManuscriptContentHash(retargeted);
  assert.equal(verify(retargeted).reason, 'invalid_signature', 'Recalcular el hash en el cliente no sirve sin la clave del servidor.');
  const fakeSignature: DemoManuscript = JSON.parse(JSON.stringify(signed));
  (fakeSignature.approvalEvidence as any).signature = 'a'.repeat(64);
  assert.equal(verify(fakeSignature).reason, 'invalid_signature');

  // 6. Evidence signed with another server key is rejected (then saving re-audits instead).
  const previousSecret = process.env.BOOK_APPROVAL_SECRET;
  process.env.BOOK_APPROVAL_SECRET = 'a-completely-different-server-secret';
  assert.equal(verify(roundTripped).reason, 'invalid_signature');
  process.env.BOOK_APPROVAL_SECRET = previousSecret;
  __resetProcessLocalApprovalSecretForTests();
  assert.equal(verify(roundTripped).valid, true);

  // 7. V5.3: evidence is a DELIVERY authorization. It is never issued for a manuscript below the
  // 60 % minimum, and when the strict audit did not pass it says so (with observations).
  assert.throws(() =>
    issueBookApprovalEvidence({
      interviewId: 'int_evidence',
      manuscript: signed,
      sourceFingerprint,
      report: { ...approved.report, passed: false, integratedUnits: 0 },
      editorialAuditPassed: true,
    })
  );
  const withObservations = issueBookApprovalEvidence({
    interviewId: 'int_evidence',
    manuscript: signed,
    sourceFingerprint,
    report: { ...approved.report, passed: false },
    editorialAuditPassed: true,
  });
  assert.equal(withObservations.verificationLevel, 'delivered_with_observations');
  assert.equal((signed.approvalEvidence as any).verificationLevel, 'fully_verified');
});

test('V5.1-C2: generación y guardado aplican la misma política y producen el mismo veredicto sin volver a consultar a la IA', async () => {
  clearSemanticVerdictCache();
  const { questions, answers, manuscript } = approvedFixture();
  let judgeCalls = 0;
  const judge: SemanticJudgeFunction = async ({ cases }) => {
    judgeCalls += cases.length;
    return cases.map((c) => ({ unitId: c.unitId, verdict: 'supported' as const, rationale: 'Paráfrasis fiel.' }));
  };

  // Before V5.1 this manuscript was approved by the hybrid audit during generation...
  const generationAudit = await auditWithHybridSemantics({
    manuscript,
    answers,
    questions,
    ...PROVIDER_ARGS,
    aiJudgeOverride: judge,
    useVerdictCache: true,
  });
  assert.equal(generationAudit.report.passed, true);
  const callsAfterGeneration = judgeCalls;
  assert.equal(callsAfterGeneration >= 1, true);

  // ...and rejected at save time by the deterministic-only audit (the reported inconsistency):
  const legacySaveAudit = auditAndApproveBookManuscript({
    manuscript: { ...manuscript, generationStatus: 'generated' },
    answers,
    questions,
  });
  assert.equal(
    legacySaveAudit.report.passed,
    false,
    'Las reglas deterministas por sí solas no pueden aprobar una paráfrasis: por eso el guardado ya no las usa como veredicto.'
  );

  // The save path now re-runs the SAME hybrid audit when there is no evidence: identical verdict,
  // and the memoized judge verdicts mean zero additional AI calls.
  const browserCopy: DemoManuscript = JSON.parse(JSON.stringify(generationAudit.manuscript));
  const saveAudit = await auditWithHybridSemantics({
    manuscript: { ...browserCopy, generationStatus: 'generated', approvalEvidence: undefined },
    answers,
    questions,
    ...PROVIDER_ARGS,
    aiJudgeOverride: judge,
    useVerdictCache: true,
  });
  assert.equal(saveAudit.report.passed, generationAudit.report.passed);
  assert.equal(saveAudit.report.coveragePercentage, generationAudit.report.coveragePercentage);
  assert.equal(judgeCalls, callsAfterGeneration, 'El guardado no debe volver a gastar tokens en veredictos ya emitidos.');
  clearSemanticVerdictCache();
});

// ---------------------------------------------------------------------------------------------
// D. Flujo completo: generar -> auditar -> aprobar -> guardar -> PDF
// ---------------------------------------------------------------------------------------------

function buildLifeStoryFixture(interviewId = 'int_v51_pipeline', options: { extended?: boolean } = {}) {
  const defs: Array<[Stage, string, string]> = [
    ['infancia', '¿Dónde naciste y cómo era tu casa?', 'Nací en Oaxaca en 1950. Mi casa era de adobe y tenía un patio grande. Mi madre Elena cocinaba tamales cada domingo. Mi padre Julián trabajaba en el campo.'],
    ['infancia', '¿A qué jugabas de niño?', 'Jugaba canicas con mi hermano Pedro en la plaza. También corríamos junto al río. Mi abuela Carmen nos contaba historias por la noche. Aquellas tardes eran felices.'],
    ['juventud', '¿Qué estudiaste?', 'Estudié en la escuela secundaria del pueblo. Mi maestro Ramón me enseñó a leer mapas. En 1968 viajé a Puebla para estudiar contabilidad. Sentí miedo y también orgullo.'],
    ['juventud', '¿Cuál fue tu primer trabajo?', 'Mi primer trabajo fue en una panadería de Puebla. Amasaba el pan desde la madrugada. El dueño Tomás me pagaba cada sábado. Aprendí el valor del esfuerzo.'],
    ['adultez', '¿Cómo conociste a tu esposa?', 'Conocí a mi esposa Rosa en una fiesta en 1972. Bailamos toda la noche en el salón municipal. Nos casamos en 1974 en la parroquia de Santo Domingo. Fue el día más alegre.'],
    ['adultez', '¿Cómo fue formar tu familia?', 'Tuvimos tres hijos en Oaxaca. Abrimos una tienda de abarrotes cerca del mercado. Rosa llevaba las cuentas con mucho cuidado. Trabajamos juntos durante veinte años.'],
    ['madurez', '¿Qué aprendiste con los años?', 'Aprendí que la paciencia abre caminos. Cerramos la tienda en 1995 para descansar. Viajamos a Veracruz para conocer el mar. Sentí una gratitud enorme.'],
    ['legado_general', '¿Qué mensaje dejas a tu familia?', 'Quiero que mis nietos recuerden la casa de adobe. Deseo que cuiden a su abuela Rosa. Les dejo mis mapas y mis cuadernos. Los quiero con todo mi amor.'],
  ];
  if (options.extended) {
    // Enough additional memories (26+ answers) for the engine to split the draft into several batches.
    const stages: Stage[] = ['infancia', 'juventud', 'adultez', 'madurez'];
    const trips: Array<[number, string, string, string, string]> = [
      [1955, 'Mitla', 'primo', 'Andrés', 'el chocolate de agua'],
      [1957, 'Tlacolula', 'tía', 'Beatriz', 'el pan de yema'],
      [1959, 'Etla', 'padrino', 'Cristóbal', 'el quesillo fresco'],
      [1961, 'Zaachila', 'prima', 'Dolores', 'la nieve de tuna'],
      [1963, 'Ocotlán', 'tío', 'Ernesto', 'el mole negro'],
      [1965, 'Miahuatlán', 'madrina', 'Felipa', 'el tejate frío'],
      [1969, 'Tehuacán', 'amigo', 'Gonzalo', 'las memelas con asiento'],
      [1971, 'Cholula', 'amiga', 'Hortensia', 'los camotes dulces'],
      [1976, 'Huatulco', 'cuñado', 'Ignacio', 'el pescado a la talla'],
      [1978, 'Tuxtepec', 'suegra', 'Josefina', 'el caldo de piedra'],
      [1980, 'Juchitán', 'compadre', 'Leandro', 'los totopos de horno'],
      [1983, 'Tehuantepec', 'comadre', 'Marcela', 'el guisado de res'],
      [1986, 'Salina Cruz', 'vecino', 'Norberto', 'el coctel de camarón'],
      [1989, 'Pinotepa', 'vecina', 'Ofelia', 'el pozole de puerco'],
      [1991, 'Tlaxiaco', 'sobrino', 'Pascual', 'el atole de granillo'],
      [1993, 'Nochixtlán', 'sobrina', 'Quintina', 'las tortillas de trigo'],
      [1997, 'Ixtlán', 'yerno', 'Rodolfo', 'la trucha asada'],
      [1999, 'Guelatao', 'nuera', 'Silvia', 'el café de olla'],
      [2002, 'Teotitlán', 'nieto', 'Teodoro', 'el higadito de fandango'],
      [2005, 'Zimatlán', 'nieta', 'Úrsula', 'las empanadas de amarillo'],
    ];
    trips.forEach(([year, town, relative, name, dish], idx) => {
      defs.push([
        stages[idx % stages.length],
        `¿Qué recuerdas de tu visita a ${town}?`,
        `En ${year} visité ${town} con mi ${relative} ${name}. Allí probé ${dish} por primera vez.`,
      ]);
    });
  }
  const questions = defs.map(([stage, text], i) => makeQuestion(`q_${i + 1}`, i + 1, stage, text));
  const answers = defs.map(([stage, text, answerText], i) =>
    makeAnswer({ id: `a_${i + 1}`, questionId: `q_${i + 1}`, questionText: text, lifeStage: stage, answerText })
  );
  const interview: any = {
    id: interviewId,
    title: 'Memorias de Carlos Mendoza',
    storyMode: 'individual',
    userDeclaredComplete: true,
  };
  const participants: any[] = [{ id: 'part_1', interviewId, name: 'Carlos Mendoza' }];
  return { interview, participants, answers, questions };
}

/** A faithful stand-in for the AI drafter: writes each planned chapter from its base redaction. */
function makeFaithfulDrafter(base: DemoManuscript, transform?: (chapterId: string, paragraphs: string[]) => string[]) {
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
          const ch = base.chapters.find((c) => c.id === seg.id)!;
          const paragraphs = seg.segmentIndex === 1 ? ch.paragraphs : [];
          return {
            id: seg.id,
            partNumber: seg.partNumber,
            dimensionKey: seg.dimensionKey,
            title: ch.title,
            paragraphs: transform ? transform(seg.id, paragraphs) : paragraphs,
          };
        }),
      },
    };
  };
  return { draftBatch, calls };
}

/**
 * Deterministic stand-in for a careful semantic judge: a memory is "supported" only when the
 * excerpt really carries its distinctive content, otherwise it is reported as omitted. It never
 * approves a memory that is not in the text, so it cannot mask real omissions in these tests.
 */
const scenarioJudgeForAdditions = createScenarioJudge();
const supportiveJudge: SemanticJudgeFunction = async (params) => {
  const { cases } = params;
  const fold = (text: string) =>
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  // V5.2: Direction-B cases (possible invented facts) are judged by the shared scenario judge.
  const additionCases = cases.filter((c) => c.checkKind === 'unsupported_addition');
  const additionVerdicts =
    additionCases.length > 0 ? await scenarioJudgeForAdditions.judge({ ...params, cases: additionCases }) : [];
  return cases.map((c) => {
    if (c.checkKind === 'unsupported_addition') {
      return additionVerdicts.find((v) => v.unitId === c.unitId)!;
    }
    const distinctive = Array.from(
      new Set(
        fold(c.originalTestimony)
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 5 || /^\d+$/.test(w))
      )
    );
    const excerpt = fold(c.candidateExcerpt);
    const hits = distinctive.filter((w) => excerpt.includes(w.slice(0, 5))).length;
    // Like a competent judge, every concrete detail the rules could not locate literally
    // ("fecha o cifra: 1950", "lugar: oaxaca") must be present for the memory to count.
    const detailsPresent = (c.detailsToConfirm || []).every((detail) => {
      const value = fold(detail.slice(detail.indexOf(':') + 1)).trim();
      return value.length === 0 || excerpt.includes(value.slice(0, 5));
    });
    const supported =
      detailsPresent && (distinctive.length === 0 || hits / distinctive.length >= 0.6);
    return {
      unitId: c.unitId,
      verdict: supported ? ('supported' as const) : ('omitted' as const),
      rationale: supported ? 'Conserva el hecho.' : 'El fragmento no contiene este recuerdo.',
    };
  });
};

function baseManuscriptFor(fx: ReturnType<typeof buildLifeStoryFixture>, style: DemoNarrativeStyleId) {
  return buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: fx.interview.title,
    storyMode: fx.interview.storyMode,
    participantNames: fx.participants.map((p) => p.name),
    answers: fx.answers as any,
    questions: fx.questions as any,
    narrativeStyle: style,
    closingDedicationText: '',
    bookStructureMode: 'prompt_autonomous',
  });
}

const defaultEditorialConfig = (style: DemoNarrativeStyleId): DemoEditorialConfig =>
  ({
    narrativeStyle: style,
    coverDesignId: 'legado_clasico',
    interiorStyleId: 'clasico_editorial',
    bookFormatId: '6x9',
    coverVisualType: 'none',
    includeTableOfContents: true,
  } as unknown as DemoEditorialConfig);

test('V5.1-D1: flujo completo en los estilos A, B y C: generar -> auditar -> aprobar -> verificar para guardar -> PDF', async () => {
  for (const style of ALL_STYLES) {
    const fx = buildLifeStoryFixture(`int_v51_e2e_${style}`);
    const base = baseManuscriptFor(fx, style);
    const drafter = makeFaithfulDrafter(base.manuscript);

    const result = await generateParticipantBookManuscriptWithAI({
      interview: fx.interview,
      participants: fx.participants,
      answers: fx.answers as any,
      questions: fx.questions as any,
      narrativeStyle: style,
      forceRefresh: true,
      pipelineOverrides: { skipDiskCache: true, draftBatch: drafter.draftBatch, aiJudge: supportiveJudge },
    });

    const m = result.manuscript;
    assert.equal(
      m.generationStatus,
      'approved',
      `${STYLE_LABEL[style]} debe aprobarse. ${result.internalReasonCode}: ${result.diagnosticSummary}`
    );
    assert.equal(m.narrativeStyle, style);
    assert.equal(m.documentaryAudit?.coveragePercentage, 100);
    assert.equal(m.documentaryAudit?.auditPolicy, 'hybrid_arbitrated');
    assert.equal(m.incompleteDraftNotice, undefined);
    assert.ok(m.approvalEvidence, 'La aprobación debe quedar registrada como evidencia firmada.');
    assert.equal(result.batchesCompleted, result.totalBatches);

    // "Save" door (a): the manuscript comes back from the browser and the server verifies it
    // against the testimony it holds now, recomputing the fingerprint on its own.
    const fromBrowser: DemoManuscript = JSON.parse(JSON.stringify(m));
    const serverFingerprint = computeBookSourceFingerprint({
      interviewId: fx.interview.id,
      narrativeStyle: style,
      bookStructureMode: 'prompt_autonomous',
      literaryPromptText: DEFAULT_LITERARY_PROMPTS_TEXT[style],
      closingDedicationText: '',
      answers: fx.answers as any,
      questions: fx.questions as any,
    });
    assert.equal(serverFingerprint, result.sourceFingerprint, 'Generación y guardado deben calcular la misma huella.');
    assert.equal(
      verifyBookApprovalEvidence({
        manuscript: fromBrowser,
        interviewId: fx.interview.id,
        narrativeStyle: style,
        currentSourceFingerprint: serverFingerprint,
      }).valid,
      true
    );

    // "Save" door (b): without evidence, the same hybrid audit approves the same text.
    const reaudit = await auditWithHybridSemantics({
      manuscript: { ...fromBrowser, approvalEvidence: undefined, generationStatus: 'generated' },
      answers: fx.answers,
      questions: fx.questions,
      ...PROVIDER_ARGS,
      aiJudgeOverride: supportiveJudge,
    });
    assert.equal(reaudit.report.passed && reaudit.editorialAudit.passed, true);

    // PDF export of the approved manuscript.
    const composed = composeBookPages({
      manuscript: fromBrowser,
      editorialConfig: defaultEditorialConfig(style),
      chapterPhotos: result.chapterPhotos,
      allPhotosById: result.allPhotosById || {},
      previewSampleOnly: false,
    });
    const pdf = generateRealDemoBookPdf({
      composed,
      profile: {
        mode: 'individual',
        displayName: 'Carlos Mendoza',
        fullName: 'Carlos Mendoza',
        partner1Name: '',
        partner2Name: '',
        hasAcceptedTemporaryNotice: true,
      },
    });
    assert.ok(pdf.blob.size > 1000, `${STYLE_LABEL[style]}: el PDF debe generarse.`);
    assert.ok(pdf.pageCount >= 4);
  }
});

test('V5.1-D2: un fallo técnico conserva los lotes, se informa como técnico y la reanudación solo redacta lo que faltaba', async () => {
  const fx = buildLifeStoryFixture('int_v51_resume', { extended: true });
  const style: DemoNarrativeStyleId = 'first_person_literary';
  const base = baseManuscriptFor(fx, style);

  const savedCheckpoints: Record<string, BookBatchCheckpointPayload> = {};
  const faithful = makeFaithfulDrafter(base.manuscript);
  let failOnBatch = 1;
  const flakyDraft = async (ctx: any) => {
    if (ctx.batchIdx === failOnBatch) {
      throw new Error('Tiempo de espera agotado en proveedor simulado');
    }
    return faithful.draftBatch(ctx);
  };

  const first = await generateParticipantBookManuscriptWithAI({
    interview: fx.interview,
    participants: fx.participants,
    answers: fx.answers as any,
    questions: fx.questions as any,
    narrativeStyle: style,
    forceRefresh: true,
    onBatchCheckpoint: (idx, cp) => {
      savedCheckpoints[String(idx)] = cp;
    },
    pipelineOverrides: { skipDiskCache: true, draftBatch: flakyDraft, aiJudge: supportiveJudge },
  });
  assert.equal((first.totalBatches || 0) >= 2, true, 'El escenario necesita al menos dos lotes.');
  assert.equal(first.manuscript.generationStatus, 'incomplete_draft');
  assert.equal(first.failureCategory, 'technical');
  assert.equal(first.internalReasonCode, 'PARTIAL_BATCH_GENERATION');
  assert.equal(first.manuscript.incompleteDraftNotice, buildIncompleteDraftUserNotice('technical'));
  assert.equal(first.manuscript.approvalEvidence, undefined);
  assert.deepEqual(first.invalidatedBatchIndexes || [], [], 'Un fallo técnico no invalida texto ya redactado.');
  // V5.3.3: batches are drafted in parallel; every batch that finished is kept (only batch 1 failed).
  assert.deepEqual(
    Object.keys(savedCheckpoints).sort(),
    Array.from({ length: first.totalBatches || 0 }, (_, i) => String(i)).filter((i) => i !== '1')
  );
  assert.equal(first.batchesCompleted, (first.totalBatches || 0) - 1);
  assert.equal(savedCheckpoints['0'].sourceFingerprint, first.sourceFingerprint);

  // Resume in a "new process": only the persisted checkpoints are available.
  failOnBatch = -1;
  const resumedDrafter = makeFaithfulDrafter(base.manuscript);
  const fxRestarted = buildLifeStoryFixture('int_v51_resume', { extended: true });
  const resumed = await generateParticipantBookManuscriptWithAI({
    interview: fxRestarted.interview,
    participants: fxRestarted.participants,
    answers: fxRestarted.answers as any,
    questions: fxRestarted.questions as any,
    narrativeStyle: style,
    initialBatchCheckpoints: JSON.parse(JSON.stringify(savedCheckpoints)),
    pipelineOverrides: { skipDiskCache: true, draftBatch: resumedDrafter.draftBatch, aiJudge: supportiveJudge },
  });
  assert.equal(resumed.manuscript.generationStatus, 'approved', `${resumed.internalReasonCode}: ${resumed.diagnosticSummary}`);
  assert.equal(resumedDrafter.calls.includes(0), false, 'El lote 0 ya estaba redactado y no debe pagarse de nuevo.');
  assert.deepEqual(resumedDrafter.calls, [1], 'Solo se redacta el lote que faltaba.');
});

test('V5.1-D3: los lotes de otra versión de la entrevista, de otro estilo o sin huella nunca se reutilizan', async () => {
  const style: DemoNarrativeStyleId = 'first_person_simple';
  const original = buildLifeStoryFixture('int_v51_stale', { extended: true });
  const originalBase = baseManuscriptFor(original, style);
  const checkpointsFromOriginal: Record<string, BookBatchCheckpointPayload> = {};
  const firstRun = await generateParticipantBookManuscriptWithAI({
    interview: original.interview,
    participants: original.participants,
    answers: original.answers as any,
    questions: original.questions as any,
    narrativeStyle: style,
    forceRefresh: true,
    onBatchCheckpoint: (idx, cp) => {
      checkpointsFromOriginal[String(idx)] = cp;
    },
    pipelineOverrides: {
      skipDiskCache: true,
      draftBatch: makeFaithfulDrafter(originalBase.manuscript).draftBatch,
      aiJudge: supportiveJudge,
    },
  });
  assert.equal(firstRun.manuscript.generationStatus, 'approved');
  const totalBatches = firstRun.totalBatches || 0;
  assert.equal(Object.keys(checkpointsFromOriginal).length, totalBatches);

  // The participant edits one answer afterwards.
  const edited = buildLifeStoryFixture('int_v51_stale', { extended: true });
  edited.answers[0] = {
    ...edited.answers[0],
    answerText: `${edited.answers[0].answerText} Mi tío Abel construyó aquella casa.`,
  };
  const editedBase = baseManuscriptFor(edited, style);
  const editedDrafter = makeFaithfulDrafter(editedBase.manuscript);
  const afterEdit = await generateParticipantBookManuscriptWithAI({
    interview: edited.interview,
    participants: edited.participants,
    answers: edited.answers as any,
    questions: edited.questions as any,
    narrativeStyle: style,
    initialBatchCheckpoints: JSON.parse(JSON.stringify(checkpointsFromOriginal)),
    pipelineOverrides: { skipDiskCache: true, draftBatch: editedDrafter.draftBatch, aiJudge: supportiveJudge },
  });
  assert.notEqual(afterEdit.sourceFingerprint, firstRun.sourceFingerprint);
  assert.equal(
    editedDrafter.calls.length,
    afterEdit.totalBatches,
    'Ningún lote redactado con las respuestas anteriores puede reutilizarse.'
  );
  assert.equal(afterEdit.manuscript.generationStatus, 'approved', `${afterEdit.internalReasonCode}: ${afterEdit.diagnosticSummary}`);
  assert.equal(
    afterEdit.manuscript.chapters.some((ch) => ch.paragraphs.some((p) => /Abel/.test(p))),
    true,
    'El libro debe incluir el recuerdo añadido.'
  );

  // The approval of the previous version does not transfer to the edited interview.
  assert.equal(
    verifyBookApprovalEvidence({
      manuscript: firstRun.manuscript,
      interviewId: edited.interview.id,
      narrativeStyle: style,
      currentSourceFingerprint: afterEdit.sourceFingerprint!,
    }).reason,
    'source_changed'
  );

  // Legacy checkpoints without a fingerprint are discarded as well.
  const legacy = buildLifeStoryFixture('int_v51_legacy', { extended: true });
  const legacyBase = baseManuscriptFor(legacy, style);
  const legacyDrafter = makeFaithfulDrafter(legacyBase.manuscript);
  const legacyCheckpoints: Record<string, BookBatchCheckpointPayload> = {};
  for (const [k, cp] of Object.entries(checkpointsFromOriginal)) {
    const { sourceFingerprint: _drop, ...withoutFingerprint } = cp;
    legacyCheckpoints[k] = withoutFingerprint;
  }
  const legacyRun = await generateParticipantBookManuscriptWithAI({
    interview: legacy.interview,
    participants: legacy.participants,
    answers: legacy.answers as any,
    questions: legacy.questions as any,
    narrativeStyle: style,
    initialBatchCheckpoints: legacyCheckpoints,
    pipelineOverrides: { skipDiskCache: true, draftBatch: legacyDrafter.draftBatch, aiJudge: supportiveJudge },
  });
  assert.equal(legacyDrafter.calls.length, legacyRun.totalBatches);
});

test('V5.1-D4: el gestor de trabajos solo hereda lotes de la misma huella y no se une a un trabajo en curso con fuentes distintas', async () => {
  const tempFile = path.join(os.tmpdir(), `yf_v51_jobs_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  const emptyResult = (overrides: Record<string, unknown> = {}) => ({
    manuscript: {
      mode: 'individual',
      title: 'T',
      subtitle: 'S',
      authors: 'A',
      dedication: '',
      closingMessage: 'C',
      narrativeStyle: 'first_person_literary',
      introduction: 'I',
      insufficientInfoNotices: [],
      generatedAt: '2026-06-01T10:00:00.000Z',
      chapters: [],
      generationStatus: 'incomplete_draft',
      status: 'incomplete_draft',
    } as any,
    chapterPhotos: {},
    closingPageText: '',
    scope: 'full' as const,
    ...overrides,
  });
  try {
    const manager = new BookGenerationJobManager(tempFile);
    const base = { interviewId: 'int_fp', narrativeStyle: 'first_person_literary' as const, scope: 'full' as const };

    const failed = manager.startOrResumeJob({
      ...base,
      sourceFingerprint: 'fp_original',
      executor: async (hooks) => {
        hooks.onBatchCheckpoint(0, { parsed: { chapters: [{ id: 'c1' }] }, respondedModel: 'm', sourceFingerprint: 'fp_original' });
        hooks.onBatchCheckpoint(1, { parsed: { chapters: [{ id: 'c2' }] }, respondedModel: 'm', sourceFingerprint: 'fp_original' });
        throw new Error('Tiempo de espera agotado');
      },
    });
    const failedSettled = await manager.waitForJob(failed.jobId);
    assert.equal(failedSettled?.status, 'failed');
    assert.equal(failedSettled?.failureCategory, 'technical');

    // Same sources -> resumes from both checkpoints.
    let inheritedSame: string[] = [];
    const sameJob = manager.startOrResumeJob({
      ...base,
      sourceFingerprint: 'fp_original',
      executor: async (hooks) => {
        inheritedSame = Object.keys(hooks.initialBatchCheckpoints).sort();
        // A content failure invalidates the batch that holds the defective chapter.
        return emptyResult({ failureCategory: 'repair_pending', internalReasonCode: 'REPAIR_EXHAUSTED', invalidatedBatchIndexes: [1] });
      },
    });
    const sameSettled = await manager.waitForJob(sameJob.jobId);
    assert.deepEqual(inheritedSame, ['0', '1']);
    assert.equal(sameSettled?.status, 'incomplete');
    assert.equal(sameSettled?.failureCategory, 'repair_pending');
    assert.deepEqual(Object.keys(sameSettled!.batchCheckpoints), ['0'], 'El lote defectuoso debe descartarse para regenerarse.');

    // The retry after a content failure replays only the healthy batch.
    let inheritedRetry: string[] = [];
    const retry = manager.startOrResumeJob({
      ...base,
      sourceFingerprint: 'fp_original',
      executor: async (hooks) => {
        inheritedRetry = Object.keys(hooks.initialBatchCheckpoints);
        hooks.onBatchCheckpoint(1, { parsed: { chapters: [{ id: 'c2' }] }, respondedModel: 'm', sourceFingerprint: 'fp_original' });
        return emptyResult({ failureCategory: 'technical', internalReasonCode: 'MODEL_TIMEOUT' });
      },
    });
    await manager.waitForJob(retry.jobId);
    assert.deepEqual(inheritedRetry, ['0']);

    // Answers edited -> different fingerprint -> nothing is inherited.
    let inheritedChanged: string[] = ['sentinel'];
    const changedJob = manager.startOrResumeJob({
      ...base,
      sourceFingerprint: 'fp_edited_answers',
      executor: async (hooks) => {
        inheritedChanged = Object.keys(hooks.initialBatchCheckpoints);
        return emptyResult();
      },
    });
    await manager.waitForJob(changedJob.jobId);
    assert.deepEqual(inheritedChanged, [], 'No deben heredarse lotes de respuestas anteriores.');

    // A job still running for old sources is not joined by a request for new sources.
    let release!: () => void;
    const hold = new Promise<void>((res) => {
      release = res;
    });
    const running = manager.startOrResumeJob({
      interviewId: 'int_fp_running',
      narrativeStyle: 'first_person_simple',
      scope: 'full',
      sourceFingerprint: 'fp_v1',
      executor: async () => {
        await hold;
        return emptyResult();
      },
    });
    const joinedSame = manager.startOrResumeJob({
      interviewId: 'int_fp_running',
      narrativeStyle: 'first_person_simple',
      scope: 'full',
      sourceFingerprint: 'fp_v1',
      executor: async () => {
        throw new Error('No debe ejecutarse: mismas fuentes comparten el trabajo activo');
      },
    });
    assert.equal(joinedSame.jobId, running.jobId);
    const forNewSources = manager.startOrResumeJob({
      interviewId: 'int_fp_running',
      narrativeStyle: 'first_person_simple',
      scope: 'full',
      sourceFingerprint: 'fp_v2',
      executor: async () => emptyResult(),
    });
    assert.notEqual(forNewSources.jobId, running.jobId);
    assert.equal(manager.getJob(running.jobId)?.status, 'cancelled');
    release();
    await manager.waitForJob(running.jobId);
    await manager.waitForJob(forNewSources.jobId);

    // Status lookups ignore jobs that no longer match the current interview content.
    assert.equal(
      manager.findLatestJobForInterview({ interviewId: 'int_fp_running', resolveCurrentSourceFingerprint: () => 'fp_v2' })?.jobId,
      forNewSources.jobId
    );
    assert.equal(
      manager.findLatestJobForInterview({ interviewId: 'int_fp_running', resolveCurrentSourceFingerprint: () => 'fp_v3' }),
      null
    );

    // V5.3.3: participants never see a failure family, internal code or diagnostic: only that
    // their book is still being prepared.
    const view = toParticipantBookJobView(sameSettled!);
    assert.equal(view.failureCategory, undefined);
    assert.equal(view.repairPass, 0);
    assert.equal('internalReasonCode' in view, false);
    assert.equal('diagnosticSummary' in view, false);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
});

// ---------------------------------------------------------------------------------------------
// E. Reparación
// ---------------------------------------------------------------------------------------------

test('V5.1-E1: una omisión real se repara de forma narrativa; si la reparación falla, el borrador se rechaza con diagnóstico preciso y sin pegado mecánico', async () => {
  const style: DemoNarrativeStyleId = 'first_person_literary';
  const fx = buildLifeStoryFixture('int_v51_repair', { extended: true });
  const base = baseManuscriptFor(fx, style);
  const targetChapter = base.manuscript.chapters.find((ch) => ch.paragraphs.some((p) => /canicas/.test(p)))!;
  assert.ok(targetChapter, 'El capítulo de infancia debe existir en la redacción base.');
  const dropMarblesMemory = (chapterId: string, paragraphs: string[]) =>
    chapterId === targetChapter.id
      ? paragraphs
          .map((p) =>
            p
              .split(/(?<=[.!?])\s+/)
              .filter((sentence) => !/canicas/.test(sentence))
              .join(' ')
          )
          .filter((p) => p.trim().length > 0)
      : paragraphs;

  // 1. The model's repair restores the memory inside the chapter.
  let repairCalls = 0;
  const repaired = await generateParticipantBookManuscriptWithAI({
    interview: fx.interview,
    participants: fx.participants,
    answers: fx.answers as any,
    questions: fx.questions as any,
    narrativeStyle: style,
    forceRefresh: true,
    pipelineOverrides: {
      skipDiskCache: true,
      draftBatch: makeFaithfulDrafter(base.manuscript, dropMarblesMemory).draftBatch,
      aiJudge: supportiveJudge,
      repairBatchCaller: async (_prompt, systemPrompt, chapterIds) => {
        repairCalls += 1;
        assert.match(systemPrompt, /REGLAS DE REPARACIÓN NARRATIVA/);
        assert.ok(
          systemPrompt.startsWith(DEFAULT_LITERARY_PROMPTS_TEXT[style]),
          'La reparación debe seguir usando intacto el prompt literario activo.'
        );
        return {
          chapters: chapterIds.map((id) => {
            const ch = base.manuscript.chapters.find((c) => c.id === id)!;
            return { id, partNumber: ch.partNumber, dimensionKey: ch.dimensionKey, title: ch.title, paragraphs: ch.paragraphs };
          }),
        } as any;
      },
    },
  });
  assert.equal(repairCalls >= 1, true);
  assert.equal(repaired.manuscript.generationStatus, 'approved', `${repaired.internalReasonCode}: ${repaired.diagnosticSummary}`);
  const repairedChapter = repaired.manuscript.chapters.find((c) => c.id === targetChapter.id)!;
  assert.equal(
    repairedChapter.paragraphs.join(' ').match(/canicas/g)?.length,
    1,
    'El recuerdo reparado debe aparecer una sola vez (sin repeticiones).'
  );

  // 2. The repair cannot fix it: the draft is rejected, nothing is pasted mechanically.
  const fx2 = buildLifeStoryFixture('int_v51_repair_fail', { extended: true });
  const unrepaired = await generateParticipantBookManuscriptWithAI({
    interview: fx2.interview,
    participants: fx2.participants,
    answers: fx2.answers as any,
    questions: fx2.questions as any,
    narrativeStyle: style,
    forceRefresh: true,
    pipelineOverrides: {
      skipDiskCache: true,
      draftBatch: makeFaithfulDrafter(base.manuscript, dropMarblesMemory).draftBatch,
      aiJudge: supportiveJudge,
      repairBatchCaller: async () => null,
    },
  });
  // V5.3: the strict audit keeps reporting the omission (honest), but the book is well above the
  // 60 % minimum, so it is delivered WITH OBSERVATIONS and every valid batch is kept.
  assert.equal(unrepaired.manuscript.documentaryAudit?.passed, false);
  assert.ok(
    (unrepaired.manuscript.documentaryAudit?.coverageAudit?.missingUnitIds || []).length >= 1,
    'La omisión sigue registrada en la auditoría.'
  );
  assert.equal(unrepaired.manuscript.generationStatus, 'approved');
  assert.equal((unrepaired.manuscript.approvalEvidence as any)?.verificationLevel, 'delivered_with_observations');
  assert.equal((unrepaired as any).deliveryDecision.eligible, true);
  assert.equal(
    unrepaired.manuscript.chapters.some((ch) => ch.paragraphs.some((p) => /canicas/.test(p))),
    false,
    'El testimonio omitido no debe pegarse mecánicamente en la prosa.'
  );
  assert.deepEqual(unrepaired.invalidatedBatchIndexes || [], [], 'Un libro entregable conserva todos sus lotes.');
  assert.ok(((unrepaired as any).repairSummary?.roundsExecuted ?? 0) <= 1, 'A lo sumo una ronda al ser ya entregable.');
});

test('V5.1-E2: una reparación que arregla un capítulo y estropea otro conserva solo el capítulo que mejoró', async () => {
  const style: DemoNarrativeStyleId = 'first_person_simple';
  const fx = buildLifeStoryFixture('int_v51_selective');
  const base = baseManuscriptFor(fx, style);
  const chapters = base.manuscript.chapters;
  assert.equal(chapters.length >= 2, true);
  const [chA, chB] = [chapters[0], chapters[chapters.length - 1]];
  const dropFirstSentence = (paragraphs: string[]) => {
    const sentences = paragraphs.join(' ').split(/(?<=[.!?])\s+/);
    return [sentences.slice(1).join(' ')];
  };

  const defective: DemoManuscript = {
    ...base.manuscript,
    aiGenerated: true,
    chapters: chapters.map((ch) =>
      ch.id === chA.id || ch.id === chB.id ? { ...ch, paragraphs: dropFirstSentence(ch.paragraphs) } : ch
    ),
  };
  const before = await auditWithHybridSemantics({
    manuscript: defective,
    answers: fx.answers,
    questions: fx.questions,
    ...PROVIDER_ARGS,
    aiJudgeOverride: supportiveJudge,
  });
  assert.equal(before.report.passed, false);
  const missingBefore = before.report.coverageAudit?.missingUnitIds.length || 0;
  assert.equal(missingBefore >= 2, true);

  const tasks = buildContextualRepairTasks({
    manuscript: before.manuscript,
    report: before.report,
    editorialAudit: before.editorialAudit,
    inventory: before.inventory,
    editorialPlan: buildEditorialChapterPlan({
      interviewTitle: fx.interview.title,
      storyMode: 'individual',
      participantNames: ['Carlos Mendoza'],
      answers: fx.answers,
      questions: fx.questions,
      bookStructureMode: 'prompt_autonomous',
    }),
  });

  const outcome = await repairChaptersContextuallyWithAI({
    manuscript: before.manuscript,
    tasks,
    activeLiteraryPrompt: DEFAULT_LITERARY_PROMPTS_TEXT[style],
    narrativeStyle: style,
    authors: 'Carlos Mendoza',
    isCouple: false,
    answers: fx.answers as any,
    questions: fx.questions as any,
    ...PROVIDER_ARGS,
    aiJudgeOverride: supportiveJudge,
    precomputedBeforeAudit: before,
    batchCallerOverride: async (_p, _s, chapterIds) =>
      ({
        chapters: chapterIds.map((id) => {
          const original = chapters.find((c) => c.id === id)!;
          return {
            id,
            partNumber: original.partNumber,
            dimensionKey: original.dimensionKey,
            title: original.title,
            // Chapter A is restored in full; chapter B is "repaired" into a single vague line.
            paragraphs: id === chA.id ? original.paragraphs : ['Fueron años que quedaron atrás.'],
          };
        }),
      } as any),
  });

  assert.ok(outcome);
  assert.equal(outcome!.improved, true, 'El capítulo que sí mejoró no debe descartarse por culpa del otro.');
  const finalA = outcome!.audited.manuscript.chapters.find((c) => c.id === chA.id)!;
  const finalB = outcome!.audited.manuscript.chapters.find((c) => c.id === chB.id)!;
  assert.deepEqual(finalA.paragraphs, chA.paragraphs);
  assert.notDeepEqual(finalB.paragraphs, ['Fueron años que quedaron atrás.'], 'La reparación regresiva debe rechazarse.');
  assert.equal(
    (outcome!.audited.report.coverageAudit?.missingUnitIds.length || 0) < missingBefore,
    true
  );
});

test('V5.1-E3: la higiene determinista en modo editorial no inserta testimonios en la prosa', () => {
  const fx = buildLifeStoryFixture('int_v51_hygiene');
  const style: DemoNarrativeStyleId = 'first_person_literary';
  const base = baseManuscriptFor(fx, style);
  const withoutLastChapterText: DemoManuscript = {
    ...base.manuscript,
    aiGenerated: true,
    chapters: base.manuscript.chapters.map((ch, idx) =>
      idx === 0 ? { ...ch, paragraphs: [ch.paragraphs.join(' ').split(/(?<=[.!?])\s+/).slice(1).join(' ')] } : ch
    ),
  };
  const wordCount = (m: DemoManuscript) => m.chapters.flatMap((c) => c.paragraphs).join(' ').split(/\s+/).length;

  const hygieneOnly = repairManuscriptOmissions({
    manuscript: withoutLastChapterText,
    answers: fx.answers,
    questions: fx.questions,
    integrateMissingUnits: false,
  });
  assert.deepEqual(hygieneOnly.repairedUnitIds, []);
  assert.equal(wordCount(hygieneOnly.manuscript) <= wordCount(withoutLastChapterText), true);
  assert.equal(hygieneOnly.report.passed, false, 'La omisión real debe seguir reportándose.');

  // The legacy (rule-based fallback / demo) behaviour is unchanged when the option is not set.
  const legacy = repairManuscriptOmissions({
    manuscript: withoutLastChapterText,
    answers: fx.answers,
    questions: fx.questions,
  });
  assert.equal(legacy.repairedUnitIds.length >= 1, true);
});

// ---------------------------------------------------------------------------------------------
// F. Diagnósticos
// ---------------------------------------------------------------------------------------------

test('V5.1-F1: cada causa de borrador incompleto tiene su categoría y su mensaje; los códigos internos no llegan al participante', () => {
  const expected: Array<[BookGenerationReasonCode, BookFailureCategory]> = [
    ['PROVIDER_ERROR', 'technical'],
    ['MODEL_TIMEOUT', 'technical'],
    ['INVALID_MODEL_RESPONSE', 'technical'],
    ['PARTIAL_BATCH_GENERATION', 'technical'],
    ['SEMANTIC_JUDGE_UNAVAILABLE', 'technical'],
    ['DOCUMENTARY_COVERAGE_FAILURE', 'documentary'],
    ['SEMANTIC_CONTRADICTION', 'documentary'],
    ['AUDIT_INCONCLUSIVE', 'documentary'],
    ['PHOTO_PLACEMENT_FAILURE', 'documentary'],
    ['EDITORIAL_QUALITY_FAILURE', 'editorial'],
    ['PRIVACY_VALIDATION_FAILURE', 'privacy'],
    ['REPAIR_EXHAUSTED', 'repair_pending'],
    ['SOURCE_CHANGED_SINCE_APPROVAL', 'source_changed'],
  ];
  for (const [code, category] of expected) {
    assert.equal(resolveBookFailureCategory(code), category, code);
  }

  const categories: BookFailureCategory[] = [
    'technical',
    'documentary',
    'editorial',
    'privacy',
    'repair_pending',
    'source_changed',
  ];
  const notices = categories.map((c) => buildIncompleteDraftUserNotice(c));
  assert.equal(new Set(notices).size, categories.length, 'Cada categoría debe tener un mensaje distinto.');
  for (const notice of notices) {
    assert.doesNotMatch(notice, /[A-Z]{4,}_[A-Z_]+/, 'Los mensajes al participante no exponen códigos internos.');
    assert.equal(notice.length > 40, true);
  }

  assert.equal(classifyBookFailureReasonCode({ error: new Error('Tiempo de espera agotado (45s)') }).category, 'technical');
  assert.equal(
    classifyBookFailureReasonCode({ error: new Error('Unexpected token in JSON response') }).category,
    'technical'
  );
  assert.equal(
    classifyBookFailureReasonCode({
      report: {
        veracityAudit: { leakedExcludedContentFlags: ['Fuga'], semanticContradictionFlags: [], inventedDataFlags: [], coupleAttributionViolations: [] },
      } as any,
    }).category,
    'privacy'
  );
  assert.equal(
    classifyBookFailureReasonCode({
      report: { coveragePercentage: 100, coverageAudit: { missingUnitIds: [] }, veracityAudit: {} } as any,
      editorialAudit: { passed: false, blockingDefects: ['Título duplicado'] } as any,
    }).category,
    'editorial'
  );
});
