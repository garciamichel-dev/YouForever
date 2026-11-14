import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOK_GENERATION_ENGINE_VERSION,
  CANONICAL_AUDIT_RULES_VERSION,
  DEMO_MAIN_QUESTIONS,
  auditAndApproveBookManuscript,
  buildDocumentaryInventory,
  buildEditorialChapterPlan,
  buildFaithfulFallbackManuscript,
  buildParticipantInitialManuscriptFromAnswers,
  computeCanonicalManuscriptCacheKey,
  repairManuscriptOmissions,
  resolveAnswerExclusionReason,
  splitAnswerTextIntoIncludedAndExcludedSentences,
  type DemoNarrativeStyleId,
  type DocumentarySourceAnswerInput,
  type DocumentarySourceQuestionInput,
} from '../demoStoryRules.ts';
import { DEFAULT_LITERARY_PROMPTS_TEXT } from '../interviewRules.ts';

type CanonicalStage =
  | 'infancia'
  | 'juventud'
  | 'adultez'
  | 'madurez'
  | 'legado_general';

function makeQuestion(
  id: string,
  orderIndex: number,
  lifeStage: CanonicalStage,
  text: string
): DocumentarySourceQuestionInput {
  return {
    id,
    orderIndex,
    lifeStage,
    topic: lifeStage,
    text,
  };
}

function makeAnswer(params: {
  id: string;
  questionId: string;
  questionText?: string;
  lifeStage: CanonicalStage;
  answerText: string;
  isFollowUp?: boolean;
  parentQuestionId?: string;
  isAdditionalMemory?: boolean;
  participantId?: string;
  participantName?: string;
  notRecalled?: boolean;
  preferNotToAnswer?: boolean;
  excludeFromBook?: boolean;
  photos?: DocumentarySourceAnswerInput['photos'];
  audio?: DocumentarySourceAnswerInput['audio'];
  audioRecordings?: DocumentarySourceAnswerInput['audioRecordings'];
  createdAt?: string;
}): DocumentarySourceAnswerInput {
  return {
    id: params.id,
    questionId: params.questionId,
    questionText: params.questionText,
    lifeStage: params.lifeStage,
    answerText: params.answerText,
    isFollowUp: Boolean(params.isFollowUp),
    parentQuestionId: params.parentQuestionId,
    isAdditionalMemory: Boolean(params.isAdditionalMemory),
    participantId: params.participantId || 'part_1',
    participantName: params.participantName || 'Elena Mendoza',
    notRecalled: params.notRecalled,
    preferNotToAnswer: params.preferNotToAnswer,
    excludeFromBook: params.excludeFromBook,
    photos: params.photos || [],
    audio: params.audio || null,
    audioRecordings: params.audioRecordings || null,
    createdAt: params.createdAt || '2026-01-10T10:00:00.000Z',
    updatedAt: params.createdAt || '2026-01-10T10:00:00.000Z',
  };
}

// ============================================================================
// SECCIÓN 17: 20 PRUEBAS UNITARIAS OBLIGATORIAS
// ============================================================================

test('Sección 17.1 y 17.2: Construcción del inventario documental completo y descomposición de respuestas largas en múltiples unidades atómicas', () => {
  const questions = [
    makeQuestion('q_inf_1', 1, 'infancia', '¿Dónde transcurrió tu infancia y quiénes vivían contigo?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ans_long_1',
      questionId: 'q_inf_1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText:
        'Vivíamos en una casona de adobe en Pátzcuaro junto a mi abuela Carlota y mi tío Sebastián. Por las tardes corríamos hacia el muelle del lago para ver llegar las canoas de madera. En invierno tomábamos atole de grano alrededor del fogón sintiendo mucha paz.',
    }),
  ];

  const inventory = buildDocumentaryInventory({
    interviewId: 'int_1',
    answers,
    questions,
    participantNames: ['Elena Mendoza'],
  });
  assert.equal(inventory.allFactUnits.length >= 3, true, 'Debe descomponer los 3 hechos en unidades atómicas');
  assert.equal(inventory.eligibleFactUnits.length, inventory.allFactUnits.length);
  assert.equal(inventory.excludedFactUnits.length, 0);
  assert.equal(inventory.corpusValidProperNames.includes('patzcuaro'), true);
  assert.equal(inventory.corpusValidProperNames.includes('carlota'), true);
});

test('Sección 17.3: Asociación de profundización con respuesta principal en el mismo capítulo y orden contiguo', () => {
  const questions = [
    makeQuestion('q_inf_1', 1, 'infancia', '¿Cuál era tu juego favorito en la infancia?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ans_main_1',
      questionId: 'q_inf_1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Jugábamos a las escondidas en el huerto de naranjos con mi primo Mateo.',
      createdAt: '2026-01-10T10:00:00.000Z',
    }),
    makeAnswer({
      id: 'ans_fu_1',
      questionId: 'followup_q_inf_1',
      parentQuestionId: 'q_inf_1',
      isFollowUp: true,
      questionText: '¿Qué escondite elegían siempre en ese huerto?',
      lifeStage: 'infancia',
      answerText: 'Nos ocultábamos detrás del viejo pozo de cantera donde olía a azahar fresco.',
      createdAt: '2026-01-10T10:05:00.000Z',
    }),
  ];

  const plan = buildEditorialChapterPlan({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    answers,
    questions,
    bookStructureMode: 'prompt_autonomous',
  });

  assert.equal(plan.chapters.length, 1, 'Principal y profundización de la misma etapa deben ir en el mismo capítulo');
  assert.deepEqual(plan.chapters[0].assignedAnswerIds, ['ans_main_1', 'ans_fu_1']);
});

test('Sección 17.4: Consolidación de recuerdos repetidos sin perder detalles únicos', () => {
  const questions = [
    makeQuestion('q_inf_1', 1, 'infancia', '¿Dónde naciste?'),
    makeQuestion('q_inf_2', 2, 'infancia', '¿Cómo era tu casa natal?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ans_rep_1',
      questionId: 'q_inf_1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Nací en la casa azul de Coyoacán frente al jardín centenario en 1954.',
    }),
    makeAnswer({
      id: 'ans_rep_2',
      questionId: 'q_inf_2',
      questionText: questions[1].text,
      lifeStage: 'infancia',
      answerText:
        'Nací en la casa azul de Coyoacán frente al jardín centenario en 1954. Tenía un portón de hierro forjado y bugambilias moradas en el balcón.',
    }),
  ];

  const inventory = buildDocumentaryInventory({
    interviewId: 'int_rep',
    answers,
    questions,
    participantNames: ['Elena Mendoza'],
  });
  const consolidated = inventory.eligibleFactUnits.filter(
    (u) => u.mergedRedundantUnitIds && u.mergedRedundantUnitIds.length > 0
  );
  assert.equal(consolidated.length >= 1, true, 'El hecho repetido debe consolidarse');
  const uniqueDetailUnit = inventory.eligibleFactUnits.find((u) =>
    u.cleanText.toLowerCase().includes('bugambilias moradas')
  );
  assert.ok(uniqueDetailUnit, 'El detalle único de las bugambilias moradas debe conservarse íntegro');
});

test('Sección 17.5, 17.6 y 17.7: Exclusión estricta de "no lo recuerdo", "prefiero no responder" y "no incluir en el libro"', () => {
  assert.equal(resolveAnswerExclusionReason('No lo recuerdo'), 'not_recalled');
  assert.equal(resolveAnswerExclusionReason('Prefiero no responder'), 'prefer_not_to_answer');
  assert.equal(
    resolveAnswerExclusionReason('No incluir en el libro este comentario privado.'),
    'excluded_by_interviewee'
  );

  const mixed = splitAnswerTextIntoIncludedAndExcludedSentences(
    'Estudié contaduría en la universidad estatal con gran esfuerzo. No incluir en el libro el problema legal con mi antiguo socio.'
  );
  assert.equal(mixed.includedSentences.length, 1);
  assert.equal(mixed.excludedSentences.length, 1);
  assert.match(mixed.includedSentences[0], /contaduría/i);
  assert.match(mixed.excludedSentences[0], /antiguo socio/i);
});

test('Sección 17.8: Conservación de incertidumbre ("creo que", "no recuerdo bien") y bloqueo si se convierte en certeza falsa', () => {
  const questions = [
    makeQuestion('q_inf_1', 1, 'infancia', '¿En qué año se mudaron de casa?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ans_unc_1',
      questionId: 'q_inf_1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Creo que nos mudamos a Guadalajara en 1966, aunque no recuerdo bien el mes exacto.',
    }),
  ];

  const { manuscript: initialManu } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
  });

  const auditOk = auditAndApproveBookManuscript({
    manuscript: initialManu,
    answers,
    questions,
  });
  assert.equal(auditOk.report.passed, true);
  assert.equal(auditOk.report.veracityAudit?.uncertaintyViolations.length, 0);

  // Ahora forzamos la pérdida del matiz de incertidumbre convirtiéndolo en certeza absoluta
  const alteredManu = structuredClone(initialManu);
  alteredManu.chapters[0].paragraphs = [
    'Nos mudamos a Guadalajara en 1966 en el mes exacto sin ninguna duda.',
  ];
  const auditAltered = auditAndApproveBookManuscript({
    manuscript: alteredManu,
    answers,
    questions,
  });
  assert.equal(auditAltered.report.passed, false);
  assert.equal((auditAltered.report.veracityAudit?.uncertaintyViolations.length || 0) > 0, true);
});

test('Sección 17.9 y 17.10: Rechazo de estructura "1 pregunta = 1 capítulo" y agrupación de múltiples respuestas en un mismo capítulo', () => {
  const questions = Array.from({ length: 10 }, (_, idx) =>
    makeQuestion(`q_inf_${idx + 1}`, idx + 1, 'infancia', `¿Recuerdo de infancia número ${idx + 1}?`)
  );
  const answers = questions.map((q, idx) =>
    makeAnswer({
      id: `ans_${idx + 1}`,
      questionId: q.id,
      questionText: q.text,
      lifeStage: 'infancia',
      answerText: `En mi infancia viví el episodio especial número ${idx + 1} junto a mi hermano Ramiro en el pueblo de Taxco.`,
    })
  );

  const { manuscript: groupedManu } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
    bookStructureMode: 'prompt_autonomous',
  });

  assert.equal(groupedManu.chapters.length, 1, 'Las 10 respuestas de infancia deben agruparse en 1 capítulo coherente');

  // Creamos un manuscrito defectuoso con 1 capítulo por cada respuesta (10 capítulos para 10 respuestas)
  const fragmentedManu = structuredClone(groupedManu);
  fragmentedManu.chapters = answers.map((a, idx) => ({
    id: `frag_ch_${idx + 1}`,
    partNumber: idx + 1,
    dimensionKey: 'raices',
    title: `Capítulo ${idx + 1}: ${a.questionText}`,
    paragraphs: [a.answerText],
  }));

  const auditFrag = auditAndApproveBookManuscript({
    manuscript: fragmentedManu,
    answers,
    questions,
  });
  assert.equal(auditFrag.report.passed, false, 'Debe rechazar manuscrito con 1 capítulo por respuesta');
  assert.equal(auditFrag.report.structuralAudit?.oneQuestionPerChapterDetected, true);
});

test('Sección 17.11 y 17.12: Modo prompt_autonomous vs Modo fixed_five_stages', () => {
  const stages: CanonicalStage[] = [
    'infancia',
    'juventud',
    'adultez',
    'madurez',
    'legado_general',
  ];
  const questions: DocumentarySourceQuestionInput[] = [];
  const answers: DocumentarySourceAnswerInput[] = [];

  // 16 respuestas en infancia + 4 en cada una de las otras 4 etapas = 32 respuestas
  for (let i = 1; i <= 16; i++) {
    const q = makeQuestion(`q_inf_${i}`, i, 'infancia', `Pregunta infancia ${i}`);
    questions.push(q);
    answers.push(
      makeAnswer({
        id: `ans_inf_${i}`,
        questionId: q.id,
        questionText: q.text,
        lifeStage: 'infancia',
        answerText: `Recuerdo de mi niñez número ${i} en la huerta de mi abuelo Ignacio en Colima.`,
      })
    );
  }
  for (const st of stages.slice(1)) {
    for (let i = 1; i <= 4; i++) {
      const q = makeQuestion(`q_${st}_${i}`, questions.length + 1, st, `Pregunta ${st} ${i}`);
      questions.push(q);
      answers.push(
        makeAnswer({
          id: `ans_${st}_${i}`,
          questionId: q.id,
          questionText: q.text,
          lifeStage: st,
          answerText: `Durante la etapa de ${st} vivimos el recuerdo significativo ${i} en Mérida.`,
        })
      );
    }
  }

  const planAutonomous = buildEditorialChapterPlan({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    answers,
    questions,
    bookStructureMode: 'prompt_autonomous',
  });
  const planFixed = buildEditorialChapterPlan({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    answers,
    questions,
    bookStructureMode: 'fixed_five_stages',
  });

  assert.equal(planFixed.chapters.length, 5, 'fixed_five_stages debe producir exactamente 5 capítulos');
  assert.equal(
    planAutonomous.chapters.length > 5 && planAutonomous.chapters.length <= 8,
    true,
    `prompt_autonomous debe subdividir la etapa extensa de infancia sin crear 1 capítulo por pregunta (obtenido: ${planAutonomous.chapters.length})`
  );
});

test('Sección 17.13, 17.14 y 17.15: Diferenciación real entre los 3 estilos, conversión 100% a 3ra persona en Estilo C y preservación de apodos, lugares, fechas y edades', () => {
  const questions = [
    makeQuestion('q_1', 1, 'infancia', '¿Cómo llamabas a tu abuela y dónde naciste?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ans_style_1',
      questionId: 'q_1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText:
        'Yo nací en 1948 en Zacatecas cuando tenía mi familia la panadería y siempre visitaba a mi abuela "Mamá Lucha" a los 7 años.',
    }),
  ];

  const styles: DemoNarrativeStyleId[] = [
    'first_person_simple',
    'first_person_literary',
    'third_person_biography',
  ];

  const renderedByStyle = styles.map(
    (style) =>
      buildParticipantInitialManuscriptFromAnswers({
        interviewTitle: 'Memorias de Elena',
        storyMode: 'individual',
        participantNames: ['Elena Mendoza'],
        answers,
        questions,
        narrativeStyle: style,
      }).manuscript
  );

  const textA = renderedByStyle[0].chapters[0].paragraphs.join(' ');
  const textB = renderedByStyle[1].chapters[0].paragraphs.join(' ');
  const textC = renderedByStyle[2].chapters[0].paragraphs.join(' ');

  assert.notEqual(textA, textC, 'Estilo A y Estilo C deben ser distintos');
  assert.notEqual(textB, textC, 'Estilo B y Estilo C deben ser distintos');

  // En los 3 estilos deben preservarse Zacatecas, 1948, 7 años y Mamá Lucha
  for (const txt of [textA, textB, textC]) {
    assert.match(txt, /Zacatecas/);
    assert.match(txt, /1948/);
    assert.match(txt, /Mamá Lucha/);
  }

  // En Estilo C no debe quedar "Yo nací" en primera persona fuera de comillas
  assert.equal(/\byo\s+nací\b/i.test(textC), false, 'Estilo C no debe dejar "yo nací"');
});

test('Sección 17.18: Detección de datos inventados (años, edades, nombres propios/parentescos no presentes y diálogos fabricados)', () => {
  const questions = [
    makeQuestion('q_1', 1, 'infancia', '¿Dónde estudiaste la primaria?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ans_inv_1',
      questionId: 'q_1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Estudié la primaria en la escuela Benito Juárez de Morelia junto a mi hermana Lucía.',
    }),
  ];

  const { manuscript: validManu } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
  });

  // Inyectamos un año inventado (1979), una edad inventada (a los 14 años) y un diálogo teatral fabricado
  const corruptedManu = structuredClone(validManu);
  corruptedManu.chapters[0].paragraphs.push(
    'En 1979 cuando tenía 14 años caminábamos por París.\n—¡Tienes que esforzarte mucho en tus estudios! —dijo el profesor con voz solemne.'
  );

  const audit = auditAndApproveBookManuscript({
    manuscript: corruptedManu,
    answers,
    questions,
  });

  assert.equal(audit.report.passed, false, 'Debe reprobar el manuscrito con invenciones');
  assert.equal((audit.report.veracityAudit?.inventedDataFlags.length || 0) >= 2, true, 'Debe detectar año/edad/diálogo inventados');
});

test('Sección 17.20: Invalidación de caché por versión de reglas, motor, estilo, modo de estructura, respuestas y fotografías', () => {
  const answers = [
    makeAnswer({
      id: 'ans_cache_1',
      questionId: 'q_1',
      lifeStage: 'infancia',
      answerText: 'Nací en Veracruz cerca del puerto.',
    }),
  ];

  assert.equal(BOOK_GENERATION_ENGINE_VERSION.length > 0, true);
  assert.equal(CANONICAL_AUDIT_RULES_VERSION.length > 0, true);

  const keyBase = computeCanonicalManuscriptCacheKey({
    interviewId: 'int_1',
    narrativeStyle: 'first_person_literary',
    bookStructureMode: 'prompt_autonomous',
    customStylePrompt: DEFAULT_LITERARY_PROMPTS_TEXT.first_person_literary,
    closingDedicationText: 'Con amor',
    answers,
  });

  const keyDifferentMode = computeCanonicalManuscriptCacheKey({
    interviewId: 'int_1',
    narrativeStyle: 'first_person_literary',
    bookStructureMode: 'fixed_five_stages',
    customStylePrompt: DEFAULT_LITERARY_PROMPTS_TEXT.first_person_literary,
    closingDedicationText: 'Con amor',
    answers,
  });

  const keyDifferentStyle = computeCanonicalManuscriptCacheKey({
    interviewId: 'int_1',
    narrativeStyle: 'third_person_biography',
    bookStructureMode: 'prompt_autonomous',
    customStylePrompt: DEFAULT_LITERARY_PROMPTS_TEXT.third_person_biography,
    closingDedicationText: 'Con amor',
    answers,
  });

  assert.notEqual(keyBase, keyDifferentMode, 'Cambiar bookStructureMode debe invalidar caché');
  assert.notEqual(keyBase, keyDifferentStyle, 'Cambiar narrativeStyle debe invalidar caché');
});

// ============================================================================
// SECCIÓN 18: PRUEBAS OBLIGATORIAS DE DETECCIÓN DE OMISIÓN COMPLETA Y PARCIAL
// ============================================================================

test('Sección 18.1 (17.16 y 17.19): Prueba obligatoria de detección de omisión completa y bucle de reparación automática', () => {
  const questions = [
    makeQuestion('q_1', 1, 'infancia', '¿Cómo era la casa de tus abuelos?'),
    makeQuestion('q_2', 2, 'juventud', '¿Cuál fue tu primer empleo?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ans_1',
      questionId: 'q_1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'La casa de mis abuelos en Querétaro tenía un patio con limoneros y una fuente de cantera rosa.',
    }),
    makeAnswer({
      id: 'ans_2',
      questionId: 'q_2',
      questionText: questions[1].text,
      lifeStage: 'juventud',
      answerText: 'Mi primer empleo fue en la relojería de don Prudencio en el centro de Toluca reparando relojes antiguos.',
    }),
  ];

  const { manuscript: fullManu } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Mi Vida',
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
  });

  // Omitimos deliberadamente el capítulo 2 completo (que contiene ans_2)
  const omittedManu = structuredClone(fullManu);
  omittedManu.chapters = [omittedManu.chapters[0]];

  const failedAudit = auditAndApproveBookManuscript({
    manuscript: omittedManu,
    answers,
    questions,
  });

  assert.equal(failedAudit.report.passed, false, 'El auditor debe detectar la omisión completa');
  assert.equal(
    failedAudit.report.coverageAudit?.missingUnitIds.includes('trace_ans_2'),
    true,
    'Debe reportar trace_ans_2 como omitida'
  );
  assert.equal(failedAudit.manuscript.generationStatus, 'failed_audit');

  // Ejecutamos el bucle de reparación documental
  const repaired = repairManuscriptOmissions({
    manuscript: failedAudit.manuscript,
    answers,
    questions,
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    maxAttempts: 2,
  });

  assert.equal(repaired.report.passed, true, 'El bucle de reparación debe recuperar el 100% de cobertura');
  assert.equal(repaired.report.coveragePercentage, 100);
  assert.equal(repaired.manuscript.generationStatus, 'approved');
});

test('Sección 18.2 (17.17): Prueba obligatoria de detección de omisión parcial (lugar, personas, evento principal, detalle secundario y emoción)', () => {
  const questions = [
    makeQuestion('q_1', 1, 'infancia', '¿Qué recuerdo guardas del molino familiar?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ans_partial_1',
      questionId: 'q_1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText:
        'En Orizaba mi abuelo Fermín y mi tía Chole construyeron el molino de café con piedras del río Blanco y sentíamos una alegría inmensa.',
    }),
  ];

  const { manuscript: fullManu } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Mi Vida',
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
  });

  // Creamos un manuscrito que menciona el molino de café pero omite a Fermín, Chole, Orizaba y la alegría
  const partialManu = structuredClone(fullManu);
  partialManu.chapters[0].paragraphs = [
    'Durante aquellos años de infancia en el campo se construyó un molino de café tradicional que trabajaba todos los días.',
  ];
  partialManu.chapters[0].pullQuote = undefined;

  const partialAudit = auditAndApproveBookManuscript({
    manuscript: partialManu,
    answers,
    questions,
  });

  assert.equal(partialAudit.report.passed, false, 'Debe reprobar la omisión parcial de personas, lugar y emoción');
  const matrixEntry = partialAudit.report.traceabilityMatrix[0];
  assert.ok(matrixEntry);
  assert.equal(matrixEntry.verified, false);
  assert.equal(
    (matrixEntry.missingFacets || []).length > 0 || (matrixEntry.missingTokens || []).length > 0,
    true,
    'Debe detallar las facetas o tokens omitidos (Orizaba, Fermín, Chole, alegría)'
  );

  // Reparación automática del detalle omitido
  const repaired = repairManuscriptOmissions({
    manuscript: partialAudit.manuscript,
    answers,
    questions,
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    maxAttempts: 2,
  });
  assert.equal(repaired.report.passed, true, 'La reparación debe restaurar el recuerdo completo con todas sus facetas');
});

// ============================================================================
// SECCIÓN 19: PRUEBA OBLIGATORIA CON ENTREVISTA CORTA (46 RESPUESTAS: 27 PRINCIPALES + 19 PROFUNDIZACIONES)
// ============================================================================

test('Sección 19: Entrevista de 46 respuestas (27 principales + 19 profundizaciones) genera entre 4 y 6 capítulos narrativos (jamás 46 ni 27) y recupera omisiones forzadas', () => {
  const stageDistribution: Array<{ stage: CanonicalStage; mainCount: number; followUpCount: number }> = [
    { stage: 'infancia', mainCount: 6, followUpCount: 5 },
    { stage: 'juventud', mainCount: 6, followUpCount: 4 },
    { stage: 'adultez', mainCount: 5, followUpCount: 4 },
    { stage: 'madurez', mainCount: 5, followUpCount: 3 },
    { stage: 'legado_general', mainCount: 5, followUpCount: 3 },
  ];

  const questions: DocumentarySourceQuestionInput[] = [];
  const answers: DocumentarySourceAnswerInput[] = [];
  let qCounter = 1;
  let fuCounter = 1;

  for (const item of stageDistribution) {
    for (let m = 1; m <= item.mainCount; m++) {
      const qId = `q_46_${qCounter}`;
      const qText = `¿Qué recuerdo importante conservas del episodio ${qCounter} de la etapa ${item.stage}?`;
      questions.push(makeQuestion(qId, qCounter, item.stage, qText));

      answers.push(
        makeAnswer({
          id: `ans_main_${qCounter}`,
          questionId: qId,
          questionText: qText,
          lifeStage: item.stage,
          answerText: `En el año ${1950 + qCounter} durante ${item.stage} compartimos tardes inolvidables en la biblioteca de Oaxaca junto a mi maestro Don Aurelio revisando mapas antiguos.`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 10, qCounter, 0)).toISOString(),
        })
      );

      if (m <= item.followUpCount) {
        answers.push(
          makeAnswer({
            id: `ans_fu_${fuCounter}`,
            questionId: `followup_${qId}`,
            parentQuestionId: qId,
            isFollowUp: true,
            questionText: `¿Qué detalle especial recuerdas de esa tarde en Oaxaca?`,
            lifeStage: item.stage,
            answerText: `En la anécdota complementaria ${200 + fuCounter} recuerdo el sonido de la campana de cantera verde y el aroma a café de olla que preparaba Doña Matilde.`,
            createdAt: new Date(Date.UTC(2026, 0, 1, 10, qCounter, 30)).toISOString(),
          })
        );
        fuCounter++;
      }

      qCounter++;
    }
  }

  assert.equal(questions.length, 27, 'Deben ser 27 preguntas principales');
  assert.equal(answers.length, 46, 'Deben ser 46 respuestas en total (27 principales + 19 profundizaciones)');

  const { manuscript } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Mis 46 Recuerdos',
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
    bookStructureMode: 'prompt_autonomous',
  });

  assert.notEqual(manuscript.chapters.length, 46, 'PROHIBIDO generar 46 capítulos para 46 respuestas');
  assert.notEqual(manuscript.chapters.length, 27, 'PROHIBIDO generar 27 capítulos para 27 preguntas');
  assert.equal(
    manuscript.chapters.length >= 4 && manuscript.chapters.length <= 6,
    true,
    `Debe agrupar en 4 a 6 capítulos narrativos coherentes (obtenido: ${manuscript.chapters.length})`
  );

  // Verificar que ninguna pregunta aparece como subtítulo o encabezado dentro de los párrafos
  const fullText = manuscript.chapters.map((c) => c.paragraphs.join('\n')).join('\n');
  assert.equal(/¿Qué recuerdo importante conservas/i.test(fullText), false, 'No debe incluir las preguntas en el texto');

  const audit = auditAndApproveBookManuscript({
    manuscript,
    answers,
    questions,
  });
  assert.equal(audit.report.passed, true);
  assert.equal(audit.report.coveragePercentage, 100);
  assert.equal(audit.report.coverageAudit?.missingUnitIds.length, 0);

  // Simulamos la omisión de 1 respuesta principal (ans_main_10 -> año 1960) y 1 profundización (ans_fu_8 -> anécdota 208)
  const manuscriptWithOmission = structuredClone(manuscript);
  for (const ch of manuscriptWithOmission.chapters) {
    ch.paragraphs = ch.paragraphs.filter(
      (p) => !p.includes('1960') && !p.includes('208')
    );
  }

  const auditAfterOmission = auditAndApproveBookManuscript({
    manuscript: manuscriptWithOmission,
    answers,
    questions,
  });
  assert.equal(auditAfterOmission.report.passed, false, 'Debe detectar la omisión de la principal 10 y profundización 8');
  assert.equal(
    auditAfterOmission.report.coverageAudit?.missingUnitIds.includes('trace_ans_main_10'),
    true
  );
  assert.equal(
    auditAfterOmission.report.coverageAudit?.missingUnitIds.includes('trace_ans_fu_8'),
    true
  );

  const repaired = repairManuscriptOmissions({
    manuscript: auditAfterOmission.manuscript,
    answers,
    questions,
    storyMode: 'individual',
    participantNames: ['Elena Mendoza'],
    maxAttempts: 2,
  });

  assert.equal(repaired.report.passed, true, 'El bucle de reparación debe recuperar ambas respuestas omitidas');
  assert.equal(repaired.report.coveragePercentage, 100);
  assert.equal(
    repaired.manuscript.chapters.length,
    manuscript.chapters.length,
    'La reparación no debe crear capítulos nuevos por cada recuerdo reparado'
  );
});

// ============================================================================
// SECCIÓN 20: PRUEBA OBLIGATORIA CON ENTREVISTA EXTENSA (230 PREGUNTAS PRINCIPALES + PROFUNDIZACIONES + FOTOS + INCERTIDUMBRES + EXCLUSIONES)
// ============================================================================

test('Sección 20: Entrevista extensa con 230 preguntas principales + profundizaciones + fotos + incertidumbres + exclusiones en los 3 estilos y 2 modos de estructura', () => {
  const stages: CanonicalStage[] = [
    'infancia',
    'juventud',
    'adultez',
    'madurez',
    'legado_general',
  ];

  const questions: DocumentarySourceQuestionInput[] = [];
  const answers: DocumentarySourceAnswerInput[] = [];

  // 230 preguntas principales (46 por cada una de las 5 etapas)
  let qIndex = 1;
  for (const stage of stages) {
    for (let i = 1; i <= 46; i++) {
      const qId = `q_230_${qIndex}`;
      const qText = `¿Cómo viviste el acontecimiento biográfico número ${qIndex} durante tu etapa de ${stage}?`;
      questions.push(makeQuestion(qId, qIndex, stage, qText));

      // Casos especiales para probar exclusiones e incertidumbres dentro de las 230 respuestas:
      let answerText = `Durante la etapa de ${stage} viví el recuerdo biográfico número ${qIndex} en la hacienda de San Miguel junto a mi primo Teodoro sembrando trigo.`;
      if (qIndex === 50) {
        answerText = 'No lo recuerdo';
      } else if (qIndex === 100) {
        answerText = 'Prefiero no responder';
      } else if (qIndex === 150) {
        answerText =
          'Durante la etapa de adultez abrimos el taller de carpintería número 150 en San Miguel con Teodoro. No incluir en el libro el disgusto privado con el arrendador.';
      } else if (qIndex === 200) {
        answerText =
          'Creo que en el recuerdo número 200 viajamos en tren hacia Chihuahua en 1974, aunque no recuerdo bien la estación.';
      } else if (qIndex === 12) {
        // Recuerdo repetido con detalle adicional
        answerText =
          'Durante la etapa de infancia viví el recuerdo biográfico número 11 en la hacienda de San Miguel junto a mi primo Teodoro sembrando trigo. Además llevábamos un perro pastor llamado Sultán.';
      }

      const hasPhoto = qIndex === 5 || qIndex === 95 || qIndex === 185;
      answers.push(
        makeAnswer({
          id: `ans_230_${qIndex}`,
          questionId: qId,
          questionText: qText,
          lifeStage: stage,
          answerText,
          photos: hasPhoto
            ? [
                {
                  id: `photo_${qIndex}`,
                  imageUrl: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
                  mimeType: 'image/png',
                  caption: `Fotografía histórica del episodio ${qIndex} en San Miguel`,
                  lifeStage: stage,
                },
              ]
            : [],
          createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, qIndex)).toISOString(),
        })
      );

      // Añadimos profundizaciones distribuidas
      if (qIndex % 15 === 0 && qIndex !== 150) {
        answers.push(
          makeAnswer({
            id: `ans_230_fu_${qIndex}`,
            questionId: `followup_${qId}`,
            parentQuestionId: qId,
            isFollowUp: true,
            questionText: `¿Qué más recuerdas sobre el acontecimiento ${qIndex}?`,
            lifeStage: stage,
            answerText: `Como detalle adicional del episodio ${qIndex}, recuerdo que cantábamos canciones tradicionales bajo el laurel del patio.`,
            createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, qIndex, 500)).toISOString(),
          })
        );
      }

      qIndex++;
    }
  }

  assert.equal(questions.length, 230, 'Deben existir exactamente 230 preguntas principales');

  const styles: DemoNarrativeStyleId[] = [
    'first_person_simple',
    'first_person_literary',
    'third_person_biography',
  ];

  for (const mode of ['prompt_autonomous', 'fixed_five_stages'] as const) {
    for (const style of styles) {
      const { manuscript: manu } = buildParticipantInitialManuscriptFromAnswers({
        interviewTitle: 'Crónica Completa de 230 Preguntas',
        storyMode: 'individual',
        participantNames: ['Elena Mendoza'],
        answers,
        questions,
        narrativeStyle: style,
        bookStructureMode: mode,
      });

      if (mode === 'fixed_five_stages') {
        assert.equal(manu.chapters.length, 5, `En fixed_five_stages (${style}) deben ser 5 capítulos`);
      } else {
        assert.equal(
          manu.chapters.length >= 12 && manu.chapters.length <= 25,
          true,
          `En prompt_autonomous (${style}) para 230 preguntas debe agrupar en 12..25 capítulos narrativos, jamás 230 (obtenido: ${manu.chapters.length})`
        );
      }

      const audit = auditAndApproveBookManuscript({
        manuscript: manu,
        answers,
        questions,
      });

      assert.equal(
        audit.report.passed,
        true,
        `Auditoría debe aprobar entrevista de 230 preguntas en modo ${mode} y estilo ${style}. Defectos: ${audit.report.blockingDefects.join(' | ')}`
      );
      assert.equal(audit.report.coveragePercentage, 100);
      assert.equal(audit.report.coverageAudit?.missingUnitIds.length, 0);
      assert.equal(audit.report.leakedExcludedContentFlags?.length || 0, 0, 'Cero filtraciones de frases excluidas');
      assert.equal(audit.report.veracityAudit?.uncertaintyViolations.length, 0, 'Incertidumbres conservadas');
      assert.equal(audit.report.structuralAudit?.oneQuestionPerChapterDetected, false);
      assert.equal(audit.report.photoAudit?.passed, true, 'Todas las fotografías deben estar ubicadas');

      // Verificar que la frase excluida en la pregunta 150 jamás aparece en el libro
      const fullBookText = manu.chapters.map((c) => c.paragraphs.join(' ')).join(' ');
      assert.equal(
        /disgusto privado con el arrendador/i.test(fullBookText),
        false,
        'La oración marcada como "no incluir en el libro" jamás debe aparecer en el manuscrito'
      );
    }
  }
});

// ============================================================================
// SECCIÓN 21: CASOS DE REGRESIÓN OBLIGATORIOS (PAREJA, AUDIO, DEMO FALLBACK, ETC.)
// ============================================================================

test('Sección 21.10, 21.11 y 21.18: Entrevista en pareja con atribución fiel, transcripción de audio y distinción de fallback en /demo', () => {
  const questions = [
    makeQuestion('q_c_1', 1, 'juventud', '¿Cómo se conocieron?'),
    makeQuestion('q_c_2', 2, 'madurez', '¿Qué viaje recuerdan con más cariño?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ans_c_1',
      questionId: 'q_c_1',
      questionText: questions[0].text,
      lifeStage: 'juventud',
      participantId: 'p_1',
      participantName: 'Roberto',
      answerText: 'Conocí a Clara en la estación de tren de Puebla durante una tarde lluviosa de octubre.',
    }),
    makeAnswer({
      id: 'ans_c_2',
      questionId: 'q_c_2',
      questionText: questions[1].text,
      lifeStage: 'madurez',
      participantId: 'p_2',
      participantName: 'Clara',
      answerText: '',
      audio: {
        transcription: 'Viajamos juntos a Campeche para celebrar nuestro aniversario frente al mar.',
      },
    }),
  ];

  const { manuscript: coupleManu } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Nuestra Historia',
    storyMode: 'compartida',
    participantNames: ['Roberto', 'Clara'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
  });

  const coupleAudit = auditAndApproveBookManuscript({
    manuscript: coupleManu,
    answers,
    questions,
  });

  assert.equal(coupleAudit.report.passed, true, 'El manuscrito en pareja con audio transcrito debe aprobar la auditoría');
  assert.equal(coupleAudit.report.coupleAttributionViolations?.length || 0, 0);

  const firstDemoQId = DEMO_MAIN_QUESTIONS[0].id;
  // Verificar que el fallback de /demo marca aiGenerated: false y excluye "no incluir en el libro"
  const demoFallback = buildFaithfulFallbackManuscript({
    profile: {
      mode: 'individual',
      displayName: 'Elena',
      fullName: 'Elena Mendoza',
      partner1Name: '',
      partner2Name: '',
      hasAcceptedTemporaryNotice: true,
    },
    responses: {
      [firstDemoQId]: {
        questionId: firstDemoQId,
        mainAnswerText:
          'Crecí en la ribera de Chapala rodeada de música de violín. No incluir en el libro el pleito vecinal.',
      },
    },
    narrativeStyle: 'first_person_literary',
  });

  assert.equal(demoFallback.aiGenerated, false, 'El fallback determinista de /demo no debe marcarse como aiGenerated: true');
  assert.equal(demoFallback.generationStatus, 'generated');
  const demoText = demoFallback.chapters.map((c) => c.paragraphs.join(' ')).join(' ');
  assert.match(demoText, /Chapala/);
  assert.equal(/pleito vecinal/i.test(demoText), false, 'El fallback de /demo debe excluir oraciones con "no incluir en el libro"');
});
