import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEMO_BOOK_FORMATS,
  DemoEditorialConfig,
  DemoInMemoryPhoto,
  DemoManuscript,
  DemoNarrativeStyleId,
  DocumentarySourceAnswerInput,
  DocumentarySourceQuestionInput,
  auditAndApproveBookManuscript,
  auditBookEditorialQuality,
  balanceInlineMarkdownMarkersAcrossLines,
  buildEditorialChapterPlan,
  buildParticipantInitialManuscriptFromAnswers,
  composeBookPages,
  computeAdaptivePhotoDimensions,
  repairManuscriptOmissions,
  resolveCanonicalAnswerSource,
  verifyDocumentaryUnitInManuscript,
} from '../demoStoryRules.ts';
import {
  DEFAULT_LITERARY_PROMPTS_CONFIG,
  DEFAULT_LITERARY_PROMPTS_TEXT,
  DEFAULT_LITERARY_PROMPT_VERSIONS,
} from '../interviewRules.ts';
import { generateRealDemoBookPdf } from '../../utils/demoPdfGenerator.ts';

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function sha256Of(input: unknown): string {
  const payload = typeof input === 'string' ? input : JSON.stringify(input);
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function makeQuestion(
  id: string,
  orderIndex: number,
  lifeStage: string,
  questionText: string
): DocumentarySourceQuestionInput {
  return {
    id,
    text: questionText,
    lifeStage,
    topic: `Memorias de ${lifeStage}`,
    orderIndex,
  };
}

function makeAnswer(params: {
  id: string;
  questionId: string;
  questionText: string;
  lifeStage: string;
  answerText: string;
  audioTranscription?: string;
  participantName?: string;
  isFollowUp?: boolean;
  parentQuestionId?: string;
  excludeFromBook?: boolean;
  photos?: DocumentarySourceAnswerInput['photos'];
  createdAt?: string;
}): DocumentarySourceAnswerInput {
  return {
    id: params.id,
    questionId: params.questionId,
    questionText: params.questionText,
    participantId: 'part_v4_1',
    participantName: params.participantName || 'Lucía Herrera',
    lifeStage: params.lifeStage,
    answerText: params.answerText,
    audioRecordings: params.audioTranscription
      ? [{ transcription: params.audioTranscription }]
      : [],
    isFollowUp: params.isFollowUp,
    parentQuestionId: params.parentQuestionId,
    excludeFromBook: params.excludeFromBook,
    photos: params.photos || [],
    createdAt: params.createdAt || '2026-02-10T10:00:00.000Z',
  };
}

function createEditorialConfig(
  style: DemoNarrativeStyleId,
  formatId: '6x9' | 'carta' | 'a5' = '6x9',
  options?: { includeTableOfContents?: boolean; includeEditorialCredits?: boolean }
): DemoEditorialConfig {
  return {
    narrativeStyle: style,
    coverDesignId: 'clasica_eterna',
    coverColorVariantIdx: 0,
    coverVisualType: 'illustration',
    coverIllustrationId: 'arbol_raices',
    interiorStyleId: 'clasico_editorial',
    bookFormatId: formatId,
    customTitle: 'Crónica Sintética de Vida',
    customSubtitle: 'Memorias y recuerdos familiares',
    customAuthors: 'Lucía Herrera',
    dedication: 'Para las generaciones venideras.',
    includeTableOfContents: options?.includeTableOfContents ?? true,
    includeEditorialCredits: options?.includeEditorialCredits ?? false,
  };
}

test('V4 Test 1: Auditoría semántica adversarial detecta negación, inversión de agencia, modalidad, antónimos e invenciones, pero acepta paráfrasis literaria fiel', () => {
  const questions = [
    makeQuestion('q_nat', 1, 'infancia', '¿Qué te enseñó tu padre en la infancia?'),
    makeQuestion('q_hosp', 2, 'juventud', '¿Quién te acompañó en un momento difícil?'),
    makeQuestion('q_rio', 3, 'juventud', '¿Recuerdas algún incidente en el río?'),
  ];
  const answers = [
    makeAnswer({
      id: 'a_nat',
      questionId: 'q_nat',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Mi padre me enseñó a nadar en el río Bravo durante el verano.',
      createdAt: '2026-01-01T10:00:00Z',
    }),
    makeAnswer({
      id: 'a_hosp',
      questionId: 'q_hosp',
      questionText: questions[1].text,
      lifeStage: 'juventud',
      answerText: 'Mi hermana me acompañó al hospital en Guadalajara cuando tuve fiebre.',
      createdAt: '2026-01-01T10:05:00Z',
    }),
    makeAnswer({
      id: 'a_rio',
      questionId: 'q_rio',
      questionText: questions[2].text,
      lifeStage: 'juventud',
      answerText: 'Mi padre me salvó de caer al río en aquella tormenta.',
      createdAt: '2026-01-01T10:10:00Z',
    }),
  ];

  const base = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Lucía',
    storyMode: 'individual',
    participantNames: ['Lucía Herrera'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
  });

  // Case A: Negation flip ("Mi padre no me enseñó a nadar")
  const negManu: DemoManuscript = structuredClone(base.manuscript);
  negManu.chapters[0].paragraphs = [
    'Mi padre no me enseñó a nadar en el río Bravo durante el verano.',
  ];
  const negAudit = auditAndApproveBookManuscript({ manuscript: negManu, answers, questions });
  assert.equal(negAudit.report.passed, false, 'Debe rechazar inversión de negación');
  assert.ok(
    (negAudit.report.veracityAudit?.semanticContradictionFlags || []).length > 0 ||
      (negAudit.report.semanticAudit?.contradictionsDetected || []).length > 0,
    'Debe registrar contradicción semántica ante negación'
  );

  // Case B: Agency flip ("Yo acompañé a mi hermana al hospital")
  const agencyManu: DemoManuscript = structuredClone(base.manuscript);
  const hospIdx = agencyManu.chapters.findIndex((c) =>
    c.paragraphs.some((p) => /hospital|guadalajara/i.test(p))
  );
  assert.ok(hospIdx >= 0);
  agencyManu.chapters[hospIdx].paragraphs = agencyManu.chapters[hospIdx].paragraphs.map((p) =>
    /hospital|guadalajara/i.test(p)
      ? 'Yo acompañé a mi hermana al hospital en Guadalajara cuando tuvo fiebre.'
      : p
  );
  const agencyAudit = auditAndApproveBookManuscript({
    manuscript: agencyManu,
    answers,
    questions,
  });
  assert.equal(agencyAudit.report.passed, false, 'Debe rechazar inversión de sujeto/objeto');

  // Case C: Modality/attempt flip ("intentó enseñarme a nadar") and coercion ("me obligó a nadar")
  for (const alteredText of [
    'Mi padre intentó enseñarme a nadar en el río Bravo durante el verano.',
    'Mi padre me obligó a nadar en el río Bravo durante el verano.',
  ]) {
    const modManu: DemoManuscript = structuredClone(base.manuscript);
    modManu.chapters[0].paragraphs = [alteredText];
    const modAudit = auditAndApproveBookManuscript({ manuscript: modManu, answers, questions });
    assert.equal(modAudit.report.passed, false, `Debe rechazar cambio modal: ${alteredText}`);
  }

  // Case D: Antonym action flip ("me salvó" -> "me empujó")
  const antManu: DemoManuscript = structuredClone(base.manuscript);
  const rioIdx = antManu.chapters.findIndex((c) =>
    c.paragraphs.some((p) => /tormenta/i.test(p))
  );
  assert.ok(rioIdx >= 0);
  antManu.chapters[rioIdx].paragraphs = antManu.chapters[rioIdx].paragraphs.map((p) =>
    /tormenta/i.test(p) ? 'Mi padre me empujó para caer al río en aquella tormenta.' : p
  );
  const antAudit = auditAndApproveBookManuscript({ manuscript: antManu, answers, questions });
  assert.equal(antAudit.report.passed, false, 'Debe rechazar antónimo de acción (salvó vs empujó)');

  // Case E: Valid literary paraphrase using richer vocabulary without contradicting original meaning
  const paraCheck = verifyDocumentaryUnitInManuscript({
    unit: base.documentaryInventory.eligibleFactUnits[0],
    chapters: [
      {
        id: 'ch_paraphrase',
        partNumber: 1,
        dimensionKey: 'infancia',
        title: 'Días junto al río',
        paragraphs: [
          'En los meses estivales, mi padre me enseñó pacientemente a nadar entre las corrientes del río Bravo.',
        ],
        sourceAnswerIds: ['a_nat'],
      },
    ],
  });
  assert.equal(paraCheck.semanticIssues.length, 0, 'No debe falsamente marcar contradicción en paráfrasis válida');
  assert.equal(paraCheck.verified, true, 'Paráfrasis fiel debe verificarse como válida');

  // Case F: Direction B reverse check (invented year, age and proper name)
  const inventedManu: DemoManuscript = structuredClone(base.manuscript);
  inventedManu.chapters[0].paragraphs.push(
    'Además, en 1999 a los 42 años viajamos con mi tío Rigoberto hacia Monterrey.'
  );
  const invAudit = auditAndApproveBookManuscript({
    manuscript: inventedManu,
    answers,
    questions,
  });
  assert.equal(invAudit.report.passed, false, 'Dirección B debe rechazar invenciones no sustentadas');
  assert.equal(invAudit.report.veracityAudit?.passed, false);
});

test('V4 Test 2: Exclusiones selectivas por cláusula y prioridad estricta de respuesta escrita sobre transcripción de audio', () => {
  const canonical = resolveCanonicalAnswerSource({
    answerText: 'Vivíamos frente a la plaza principal de Puebla y jugábamos ajedrez.',
    audioRecordings: [
      {
        transcription:
          '[Nota de voz]: Vivíamos en Monterrey, texto antiguo erróneo de voz.',
      },
    ],
  });
  assert.equal(canonical.source, 'written');
  assert.equal(
    canonical.text,
    'Vivíamos frente a la plaza principal de Puebla y jugábamos ajedrez.'
  );
  assert.ok(!/Monterrey/i.test(canonical.text), 'No debe concatenar audio redundante sobre texto escrito');

  const questions = [
    makeQuestion('q_ex1', 1, 'adultez', 'Cuéntame sobre tu trabajo y tu vida familiar.'),
    makeQuestion('q_ex2', 2, 'adultez', '¿Hubo algún tema delicado en esa etapa?'),
  ];
  const answers = [
    makeAnswer({
      id: 'a_ex1',
      questionId: 'q_ex1',
      questionText: questions[0].text,
      lifeStage: 'adultez',
      answerText:
        'Trabajé veinte años como maestra rural en Oaxaca con mucho orgullo. Esto te lo cuento, pero no quiero publicarlo: tuve un pleito legal con mi exsocio Mateo.',
      createdAt: '2026-01-02T10:00:00Z',
    }),
    makeAnswer({
      id: 'a_ex2',
      questionId: 'q_ex2',
      questionText: questions[1].text,
      lifeStage: 'adultez',
      answerText: 'No menciones mi divorcio de 1998. En cambio sí conserva que adoptamos al perro Lucas en Oaxaca.',
      createdAt: '2026-01-02T10:05:00Z',
    }),
  ];

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Oaxaca',
    storyMode: 'individual',
    participantNames: ['Lucía Herrera'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
  });
  const fullText = built.manuscript.chapters.map((c) => c.paragraphs.join(' ')).join(' ');
  assert.ok(/maestra rural en Oaxaca/i.test(fullText), 'Debe conservar la cláusula autorizada');
  assert.ok(/perro Lucas/i.test(fullText), 'Debe conservar el recuerdo autorizado en la misma respuesta');
  assert.equal(/pleito legal|exsocio Mateo/i.test(fullText), false, 'Debe excluir la cláusula privada');
  assert.equal(/divorcio|1998/i.test(fullText), false, 'Debe excluir el divorcio solicitado');

  const audit = auditAndApproveBookManuscript({
    manuscript: built.manuscript,
    answers,
    questions,
  });
  assert.equal(audit.report.leakedExcludedContentFlags?.length || 0, 0);
});

test('V4 Test 3: Entrevista parcial de una sola etapa se identifica como "Un libro parcial de memorias" sin inventar etapas ni sufijos numéricos', () => {
  const questions = [
    makeQuestion('qp_1', 1, 'infancia', '¿Dónde naciste?'),
    makeQuestion('qp_2', 2, 'infancia', '¿Cómo era tu escuela primaria?'),
    makeQuestion('qp_3', 3, 'infancia', '¿A qué jugabas con tus amigos?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ap_1',
      questionId: 'qp_1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Nací en Toluca en una casa con patio de naranjos.',
      createdAt: '2026-01-03T10:00:00Z',
    }),
    makeAnswer({
      id: 'ap_2',
      questionId: 'qp_2',
      questionText: questions[1].text,
      lifeStage: 'infancia',
      answerText: 'Mi escuela primaria tenía salones altos de madera y un pizarrón verde.',
      createdAt: '2026-01-03T10:05:00Z',
    }),
    makeAnswer({
      id: 'ap_3',
      questionId: 'qp_3',
      questionText: questions[2].text,
      lifeStage: 'infancia',
      answerText: 'Jugábamos canicas en el callejón con mi amigo Samuel después de clases.',
      createdAt: '2026-01-03T10:10:00Z',
    }),
  ];

  const plan = buildEditorialChapterPlan({
    interviewTitle: 'Recuerdos de niñez',
    storyMode: 'individual',
    participantNames: ['Lucía Herrera'],
    answers,
    questions,
    bookStructureMode: 'prompt_autonomous',
  });
  assert.equal(plan.isPartialMemoir, true, 'Debe marcar entrevista de 1 etapa como parcial');
  assert.ok(
    /un libro parcial de memorias/i.test(plan.partialMemoirSubtitle || ''),
    'El subtítulo planificado debe indicar explícitamente libro parcial de memorias'
  );
  assert.ok(plan.chapters.every((c) => !/\(\d+\)\s*$/.test(c.suggestedTitleIndividual)));

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Recuerdos de niñez',
    storyMode: 'individual',
    participantNames: ['Lucía Herrera'],
    answers,
    questions,
    narrativeStyle: 'first_person_simple',
    bookStructureMode: 'prompt_autonomous',
  });
  assert.equal(built.manuscript.isPartialMemoir, true);
  assert.ok(/libro parcial de memorias/i.test(built.manuscript.subtitle));
  assert.ok(built.manuscript.chapters.every((c) => !/\(\d+\)\s*$/.test(c.title)));
  assert.ok(
    built.manuscript.chapters.every((c) => !/adolescencia|adultez|madurez|vejez/i.test(c.title)),
    'No debe fabricar capítulos de etapas no documentadas'
  );
});

test('V4 Test 4: Auditoría editorial dual y generación válida e independiente en los estilos A, B y C', () => {
  // Verify editorial audit catches perspective leaks (except inside direct quotes), fillers, duplicates, and broken titles
  const badStyleCManu: DemoManuscript = {
    title: 'Biografía defectuosa',
    subtitle: 'Prueba',
    authors: 'Lucía Herrera',
    mode: 'individual',
    narrativeStyle: 'third_person_biography',
    introduction: 'Lucía nació en Toluca.',
    dedication: '',
    closingMessage: 'Su historia sigue.',
    insufficientInfoNotices: [],
    generatedAt: '2026-02-01T00:00:00Z',
    chapters: [
      {
        id: 'c_bad_1',
        partNumber: 1,
        dimensionKey: 'infancia',
        title: '¿Dónde creciste?',
        paragraphs: [
          'Ehh yo nací en Toluca junto a mi abuela, aunque decía «Yo siempre estaré contigo».',
          'Fragmento roto con **negrita abierta.',
        ],
      },
      {
        id: 'c_bad_2',
        partNumber: 2,
        dimensionKey: 'adultez',
        title: 'Etapa (2)',
        paragraphs: ['Lucía trabajó en el taller municipal desde 1985 con dedicación.'],
      },
    ],
  };

  const edReport = auditBookEditorialQuality({ manuscript: badStyleCManu });
  assert.equal(edReport.passed, false);
  assert.ok(edReport.firstPersonLeakFlags.length > 0, 'Debe detectar 1ra persona fuera de comillas en Estilo C');
  assert.ok(edReport.oralFillerOrArtifactFlags.length > 0, 'Debe detectar muletilla oral "ehh"');
  assert.ok(edReport.titleQualityFlags.length >= 2, 'Debe detectar título en pregunta y sufijo numérico (2)');
  assert.ok(edReport.unbalancedMarkdownFlags.length > 0, 'Debe detectar marcador ** sin cerrar');

  // Direct quotes in Style C must be allowed cleanly
  const quoteOkStyleC: DemoManuscript = {
    ...badStyleCManu,
    chapters: [
      {
        id: 'c_ok',
        partNumber: 1,
        dimensionKey: 'infancia',
        title: 'Las enseñanzas de su abuela',
        paragraphs: [
          'Lucía creció en Toluca rodeada del cariño de su abuela, quien repetía con dulzura: «Yo siempre estaré contigo en cada paso».',
        ],
      },
    ],
  };
  const edOk = auditBookEditorialQuality({ manuscript: quoteOkStyleC });
  assert.equal(edOk.firstPersonLeakFlags.length, 0, 'Citas textuales entre comillas latinas en Estilo C no deben marcar fuga');
  assert.equal(edOk.passed, true);

  // Run same 20-answer synthetic interview across A, B, C and verify both Documentary & Editorial audits pass
  const stages = ['infancia', 'juventud', 'adultez', 'madurez', 'legado'];
  const q20: DocumentarySourceQuestionInput[] = [];
  const a20: DocumentarySourceAnswerInput[] = [];
  for (let i = 1; i <= 20; i++) {
    const st = stages[(i - 1) % stages.length];
    const q = makeQuestion(`q20_${i}`, i, st, `¿Qué recuerdo importante conservas de la etapa ${st} (${i})?`);
    q20.push(q);
    a20.push(
      makeAnswer({
        id: `a20_${i}`,
        questionId: q.id,
        questionText: q.text,
        lifeStage: st,
        answerText: `En mi etapa de ${st} viví el episodio ${i} en Veracruz junto a mi hermano Gabriel reparando barcos pesqueros en el muelle.`,
        createdAt: new Date(Date.UTC(2026, 0, 5, 10, i)).toISOString(),
      })
    );
  }

  const styles: DemoNarrativeStyleId[] = [
    'first_person_simple',
    'first_person_literary',
    'third_person_biography',
  ];
  const textsByStyle: Record<string, string> = {};
  for (const st of styles) {
    const res = buildParticipantInitialManuscriptFromAnswers({
      interviewTitle: 'Memorias del Puerto',
      storyMode: 'individual',
      participantNames: ['Lucía Herrera'],
      answers: a20,
      questions: q20,
      narrativeStyle: st,
      bookStructureMode: 'prompt_autonomous',
    });
    const fullAudit = auditAndApproveBookManuscript({
      manuscript: res.manuscript,
      answers: a20,
      questions: q20,
    });
    assert.equal(fullAudit.report.passed, true, `Auditoría documental debe aprobar estilo ${st}`);
    assert.equal(fullAudit.editorialAudit.passed, true, `Auditoría editorial debe aprobar estilo ${st}`);
    textsByStyle[st] = res.manuscript.chapters.map((c) => c.paragraphs.join(' ')).join(' ');
  }

  assert.notEqual(
    textsByStyle.first_person_simple,
    textsByStyle.third_person_biography,
    'Estilo A y Estilo C deben diferenciarse claramente'
  );
  assert.notEqual(
    textsByStyle.first_person_literary,
    textsByStyle.third_person_biography,
    'Estilo B y Estilo C deben diferenciarse claramente'
  );
});

test('V4 Test 5: Reparación narrativa recupera omisiones sin duplicar episodios ni degradar calidad editorial y marca estado incompleto si falla', () => {
  const questions = [
    makeQuestion('qr_1', 1, 'infancia', '¿Qué recuerdas de la casa familiar?'),
    makeQuestion('qr_2', 2, 'juventud', '¿Cuál fue tu primer oficio?'),
    makeQuestion('qr_3', 3, 'adultez', '¿Cómo celebraron su aniversario?'),
  ];
  const answers = [
    makeAnswer({
      id: 'ar_1',
      questionId: 'qr_1',
      questionText: questions[0].text,
      lifeStage: 'infancia',
      answerText: 'Mi madre cultivaba bugambilias rojas en el corredor de la casa de Mérida.',
      createdAt: '2026-01-04T10:00:00Z',
    }),
    makeAnswer({
      id: 'ar_2',
      questionId: 'qr_2',
      questionText: questions[1].text,
      lifeStage: 'juventud',
      answerText: 'Aprendí relojería en el taller del maestro Octavio a los dieciocho años.',
      createdAt: '2026-01-04T10:05:00Z',
    }),
    makeAnswer({
      id: 'ar_3',
      questionId: 'qr_3',
      questionText: questions[2].text,
      lifeStage: 'adultez',
      answerText: 'Celebramos nuestras bodas de plata con música de marimba en el jardín familiar.',
      createdAt: '2026-01-04T10:10:00Z',
    }),
  ];

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Mérida',
    storyMode: 'individual',
    participantNames: ['Lucía Herrera'],
    answers,
    questions,
    narrativeStyle: 'third_person_biography',
  });

  // Deliberately remove the Octavio watchmaking paragraph from manuscript
  const mutilated: DemoManuscript = structuredClone(built.manuscript);
  mutilated.chapters = mutilated.chapters.map((ch) => ({
    ...ch,
    paragraphs: ch.paragraphs.filter((p) => !/octavio|relojer[ií]a/i.test(p)),
  }));

  const preAudit = auditAndApproveBookManuscript({
    manuscript: mutilated,
    answers,
    questions,
  });
  assert.equal(preAudit.report.passed, false, 'Debe detectar omisión deliberada de relojería');

  const repaired = repairManuscriptOmissions({
    manuscript: mutilated,
    answers,
    questions,
    storyMode: 'individual',
    participantNames: ['Lucía Herrera'],
  });
  assert.equal(repaired.report.passed, true, 'La reparación debe recuperar 100% de hechos');
  assert.equal(repaired.editorialAudit.passed, true, 'La reparación en Estilo C no debe filtrar 1ra persona ni degradar estilo');
  assert.equal(repaired.editorialAudit.duplicateEpisodeFlags.length, 0);

  // Incomplete / failed draft state stays clearly labeled and cannot pass empty/unapproved validation
  const incompleteDraft: DemoManuscript = {
    ...built.manuscript,
    aiGenerated: false,
    status: 'incomplete_draft',
    generationStatus: 'incomplete_draft',
    incompleteDraftNotice:
      'BORRADOR INCOMPLETO — PENDIENTE DE REVISIÓN: Todavía faltan partes por revisar antes de aprobar la edición definitiva.',
  };
  assert.equal(incompleteDraft.generationStatus, 'incomplete_draft');
  assert.ok(/BORRADOR INCOMPLETO — PENDIENTE DE REVISIÓN/.test(incompleteDraft.incompleteDraftNotice || ''));
});

test('V4 Test 6: Dimensionamiento adaptativo de fotografías y matriz de 0, 1, 5, 10 y 30 imágenes en distintas orientaciones y resoluciones', () => {
  const format6x9 = DEMO_BOOK_FORMATS.find((f) => f.id === '6x9')!;
  const formatA5 = DEMO_BOOK_FORMATS.find((f) => f.id === 'a5')!;

  const landscapeDim = computeAdaptivePhotoDimensions({
    format: format6x9,
    usableWidthMm: 118,
    availableHeightMm: 150,
    naturalWidth: 1600,
    naturalHeight: 900,
    photoCountInBook: 4,
    photoCountInChapter: 1,
    hasCaption: true,
  });
  assert.equal(landscapeDim.orientation, 'landscape');
  assert.ok(landscapeDim.widthMm > landscapeDim.heightMm);
  assert.ok(landscapeDim.widthMm <= 118);

  const portraitDim = computeAdaptivePhotoDimensions({
    format: format6x9,
    usableWidthMm: 118,
    availableHeightMm: 150,
    naturalWidth: 900,
    naturalHeight: 1600,
    photoCountInBook: 4,
    photoCountInChapter: 1,
    hasCaption: true,
  });
  assert.equal(portraitDim.orientation, 'portrait');
  assert.ok(portraitDim.heightMm > portraitDim.widthMm);

  const highResSameFormat = computeAdaptivePhotoDimensions({
    format: formatA5,
    usableWidthMm: 110,
    availableHeightMm: 140,
    naturalWidth: 1600,
    naturalHeight: 1200,
    photoCountInBook: 2,
    photoCountInChapter: 1,
    hasCaption: false,
  });

  const lowResDim = computeAdaptivePhotoDimensions({
    format: formatA5,
    usableWidthMm: 110,
    availableHeightMm: 140,
    naturalWidth: 240,
    naturalHeight: 180,
    photoCountInBook: 2,
    photoCountInChapter: 1,
    hasCaption: false,
  });
  assert.ok(
    lowResDim.widthMm < highResSameFormat.widthMm,
    'No debe ampliar agresivamente imágenes de muy baja resolución respecto a alta resolución'
  );

  // Matrix for 0, 1, 5, 10, 30 photos
  for (const photoCount of [0, 1, 5, 10, 30]) {
    const qs: DocumentarySourceQuestionInput[] = [];
    const ans: DocumentarySourceAnswerInput[] = [];
    const stages = ['infancia', 'juventud', 'adultez', 'madurez', 'legado'];
    const totalQs = Math.max(5, photoCount);

    for (let i = 1; i <= totalQs; i++) {
      const st = stages[(i - 1) % stages.length];
      const qText = `¿Qué historia corresponde a la escena número ${i}?`;
      qs.push(makeQuestion(`qm_${photoCount}_${i}`, i, st, qText));
      const dims =
        i % 3 === 0
          ? { w: 1000, h: 1000 }
          : i % 2 === 0
          ? { w: 900, h: 1600 }
          : { w: 1600, h: 900 };
      ans.push(
        makeAnswer({
          id: `am_${photoCount}_${i}`,
          questionId: `qm_${photoCount}_${i}`,
          questionText: qText,
          lifeStage: st,
          answerText: `Escena ${i} en la alameda central de Querétaro compartiendo pan de dulce con mi tía Beatriz.`,
          photos:
            i <= photoCount
              ? [
                  {
                    id: `ph_${photoCount}_${i}`,
                    imageUrl: TINY_PNG_DATA_URL,
                    mimeType: 'image/png',
                    caption: `Recuerdo visual ${i} en Querétaro`,
                    lifeStage: st,
                    naturalWidth: dims.w,
                    naturalHeight: dims.h,
                  } as any,
                ]
              : [],
          createdAt: new Date(Date.UTC(2026, 0, 10, 10, i)).toISOString(),
        })
      );
    }

    const built = buildParticipantInitialManuscriptFromAnswers({
      interviewTitle: `Álbum de ${photoCount} fotografías`,
      storyMode: 'individual',
      participantNames: ['Lucía Herrera'],
      answers: ans,
      questions: qs,
      narrativeStyle: 'first_person_literary',
    });

    assert.equal(
      Object.keys(built.allPhotosById).length,
      photoCount,
      `Deben conservarse exactamente ${photoCount} fotos elegibles`
    );

    const composed = composeBookPages({
      manuscript: built.manuscript,
      editorialConfig: createEditorialConfig('first_person_literary', '6x9'),
      chapterPhotos: built.chapterPhotos,
      allPhotosById: built.allPhotosById,
      previewSampleOnly: false,
    });

    const placedIds = new Set<string>();
    for (const pg of composed.pages) {
      for (const sec of pg.sections || []) {
        if (sec.photo && !sec.isContinuation && (!sec.paragraphPhotos || Object.keys(sec.paragraphPhotos).length === 0)) {
          placedIds.add(sec.photo.id);
        }
        for (const arr of Object.values(sec.paragraphPhotos || {})) {
          for (const ph of arr || []) {
            if (ph?.id) placedIds.add(ph.id);
          }
        }
      }
    }
    assert.equal(
      placedIds.size,
      photoCount,
      `El libro maquetado debe incluir exactamente las ${photoCount} fotos sin pérdidas ni duplicaciones`
    );
  }
});

test('V4 Test 7: Generación real de PDF en formatos 6x9, carta y a5 con desbordamiento, negritas/cursivas, índice multipágina e interruptores de índice y créditos', () => {
  // Balance inline markdown check across line splits
  const balanced = balanceInlineMarkdownMarkersAcrossLines([
    'Este fue el inicio de **una gran amistad que cruzó',
    'las montañas con *mucha alegría* durante años** sin descanso.',
  ]);
  assert.equal((balanced[0].match(/\*\*/g) || []).length % 2, 0);
  assert.equal((balanced[1].match(/\*\*/g) || []).length % 2, 0);

  // Build manuscript with 24 chapters (> 1 TOC page in A5/6x9) + overflow long chapter + embedded photo + bold/italic inline formatting
  const longParagraph = Array.from({ length: 14 }, (_, i) =>
    `Párrafo de memoria extendida #${i + 1}: **aquella mañana en Pátzcuaro** caminamos entre *los portales antiguos* mientras las campanas anunciaban la fiesta patronal del pueblo.`
  ).join(' ');

  const chapters = Array.from({ length: 24 }, (_, idx) => ({
    id: `v4_ch_${idx + 1}`,
    partNumber: idx + 1,
    dimensionKey: `dim_v4_${idx + 1}`,
    title: `Capítulo Temático ${idx + 1}: Caminos de la memoria`,
    paragraphs:
      idx === 0
        ? [longParagraph, longParagraph]
        : [
            `Durante **esta etapa ${idx + 1}** visitamos *la plaza de Morelia* con nuestros primos y abuelos para celebrar las cosechas de otoño.`,
          ],
    photoPlacements:
      idx === 1
        ? [
            {
              photoId: 'pdf_v4_photo_1',
              caption: 'Fotografía en la plaza de Morelia',
              shortCaption: 'Plaza de Morelia',
              paragraphIndex: 0,
            },
          ]
        : [],
  }));

  const photoObj: DemoInMemoryPhoto = {
    id: 'pdf_v4_photo_1',
    objectUrl: TINY_PNG_DATA_URL,
    dataUrl: TINY_PNG_DATA_URL,
    fileName: 'morelia.png',
    mimeType: 'image/png',
    width: 1200,
    height: 800,
    caption: 'Fotografía en la plaza de Morelia',
    focusY: 'center',
    zoom: 1,
  };

  const baseManu: DemoManuscript = {
    title: 'Memorias Completas de Prueba',
    subtitle: 'Edición verificada',
    authors: 'Lucía Herrera',
    mode: 'individual',
    narrativeStyle: 'first_person_literary',
    introduction: 'Bienvenidos a este libro de recuerdos compartidos.',
    dedication: 'Para toda mi familia.',
    chapters,
    closingMessage: 'Cada recuerdo permanece vivo.',
    insufficientInfoNotices: [],
    generatedAt: '2026-02-12T10:00:00Z',
    aiGenerated: true,
    generationStatus: 'approved',
    status: 'approved',
  };

  const profile = {
    mode: 'individual' as const,
    displayName: 'Lucía Herrera',
    fullName: 'Lucía Herrera',
    partner1Name: '',
    partner2Name: '',
    hasAcceptedTemporaryNotice: true,
  };

  for (const formatId of ['6x9', 'carta', 'a5'] as const) {
    const composedWithToc = composeBookPages({
      manuscript: baseManu,
      editorialConfig: createEditorialConfig('first_person_literary', formatId, {
        includeTableOfContents: true,
        includeEditorialCredits: true,
      }),
      chapterPhotos: {},
      allPhotosById: { pdf_v4_photo_1: photoObj },
      previewSampleOnly: false,
    });

    assert.ok(
      composedWithToc.pages.some((p) => p.kind === 'editorial_credits'),
      `Formato ${formatId} debe incluir créditos editoriales cuando están activados`
    );

    const pdfRes = generateRealDemoBookPdf({
      composed: composedWithToc,
      profile,
    });
    assert.equal(
      pdfRes.integrityReport.passed,
      true,
      `Integridad PDF falló en ${formatId}: ${pdfRes.integrityReport.errors.join(' | ')}`
    );
    assert.equal(pdfRes.integrityReport.duplicatePageNumbers.length, 0);
    assert.equal(pdfRes.integrityReport.brokenMarkersDetected, 0);
    assert.equal(pdfRes.integrityReport.tocPresent, true);
    assert.equal(pdfRes.integrityReport.tocPageNumbersValid, true);
    assert.equal(pdfRes.integrityReport.photosEmbedded, 1);
    assert.ok(pdfRes.pdfBytes.length > 2000);
  }

  // Verify disabling both toggles omits TOC and Credits cleanly
  const composedNoExtras = composeBookPages({
    manuscript: baseManu,
    editorialConfig: createEditorialConfig('first_person_literary', '6x9', {
      includeTableOfContents: false,
      includeEditorialCredits: false,
    }),
    chapterPhotos: {},
    allPhotosById: { pdf_v4_photo_1: photoObj },
    previewSampleOnly: false,
  });
  assert.equal(composedNoExtras.pages.some((p) => p.kind === 'table_of_contents'), false);
  assert.equal(composedNoExtras.pages.some((p) => p.kind === 'editorial_credits'), false);

  const pdfNoExtras = generateRealDemoBookPdf({
    composed: composedNoExtras,
    profile,
  });
  assert.equal(pdfNoExtras.integrityReport.passed, true);
  assert.equal(pdfNoExtras.integrityReport.tocPresent, false);
});

test('V4 Test 8: Integridad criptográfica SHA-256 de prompts literarios e historial de datos almacenados', () => {
  const EXPECTED_INTERVIEW_RULES_SHA256 =
    '833777408008934d110a4dfeef768e54001e9568d37fcb28901fbdcf8ea822e8';
  const EXPECTED_PROMPTS_TEXT_SHA256 =
    'cdd4e55cd422db30b9d958995bee3b83043ae257ad37028a0a90ec0463055c6f';
  const EXPECTED_PROMPT_VERSIONS_SHA256 =
    '3383101a620b5827550c449e13710e67e6394d25e4a12bdee81b5edcb6b3a54d';
  const EXPECTED_PROMPTS_CONFIG_SHA256 =
    'ed63d02dded70d132c4db8ac007cfbaeff4dbdccfcfe684422308f00b4c17510';
  const EXPECTED_STORAGE_STATE_SHA256 =
    '4563175c8e735cb9bcd09f631557c181a54b658fbf96d11253eb7e0a328ff652';

  const interviewRulesPath = path.resolve(process.cwd(), 'src', 'logic', 'interviewRules.ts');
  const rawInterviewRules = fs.readFileSync(interviewRulesPath);
  assert.equal(
    crypto.createHash('sha256').update(rawInterviewRules).digest('hex'),
    EXPECTED_INTERVIEW_RULES_SHA256,
    'src/logic/interviewRules.ts no debe modificarse'
  );
  assert.equal(
    sha256Of(DEFAULT_LITERARY_PROMPTS_TEXT),
    EXPECTED_PROMPTS_TEXT_SHA256,
    'DEFAULT_LITERARY_PROMPTS_TEXT no debe modificarse'
  );
  assert.equal(
    sha256Of(DEFAULT_LITERARY_PROMPT_VERSIONS),
    EXPECTED_PROMPT_VERSIONS_SHA256,
    'DEFAULT_LITERARY_PROMPT_VERSIONS no debe modificarse'
  );
  assert.equal(
    sha256Of(DEFAULT_LITERARY_PROMPTS_CONFIG),
    EXPECTED_PROMPTS_CONFIG_SHA256,
    'DEFAULT_LITERARY_PROMPTS_CONFIG no debe modificarse'
  );

  const storageStatePath = path.resolve(process.cwd(), 'data', 'storage_state.json');
  if (fs.existsSync(storageStatePath)) {
    const rawStorage = fs.readFileSync(storageStatePath);
    const actualStorageHash = crypto.createHash('sha256').update(rawStorage).digest('hex');
    assert.equal(
      actualStorageHash,
      EXPECTED_STORAGE_STATE_SHA256,
      'data/storage_state.json histórico debe permanecer intacto byte a byte'
    );
  }
});
