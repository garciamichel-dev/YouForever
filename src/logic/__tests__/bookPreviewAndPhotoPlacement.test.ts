import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_CLOSING_PAGE_BRAND_MARK,
  DEMO_CLOSING_PAGE_CENTRAL_TEXT,
  DemoEditorialConfig,
  DemoNarrativeStyleId,
  buildParticipantInitialManuscriptFromAnswers,
  composeBookPages,
} from '../demoStoryRules.ts';
import { generateRealDemoBookPdf } from '../../utils/demoPdfGenerator.ts';

function createDefaultEditorialConfig(style: DemoNarrativeStyleId): DemoEditorialConfig {
  return {
    narrativeStyle: style,
    coverDesignId: 'clasica_eterna',
    coverColorVariantIdx: 0,
    coverVisualType: 'illustration',
    coverIllustrationId: 'arbol_raices',
    interiorStyleId: 'clasico_editorial',
    bookFormatId: '6x9',
    customTitle: 'Mi Historia',
    customSubtitle: 'Recuerdos y memorias de mi vida',
    customAuthors: 'Elena Martínez',
    dedication: '',
  };
}

test('composeBookPages in previewSampleOnly mode generates 6 pages with Page 6 displaying only "Esta historia continuará..." centered and YouForever brand bottom-right', () => {
  const answers = [
    {
      id: 'ans_1',
      questionId: 'q_inf_1',
      questionText: '¿Dónde creciste y cómo era la casa de tu infancia?',
      answerText:
        'Crecí en una casa grande con patio de adoquines en Puebla, donde mi abuela cultivaba jazmines y nos contaba historias al atardecer.',
      participantId: 'p1',
      participantName: 'Elena Martínez',
      lifeStage: 'infancia',
      createdAt: '2026-01-01T10:00:00Z',
    },
    {
      id: 'ans_2',
      questionId: 'q_juv_1',
      questionText: '¿Cuál fue tu primer sueño de juventud?',
      answerText:
        'En mi juventud estudié literatura en la universidad y descubrí mi vocación por enseñar a niños y jóvenes de mi comunidad.',
      participantId: 'p1',
      participantName: 'Elena Martínez',
      lifeStage: 'juventud',
      createdAt: '2026-01-01T10:05:00Z',
    },
    {
      id: 'ans_3',
      questionId: 'q_adu_1',
      questionText: '¿Cómo formaste tu propio hogar?',
      answerText:
        'Construimos nuestro hogar cerca del bosque, llenándolo de libros, música de guitarra y reuniones familiares cada domingo.',
      participantId: 'p1',
      participantName: 'Elena Martínez',
      lifeStage: 'adultez',
      createdAt: '2026-01-01T10:10:00Z',
    },
  ];

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'La historia de Elena Martínez',
    storyMode: 'individual',
    participantNames: ['Elena Martínez'],
    answers,
    questions: [],
    narrativeStyle: 'first_person_literary',
    closingDedicationText: 'Con amor para mis nietos.',
  });

  const editorialConfig = createDefaultEditorialConfig('first_person_literary');
  const composedPreview = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig,
    chapterPhotos: built.chapterPhotos,
    allPhotosById: built.allPhotosById,
    previewSampleOnly: true,
  });

  assert.equal(composedPreview.isPreviewSample, true);
  assert.equal(composedPreview.useOfficialForeverYouLogo, true);
  assert.equal(composedPreview.pages.length, 6);

  const page6 = composedPreview.pages[5];
  assert.equal(page6.pageNumber, 6);
  assert.equal(page6.totalPages, 6);
  assert.equal(page6.kind, 'closing_mandatory');
  assert.equal(page6.centralClosingText, DEMO_CLOSING_PAGE_CENTRAL_TEXT);
  assert.equal(page6.centralClosingText, 'Esta historia continuará...');
  assert.equal(page6.bottomRightBrand, DEMO_CLOSING_PAGE_BRAND_MARK);
  assert.equal(page6.showPageNumber, false);
});

test('composeBookPages places photographs at the exact paragraphIndex with a concise summary caption', () => {
  const samplePngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const answers = [
    {
      id: 'ans_p1',
      questionId: 'q_1',
      questionText: '¿Cómo recuerdas tus primeros años en la escuela?',
      answerText: 'Mis primeros años en la escuela primaria estuvieron llenos de curiosidad.',
      participantId: 'p1',
      participantName: 'Carlos Rivera',
      lifeStage: 'infancia',
      createdAt: '2026-01-01T10:00:00Z',
    },
    {
      id: 'ans_p2',
      questionId: 'q_2',
      questionText: '¿Qué viaje familiar de tu infancia guardas con más cariño?',
      answerText:
        'El viaje en tren a Veracruz con mis padres y hermanos cuando vi el mar por primera vez.',
      participantId: 'p1',
      participantName: 'Carlos Rivera',
      lifeStage: 'infancia',
      createdAt: '2026-01-01T10:05:00Z',
      photos: [
        {
          id: 'photo_int_veracruz_1',
          caption:
            'En esta fotografía estamos frente al malecón de Veracruz en el verano de 1968 cuando mi padre nos compró gorras de marinero y caminamos toda la tarde junto al puerto mirando los barcos.',
          dataUrl: samplePngDataUrl,
          imageUrl: samplePngDataUrl,
          mimeType: 'image/png',
        },
      ],
    },
  ];

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Carlos Rivera',
    storyMode: 'individual',
    participantNames: ['Carlos Rivera'],
    answers,
    questions: [],
    narrativeStyle: 'first_person_literary',
  });

  const chInfancia = built.manuscript.chapters.find((c) => c.id === 'part_ch_infancia');
  assert.ok(chInfancia, 'Infancia chapter should exist');
  assert.ok(Array.isArray(chInfancia.photoPlacements) && chInfancia.photoPlacements.length === 1);
  assert.equal(chInfancia.photoPlacements![0].photoId, 'photo_int_veracruz_1');
  assert.equal(chInfancia.photoPlacements![0].paragraphIndex, 1);
  assert.ok(
    chInfancia.photoPlacements![0].shortCaption.length <= 98,
    'Photo footer caption must be a short summary'
  );

  const composed = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: createDefaultEditorialConfig('first_person_literary'),
    chapterPhotos: built.chapterPhotos,
    allPhotosById: built.allPhotosById,
    previewSampleOnly: true,
  });

  // Find the section containing photo_int_veracruz_1 in paragraphPhotos
  let foundPlacedPhoto = false;
  for (const pg of composed.pages) {
    for (const sec of pg.sections || []) {
      if (sec.paragraphPhotos) {
        for (const list of Object.values(sec.paragraphPhotos)) {
          for (const ph of list) {
            if (ph.id === 'photo_int_veracruz_1') {
              foundPlacedPhoto = true;
              assert.ok(ph.caption && ph.caption.length <= 98);
            }
          }
        }
      }
    }
  }
  assert.equal(foundPlacedPhoto, true, 'Photo must be placed in paragraphPhotos of its exact section');

  const pdfOut = generateRealDemoBookPdf({
    composed,
    profile: {
      mode: 'individual',
      displayName: 'Carlos Rivera',
      fullName: 'Carlos Rivera',
      partner1Name: '',
      partner2Name: '',
      hasAcceptedTemporaryNotice: true,
    },
  });
  assert.ok(pdfOut.blob.size > 1000, 'Generated sample PDF must be non-empty');
  assert.equal(pdfOut.pageCount, composed.pages.length);
  assert.ok(composed.pages.length <= 6);
});

test('buildParticipantInitialManuscriptFromAnswers produces distinct redactions for Style A, Style B, and Style C', () => {
  const answers = [
    {
      id: 'ans_s1',
      questionId: 'q_s1',
      questionText: '¿Dónde naciste?',
      answerText: 'Nací en Guadalajara en una mañana lluviosa de junio rodeado de mi familia.',
      participantId: 'p1',
      participantName: 'Lucía Gómez',
      lifeStage: 'infancia',
      createdAt: '2026-01-01T10:00:00Z',
    },
  ];

  const styleA = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Historia de Lucía',
    storyMode: 'individual',
    participantNames: ['Lucía Gómez'],
    answers,
    questions: [],
    narrativeStyle: 'first_person_simple',
  });

  const styleB = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Historia de Lucía',
    storyMode: 'individual',
    participantNames: ['Lucía Gómez'],
    answers,
    questions: [],
    narrativeStyle: 'first_person_literary',
  });

  const styleC = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Historia de Lucía',
    storyMode: 'individual',
    participantNames: ['Lucía Gómez'],
    answers,
    questions: [],
    narrativeStyle: 'third_person_biography',
  });

  assert.notEqual(styleA.manuscript.introduction, styleB.manuscript.introduction);
  assert.notEqual(styleB.manuscript.introduction, styleC.manuscript.introduction);
  assert.notEqual(
    styleA.manuscript.chapters[0].paragraphs[0],
    styleC.manuscript.chapters[0].paragraphs[0]
  );
});

test('generateRealDemoBookPdf produces native selectable vector text in both sample and full book PDFs', async () => {
  const answers = [
    {
      id: 'ans_vec_1',
      questionId: 'q_vec_1',
      questionText: '¿Cuál es tu recuerdo más preciado?',
      answerText: 'El jardín de bugambilias en la casa de mis abuelos en Oaxaca.',
      participantId: 'p1',
      participantName: 'Michel García García',
      lifeStage: 'infancia',
      createdAt: '2026-01-01T10:00:00Z',
    },
  ];

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Michel García García',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
    narrativeStyle: 'first_person_literary',
  });

  const composedFull = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: createDefaultEditorialConfig('first_person_literary'),
    chapterPhotos: built.chapterPhotos,
    allPhotosById: built.allPhotosById,
    previewSampleOnly: false,
  });

  const fullPdf = generateRealDemoBookPdf({
    composed: composedFull,
    profile: {
      mode: 'individual',
      displayName: 'Michel García García',
      fullName: 'Michel García García',
      partner1Name: '',
      partner2Name: '',
      hasAcceptedTemporaryNotice: true,
    },
  });

  assert.ok(fullPdf.blob.size > 1000);
  assert.ok(fullPdf.pageCount >= 4);
});

test('ensurePhotosPlacedInManuscript strips orphaned/deleted photo markdown blocks while preserving all answer text', async () => {
  const { ensurePhotosPlacedInManuscript, INITIAL_APP_CONFIG } = await import(
    '../interviewRules.ts'
  );
  assert.equal(INITIAL_APP_CONFIG.bookStructureMode, 'prompt_autonomous');

  const staleManuscript = `# Memorias de Michel García García\n\n## Infancia\nCrecí rodeado de mi familia.\n![Foto eliminada | Aportada por Michel García García (infancia)](/api/photos/photo_int_1793926754312_ko21j_1794363871407_0_doar)\n*Fotografía relacionada con «Pregunta» — Contexto: Foto eliminada (Aportada por Michel García García)*\n\nSeguimos adelante con alegría.`;

  const cleaned = ensurePhotosPlacedInManuscript({
    compiledMarkdown: staleManuscript,
    answers: [
      {
        id: 'ans_m1',
        interviewId: 'int_1793926754312_ko21j',
        questionId: 'q_1',
        questionText: 'Pregunta',
        participantId: 'p1',
        participantName: 'Michel García García',
        answerText: 'Crecí rodeado de mi familia.',
        notRecalled: false,
        isFollowUp: false,
        isAdditionalMemory: false,
        parentQuestionId: null,
        idempotencyKey: 'idem_test_m1',
        photos: [],
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:00:00Z',
      },
    ],
    questions: [],
  });

  assert.equal(
    cleaned.includes('photo_int_1793926754312_ko21j_1794363871407_0_doar'),
    false,
    'Deleted photo ID must be stripped from compiled manuscript'
  );
  assert.equal(
    cleaned.includes('Crecí rodeado de mi familia.'),
    true,
    'Participant answer text must remain 100% intact'
  );
});

