import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVoluntaryCompletion,
  applyAdminReopen,
  computeLayoutEditQuotaStatus,
  canSubmitAnswer,
  InterviewRecord,
  AnswerRecord,
  QuestionRecord,
} from './interviewRules.ts';
import {
  buildParticipantInitialManuscriptFromAnswers,
  composeBookPages,
  hasUpdatedAnswersSinceBookVersion,
  DEMO_NARRATIVE_STYLES,
  DEMO_COVER_DESIGNS,
  DEMO_INTERIOR_STYLES,
  DEMO_BOOK_FORMATS,
  DEMO_CLOSING_PAGE_BRAND_MARK,
  DemoEditorialConfig,
  DemoInMemoryPhoto,
  DemoManuscript,
} from './demoStoryRules.ts';
import { generateRealDemoBookPdf, preloadBookResourcesForPdf } from '../utils/demoPdfGenerator.ts';

const baseInterview: InterviewRecord = {
  id: 'int_book_1',
  title: 'Memorias de Elena Gómez',
  storyMode: 'individual',
  storyType: 'biografia_personal',
  status: 'open',
  openedAt: new Date(Date.now() - 86400000).toISOString(),
  expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
  openDaysAtCreation: 15,
  sufficiencyThreshold: 10,
  maxFollowUpsAtCreation: 2,
  completedQuestionCount: 5,
  sufficiencyStatus: 'sufficient',
  userDeclaredComplete: false,
  closedAt: null,
  closureReason: null,
  lastActivityAt: new Date().toISOString(),
  questionnaireVersionId: 'v1',
};

test('1. Cierre voluntario bloquea respuestas y recuerdos adicionales (modo solo lectura) e inicializa cuota de maquetación', () => {
  const closed = applyVoluntaryCompletion(
    baseInterview,
    'Para mis nietos Sofía y Mateo, con todo mi cariño.'
  );

  assert.equal(closed.userDeclaredComplete, true);
  assert.equal(closed.status, 'completed');
  assert.equal(
    closed.participantClosingText,
    'Para mis nietos Sofía y Mateo, con todo mi cariño.'
  );

  // Answers and additional memories must be strictly blocked
  assert.equal(canSubmitAnswer(closed, Date.now(), false).allowed, false);
  assert.equal(canSubmitAnswer(closed, Date.now(), true).allowed, false);

  // Quota before generating Version 1: canGenerateInitial is true, canModifyLayout becomes true after Version 1 is created
  const quotaInitial = computeLayoutEditQuotaStatus(closed);
  assert.equal(quotaInitial.hasInitialBook, false);
  assert.equal(quotaInitial.canGenerateInitial, true);
  assert.equal(quotaInitial.remainingEdits, 1);
  assert.equal(quotaInitial.canModifyLayout, false);
});

test('2. Control de cuota de modificación de maquetación (Versión 1 inicial + 1 modificación adicional)', () => {
  const closed = applyVoluntaryCompletion(baseInterview, 'Mi dedicatoria final');

  // Simulate Version 1 generated
  const afterV1: InterviewRecord = {
    ...closed,
    bookGeneratedCount: 1,
    layoutEditsAllowed: 1,
    layoutEditsUsed: 0,
  };
  const qAfterV1 = computeLayoutEditQuotaStatus(afterV1);
  assert.equal(qAfterV1.hasInitialBook, true);
  assert.equal(qAfterV1.canGenerateInitial, false);
  assert.equal(qAfterV1.remainingEdits, 1);
  assert.equal(qAfterV1.canModifyLayout, true);

  // Simulate Version 2 generated (1 modification used)
  const afterV2: InterviewRecord = {
    ...afterV1,
    bookGeneratedCount: 2,
    layoutEditsAllowed: 1,
    layoutEditsUsed: 1,
  };
  const qAfterV2 = computeLayoutEditQuotaStatus(afterV2);
  assert.equal(qAfterV2.hasInitialBook, true);
  assert.equal(qAfterV2.remainingEdits, 0);
  assert.equal(qAfterV2.canModifyLayout, false);

  // Admin reopens interview and grants 2 more layout modifications
  const reopened = applyAdminReopen(
    afterV2,
    10,
    'Solicitud de ajuste editorial',
    'admin@foreveryou.mx',
    2
  );
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.userDeclaredComplete, false);
  const qReopened = computeLayoutEditQuotaStatus(reopened);
  assert.equal(qReopened.remainingEdits, 2);
  assert.equal(qReopened.canModifyLayout, true);
});

test('3. Catálogos editoriales completos disponibles para el Portal del Participante', () => {
  assert.equal(DEMO_NARRATIVE_STYLES.length, 3);
  const defaultStyle = DEMO_NARRATIVE_STYLES.find((s) => s.recommended);
  assert.equal(defaultStyle?.id, 'first_person_literary');

  assert.equal(DEMO_COVER_DESIGNS.length, 5);
  assert.equal(DEMO_INTERIOR_STYLES.length, 5);
  assert.equal(DEMO_BOOK_FORMATS.length, 3);
});

test('4. Construcción del manuscrito del participante con integración de fotografías por etapa y preferencia de cierre en última página sin duplicación', () => {
  const questions: QuestionRecord[] = [
    {
      id: 'q_inf_1',
      text: '¿Cómo era la casa de tu infancia?',
      lifeStage: 'infancia',
      topic: 'hogar',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'q_adu_1',
      text: '¿Cuál fue tu mayor aprendizaje en la madurez?',
      lifeStage: 'madurez',
      topic: 'aprendizajes',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const answers: AnswerRecord[] = [
    {
      id: 'ans_1',
      interviewId: 'int_book_1',
      questionId: 'q_inf_1',
      questionText: '¿Cómo era la casa de tu infancia?',
      participantId: 'p_elena',
      participantName: 'Elena Gómez',
      answerText: 'Era una casa blanca con bugambilias y un patio lleno de pájaros.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      photos: [
        {
          id: 'photo_patio_1',
          interviewId: 'int_book_1',
          questionId: 'q_inf_1',
          lifeStage: 'infancia',
          participantId: 'p_elena',
          participantName: 'Elena Gómez',
          fileName: 'patio.jpg',
          mimeType: 'image/jpeg',
          caption: 'El jardín de bugambilias en 1962',
          imageUrl: '/api/photos/photo_patio_1',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      idempotencyKey: 'k_1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ans_2',
      interviewId: 'int_book_1',
      questionId: 'q_adu_1',
      questionText: '¿Cuál fue tu mayor aprendizaje en la madurez?',
      participantId: 'p_elena',
      participantName: 'Elena Gómez',
      answerText: 'Aprendí que la paciencia y el amor a la familia lo sostienen todo.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'k_2',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const closingDedication = 'Para mis nietos Sofía y Mateo, con todo mi amor eterno.';

  const { manuscript, chapterPhotos } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Elena Gómez',
    storyMode: 'individual',
    participantNames: ['Elena Gómez'],
    narrativeStyle: 'first_person_literary',
    answers,
    questions,
    closingDedicationText: closingDedication,
  });

  const firstChapterId = manuscript.chapters[0].id;
  assert.ok(chapterPhotos[firstChapterId]);
  assert.equal(chapterPhotos[firstChapterId]?.id, 'photo_patio_1');

  const editorialConfig: DemoEditorialConfig = {
    coverDesignId: 'clasica_eterna',
    coverColorVariantIdx: 0,
    coverVisualType: 'illustration',
    coverIllustrationId: 'arbol_raices',
    interiorStyleId: 'clasico_editorial',
    bookFormatId: DEMO_BOOK_FORMATS[1].id,
    customTitle: manuscript.title,
    customSubtitle: manuscript.subtitle,
    customAuthors: manuscript.authors,
    dedication: closingDedication,
  };

  // Compose book pages with customClosingPageText
  const composed = composeBookPages({
    manuscript,
    editorialConfig,
    chapterPhotos,
    customClosingPageText: closingDedication,
    maxContentPages: 50,
  });

  // Final page must be closing_mandatory with participant's closing dedication + << ForeverYou >>
  const lastPage = composed.pages[composed.pages.length - 1];
  assert.equal(lastPage.kind, 'closing_mandatory');
  assert.equal(lastPage.centralClosingText, closingDedication);
  assert.equal(lastPage.bottomRightBrand, DEMO_CLOSING_PAGE_BRAND_MARK);

  // Ensure the closing dedication is NOT repeated on Page 2 (dedication) or in chapter body
  const titlePage = composed.pages.find((p) => p.kind === 'title_dedication');
  assert.notEqual(titlePage?.dedication, closingDedication);
});

test('5. Integración del 100% de respuestas principales, profundizaciones justo después de su pregunta principal y transcripciones de voz, con estilo B por defecto', () => {
  const questions: QuestionRecord[] = [
    {
      id: 'q_inf_1',
      text: '¿Cómo era tu casa natal?',
      lifeStage: 'infancia',
      topic: 'hogar',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'q_inf_2',
      text: '¿Qué juegos disfrutabas en tu niñez?',
      lifeStage: 'infancia',
      topic: 'juegos',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      orderIndex: 2,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  // Note: answers passed out of order, plus a deepening follow-up for q_inf_1 and a voice-only transcription
  const answers: AnswerRecord[] = [
    {
      id: 'ans_q2',
      interviewId: 'int_book_1',
      questionId: 'q_inf_2',
      participantId: 'p_elena',
      participantName: 'Elena Gómez',
      answerText: 'Jugábamos a las escondidas en la huerta con mis primos hasta que anochecía.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'k_q2',
      createdAt: '2026-01-02T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    },
    {
      id: 'ans_q1',
      interviewId: 'int_book_1',
      questionId: 'q_inf_1',
      participantId: 'p_elena',
      participantName: 'Elena Gómez',
      answerText: 'Vivíamos frente a la plaza central de Coyoacán',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'k_q1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ans_q1_followup',
      interviewId: 'int_book_1',
      questionId: 'followup_q_inf_1_1',
      parentQuestionId: 'q_inf_1',
      participantId: 'p_elena',
      participantName: 'Elena Gómez',
      answerText: '',
      audio: {
        id: 'aud_1',
        interviewId: 'int_book_1',
        questionId: 'followup_q_inf_1_1',
        participantId: 'p_elena',
        participantName: 'Elena Gómez',
        audioUrl: '/api/audio/aud_1',
        mimeType: 'audio/webm',
        transcription: 'Desde el balcón escuchábamos las campanas y el aroma del pan recién horneado.',
        createdAt: '2026-01-01T01:00:00Z',
      },
      notRecalled: false,
      isFollowUp: true,
      isAdditionalMemory: false,
      idempotencyKey: 'k_q1_f',
      createdAt: '2026-01-01T01:00:00Z',
      updatedAt: '2026-01-01T01:00:00Z',
    },
  ];

  // Omit narrativeStyle to verify default is 'first_person_literary' (Option B)
  const { manuscript } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Elena Gómez',
    storyMode: 'individual',
    participantNames: ['Elena Gómez'],
    answers,
    questions,
  });

  assert.equal(manuscript.narrativeStyle, 'first_person_literary');
  assert.equal(manuscript.chapters.length, 1);

  const infParas = manuscript.chapters[0].paragraphs;
  // Paragraph 0 must contain q_inf_1 integrated immediately with its deepening follow-up transcription
  assert.ok(infParas[0].includes('Vivíamos frente a la plaza central de Coyoacán.'));
  assert.ok(
    infParas[0].includes('Desde el balcón escuchábamos las campanas y el aroma del pan recién horneado.')
  );
  // Paragraph 1 must be q_inf_2 (ordered after q_inf_1 + its follow-up)
  assert.ok(infParas[1].includes('Jugábamos a las escondidas en la huerta'));
});

test('6. Vista previa de 5 páginas de muestra en maquetación y continuidad exacta de esas primeras 5 páginas al generar el PDF completo', () => {
  const questions: QuestionRecord[] = [
    {
      id: 'q1',
      text: 'P1',
      lifeStage: 'infancia',
      topic: 't1',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'q2',
      text: 'P2',
      lifeStage: 'juventud',
      topic: 't2',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      orderIndex: 2,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'q3',
      text: 'P3',
      lifeStage: 'adultez',
      topic: 't3',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      orderIndex: 3,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'q4',
      text: 'P4',
      lifeStage: 'madurez',
      topic: 't4',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      orderIndex: 4,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'q5',
      text: 'P5',
      lifeStage: 'legado_general',
      topic: 't5',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      orderIndex: 5,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const answers: AnswerRecord[] = questions.map((q, idx) => ({
    id: `ans_${idx}`,
    interviewId: 'int_book_1',
    questionId: q.id,
    participantId: 'p_elena',
    participantName: 'Elena Gómez',
    answerText: `Recuerdo extenso número ${idx + 1} de la etapa ${q.lifeStage}: cada vivencia quedó grabada con claridad y emoción en la memoria de nuestra familia.`,
    notRecalled: false,
    isFollowUp: false,
    isAdditionalMemory: false,
    idempotencyKey: `k_${idx}`,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }));

  const { manuscript } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias Completas de Elena',
    storyMode: 'individual',
    participantNames: ['Elena Gómez'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
  });

  const editorialConfig: DemoEditorialConfig = {
    coverDesignId: 'clasica_eterna',
    coverColorVariantIdx: 0,
    coverVisualType: 'illustration',
    coverIllustrationId: 'arbol_raices',
    interiorStyleId: 'clasico_editorial',
    bookFormatId: '6x9',
    customTitle: manuscript.title,
    customSubtitle: manuscript.subtitle,
    customAuthors: manuscript.authors,
    dedication: 'Para toda mi familia.',
  };

  // 1. Compose 5-page sample preview (Layout Studio mode)
  const previewComposed = composeBookPages({
    manuscript,
    editorialConfig,
    maxContentPages: 500,
    previewSampleOnly: true,
  });

  assert.equal(previewComposed.isPreviewSample, true);
  assert.equal(previewComposed.pages.length, 6);
  assert.equal(previewComposed.pages[0].kind, 'cover');
  assert.equal(previewComposed.pages[1].kind, 'title_dedication');
  assert.equal(previewComposed.pages[2].kind, 'chapter_content');
  assert.equal(previewComposed.pages[3].kind, 'chapter_content');
  assert.equal(previewComposed.pages[4].kind, 'chapter_content');
  assert.equal(previewComposed.pages[5].kind, 'closing_mandatory');

  const lockedPreviewGroups = previewComposed.pages
    .filter((p) => p.kind === 'chapter_content' && Array.isArray(p.sections))
    .map((p) => p.sections!);

  // 2. Compose full book PDF (on Save) preserving lockedPreviewGroups
  const fullComposed = composeBookPages({
    manuscript: { ...manuscript, lockedPreviewGroups },
    editorialConfig,
    maxContentPages: 500,
    previewSampleOnly: false,
    lockedLeadingContentGroups: lockedPreviewGroups,
  });

  assert.equal(fullComposed.isPreviewSample, false);
  // Each chapter starts on a new page as requested, while paragraphs within chapters flow continuously
  assert.equal(fullComposed.pages.length, 8);

  // Verify Pages 1..5 in fullComposed have the exact same content sections as Pages 1..5 in previewComposed
  assert.equal(fullComposed.pages[0].title, previewComposed.pages[0].title);
  assert.equal(fullComposed.pages[1].introduction, previewComposed.pages[1].introduction);
  assert.deepEqual(fullComposed.pages[2].sections, previewComposed.pages[2].sections);
  assert.deepEqual(fullComposed.pages[3].sections, previewComposed.pages[3].sections);
  assert.deepEqual(fullComposed.pages[4].sections, previewComposed.pages[4].sections);

  // Verify remaining content chapters each start on their own page, and the last page is closing_mandatory
  const page5ChapterIds = (fullComposed.pages[5].sections || []).map((s) => s.chapterId);
  const page6ChapterIds = (fullComposed.pages[6].sections || []).map((s) => s.chapterId);
  assert.ok(page5ChapterIds.includes('part_ch_madurez'));
  assert.ok(page6ChapterIds.includes('part_ch_legado'));
  assert.equal(fullComposed.pages[7].kind, 'closing_mandatory');
});

test('7. Detección automática de respuestas nuevas tras reabrir la entrevista', () => {
  const savedVersion = {
    createdAt: '2026-01-05T10:00:00Z',
    manuscript: {
      chapters: [
        {
          id: 'part_ch_infancia',
          partNumber: 1,
          dimensionKey: 'raices',
          title: 'Infancia',
          paragraphs: ['Respuesta inicial 1'],
        },
      ],
    } as any,
  };

  // Case A: No new answers and not reopened after savedVersion
  assert.equal(
    hasUpdatedAnswersSinceBookVersion({
      answers: [
        {
          answerText: 'Respuesta inicial 1',
          notRecalled: false,
          createdAt: '2026-01-04T10:00:00Z',
          updatedAt: '2026-01-04T10:00:00Z',
        },
      ],
      interviewReopenedAt: null,
      latestBookVersion: savedVersion,
    }),
    false
  );

  // Case B: Interview was reopened after savedVersion
  assert.equal(
    hasUpdatedAnswersSinceBookVersion({
      answers: [
        {
          answerText: 'Respuesta inicial 1',
          notRecalled: false,
          createdAt: '2026-01-04T10:00:00Z',
          updatedAt: '2026-01-04T10:00:00Z',
        },
      ],
      interviewReopenedAt: '2026-01-06T12:00:00Z',
      latestBookVersion: savedVersion,
    }),
    true
  );

  // Case C: More main answers exist than paragraphs in savedVersion
  assert.equal(
    hasUpdatedAnswersSinceBookVersion({
      answers: [
        {
          answerText: 'Respuesta inicial 1',
          notRecalled: false,
          createdAt: '2026-01-04T10:00:00Z',
          updatedAt: '2026-01-04T10:00:00Z',
        },
        {
          answerText: 'Respuesta inicial 2 que faltaba en el libro',
          notRecalled: false,
          createdAt: '2026-01-04T11:00:00Z',
          updatedAt: '2026-01-04T11:00:00Z',
        },
      ],
      interviewReopenedAt: null,
      latestBookVersion: savedVersion,
    }),
    true
  );
});

test('8. Fidelidad de Diseño Interior, Formato Físico (A5, 6x9, Carta) y Variante Cromática en composición final del libro', () => {
  const answers: AnswerRecord[] = [
    {
      id: 'a1',
      interviewId: 'int_1',
      questionId: 'q1',
      participantId: 'p1',
      participantName: 'Santiago Ramos',
      answerText:
        'Recuerdo con **mucho cariño** aquellas tardes de lluvia en el taller de carpintería de mi abuelo, donde el olor a *madera de cedro* inundaba toda la casa.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'k1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];
  const questions: QuestionRecord[] = [
    {
      id: 'q1',
      text: '¿Qué recuerdas de tu abuelo?',
      lifeStage: 'infancia',
      topic: 'familia',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];
  const { manuscript } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Santiago',
    storyMode: 'individual',
    participantNames: ['Santiago Ramos'],
    answers,
    questions,
  });

  // Compose with 'legado_familiar' interior style and 'carta' physical format
  const cartaComposed = composeBookPages({
    manuscript,
    editorialConfig: {
      narrativeStyle: 'first_person_literary',
      coverDesignId: 'clasica_eterna',
      coverColorVariantIdx: 2, // Azul Noche y Plata
      coverVisualType: 'illustration',
      coverIllustrationId: 'brujula_camino',
      interiorStyleId: 'legado_familiar',
      bookFormatId: 'carta',
      customTitle: 'Memorias de Santiago',
      customSubtitle: 'Edición Especial',
      customAuthors: 'Santiago Ramos',
      dedication: 'Para mis hijos.',
    },
    previewSampleOnly: false,
  });

  assert.equal(cartaComposed.interiorStyle.id, 'legado_familiar');
  assert.equal(cartaComposed.interiorStyle.pageBgHex, '#FAF6EE');
  assert.equal(cartaComposed.interiorStyle.ornamentStyle, 'botanical_leaf');
  assert.equal(cartaComposed.format.id, 'carta');
  assert.equal(cartaComposed.format.widthMm, 215.9);
  assert.equal(cartaComposed.format.heightMm, 279.4);
  assert.equal(cartaComposed.coverPalette.name, 'Azul Prusia & Dorado');

  // Compose with 'a5' physical format and 'minimalista_contemporaneo' interior style
  const a5Composed = composeBookPages({
    manuscript,
    editorialConfig: {
      narrativeStyle: 'first_person_literary',
      coverDesignId: 'recuerdos_marfil',
      coverColorVariantIdx: 1,
      coverVisualType: 'none',
      coverIllustrationId: 'arbol_raices',
      interiorStyleId: 'minimalista_contemporaneo',
      bookFormatId: 'a5',
      customTitle: 'Memorias de Santiago',
      customSubtitle: 'Edición Compacta',
      customAuthors: 'Santiago Ramos',
      dedication: 'Para mis hijos.',
    },
    previewSampleOnly: false,
  });

  assert.equal(a5Composed.interiorStyle.id, 'minimalista_contemporaneo');
  assert.equal(a5Composed.interiorStyle.pdfFontFamily, 'helvetica');
  assert.equal(a5Composed.interiorStyle.textAlign, 'left');
  assert.equal(a5Composed.format.id, 'a5');
  assert.equal(a5Composed.format.widthMm, 148);
  assert.equal(a5Composed.format.heightMm, 210);
  assert.ok(cartaComposed.format.maxCharsPerContentPage > a5Composed.format.maxCharsPerContentPage);
});

test('9. Limpieza de ortografía, gramática, muletillas y repeticiones, y diferenciación total entre Estilos A (formal 1ra persona), B (literario 1ra persona) y C (100% 3ra persona biográfica)', async () => {
  const { cleanSpanishOralText, convertFirstPersonToThirdPersonSpanish } = await import(
    './demoStoryRules.ts'
  );

  // 9.1 Oral cleanup: muletillas, missing accents, repeated words and repeated sentences
  const rawDirty =
    'Este... pues yo naci en Guadalajara con mi papa y mi mama. O sea, este, vivi vivi muchos anos muy feliz. Vivi muchos anos muy feliz. Tambien estudie en la escuela del barrio.';
  const cleaned = cleanSpanishOralText(rawDirty);
  assert.ok(!/\beste\b/i.test(cleaned), `No debe contener muletilla "este": ${cleaned}`);
  assert.ok(!/\bo sea\b/i.test(cleaned), `No debe contener muletilla "o sea": ${cleaned}`);
  assert.ok(cleaned.includes('nací'), `Debe corregir tilde en "nací": ${cleaned}`);
  assert.ok(cleaned.includes('papá') && cleaned.includes('mamá'), `Debe corregir tildes en papá/mamá: ${cleaned}`);
  assert.ok(cleaned.includes(' años '), `Debe corregir "anos" -> "años": ${cleaned}`);
  assert.ok(!/viví\s+viví/i.test(cleaned), `Debe eliminar palabras duplicadas consecutivas: ${cleaned}`);

  // 9.2 Full 3rd-person conversion across multiple sentences
  const thirdPerson = convertFirstPersonToThirdPersonSpanish(
    cleaned,
    'Elena Gómez',
    false
  );
  assert.ok(!/\byo\b/i.test(thirdPerson), `Estilo C no debe dejar pronombre "yo": ${thirdPerson}`);
  assert.ok(!/\bnací\b/i.test(thirdPerson), `Estilo C debe convertir "nací" a "nació": ${thirdPerson}`);
  assert.ok(thirdPerson.includes('nació'), `Estilo C debe usar "nació": ${thirdPerson}`);
  assert.ok(thirdPerson.includes('su papá') && thirdPerson.includes('su mamá'), `Estilo C debe convertir "mi" a "su": ${thirdPerson}`);
  assert.ok(thirdPerson.includes('estudió'), `Estilo C debe convertir "estudié" a "estudió": ${thirdPerson}`);

  // 9.3 Switching between Styles A, B, and C on the same interview answers produces 3 distinct manuscripts
  const questions: QuestionRecord[] = [
    {
      id: 'q_inf_1',
      text: '¿Dónde naciste y cómo fue tu niñez?',
      lifeStage: 'infancia',
      topic: 'origen',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const answers: AnswerRecord[] = [
    {
      id: 'ans_main_1',
      interviewId: 'int_book_1',
      questionId: 'q_inf_1',
      participantId: 'p_elena',
      participantName: 'Elena Gómez',
      answerText:
        'Bueno, este... pues yo naci en Morelia con mi mama y mis abuelos. O sea, creci rodeada de arboles y jardines.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'k_m1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ans_fu_1',
      interviewId: 'int_book_1',
      questionId: 'fu_q_inf_1',
      parentQuestionId: 'q_inf_1',
      participantId: 'p_elena',
      participantName: 'Elena Gómez',
      answerText: 'Tambien jugaba todas las tardes con mi hermano en el patio.',
      notRecalled: false,
      isFollowUp: true,
      isAdditionalMemory: false,
      idempotencyKey: 'k_f1',
      createdAt: '2026-01-01T00:05:00Z',
      updatedAt: '2026-01-01T00:05:00Z',
    },
  ];

  const manuA = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Elena Gómez',
    storyMode: 'individual',
    participantNames: ['Elena Gómez'],
    answers,
    questions,
    narrativeStyle: 'first_person_simple',
  }).manuscript;

  const manuB = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Elena Gómez',
    storyMode: 'individual',
    participantNames: ['Elena Gómez'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
  }).manuscript;

  const manuC = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Elena Gómez',
    storyMode: 'individual',
    participantNames: ['Elena Gómez'],
    answers,
    questions,
    narrativeStyle: 'third_person_biography',
  }).manuscript;

  const paraA = manuA.chapters[0].paragraphs[0];
  const paraB = manuB.chapters[0].paragraphs[0];
  const paraC = manuC.chapters[0].paragraphs[0];

  // All three must be distinct so switching styles in the studio immediately changes the text
  assert.notEqual(paraA, paraB, 'El Estilo A y el Estilo B deben producir redacciones distintas');
  assert.notEqual(paraB, paraC, 'El Estilo B y el Estilo C deben producir redacciones distintas');
  assert.notEqual(paraA, paraC, 'El Estilo A y el Estilo C deben producir redacciones distintas');

  // Style C must have converted both the main answer and the integrated follow-up answer to 3rd person
  assert.ok(paraC.includes('nació'), `Estilo C debe estar en tercera persona ("nació"): ${paraC}`);
  assert.ok(
    paraC.includes('su mamá') && paraC.includes('sus abuelos') && paraC.includes('su hermano'),
    `Estilo C debe convertir todos los posesivos a tercera persona (incluyendo profundización): ${paraC}`
  );
  assert.ok(!/\bmi mamá\b/i.test(paraC), `Estilo C no debe conservar "mi mamá": ${paraC}`);
});

test('10. Generación de PDF en todos los diseños interiores, portadas y formatos físicos mantiene conteo exacto de páginas', async () => {
  const answers: AnswerRecord[] = [
    {
      id: 'ans_pdf_1',
      interviewId: 'int_book_1',
      questionId: 'q_inf_1',
      participantId: 'p_elena',
      participantName: 'Elena Gómez',
      answerText:
        'Recuerdo con nitidez la casa de mis abuelos en Guadalajara, los árboles de naranjo en el patio central y las largas sobremesas dominicales.',
      notRecalled: false,
      isFollowUp: false,
      isAdditionalMemory: false,
      idempotencyKey: 'k_pdf_1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];
  const questions: QuestionRecord[] = [
    {
      id: 'q_inf_1',
      text: '¿Cómo recuerdas tu hogar de la infancia?',
      lifeStage: 'infancia',
      topic: 'hogar',
      priority: 'alta',
      allowedStoryModes: 'ambas',
      requirementType: 'mandatory',
      active: true,
      version: 1,
      orderIndex: 1,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ];

  const { manuscript } = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Elena Gómez',
    storyMode: 'individual',
    participantNames: ['Elena Gómez'],
    answers,
    questions,
    narrativeStyle: 'first_person_literary',
  });

  for (const interior of DEMO_INTERIOR_STYLES) {
    for (const format of DEMO_BOOK_FORMATS) {
      const config: DemoEditorialConfig = {
        coverDesignId: DEMO_COVER_DESIGNS[0].id,
        coverColorVariantIdx: 0,
        coverVisualType: 'illustration',
        coverIllustrationId: 'arbol_raices',
        interiorStyleId: interior.id,
        bookFormatId: format.id,
        customTitle: 'Memorias de Elena Gómez',
        customSubtitle: 'Una vida contada con el corazón',
        customAuthors: 'Elena Gómez',
        dedication: 'Para mis hijos y nietos con todo mi amor.',
      };

      const composed = composeBookPages({
        manuscript,
        editorialConfig: config,
        maxContentPages: 500,
      });

      await preloadBookResourcesForPdf(composed);

      const pdfResult = generateRealDemoBookPdf({
        composed,
        profile: {
          mode: 'individual',
          displayName: 'Elena Gómez',
          fullName: 'Elena Gómez',
          partner1Name: 'Elena Gómez',
          partner2Name: '',
          hasAcceptedTemporaryNotice: true,
        },
      });

      assert.equal(pdfResult.pageCount, composed.pages.length);
      assert.ok(pdfResult.blobUrl.length > 0);
      assert.ok(pdfResult.filename.endsWith('.pdf'));
      URL.revokeObjectURL(pdfResult.blobUrl);
    }
  }
});

test('11. Corrección integral de ortografía, preservación de preposiciones tras vocal acentuada, contextualización natural con pregunta y saneamiento de versiones ya guardadas', async () => {
  const {
    cleanSpanishOralText,
    contextualizeAnswerWithQuestion,
    cleanAndRewriteTestimonyForStyle,
    sanitizeAndRepairBookManuscript,
  } = await import('./demoStoryRules.ts');

  // 11.1 Preserve prepositions "a" and "o" after accented vowels ("salía a jugar", "quería a mi mamá", "día a día", "niño o niña")
  const accentedPreps = cleanSpanishOralText(
    'De nino o nina yo salia a jugar al parque, queria a mi mama y crecia dia a dia.'
  );
  assert.ok(accentedPreps.includes('salía a jugar'), `Debe conservar "salía a jugar": ${accentedPreps}`);
  assert.ok(accentedPreps.includes('quería a mi mamá'), `Debe conservar "quería a mi mamá": ${accentedPreps}`);
  assert.ok(accentedPreps.includes('día a día'), `Debe conservar "día a día": ${accentedPreps}`);
  assert.ok(accentedPreps.includes('niño o niña'), `Debe conservar "niño o niña": ${accentedPreps}`);

  // 11.2 Orthographic errors (B/V, H, S/C/Z, accents)
  const misspelled = cleanSpanishOralText(
    'Cuando yo iva a la escuela con mi ermano y mi aguelo, abia muchas veses que estube feliz ahi.'
  );
  assert.ok(misspelled.includes('iba a la escuela'), `Debe corregir "iva" -> "iba": ${misspelled}`);
  assert.ok(misspelled.includes('mi hermano'), `Debe corregir "ermano" -> "hermano": ${misspelled}`);
  assert.ok(misspelled.includes('mi abuelo'), `Debe corregir "aguelo" -> "abuelo": ${misspelled}`);
  assert.ok(misspelled.includes('había muchas veces'), `Debe corregir "abia muchas veses": ${misspelled}`);
  assert.ok(misspelled.includes('estuve feliz ahí'), `Debe corregir "estube feliz ahi": ${misspelled}`);

  // 11.3 Question-contextual coherence for short elliptical answers without robotic templates
  const shortPlace = contextualizeAnswerWithQuestion('En Guadalajara, Jalisco.', '¿Dónde naciste?');
  assert.equal(shortPlace, 'Nací en Guadalajara, Jalisco.');

  const shortrewriteC = cleanAndRewriteTestimonyForStyle({
    rawText: 'En Guadalajara, Jalisco.',
    narrativeStyle: 'third_person_biography',
    speakerName: 'Elena Gómez',
    questionText: '¿Dónde naciste?',
  });
  assert.ok(
    shortrewriteC.includes('nació en Guadalajara, Jalisco'),
    `Estilo C debe contextualizar respuesta breve en tercera persona: ${shortrewriteC}`
  );

  // 11.4 Automatic sanitization and repair of previously saved versions (stripping legacy robotic templates and restoring omitted "a")
  const legacySavedManuscript = {
    title: 'Memorias Guardadas',
    subtitle: 'Edición Anterior',
    authors: 'Elena Gómez',
    mode: 'individual' as const,
    dedication: 'Para mi familia.',
    narrativeStyle: 'first_person_simple' as const,
    introduction:
      'En lo que respecta a esta etapa de mi vida, yo salía jugar con mi ermano y quería mi mamá.',
    closingMessage: 'En conclusión, estube muy agradecida día día.',
    insufficientInfoNotices: [],
    generatedAt: '2026-01-01T00:00:00Z',
    chapters: [
      {
        id: 'part_ch_infancia',
        partNumber: 1,
        dimensionKey: 'raices' as const,
        title: 'Infancia y Raíces',
        paragraphs: [
          'Asimismo, cabe señalar en torno a esta vivencia que cuando iva a la escuela salía jugar en el patio.',
          'En consonancia con este recuerdo, Elena Gómez refiere que aquello a su persona dio mucha alegría.',
        ],
        pullQuote: 'Aquel instante dejó en mi corazón una huella imborrable: quería mi mamá.',
      },
    ],
  };

  const repaired = sanitizeAndRepairBookManuscript(legacySavedManuscript);
  assert.ok(
    !repaired.introduction.includes('En lo que respecta a esta etapa'),
    `Debe eliminar frase robótica heredada en introducción: ${repaired.introduction}`
  );
  assert.ok(
    repaired.introduction.includes('salía a jugar con mi hermano'),
    `Debe reparar preposición omitida y ortografía en versión guardada: ${repaired.introduction}`
  );
  assert.ok(
    repaired.introduction.includes('quería a mi mamá'),
    `Debe restaurar "quería a mi mamá" en versión guardada: ${repaired.introduction}`
  );
  assert.ok(
    !repaired.chapters[0].paragraphs[0].includes('cabe señalar en torno a esta vivencia'),
    `Debe eliminar muletilla robótica heredada del párrafo: ${repaired.chapters[0].paragraphs[0]}`
  );
  assert.ok(
    repaired.chapters[0].paragraphs[0].includes('iba a la escuela salía a jugar'),
    `Debe corregir "iva" y "salía a jugar" en versión guardada: ${repaired.chapters[0].paragraphs[0]}`
  );
  assert.ok(
    !repaired.chapters[0].paragraphs[1].includes('a su persona'),
    `Debe corregir "a su persona" por redacción natural: ${repaired.chapters[0].paragraphs[1]}`
  );

  // Verify composeBookPages also sanitizes saved manuscripts automatically while keeping useOfficialForeverYouLogo false for legacy versions
  const composedFromLegacy = composeBookPages({
    manuscript: legacySavedManuscript,
    editorialConfig: {
      coverDesignId: 'clasica_eterna',
      coverColorVariantIdx: 0,
      coverVisualType: 'illustration',
      coverIllustrationId: 'arbol_raices',
      interiorStyleId: 'clasico_editorial',
      bookFormatId: '6x9',
      customTitle: 'Memorias Guardadas',
      customSubtitle: 'Edición Anterior',
      customAuthors: 'Elena Gómez',
      dedication: 'Para mi familia.',
    },
    maxContentPages: 50,
  });
  assert.equal(composedFromLegacy.useOfficialForeverYouLogo, false);
  const firstChapterSection = composedFromLegacy.pages.find((p) => p.kind === 'chapter_content')
    ?.sections?.[0];
  assert.ok(firstChapterSection);
  assert.ok(
    firstChapterSection.paragraphs[0].includes('iba a la escuela salía a jugar'),
    `composeBookPages debe entregar el texto depurado al visualizador y al PDF: ${firstChapterSection.paragraphs[0]}`
  );

  // Verify newly generated manuscripts have useOfficialForeverYouLogo = true
  const newlyBuilt = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Nueva Edición Con Logotipo ForeverYou',
    storyMode: 'individual',
    participantNames: ['Elena Gómez'],
    answers: [
      {
        id: 'ans_new_1',
        questionId: 'q_new_1',
        participantName: 'Elena Gómez',
        answerText: 'Recuerdo mi infancia en Morelia con mucho cariño.',
        notRecalled: false,
      },
    ],
    questions: [
      {
        id: 'q_new_1',
        text: '¿Cómo fue tu infancia?',
        lifeStage: 'infancia',
        topic: 'origen',
      },
    ],
  });
  assert.equal(newlyBuilt.manuscript.useOfficialForeverYouLogo, true);
});

test('12. Fidelidad y continuidad estricta 100% de la Vista Previa (primeras 5 páginas) en el PDF final con fotografías e inicio de capítulo en nueva página', () => {
  const editorialConfig: DemoEditorialConfig = {
    narrativeStyle: 'first_person_simple',
    coverDesignId: 'clasica_eterna',
    coverColorVariantIdx: 0,
    coverVisualType: 'illustration',
    coverIllustrationId: 'arbol_raices',
    interiorStyleId: 'clasico_editorial',
    bookFormatId: '6x9',
    customTitle: 'Memorias de Michel',
    customSubtitle: 'Libro autobiográfico familiar',
    customAuthors: 'Michel García García',
    dedication: 'Para mis hijos con todo mi cariño',
  };

  const samplePhoto: DemoInMemoryPhoto = {
    id: 'photo_test_fish',
    objectUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    fileName: 'pesca.png',
    mimeType: 'image/png',
    width: 800,
    height: 600,
    zoom: 1,
    focusY: 'center',
    caption: 'Día de pesca en el mar',
  };

  const previewManuscript: DemoManuscript = {
    title: 'Memorias de Michel',
    subtitle: 'Libro autobiográfico familiar',
    authors: 'Michel García García',
    mode: 'individual',
    narrativeStyle: 'first_person_simple',
    introduction: 'Este prólogo fue generado para la vista previa y debe ser idéntico en el PDF final.',
    dedication: 'Para mis hijos con todo mi cariño',
    chapters: [
      {
        id: 'cap_1',
        partNumber: 1,
        dimensionKey: 'raices',
        title: 'Primeros Pasos y Recuerdos',
        paragraphs: [
          `Párrafo 1 aprobado en la vista previa del Estilo A. ${'En nuestra casa familiar de Veracruz compartíamos largas tardes de conversación junto al jardín de naranjos mientras escuchábamos las anécdotas de nuestros abuelos. '.repeat(3)}`,
          `Párrafo 2 aprobado en la vista previa del Estilo A. ${'Durante las vacaciones de verano caminábamos hasta el malecón para contemplar los barcos que llegaban al puerto al atardecer. '.repeat(3)}`,
          `Párrafo 3 aprobado en la vista previa del Estilo A. ${'Cada domingo nos reuníamos alrededor de la mesa grande del comedor para celebrar la unión y el cariño de toda la familia. '.repeat(3)}`,
          `Párrafo 4 aprobado en la vista previa del Estilo A. ${'Aquellos primeros años me enseñaron el valor del trabajo constante, la palabra cumplida y la gratitud por cada nuevo día. '.repeat(3)}`,
          `Párrafo 5 aprobado en la vista previa del Estilo A. ${'Guardo cada uno de estos recuerdos como el cimiento sobre el que construimos nuestro camino en los años siguientes. '.repeat(3)}`,
        ],
        photoPlacements: [
          {
            photoId: 'photo_test_fish',
            paragraphIndex: 1,
            shortCaption: 'Día de pesca en el mar',
          },
        ],
      },
      {
        id: 'cap_2',
        partNumber: 2,
        dimensionKey: 'hogar_familia_crianza',
        title: 'La Juventud y el Mar',
        paragraphs: [
          'Párrafo 1 del capítulo 2 en la vista previa.',
        ],
      },
    ],
    closingMessage: 'Fin de la vista previa.',
    insufficientInfoNotices: [],
    generatedAt: new Date().toISOString(),
    aiGenerated: true,
  };

  // 1. Generate 5-page preview
  const previewComposed = composeBookPages({
    manuscript: previewManuscript,
    editorialConfig,
    chapterPhotos: { cap_1: samplePhoto },
    allPhotosById: { photo_test_fish: samplePhoto },
    previewSampleOnly: true,
  });

  assert.equal(previewComposed.isPreviewSample, true);
  assert.equal(previewComposed.pages.length, 6); // 5 content/preview pages + page 6 mandatory closing

  // Capture lockedPreviewGroups from preview
  const lockedPreviewGroups = previewComposed.pages
    .filter((p) => p.kind === 'chapter_content' && Array.isArray(p.sections))
    .map((p) => p.sections!);

  // 2. Full book generation with locked preview pages
  const fullManuscript: DemoManuscript = {
    ...previewManuscript,
    introduction: previewManuscript.introduction,
    lockedPreviewGroups,
    chapters: [
      {
        ...previewManuscript.chapters[0],
        paragraphs: [
          ...previewManuscript.chapters[0].paragraphs,
          'Párrafo 6 adicional del capítulo 1 en el libro completo.',
          'Párrafo 7 adicional del capítulo 1 en el libro completo.',
        ],
      },
      {
        id: 'cap_2',
        partNumber: 2,
        dimensionKey: 'hogar_familia_crianza',
        title: 'La Juventud y el Mar',
        paragraphs: [
          'Párrafo 1 del capítulo 2 continuando la historia.',
          'Párrafo 2 del capítulo 2 continuando la historia.',
        ],
      },
      {
        id: 'cap_3',
        partNumber: 3,
        dimensionKey: 'presente_legado_futuro',
        title: 'Mi Legado',
        paragraphs: [
          'Párrafo 1 del capítulo 3 que debe iniciar en nueva página.',
        ],
      },
    ],
  };

  const fullComposed = composeBookPages({
    manuscript: fullManuscript,
    editorialConfig,
    chapterPhotos: { cap_1: samplePhoto },
    allPhotosById: { photo_test_fish: samplePhoto },
    previewSampleOnly: false,
    lockedLeadingContentGroups: lockedPreviewGroups,
    maxContentPages: 500,
  });

  // Verify Page 1 (Cover) matches preview exactly
  assert.equal(fullComposed.pages[0].title, previewComposed.pages[0].title);
  assert.equal(fullComposed.pages[0].subtitle, previewComposed.pages[0].subtitle);
  assert.equal(fullComposed.pages[0].authors, previewComposed.pages[0].authors);

  // Verify Page 2 (Title & Dedication) matches preview exactly
  assert.equal(fullComposed.pages[1].introduction, previewComposed.pages[1].introduction);
  assert.equal(fullComposed.pages[1].dedication, previewComposed.pages[1].dedication);

  // Verify Pages 3, 4, 5 match preview content sections exactly character by character
  assert.deepEqual(fullComposed.pages[2].sections, previewComposed.pages[2].sections);
  assert.deepEqual(fullComposed.pages[3].sections, previewComposed.pages[3].sections);
  assert.deepEqual(fullComposed.pages[4].sections, previewComposed.pages[4].sections);

  // Verify that subsequent chapters (cap_3) start on a new page
  const pageWithCap3 = fullComposed.pages.find((p) =>
    (p.sections || []).some((s) => s.chapterId === 'cap_3' && !s.isContinuation)
  );
  assert.ok(pageWithCap3, 'El capítulo 3 debe existir');
  const sectionsOnCap3Page = pageWithCap3.sections || [];
  assert.equal(sectionsOnCap3Page[0].chapterId, 'cap_3');
  assert.equal(sectionsOnCap3Page[0].isContinuation, false);

  // Verify final closing page is closing_mandatory
  const lastPage = fullComposed.pages[fullComposed.pages.length - 1];
  assert.equal(lastPage.kind, 'closing_mandatory');
});






