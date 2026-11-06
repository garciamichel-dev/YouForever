import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_MAIN_QUESTIONS,
  DEMO_MAX_BASE_QUESTIONS,
  DEMO_MAX_AI_FOLLOW_UPS,
  DEMO_MAX_TOTAL_QUESTIONS,
  DEMO_NARRATIVE_STYLES,
  DEMO_COVER_DESIGNS,
  DEMO_INTERIOR_STYLES,
  DEMO_BOOK_FORMATS,
  DEMO_TEMPORARY_PRIVACY_NOTICE,
  DEMO_CLOSING_PAGE_CENTRAL_TEXT,
  DEMO_CLOSING_PAGE_BRAND_MARK,
  buildSafeDemoPdfFilename,
  composeBookPages,
  buildFallbackFollowUp,
  buildFaithfulFallbackManuscript,
  countGeneratedDemoFollowUps,
  canRequestDemoFollowUpForQuestion,
  DemoBasicProfile,
  DemoEditorialConfig,
  DemoQuestionResponse,
} from './demoStoryRules.ts';
import {
  DEMO_SESSION_TTL_MS,
  isDemoSessionExpired,
  createInitialDemoSessionState,
} from '../utils/demoSessionManager.ts';

test('DEMO_MAIN_QUESTIONS has 5 base questions and enforces 3 AI follow-ups (8 questions total)', () => {
  assert.equal(DEMO_MAIN_QUESTIONS.length, 5);
  assert.equal(DEMO_MAX_BASE_QUESTIONS, 5);
  assert.equal(DEMO_MAX_AI_FOLLOW_UPS, 3);
  assert.equal(DEMO_MAX_TOTAL_QUESTIONS, 8);

  // Question 1
  assert.equal(DEMO_MAIN_QUESTIONS[0].individualDimensionTitle, 'Mis raíces');
  assert.equal(DEMO_MAIN_QUESTIONS[0].coupleDimensionTitle, 'Nuestros primeros recuerdos');
  assert.equal(
    DEMO_MAIN_QUESTIONS[0].individualText,
    'Si pudieras regresar por un instante a tu infancia y revivir un momento que guardas con especial cariño, ¿cuál elegirías y quiénes estarían contigo?'
  );
  assert.equal(
    DEMO_MAIN_QUESTIONS[0].coupleText,
    'Antes de que sus caminos se encontraran, ¿qué recuerdo entrañable de la infancia o juventud le gustaría compartir a cada uno para que el otro conozca mejor de dónde viene?'
  );

  // Question 5
  assert.equal(DEMO_MAIN_QUESTIONS[4].individualDimensionTitle, 'Las palabras que deseo dejar');
  assert.equal(DEMO_MAIN_QUESTIONS[4].coupleDimensionTitle, 'Lo que deseamos dejar');
});

test('canRequestDemoFollowUpForQuestion allows AI follow-ups on first 3 answered questions and blocks on 4th and 5th', () => {
  const responses: Record<string, DemoQuestionResponse> = {};

  // Initially 0 follow-ups used -> Q1 can request AI follow-up
  assert.equal(countGeneratedDemoFollowUps(responses), 0);
  assert.equal(canRequestDemoFollowUpForQuestion(responses, 'demo_q1_raices'), true);

  // Simulate Q1, Q2, Q3 receiving AI follow-ups
  for (const qId of ['demo_q1_raices', 'demo_q2_transformacion', 'demo_q3_personas_amadas']) {
    responses[qId] = {
      questionId: qId,
      mainAnswerText: 'Un recuerdo significativo de mi vida.',
      mainOmission: 'none',
      followUp: {
        mainQuestionId: qId,
        shouldAskFollowUp: true,
        followUpQuestion: `¿Qué más recuerdas sobre ${qId}?`,
        detectedTheme: 'recuerdo',
        referencedDetail: 'vida',
      },
      followUpCompleted: true,
    };
  }

  assert.equal(countGeneratedDemoFollowUps(responses), 3);
  // Existing Q1..Q3 still return true if revisited
  assert.equal(canRequestDemoFollowUpForQuestion(responses, 'demo_q1_raices'), true);
  // Q4 and Q5 cannot generate a 4th or 5th AI follow-up (total capped at 5 base + 3 AI = 8)
  assert.equal(canRequestDemoFollowUpForQuestion(responses, 'demo_q4_esencia'), false);
  assert.equal(canRequestDemoFollowUpForQuestion(responses, 'demo_q5_legado'), false);
});

test('DEMO_NARRATIVE_STYLES has 3 styles with Literary First Person recommended by default', () => {
  assert.equal(DEMO_NARRATIVE_STYLES.length, 3);
  const recommended = DEMO_NARRATIVE_STYLES.find((s) => s.recommended);
  assert.ok(recommended);
  assert.equal(recommended.id, 'first_person_literary');
});

test('Editorial catalogs include 5 covers, 5 interiors, and 3 physical formats (A5, 6x9, Carta)', () => {
  assert.equal(DEMO_COVER_DESIGNS.length, 5);
  assert.equal(DEMO_INTERIOR_STYLES.length, 5);
  assert.equal(DEMO_BOOK_FORMATS.length, 3);
  assert.deepEqual(
    DEMO_BOOK_FORMATS.map((f) => f.id),
    ['a5', '6x9', 'carta']
  );
});

test('Temporary privacy notice matches exact specification', () => {
  assert.equal(
    DEMO_TEMPORARY_PRIVACY_NOTICE,
    'Esta demostración utiliza inteligencia artificial para convertir tus recuerdos en un pequeño libro. Tus respuestas se conservarán temporalmente en este navegador durante la sesión y no se guardarán en nuestra base de datos. Para generar las preguntas y la historia, el texto necesario se enviará al proveedor de inteligencia artificial.'
  );
});

test('buildSafeDemoPdfFilename produces clean human-readable filenames without special chars', () => {
  const individualProfile: DemoBasicProfile = {
    mode: 'individual',
    displayName: 'María Elena',
    fullName: 'María Elena Gómez',
    partner1Name: '',
    partner2Name: '',
    hasAcceptedTemporaryNotice: true,
  };
  assert.equal(
    buildSafeDemoPdfFilename(individualProfile),
    'ForeverYou_Mi_Historia_Maria_Elena.pdf'
  );

  const coupleProfile: DemoBasicProfile = {
    mode: 'pareja',
    displayName: '',
    partner1Name: 'Ana Sofía',
    partner2Name: 'Carlos Andrés',
    hasAcceptedTemporaryNotice: true,
  };
  assert.equal(
    buildSafeDemoPdfFilename(coupleProfile),
    'ForeverYou_Nuestra_Historia_Ana_Sofia_y_Carlos_Andres.pdf'
  );
});

test('composeBookPages always generates between 5 and 10 pages and enforces mandatory closing page', () => {
  const profile: DemoBasicProfile = {
    mode: 'individual',
    displayName: 'Don Roberto',
    partner1Name: '',
    partner2Name: '',
    hasAcceptedTemporaryNotice: true,
  };

  const responses: Record<string, DemoQuestionResponse> = {};
  for (const q of DEMO_MAIN_QUESTIONS) {
    responses[q.id] = {
      questionId: q.id,
      mainAnswerText:
        'Recuerdo el patio grande de ladrillo rojo en casa de mis abuelos, donde olía a café recién colado y pan dulce cada mañana.',
      mainOmission: 'none',
      followUpAnswerText:
        'Mi abuela cantaba bajito mientras regaba las macetas de geranios antes de que saliera el sol.',
      followUpOmission: 'none',
      followUpCompleted: true,
    };
  }

  const manuscript = buildFaithfulFallbackManuscript({
    profile,
    responses,
    narrativeStyle: 'first_person_literary',
    dedication: 'Para mis nietos con todo mi amor.',
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
    dedication: manuscript.dedication,
  };

  const composed = composeBookPages({
    manuscript,
    editorialConfig,
  });

  assert.ok(composed.pages.length >= 5 && composed.pages.length <= 10);
  assert.equal(composed.pages[0].kind, 'cover');
  assert.equal(composed.pages[1].kind, 'title_dedication');

  const lastPage = composed.pages[composed.pages.length - 1];
  assert.equal(lastPage.kind, 'closing_mandatory');
  assert.equal(lastPage.centralClosingText, DEMO_CLOSING_PAGE_CENTRAL_TEXT);
  assert.equal(lastPage.centralClosingText, 'Esta historia continuará...');
  assert.equal(lastPage.bottomRightBrand, DEMO_CLOSING_PAGE_BRAND_MARK);
  assert.equal(lastPage.bottomRightBrand, '<< ForeverYou >>');
  assert.equal(lastPage.showPageNumber, false);
});

test('composeBookPages never exceeds 10 pages even with very extensive chapters', () => {
  const longPara =
    'Durante muchos años trabajamos con dedicación en aquel taller familiar donde aprendimos que la paciencia y la honestidad abren todas las puertas. '.repeat(
      8
    );

  const manuscript = {
    title: 'Una vida entera',
    subtitle: 'Memorias extensas',
    authors: 'Elena y Jorge',
    mode: 'pareja' as const,
    narrativeStyle: 'first_person_literary' as const,
    introduction: 'Introducción extensa.',
    dedication: 'Para toda nuestra familia.',
    chapters: DEMO_MAIN_QUESTIONS.map((q, idx) => ({
      id: q.id,
      partNumber: idx + 1,
      dimensionKey: q.dimensionKey,
      title: q.coupleBookPartTitle,
      paragraphs: [longPara, longPara, longPara, longPara],
      pullQuote: 'La paciencia y la honestidad abren todas las puertas.',
    })),
    closingMessage: 'Que siempre permanezcan unidos.',
    insufficientInfoNotices: [],
    generatedAt: new Date().toISOString(),
  };

  const editorialConfig: DemoEditorialConfig = {
    coverDesignId: 'album_nuestra_vida',
    coverColorVariantIdx: 0,
    coverVisualType: 'illustration',
    coverIllustrationId: 'hogar_calido',
    interiorStyleId: 'legado_familiar',
    bookFormatId: 'a5',
    customTitle: manuscript.title,
    customSubtitle: manuscript.subtitle,
    customAuthors: manuscript.authors,
    dedication: manuscript.dedication,
  };

  const composed = composeBookPages({ manuscript, editorialConfig });
  assert.ok(composed.pages.length >= 5 && composed.pages.length <= 10);
  assert.equal(composed.pages[composed.pages.length - 1].kind, 'closing_mandatory');
});

test('buildFallbackFollowUp references quoted nicknames when present', () => {
  const q3 = DEMO_MAIN_QUESTIONS[2];
  const res = buildFallbackFollowUp({
    question: q3,
    mode: 'individual',
    answerText: 'Mi abuelo «Tata Chuy» siempre me esperaba en la estación.',
  });
  assert.equal(res.shouldAskFollowUp, true);
  assert.equal(res.referencedDetail, 'Tata Chuy');
  assert.match(res.followUpQuestion, /Tata Chuy/);
});

test('Demo session TTL expires strictly after 4 hours', () => {
  const baseNow = 1_700_000_000_000;
  const session = createInitialDemoSessionState(baseNow);

  assert.equal(isDemoSessionExpired(session, baseNow + 1000), false);
  assert.equal(isDemoSessionExpired(session, baseNow + DEMO_SESSION_TTL_MS - 1000), false);
  assert.equal(isDemoSessionExpired(session, baseNow + DEMO_SESSION_TTL_MS + 1), true);
});
