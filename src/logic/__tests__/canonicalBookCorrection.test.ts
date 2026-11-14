import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DemoEditorialConfig,
  DemoNarrativeStyleId,
  auditAndApproveBookManuscript,
  buildParticipantInitialManuscriptFromAnswers,
  composeBookPages,
  computeCanonicalManuscriptCacheKey,
  resolveDocumentaryPhotoChapterAndParagraph,
} from '../demoStoryRules.ts';
import { generateRealDemoBookPdf } from '../../utils/demoPdfGenerator.ts';

function buildEditorialConfig(
  style: DemoNarrativeStyleId = 'first_person_literary',
  formatId: '6x9' | 'carta' | 'a5' = '6x9',
  includeToc = false
): DemoEditorialConfig {
  return {
    narrativeStyle: style,
    coverDesignId: 'clasica_eterna',
    coverColorVariantIdx: 0,
    coverVisualType: 'illustration',
    coverIllustrationId: 'arbol_raices',
    interiorStyleId: 'clasico_editorial',
    bookFormatId: formatId,
    customTitle: 'Memorias de Michel García García',
    customSubtitle: 'Legado documental y familiar',
    customAuthors: 'Michel García García',
    dedication: 'Para mis hijos y nietos con profundo cariño.',
    includeTableOfContents: includeToc,
    startEachChapterOnNewPage: true,
  };
}

const samplePngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Caso 1 — Identidad entre Vista Previa y Libro Final
test('Caso 1: Las páginas 1 a 5 de la vista previa son idénticas a las páginas 1 a 5 del libro final en el mismo estilo y formato', () => {
  const answers = [
    {
      id: 'ans_1',
      questionId: 'q_1',
      questionText: '¿Dónde naciste y cómo era tu hogar de infancia?',
      answerText:
        'Nací en Veracruz en una casa amplia con patio central donde mis abuelos sembraban naranjos y jazmines. Todas las tardes nos sentábamos en el corredor a escuchar las historias del puerto.',
      participantName: 'Michel García García',
      lifeStage: 'infancia',
      createdAt: '2026-01-01T10:00:00Z',
    },
    {
      id: 'ans_2',
      questionId: 'q_2',
      questionText: '¿Cómo fue tu etapa de juventud y estudios?',
      answerText:
        'En mi juventud me trasladé a Xalapa para estudiar ingeniería civil. Fueron años de esfuerzo constante, desvelos con mis compañeros de carrera y grandes aprendizajes.',
      participantName: 'Michel García García',
      lifeStage: 'juventud',
      createdAt: '2026-01-01T10:05:00Z',
    },
    {
      id: 'ans_3',
      questionId: 'q_3',
      questionText: '¿Cómo formaste tu propia familia?',
      answerText:
        'Formé mi hogar junto a mi esposa Elena, con quien construimos una familia unida basada en el respeto, la paciencia y el amor por la naturaleza.',
      participantName: 'Michel García García',
      lifeStage: 'adultez',
      createdAt: '2026-01-01T10:10:00Z',
    },
    {
      id: 'ans_4',
      questionId: 'q_4',
      questionText: '¿Qué momento marcó tu madurez?',
      answerText:
        'El nacimiento de nuestros nietos y los días de pesca tranquila en la laguna marcaron una etapa de plenitud y gratitud profunda.',
      participantName: 'Michel García García',
      lifeStage: 'madurez',
      createdAt: '2026-01-01T10:15:00Z',
    },
  ];

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Michel García García',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
    narrativeStyle: 'first_person_simple',
  });

  const config = buildEditorialConfig('first_person_simple', '6x9');
  const previewDoc = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: config,
    chapterPhotos: built.chapterPhotos,
    allPhotosById: built.allPhotosById,
    previewSampleOnly: true,
  });
  const fullDoc = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: config,
    chapterPhotos: built.chapterPhotos,
    allPhotosById: built.allPhotosById,
    previewSampleOnly: false,
  });

  assert.equal(previewDoc.pages.length, 6);
  for (let i = 0; i < 5; i++) {
    assert.equal(previewDoc.pages[i].kind, fullDoc.pages[i].kind);
    assert.equal(previewDoc.pages[i].title, fullDoc.pages[i].title);
    assert.deepEqual(
      previewDoc.pages[i].sections?.map((s) => ({
        chapterId: s.chapterId,
        title: s.title,
        isContinuation: s.isContinuation,
        paragraphs: s.paragraphs,
      })),
      fullDoc.pages[i].sections?.map((s) => ({
        chapterId: s.chapterId,
        title: s.title,
        isContinuation: s.isContinuation,
        paragraphs: s.paragraphs,
      }))
    );
  }
});

// Caso 2 — Cada capítulo real inicia en página nueva
test('Caso 2: Con un manuscrito de 5 capítulos reales, cada apertura ocurre al inicio de una nueva página física y jamás hay 2 capítulos en la misma página', () => {
  const stages = ['infancia', 'juventud', 'adultez', 'madurez', 'legado_general'];
  const answers = stages.map((st, idx) => ({
    id: `ans_${idx + 1}`,
    questionId: `q_${idx + 1}`,
    questionText: `Pregunta etapa ${st}`,
    answerText: `Recuerdo significativo de la etapa ${st} que comparto con toda mi familia para preservar nuestra historia.`,
    participantName: 'Michel García García',
    lifeStage: st,
    createdAt: `2026-01-01T10:0${idx}:00Z`,
  }));

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
  });

  assert.equal(built.manuscript.chapters.length, 5);
  const fullDoc = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: buildEditorialConfig(),
    previewSampleOnly: false,
  });

  const contentPages = fullDoc.pages.filter((p) => p.kind === 'chapter_content');
  assert.ok(contentPages.length >= 5);

  const chapterOpeningsSeen = new Set<string>();
  for (const page of contentPages) {
    assert.equal(
      page.sections?.length,
      1,
      'Ninguna página física puede mezclar dos capítulos reales distintos'
    );
    const sec = page.sections![0];
    if (!sec.isContinuation) {
      assert.equal(
        chapterOpeningsSeen.has(sec.chapterId),
        false,
        `El capítulo ${sec.chapterId} solo puede tener una apertura de capítulo`
      );
      chapterOpeningsSeen.add(sec.chapterId);
    }
  }
  assert.equal(chapterOpeningsSeen.size, 5);
});

// Caso 3 — Múltiples respuestas relacionadas dentro del mismo capítulo
test('Caso 3: 6 preguntas respondidas pertenecientes a la misma etapa biográfica se integran dentro de un único capítulo coherente sin crear 6 capítulos separados', () => {
  const childhoodQuestions = [
    '¿Cómo era la casa donde naciste?',
    '¿A qué jugabas con tus hermanos en el patio?',
    '¿Cómo se llamaba tu escuela primaria?',
    '¿Quién fue tu maestro más recordado?',
    '¿Qué platillo preparaba tu abuela los domingos?',
    '¿Cómo celebraban las fiestas decembrinas en la infancia?',
  ];
  const answers = childhoodQuestions.map((qText, idx) => ({
    id: `ans_inf_${idx + 1}`,
    questionId: `q_inf_${idx + 1}`,
    questionText: qText,
    answerText: `Episodio distinto número ${idx + 1}: En aquella época vivíamos momentos únicos frente al río Papaloapan con toda la familia reunida (${qText}).`,
    participantName: 'Michel García García',
    lifeStage: 'infancia',
    createdAt: `2026-01-01T10:0${idx}:00Z`,
  }));

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Infancia',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
  });

  assert.equal(
    built.manuscript.chapters.length,
    1,
    'Las 6 respuestas de infancia deben agruparse en 1 capítulo coherente y no en 6 capítulos'
  );
  assert.ok(
    built.manuscript.chapters[0].paragraphs.length >= 6,
    'Los 6 episodios distintos deben conservarse como párrafos dentro del mismo capítulo'
  );
});

// Caso 4 — Consolidación de recuerdos repetidos sin duplicación
test('Caso 4: Dos respuestas o profundizaciones que cuentan el mismo episodio se consolidan en una sola narración enriquecida sin repetir dos veces el episodio', () => {
  const answers = [
    {
      id: 'ans_dup_1',
      questionId: 'q_dup_1',
      questionText: '¿Cuál fue tu día más feliz en el mar?',
      answerText:
        'Aquel domingo de verano salimos de pesca en la lancha azul con mi padre y mi hermano mayor frente a la costa de Alvarado.',
      participantName: 'Michel García García',
      lifeStage: 'juventud',
      createdAt: '2026-01-01T10:00:00Z',
    },
    {
      id: 'ans_dup_2',
      questionId: 'q_dup_2',
      questionText: 'Cuéntanos más sobre las salidas familiares en lancha.',
      answerText:
        'Aquel domingo de verano salimos de pesca en la lancha azul con mi padre y mi hermano mayor frente a la costa de Alvarado. Al regresar preparamos pescado asado en la playa al atardecer.',
      participantName: 'Michel García García',
      lifeStage: 'juventud',
      createdAt: '2026-01-01T10:05:00Z',
    },
  ];

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
    narrativeStyle: 'first_person_simple',
  });

  const ch = built.manuscript.chapters[0];
  assert.ok(ch);
  const fullChapterText = ch.paragraphs.join(' ');
  const occurrences = (fullChapterText.match(/lancha azul/gi) || []).length;
  assert.equal(
    occurrences,
    1,
    'El episodio repetido de la lancha azul debe consolidarse y aparecer una sola vez'
  );
  assert.ok(
    fullChapterText.toLowerCase().includes('pescado asado'),
    'El detalle complementario de la segunda respuesta debe conservarse en la unidad consolidada'
  );
});

// Caso 5 — Continuidad interna del capítulo sin saltos artificiales
test('Caso 5: Un capítulo de 10 párrafos fluye continuamente en páginas sucesivas sin abrir páginas nuevas por cada párrafo', () => {
  const answers = Array.from({ length: 10 }, (_, idx) => ({
    id: `ans_cont_${idx + 1}`,
    questionId: `q_cont_${idx + 1}`,
    questionText: `Recuerdo ${idx + 1}`,
    answerText: `Durante el año ${1980 + idx} construimos el proyecto comunitario número ${idx + 1} en la sierra norte, colaborando con los artesanos y maestros carpinteros de la región en jornadas memorables.`,
    participantName: 'Michel García García',
    lifeStage: 'adultez',
    createdAt: `2026-01-01T10:${String(idx).padStart(2, '0')}:00Z`,
  }));

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
  });

  assert.equal(built.manuscript.chapters.length, 1);
  assert.equal(built.manuscript.chapters[0].paragraphs.length, 10);

  const composed = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: buildEditorialConfig(),
    previewSampleOnly: false,
  });

  const contentPages = composed.pages.filter((p) => p.kind === 'chapter_content');
  assert.ok(
    contentPages.length >= 2 && contentPages.length <= 4,
    `10 párrafos deben fluir continuamente en 2 a 4 páginas físicas (obtenidas: ${contentPages.length}), no en 10 páginas separadas`
  );
  assert.equal(contentPages[0].sections![0].isContinuation, false);
  for (let i = 1; i < contentPages.length; i++) {
    assert.equal(contentPages[i].sections![0].isContinuation, true);
  }
});

// Caso 6 — Cero líneas truncadas o cortadas al final de página
test('Caso 6: El 100% de las palabras y oraciones de párrafos extensos aparecen en las páginas compuestas y en el PDF en formatos 6x9, carta y a5 sin pérdida de texto', () => {
  const uniqueMarkers = Array.from({ length: 12 }, (_, idx) => `MARCADOR_FIN_PARRAFO_${idx + 1}`);
  const answers = uniqueMarkers.map((marker, idx) => ({
    id: `ans_long_${idx + 1}`,
    questionId: `q_long_${idx + 1}`,
    questionText: `Pregunta extensa ${idx + 1}`,
    answerText: `${'En aquellos tiempos caminábamos por los senderos del bosque escuchando el canto de los pájaros y recordando las enseñanzas de nuestros mayores sobre la vida y el trabajo honrado. '.repeat(
      5
    )}Finalmente llegamos a la meta con ${marker}.`,
    participantName: 'Michel García García',
    lifeStage: idx < 6 ? 'infancia' : 'adultez',
    createdAt: `2026-01-01T11:${String(idx).padStart(2, '0')}:00Z`,
  }));

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias Completas',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
  });

  for (const fmt of ['6x9', 'carta', 'a5'] as const) {
    const composed = composeBookPages({
      manuscript: built.manuscript,
      editorialConfig: buildEditorialConfig('first_person_literary', fmt),
      previewSampleOnly: false,
    });

    const allComposedText = composed.pages
      .filter((p) => p.kind === 'chapter_content')
      .flatMap((p) => (p.sections || []).flatMap((s) => s.paragraphs))
      .join(' ');

    for (const marker of uniqueMarkers) {
      assert.equal(
        allComposedText.includes(marker),
        true,
        `El marcador final "${marker}" no puede truncarse ni perderse en formato ${fmt}`
      );
    }

    const pdfOut = generateRealDemoBookPdf({
      composed,
      profile: {
        mode: 'individual',
        displayName: 'Michel García García',
        fullName: 'Michel García García',
        partner1Name: '',
        partner2Name: '',
        hasAcceptedTemporaryNotice: true,
      },
    });
    assert.ok(pdfOut.blob.size > 1500);
    assert.ok(pdfOut.pageCount >= composed.pages.length);
  }
});

// Caso 7 — Preservación de incertidumbre del testimonio
test('Caso 7: Respuestas con expresiones de duda ("creo que fue en 1974", "no recuerdo bien el nombre") preservan la incertidumbre en el manuscrito y en la matriz de trazabilidad', () => {
  const answers = [
    {
      id: 'ans_unc_1',
      questionId: 'q_unc_1',
      questionText: '¿En qué año se mudaron a aquella casa?',
      answerText:
        'Creo que fue en 1974 cuando nos mudamos al barrio de San José, aunque no recuerdo bien el nombre de la calle principal.',
      participantName: 'Michel García García',
      lifeStage: 'infancia',
      createdAt: '2026-01-01T10:00:00Z',
    },
  ];

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
  });

  const chText = built.manuscript.chapters[0].paragraphs.join(' ').toLowerCase();
  assert.ok(
    chText.includes('creo que') || chText.includes('no recuerdo bien'),
    'El manuscrito debe preservar las expresiones de incertidumbre del entrevistado'
  );
  assert.equal(built.manuscript.documentaryAudit?.uncertaintiesPreserved, true);
  assert.ok(
    (built.manuscript.documentaryAudit?.traceabilityMatrix[0]?.uncertaintyExpressions?.length || 0) >=
      1
  );
});

// Caso 8 — Ubicación documental de fotografías
test('Caso 8: Fotografías asociadas a capítulos posteriores (ej. Capítulo 3 y 4) se anclan a su capítulo y párrafo exacto, nunca se mueven al Capítulo 1 ni alteran la página 5 de la vista previa', () => {
  const answers = [
    {
      id: 'ans_c1',
      questionId: 'q_c1',
      questionText: 'Infancia',
      answerText: `${'En mi infancia vivíamos en el campo rodeados de árboles frutales y manantiales cristalinos. '.repeat(
        8
      )}`,
      participantName: 'Michel García García',
      lifeStage: 'infancia',
      createdAt: '2026-01-01T10:00:00Z',
    },
    {
      id: 'ans_c2',
      questionId: 'q_c2',
      questionText: 'Juventud',
      answerText: `${'Durante mi juventud trabajé en el taller mecánico aprendiendo el oficio con dedicación diaria. '.repeat(
        8
      )}`,
      participantName: 'Michel García García',
      lifeStage: 'juventud',
      createdAt: '2026-01-01T10:05:00Z',
    },
    {
      id: 'ans_c3',
      questionId: 'q_c3',
      questionText: 'Adultez',
      answerText:
        'En nuestra adultez construimos la cabaña familiar cerca del lago de Pátzcuaro donde celebrábamos cada aniversario.',
      participantName: 'Michel García García',
      lifeStage: 'adultez',
      createdAt: '2026-01-01T10:10:00Z',
    },
    {
      id: 'ans_c4_pesca',
      questionId: 'q_c4',
      questionText: '¿Qué actividad disfrutas más en tu madurez?',
      answerText:
        'En mi madurez disfruto salir a un día de pesca deportiva en alta mar con mis amigos y mi hijo menor.',
      participantName: 'Michel García García',
      lifeStage: 'madurez',
      createdAt: '2026-01-01T10:15:00Z',
      photos: [
        {
          id: 'photo_dia_de_pesca',
          caption: 'Un día de pesca inolvidable sosteniendo el dorado que capturamos al amanecer.',
          dataUrl: samplePngDataUrl,
          imageUrl: samplePngDataUrl,
          mimeType: 'image/png',
          lifeStage: 'madurez',
        },
      ],
    },
  ];

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias de Michel García García',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
  });

  // Verify photo_dia_de_pesca is in Chapter 4 (madurez) and NOT in Chapter 1 (infancia)
  const ch1 = built.manuscript.chapters[0];
  const ch4 = built.manuscript.chapters.find((c) => c.id === 'part_ch_madurez');
  assert.ok(ch4);
  assert.equal((ch1.photoPlacements || []).length, 0, 'Capítulo 1 no debe recibir fotos de capítulos posteriores');
  assert.equal((ch4.photoPlacements || [])[0]?.photoId, 'photo_dia_de_pesca');

  // Verify resolveDocumentaryPhotoChapterAndParagraph also resolves autonomous chapters to Chapter 4
  const resolvedAutonomous = resolveDocumentaryPhotoChapterAndParagraph({
    chapters: built.manuscript.chapters,
    photoId: 'photo_dia_de_pesca',
    shortCaption: 'Un día de pesca inolvidable',
    originalDescription: 'Un día de pesca inolvidable sosteniendo el dorado que capturamos al amanecer.',
    answerId: 'ans_c4_pesca',
    questionId: 'q_c4',
  });
  assert.equal(resolvedAutonomous.chapterId, 'part_ch_madurez');

  // Verify preview page 5 is NOT replaced by Chapter 4's photo page
  const previewComposed = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: buildEditorialConfig(),
    chapterPhotos: built.chapterPhotos,
    allPhotosById: built.allPhotosById,
    previewSampleOnly: true,
  });
  const page5 = previewComposed.pages[4];
  assert.equal(page5.kind, 'chapter_content');
  assert.notEqual(
    page5.sections?.[0]?.chapterId,
    'part_ch_madurez',
    'La página 5 de la vista previa jamás debe adelantar el Capítulo 4 por tener foto'
  );
});

// Caso 9 — Eliminación de capítulos falsos de relleno
test('Caso 9: Con una entrevista breve, jamás se generan capítulos falsos de relleno como "Eco de nuestra memoria" o "Palabras para recordar"', () => {
  const answers = [
    {
      id: 'ans_short_1',
      questionId: 'q_short_1',
      questionText: '¿Cuál es tu recuerdo principal?',
      answerText: 'El abrazo de mis padres cuando terminé mis estudios universitarios.',
      participantName: 'Michel García García',
      lifeStage: 'juventud',
      createdAt: '2026-01-01T10:00:00Z',
    },
  ];

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias Breves',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
  });

  const previewComposed = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: buildEditorialConfig(),
    previewSampleOnly: true,
  });

  const allSectionTitles = previewComposed.pages
    .flatMap((p) => p.sections || [])
    .map((s) => s.title);

  for (const title of allSectionTitles) {
    assert.equal(title.includes('Eco de nuestra memoria'), false);
    assert.equal(title.includes('Palabras para recordar'), false);
    assert.equal(title.includes('Huellas que permanecen'), false);
  }
});

// Caso 10 — Diferenciación real de Estilos A, B y C
test('Caso 10: El mismo conjunto de respuestas produce manuscritos distintos y fieles para Estilo A, Estilo B y Estilo C', () => {
  const answers = [
    {
      id: 'ans_st_1',
      questionId: 'q_st_1',
      questionText: '¿Cómo recuerdas tu primer trabajo?',
      answerText: 'Empecé a trabajar a los dieciocho años en la imprenta del centro histórico.',
      participantName: 'Michel García García',
      lifeStage: 'juventud',
      createdAt: '2026-01-01T10:00:00Z',
    },
  ];

  const styleA = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
    narrativeStyle: 'first_person_simple',
  });
  const styleB = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
    narrativeStyle: 'first_person_literary',
  });
  const styleC = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
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

// Caso 11 — Cambio de formato o diseño sin regenerar IA
test('Caso 11: Cambiar formato físico (6x9 -> carta -> a5) repagina el mismo manuscrito canónico sin alterar su texto', () => {
  const answers = Array.from({ length: 6 }, (_, idx) => ({
    id: `ans_fmt_${idx + 1}`,
    questionId: `q_fmt_${idx + 1}`,
    questionText: `Pregunta ${idx + 1}`,
    answerText: `${'Recuerdo con nitidez cada conversación familiar alrededor de la mesa de madera donde compartíamos sueños y proyectos. '.repeat(
      4
    )}Episodio ${idx + 1}.`,
    participantName: 'Michel García García',
    lifeStage: 'adultez',
    createdAt: `2026-01-01T10:0${idx}:00Z`,
  }));

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
  });

  const canonicalParagraphsSnapshot = JSON.stringify(built.manuscript.chapters);

  const docCarta = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: buildEditorialConfig('first_person_literary', 'carta'),
    previewSampleOnly: false,
  });
  const docA5 = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: buildEditorialConfig('first_person_literary', 'a5'),
    previewSampleOnly: false,
  });

  // Manuscript chapters remain 100% untouched
  assert.equal(JSON.stringify(built.manuscript.chapters), canonicalParagraphsSnapshot);
  // Smaller physical page format (A5) requires at least as many or more pages than Carta
  assert.ok(docA5.pages.length >= docCarta.pages.length);
});

// Caso 12 — Protección ante fallo de IA o auditoría fallida
test('Caso 12: La auditoría documental detecta manuscritos vacíos o fallidos y marca generationStatus como failed_audit para impedir su guardado', () => {
  const emptyCandidate = {
    title: 'Libro vacío',
    subtitle: '',
    authors: 'Michel García García',
    mode: 'individual' as const,
    narrativeStyle: 'first_person_literary' as const,
    introduction: '',
    dedication: '',
    chapters: [],
    closingMessage: '',
    insufficientInfoNotices: [],
    generatedAt: new Date().toISOString(),
  };

  const audited = auditAndApproveBookManuscript({
    manuscript: emptyCandidate,
    answers: [
      {
        id: 'ans_1',
        questionId: 'q_1',
        participantName: 'Michel García García',
        answerText: 'Testimonio real que no puede perderse.',
      },
    ],
    questions: [],
  });

  assert.equal(audited.report.passed, false);
  assert.equal(audited.manuscript.generationStatus, 'failed_audit');
  assert.ok(audited.report.blockingDefects.length > 0);
});

// Caso 13 — Exactitud del índice (Tabla de Contenido) y llave compuesta de caché
test('Caso 13: Cuando includeTableOfContents está activo, los números de página del índice coinciden exactamente con la página física donde inicia cada capítulo', () => {
  const stages = ['infancia', 'juventud', 'adultez', 'madurez'];
  const answers = stages.map((st, idx) => ({
    id: `ans_toc_${idx + 1}`,
    questionId: `q_toc_${idx + 1}`,
    questionText: `Pregunta ${st}`,
    answerText: `${`Relato extenso de la etapa ${st} para ocupar espacio físico real en el libro. `.repeat(
      6
    )}`,
    participantName: 'Michel García García',
    lifeStage: st,
    createdAt: `2026-01-01T10:0${idx}:00Z`,
  }));

  const built = buildParticipantInitialManuscriptFromAnswers({
    interviewTitle: 'Memorias con Índice',
    storyMode: 'individual',
    participantNames: ['Michel García García'],
    answers,
    questions: [],
  });

  const composed = composeBookPages({
    manuscript: built.manuscript,
    editorialConfig: buildEditorialConfig('first_person_literary', '6x9', true),
    previewSampleOnly: false,
  });

  const tocPage = composed.pages.find((p) => p.kind === 'table_of_contents');
  assert.ok(tocPage, 'Debe existir la página de índice cuando includeTableOfContents es true');
  assert.ok(Array.isArray(tocPage.tocEntries) && tocPage.tocEntries.length === 4);

  for (const entry of tocPage.tocEntries!) {
    const targetPage = composed.pages.find((p) => p.pageNumber === entry.startPageNumber);
    assert.ok(targetPage, `Debe existir la página ${entry.startPageNumber}`);
    assert.equal(targetPage.kind, 'chapter_content');
    assert.equal(targetPage.sections?.[0]?.chapterId, entry.chapterId);
    assert.equal(targetPage.sections?.[0]?.isContinuation, false);
  }

  // Verify composite cache key changes whenever answers, style, or prompt change
  const keyA = computeCanonicalManuscriptCacheKey({
    interviewId: 'int_1',
    narrativeStyle: 'first_person_simple',
    customStylePrompt: 'Prompt v1',
    answers,
  });
  const keyB = computeCanonicalManuscriptCacheKey({
    interviewId: 'int_1',
    narrativeStyle: 'first_person_simple',
    customStylePrompt: 'Prompt v2 modificado por admin',
    answers,
  });
  assert.notEqual(keyA, keyB, 'Cambiar el Prompt Literario Activo debe invalidar el caché');
});
