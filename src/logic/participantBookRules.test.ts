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
  DEMO_NARRATIVE_STYLES,
  DEMO_COVER_DESIGNS,
  DEMO_INTERIOR_STYLES,
  DEMO_BOOK_FORMATS,
  DEMO_CLOSING_PAGE_BRAND_MARK,
  DemoEditorialConfig,
} from './demoStoryRules.ts';

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
