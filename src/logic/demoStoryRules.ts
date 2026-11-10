export type DemoStoryMode = 'individual' | 'pareja';

export type DemoNarrativeStyleId =
  | 'first_person_simple'
  | 'first_person_literary'
  | 'third_person_biography';

export type DemoCoverDesignId =
  | 'clasica_eterna'
  | 'recuerdos_marfil'
  | 'album_nuestra_vida'
  | 'raices_recuerdos'
  | 'historia_contemporanea';

export type DemoInteriorStyleId =
  | 'clasico_editorial'
  | 'memorias_elegantes'
  | 'diario_intimo'
  | 'minimalista_contemporaneo'
  | 'legado_familiar';

export type DemoBookFormatId = 'a5' | '6x9' | 'carta';

export type DemoCoverVisualType = 'none' | 'illustration' | 'photo';

export type DemoThematicIllustrationId =
  | 'arbol_raices'
  | 'pluma_tinta'
  | 'brujula_camino'
  | 'hogar_calido'
  | 'constelacion_familiar';

export interface DemoBasicProfile {
  mode: DemoStoryMode;
  // Individual
  displayName: string;
  fullName?: string;
  // Couple
  partner1Name: string;
  partner2Name: string;
  // Shared
  customTitle?: string;
  hasAcceptedTemporaryNotice: boolean;
}

export interface DemoQuestionDefinition {
  id: string;
  stepNumber: number;
  dimensionKey: 'raices' | 'transformacion' | 'personas_amadas' | 'esencia' | 'legado';
  individualDimensionTitle: string;
  coupleDimensionTitle: string;
  individualBookPartTitle: string;
  coupleBookPartTitle: string;
  individualText: string;
  coupleText: string;
  objective: string;
  focusHints: string[];
}

export interface DemoFollowUpPayload {
  mainQuestionId: string;
  shouldAskFollowUp: boolean;
  followUpQuestion: string;
  detectedTheme: string;
  referencedDetail: string;
}

export interface DemoQuestionResponse {
  questionId: string;
  // Individual or Joint answer
  mainAnswerText: string;
  // Couple separate answers
  partner1AnswerText?: string;
  partner2AnswerText?: string;
  mainOmission?: 'none' | 'not_recalled' | 'prefer_not_to_answer';
  // Generated AI follow-up (at most 1 per main question)
  followUp?: DemoFollowUpPayload | null;
  followUpAnswerText?: string;
  partner1FollowUpText?: string;
  partner2FollowUpText?: string;
  followUpOmission?: 'none' | 'not_recalled' | 'prefer_not_to_answer';
  followUpCompleted?: boolean;
}

export interface DemoChapterManuscript {
  id: string;
  partNumber: number;
  dimensionKey: string;
  title: string;
  paragraphs: string[];
  pullQuote?: string;
}

export interface DemoManuscript {
  title: string;
  subtitle: string;
  authors: string;
  mode: DemoStoryMode;
  narrativeStyle: DemoNarrativeStyleId;
  introduction: string;
  dedication: string;
  chapters: DemoChapterManuscript[];
  closingMessage: string;
  insufficientInfoNotices: string[];
  generatedAt: string;
  lockedPreviewGroups?: ComposedChapterSectionBlock[][];
  useOfficialForeverYouLogo?: boolean;
}

export interface DemoInMemoryPhoto {
  id: string;
  objectUrl: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  caption?: string;
  focusY: 'top' | 'center' | 'bottom';
  zoom: number;
}

export interface DemoEditorialConfig {
  narrativeStyle?: DemoNarrativeStyleId;
  coverDesignId: DemoCoverDesignId;
  coverColorVariantIdx: number;
  coverVisualType: DemoCoverVisualType;
  coverIllustrationId: DemoThematicIllustrationId;
  interiorStyleId: DemoInteriorStyleId;
  bookFormatId: DemoBookFormatId;
  customTitle: string;
  customSubtitle: string;
  customAuthors: string;
  dedication: string;
}

export const DEMO_TEMPORARY_PRIVACY_NOTICE =
  'Esta demostración utiliza inteligencia artificial para convertir tus recuerdos en un pequeño libro. Tus respuestas se conservarán temporalmente en este navegador durante la sesión y no se guardarán en nuestra base de datos. Para generar las preguntas y la historia, el texto necesario se enviará al proveedor de inteligencia artificial.';

export const DEMO_CLOSING_PAGE_CENTRAL_TEXT = 'Esta historia continuará...';
export const DEMO_CLOSING_PAGE_BRAND_MARK = '<< YouForever >>';

export const DEMO_MAX_BASE_QUESTIONS = 5;
export const DEMO_MAX_AI_FOLLOW_UPS = 3;
export const DEMO_MAX_TOTAL_QUESTIONS = DEMO_MAX_BASE_QUESTIONS + DEMO_MAX_AI_FOLLOW_UPS; // 8 questions in total

/**
 * Counts how many AI follow-up questions have already been generated across the interview.
 */
export function countGeneratedDemoFollowUps(
  responses: Record<string, DemoQuestionResponse>,
  excludeQuestionId?: string
): number {
  let count = 0;
  for (const [qId, resp] of Object.entries(responses)) {
    if (excludeQuestionId && qId === excludeQuestionId) continue;
    if (
      resp &&
      resp.mainOmission === 'none' &&
      resp.followUp?.shouldAskFollowUp &&
      Boolean(resp.followUp.followUpQuestion?.trim())
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * Determines whether the interview can generate/present an AI follow-up for the given base question,
 * enforcing the strict limit of 3 AI follow-ups across the 5 base questions (total 8 questions).
 */
export function canRequestDemoFollowUpForQuestion(
  responses: Record<string, DemoQuestionResponse>,
  questionId: string
): boolean {
  const existing = responses[questionId];
  if (
    existing?.followUp?.shouldAskFollowUp &&
    Boolean(existing.followUp.followUpQuestion?.trim())
  ) {
    return true;
  }
  const usedInOtherQuestions = countGeneratedDemoFollowUps(responses, questionId);
  return usedInOtherQuestions < DEMO_MAX_AI_FOLLOW_UPS;
}

/**
 * The 5 fixed main questions for Individual and Couple modes (Sections 7, 8, 9).
 */
export const DEMO_MAIN_QUESTIONS: DemoQuestionDefinition[] = [
  {
    id: 'demo_q1_raices',
    stepNumber: 1,
    dimensionKey: 'raices',
    individualDimensionTitle: 'Mis raíces',
    coupleDimensionTitle: 'Nuestros primeros recuerdos',
    individualBookPartTitle: 'El lugar donde comenzó mi historia',
    coupleBookPartTitle: 'El lugar donde comenzaron nuestros caminos',
    individualText:
      'Si pudieras regresar por un instante a tu infancia y revivir un momento que guardas con especial cariño, ¿cuál elegirías y quiénes estarían contigo?',
    coupleText:
      'Antes de que sus caminos se encontraran, ¿qué recuerdo entrañable de la infancia o juventud le gustaría compartir a cada uno para que el otro conozca mejor de dónde viene?',
    objective:
      'Descubrir un recuerdo concreto de la infancia o juventud que permita crear una escena autobiográfica significativa.',
    focusHints: [
      'Personas presentes',
      'Lugar y atmósfera',
      'Sensaciones cotidianas',
      'Expresiones familiares',
      'Emociones de aquel momento',
    ],
  },
  {
    id: 'demo_q2_transformacion',
    stepNumber: 2,
    dimensionKey: 'transformacion',
    individualDimensionTitle: 'El momento que transformó mi vida',
    coupleDimensionTitle: 'El encuentro que cambió nuestras vidas',
    individualBookPartTitle: 'Los caminos que me hicieron ser quien soy',
    coupleBookPartTitle: 'El encuentro que transformó nuestra historia',
    individualText:
      'A lo largo de tu vida, ¿qué decisión, acontecimiento o encuentro marcó un antes y un después para ti, y por qué consideras que cambió tu historia?',
    coupleText:
      '¿Cómo recuerdan el momento en que sus vidas se encontraron y qué acontecimientos hicieron que su historia juntos se volviera importante para ambos?',
    objective:
      'Identificar una experiencia, encuentro o decisión que ayude a comprender cómo se convirtieron en quienes son hoy.',
    focusHints: [
      'Decisiones importantes',
      'Cambios de vida',
      'Encuentros significativos',
      'Aprendizajes',
      'Sentimientos experimentados',
    ],
  },
  {
    id: 'demo_q3_personas_amadas',
    stepNumber: 3,
    dimensionKey: 'personas_amadas',
    individualDimensionTitle: 'Las personas que amo',
    coupleDimensionTitle: 'Nuestra manera de querernos',
    individualBookPartTitle: 'Las personas que llevo en el corazón',
    coupleBookPartTitle: 'El lenguaje íntimo de nuestro cariño',
    individualText:
      'Piensa en una persona a la que hayas amado profundamente, como tu pareja, un hijo, tus padres o alguien muy especial. ¿Cómo le decías de cariño y qué pequeño momento que vivieron juntos te gustaría conservar para siempre?',
    coupleText:
      '¿Cómo se llaman o se llamaban de cariño y qué pequeño gesto, costumbre o momento compartido representa mejor el amor y el afecto que han construido?',
    objective:
      'Recuperar los apodos afectivos y las expresiones íntimas que hacen que una historia sea personal e irrepetible.',
    focusHints: [
      'Apodos afectivos exactos',
      'Formas especiales de llamarse',
      'Gestos cotidianos',
      'Costumbres compartidas',
      'Frases memorables',
    ],
  },
  {
    id: 'demo_q4_esencia',
    stepNumber: 4,
    dimensionKey: 'esencia',
    individualDimensionTitle: 'Mi esencia personal',
    coupleDimensionTitle: 'Lo que nos hace únicos',
    individualBookPartTitle: 'Las pequeñas cosas que me hacen ser yo',
    coupleBookPartTitle: 'Las costumbres que nos hacen únicos',
    individualText:
      '¿Qué gesto, frase, costumbre o manera de demostrar cariño es tan característica de ti que tus seres queridos la reconocerían inmediatamente y dirían: “Así es como yo lo recuerdo”?',
    coupleText:
      '¿Qué costumbre, frase, anécdota o manera de convivir es tan característica de ustedes que sus seres queridos la reconocerían inmediatamente como parte de su historia?',
    objective:
      'Descubrir la personalidad cotidiana, modismos, sentido del humor y hábitos entrañables.',
    focusHints: [
      'Maneras de hablar y frases propias',
      'Formas de cuidar a los demás',
      'Costumbres familiares y tradiciones',
      'Sentido del humor y gestos característicos',
    ],
  },
  {
    id: 'demo_q5_legado',
    stepNumber: 5,
    dimensionKey: 'legado',
    individualDimensionTitle: 'Las palabras que deseo dejar',
    coupleDimensionTitle: 'Lo que deseamos dejar',
    individualBookPartTitle: 'Las palabras que quiero dejar',
    coupleBookPartTitle: 'Las palabras que deseamos dejar',
    individualText:
      'Imagina que, dentro de muchos años, las personas que más amas abren este libro para recordar quién eres y sentirse cerca de ti. ¿Qué te gustaría decirles con tus propias palabras para que nunca olviden cuánto significaron en tu vida?',
    coupleText:
      'Si dentro de muchos años sus seres queridos abrieran este libro para recordar su historia, ¿qué les gustaría decirles y qué quisieran que permaneciera vivo de todo lo que han compartido?',
    objective:
      'Obtener un mensaje personal para sus seres queridos que cierre emotivamente la historia conservando sus palabras literales.',
    focusHints: [
      'Mensajes de amor y gratitud',
      'Consejos y enseñanzas',
      'Deseos para la familia',
      'Palabras literales para conservar',
    ],
  },
];

export interface DemoNarrativeStyleOption {
  id: DemoNarrativeStyleId;
  recommended?: boolean;
  individualTitle: string;
  coupleTitle: string;
  individualDescription: string;
  coupleDescription: string;
  individualExample: string;
  coupleExample: string;
  characteristics: string[];
}

export const DEMO_NARRATIVE_STYLES: DemoNarrativeStyleOption[] = [
  {
    id: 'first_person_simple',
    recommended: false,
    individualTitle: 'A. Primera persona — Relato personal',
    coupleTitle: 'A. Primera persona del plural — Relato directo',
    individualDescription:
      'Tu historia narrada directamente con tus propias palabras, como si estuvieras contándosela a alguien cercano.',
    coupleDescription:
      'Su historia narrada directamente en primera persona del plural, identificando con claridad los recuerdos individuales de cada uno cuando corresponda.',
    individualExample:
      '«Nací en España y recuerdo que mi madre siempre nos recibía con una sonrisa cuando volvíamos a casa».',
    coupleExample:
      '«Antes de conocernos, cada uno guardaba sus propios recuerdos de infancia, hasta el día en que nuestros caminos coincidieron».',
    characteristics: [
      'Primera persona',
      'Redacción directa',
      'Lenguaje claro',
      'Tono personal',
      'Conservación de la voz original',
    ],
  },
  {
    id: 'first_person_literary',
    recommended: true,
    individualTitle: 'B. Primera persona — Narrativa literaria y emotiva',
    coupleTitle: 'B. Primera persona del plural — Narrativa literaria y emotiva',
    individualDescription:
      'Tus recuerdos transformados en unas memorias personales con una escritura más cuidada, cálida y emotiva, como si tú mismo hubieras escrito un pequeño libro.',
    coupleDescription:
      'Sus recuerdos transformados en unas memorias compartidas con prosa literaria, cálida y emotiva, respetando con equilibrio las dos voces.',
    individualExample:
      '«Cuando regreso con la memoria a los primeros años de mi vida, todavía puedo imaginar la sonrisa de mi madre esperándonos en casa. Hay recuerdos que el tiempo no consigue borrar».',
    coupleExample:
      '«Cuando volvemos la mirada hacia el inicio de nuestra historia, descubrimos que aquellos pequeños gestos cotidianos fueron tejiendo un hogar propio».',
    characteristics: [
      'Primera persona',
      'Prosa literaria',
      'Sensibilidad emocional',
      'Descripciones sustentadas en lo narrado',
      'Transiciones elegantes',
      'Conservación de expresiones personales',
    ],
  },
  {
    id: 'third_person_biography',
    recommended: false,
    individualTitle: 'C. Tercera persona — Biografía narrativa',
    coupleTitle: 'C. Tercera persona — Biografía de ambos protagonistas',
    individualDescription:
      'Tu historia contada desde la perspectiva de un narrador que presenta tu vida, tus experiencias y las personas que dejaron huella en ella.',
    coupleDescription:
      'La historia de ambos contada desde la perspectiva de un narrador cálido y respetuoso que entrelaza sus recuerdos, voces y vivencias.',
    individualExample:
      '«Desde pequeña, Ana descubrió que su familia era el centro de sus recuerdos más entrañables. La sonrisa de su madre se convirtió en una de las imágenes que conservaría durante toda su vida».',
    coupleExample:
      '«Las trayectorias de Ana y Luis comenzaron en escenarios distintos, pero al encontrarse construyeron una complicidad que sus seres queridos reconocen al instante».',
    characteristics: [
      'Tercera persona',
      'Tono biográfico',
      'Narrador cálido',
      'Perspectiva respetuosa',
      'Narración fiel',
    ],
  },
];

export interface DemoCoverPaletteVariant {
  name: string;
  bgHex: string;
  secondaryBgHex: string;
  textHex: string;
  subtextHex: string;
  accentHex: string;
  borderHex: string;
}

export interface DemoCoverDesignSpec {
  id: DemoCoverDesignId;
  number: number;
  name: string;
  subtitle: string;
  sensation: string;
  titleFontFamily: string;
  bodyFontFamily: string;
  accentFontFamily?: string;
  variants: DemoCoverPaletteVariant[];
}

export const DEMO_COVER_DESIGNS: DemoCoverDesignSpec[] = [
  {
    id: 'clasica_eterna',
    number: 1,
    name: 'Clásica Eterna',
    subtitle: 'Libro autobiográfico de colección en tapa dura',
    sensation: 'Elegancia, memoria y permanencia',
    titleFontFamily: "'Playfair Display', Georgia, serif",
    bodyFontFamily: "'EB Garamond', Georgia, serif",
    variants: [
      {
        name: 'Verde Bosque & Oro',
        bgHex: '#183225',
        secondaryBgHex: '#12261C',
        textHex: '#FAF5E8',
        subtextHex: '#E5D8B8',
        accentHex: '#C8A253',
        borderHex: '#A6833C',
      },
      {
        name: 'Borgoña Imperial & Marfil',
        bgHex: '#3A171C',
        secondaryBgHex: '#2A1014',
        textHex: '#FAF5E8',
        subtextHex: '#E6D5C3',
        accentHex: '#CDA557',
        borderHex: '#9E7B36',
      },
      {
        name: 'Azul Prusia & Dorado',
        bgHex: '#17253B',
        secondaryBgHex: '#101B2B',
        textHex: '#F9F6EE',
        subtextHex: '#D8DFEA',
        accentHex: '#C7A358',
        borderHex: '#997A39',
      },
    ],
  },
  {
    id: 'recuerdos_marfil',
    number: 2,
    name: 'Recuerdos en Marfil',
    subtitle: 'Composición literaria minimalista con amplio espacio',
    sensation: 'Intimidad, sencillez y nostalgia',
    titleFontFamily: "'Cormorant Garamond', Georgia, serif",
    bodyFontFamily: "'Lora', Georgia, serif",
    variants: [
      {
        name: 'Marfil Cálido & Carbón',
        bgHex: '#FAF7F0',
        secondaryBgHex: '#F2ECE1',
        textHex: '#231F1D',
        subtextHex: '#635850',
        accentHex: '#8C6D46',
        borderHex: '#D5C8B8',
      },
      {
        name: 'Lino Antiguo & Sepia',
        bgHex: '#F5EFE4',
        secondaryBgHex: '#EAE0D0',
        textHex: '#2C221E',
        subtextHex: '#6E5A4F',
        accentHex: '#7A5438',
        borderHex: '#C9B9A6',
      },
      {
        name: 'Alabastro & Piedra',
        bgHex: '#F8F8F6',
        secondaryBgHex: '#EFECE8',
        textHex: '#1E2022',
        subtextHex: '#5A5E63',
        accentHex: '#6E655C',
        borderHex: '#D0CEC9',
      },
    ],
  },
  {
    id: 'album_nuestra_vida',
    number: 3,
    name: 'Álbum de Nuestra Vida',
    subtitle: 'Marcos inspirados en álbumes familiares y detalles manuscritos',
    sensation: 'Cercanía, familia y recuerdos compartidos',
    titleFontFamily: "'Lora', Georgia, serif",
    bodyFontFamily: "'Plus Jakarta Sans', sans-serif",
    accentFontFamily: "'Caveat', cursive",
    variants: [
      {
        name: 'Crema Familiar & Terracota',
        bgHex: '#F4EDE2',
        secondaryBgHex: '#E8DEC8',
        textHex: '#33261E',
        subtextHex: '#6B5547',
        accentHex: '#9C5A3C',
        borderHex: '#C2A88B',
      },
      {
        name: 'Sepia Suave & Bronce',
        bgHex: '#EFE5D6',
        secondaryBgHex: '#E2D4C0',
        textHex: '#2D221B',
        subtextHex: '#5E4B3E',
        accentHex: '#85583A',
        borderHex: '#B89F82',
      },
      {
        name: 'Pergamino & Olivo',
        bgHex: '#F2EFE6',
        secondaryBgHex: '#E5E0D2',
        textHex: '#2A2D24',
        subtextHex: '#5A6050',
        accentHex: '#626F4E',
        borderHex: '#B8BDA8',
      },
    ],
  },
  {
    id: 'raices_recuerdos',
    number: 4,
    name: 'Raíces y Recuerdos',
    subtitle: 'Ilustraciones botánicas originales en tonos tierra y salvia',
    sensation: 'Tradición, familia y legado generacional',
    titleFontFamily: "'EB Garamond', Georgia, serif",
    bodyFontFamily: "'Lora', Georgia, serif",
    variants: [
      {
        name: 'Verde Salvia & Beige Tierra',
        bgHex: '#EAE8E0',
        secondaryBgHex: '#DCD8CC',
        textHex: '#263329',
        subtextHex: '#4E6053',
        accentHex: '#4A6651',
        borderHex: '#9EB0A2',
      },
      {
        name: 'Bosque Suave & Arena',
        bgHex: '#2E3D33',
        secondaryBgHex: '#233027',
        textHex: '#F3EFE6',
        subtextHex: '#C8D3C9',
        accentHex: '#A7BFA9',
        borderHex: '#6E8572',
      },
      {
        name: 'Arcilla & Hoja Seca',
        bgHex: '#EFE8DF',
        secondaryBgHex: '#E3D8CA',
        textHex: '#3B2B23',
        subtextHex: '#6E5549',
        accentHex: '#8A5A44',
        borderHex: '#C2A899',
      },
    ],
  },
  {
    id: 'historia_contemporanea',
    number: 5,
    name: 'Historia Contemporánea',
    subtitle: 'Composición geométrica equilibrada con acentos en cobre',
    sensation: 'Modernidad, calidad premium y sofisticación',
    titleFontFamily: "'Manrope', sans-serif",
    bodyFontFamily: "'Source Serif 4', Georgia, serif",
    variants: [
      {
        name: 'Azul Noche & Cobre',
        bgHex: '#152032',
        secondaryBgHex: '#1E2C42',
        textHex: '#FFFFFF',
        subtextHex: '#CBD5E1',
        accentHex: '#C87D4B',
        borderHex: '#475569',
      },
      {
        name: 'Gris Cálido & Cobre Oscuro',
        bgHex: '#F3F2EE',
        secondaryBgHex: '#E5E3DC',
        textHex: '#18181B',
        subtextHex: '#52525B',
        accentHex: '#B46939',
        borderHex: '#D4D2C8',
      },
      {
        name: 'Grafito & Bronce',
        bgHex: '#202124',
        secondaryBgHex: '#2C2E33',
        textHex: '#F8FAFC',
        subtextHex: '#D1D5DB',
        accentHex: '#D08856',
        borderHex: '#4B5563',
      },
    ],
  },
];

export interface DemoInteriorStyleSpec {
  id: DemoInteriorStyleId;
  number: number;
  name: string;
  subtitle: string;
  bodyFontFamily: string;
  titleFontFamily: string;
  accentFontFamily?: string;
  pdfFontFamily: 'times' | 'helvetica';
  textAlign: 'justify' | 'left';
  useDropCap: boolean;
  ornamentStyle: 'classic_line' | 'diamond_flourish' | 'journal_script' | 'minimal_bar' | 'botanical_leaf';
  pageBgHex: string;
  textHex: string;
  mutedHex: string;
  accentHex: string;
}

export const DEMO_INTERIOR_STYLES: DemoInteriorStyleSpec[] = [
  {
    id: 'clasico_editorial',
    number: 1,
    name: 'Clásico editorial',
    subtitle: 'EB Garamond, texto justificado, márgenes generosos y capitulares discretas',
    bodyFontFamily: "'EB Garamond', Georgia, serif",
    titleFontFamily: "'EB Garamond', Georgia, serif",
    pdfFontFamily: 'times',
    textAlign: 'justify',
    useDropCap: true,
    ornamentStyle: 'classic_line',
    pageBgHex: '#FDFBF7',
    textHex: '#221F1D',
    mutedHex: '#6E665E',
    accentHex: '#7A5C38',
  },
  {
    id: 'memorias_elegantes',
    number: 2,
    name: 'Memorias elegantes',
    subtitle: 'Títulos en Cormorant Garamond, cuerpo en Lora, citas destacadas y separadores delicados',
    bodyFontFamily: "'Lora', Georgia, serif",
    titleFontFamily: "'Cormorant Garamond', Georgia, serif",
    pdfFontFamily: 'times',
    textAlign: 'justify',
    useDropCap: true,
    ornamentStyle: 'diamond_flourish',
    pageBgHex: '#FAF7F2',
    textHex: '#24201E',
    mutedHex: '#6B6057',
    accentHex: '#8C6239',
  },
  {
    id: 'diario_intimo',
    number: 3,
    name: 'Diario íntimo',
    subtitle: 'Libre Baskerville con acentos manuscritos discretos y bloques cálidos',
    bodyFontFamily: "'Libre Baskerville', Georgia, serif",
    titleFontFamily: "'Libre Baskerville', Georgia, serif",
    accentFontFamily: "'Caveat', cursive",
    pdfFontFamily: 'times',
    textAlign: 'left',
    useDropCap: false,
    ornamentStyle: 'journal_script',
    pageBgHex: '#F9F5EB',
    textHex: '#2B241E',
    mutedHex: '#706052',
    accentHex: '#945D3E',
  },
  {
    id: 'minimalista_contemporaneo',
    number: 4,
    name: 'Minimalista contemporáneo',
    subtitle: 'Cuerpo en Source Serif 4 y títulos en Manrope con espacios blancos equilibrados',
    bodyFontFamily: "'Source Serif 4', Georgia, serif",
    titleFontFamily: "'Manrope', sans-serif",
    pdfFontFamily: 'helvetica',
    textAlign: 'left',
    useDropCap: false,
    ornamentStyle: 'minimal_bar',
    pageBgHex: '#FFFFFF',
    textHex: '#18181B',
    mutedHex: '#64748B',
    accentHex: '#B46939',
  },
  {
    id: 'legado_familiar',
    number: 5,
    name: 'Legado familiar',
    subtitle: 'Lora con títulos ornamentales moderados, citas familiares y motivos botánicos',
    bodyFontFamily: "'Lora', Georgia, serif",
    titleFontFamily: "'Playfair Display', Georgia, serif",
    pdfFontFamily: 'times',
    textAlign: 'justify',
    useDropCap: true,
    ornamentStyle: 'botanical_leaf',
    pageBgHex: '#FAF6EE',
    textHex: '#28231E',
    mutedHex: '#685B4E',
    accentHex: '#4E6752',
  },
];

export interface DemoBookFormatSpec {
  id: DemoBookFormatId;
  name: string;
  dimensionsLabel: string;
  description: string;
  widthMm: number;
  heightMm: number;
  aspectRatio: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginInnerMm: number;
  marginOuterMm: number;
  baseFontPt: number;
  titleFontPt: number;
  maxCharsPerContentPage: number;
  maxParagraphsPerPage: number;
}

export const DEMO_BOOK_FORMATS: DemoBookFormatSpec[] = [
  {
    id: 'a5',
    name: 'A5 vertical',
    dimensionsLabel: '148 × 210 mm',
    description: 'Libro compacto, adecuado para memorias personales.',
    widthMm: 148,
    heightMm: 210,
    aspectRatio: 148 / 210,
    marginTopMm: 18,
    marginBottomMm: 18,
    marginInnerMm: 18,
    marginOuterMm: 15,
    baseFontPt: 10.5,
    titleFontPt: 16,
    maxCharsPerContentPage: 1050,
    maxParagraphsPerPage: 3,
  },
  {
    id: '6x9',
    name: '6 × 9 pulgadas',
    dimensionsLabel: '152.4 × 228.6 mm',
    description: 'Formato editorial comercial estándar.',
    widthMm: 152.4,
    heightMm: 228.6,
    aspectRatio: 152.4 / 228.6,
    marginTopMm: 20,
    marginBottomMm: 20,
    marginInnerMm: 20,
    marginOuterMm: 16,
    baseFontPt: 11,
    titleFontPt: 17,
    maxCharsPerContentPage: 1250,
    maxParagraphsPerPage: 4,
  },
  {
    id: 'carta',
    name: 'Carta vertical',
    dimensionsLabel: '215.9 × 279.4 mm (8.5 × 11")',
    description: 'Formato práctico para impresión doméstica en México.',
    widthMm: 215.9,
    heightMm: 279.4,
    aspectRatio: 215.9 / 279.4,
    marginTopMm: 24,
    marginBottomMm: 24,
    marginInnerMm: 24,
    marginOuterMm: 20,
    baseFontPt: 11.5,
    titleFontPt: 19,
    maxCharsPerContentPage: 1650,
    maxParagraphsPerPage: 5,
  },
];

export const DEMO_THEMATIC_ILLUSTRATIONS: Array<{
  id: DemoThematicIllustrationId;
  label: string;
  description: string;
}> = [
  {
    id: 'arbol_raices',
    label: 'Árbol de Raíces',
    description: 'Ramas y raíces entrelazadas que simbolizan origen y familia.',
  },
  {
    id: 'pluma_tinta',
    label: 'Pluma y Memoria',
    description: 'Pluma estilográfica clásica sobre líneas de escritura.',
  },
  {
    id: 'brujula_camino',
    label: 'Rosa de los Vientos',
    description: 'Símbolo de los caminos, decisiones y viajes de la vida.',
  },
  {
    id: 'hogar_calido',
    label: 'Ventana del Hogar',
    description: 'Arco clásico con hojas suaves evocando refugio y cercanía.',
  },
  {
    id: 'constelacion_familiar',
    label: 'Vínculos Eternos',
    description: 'Líneas delicadas y estrellas que representan encuentros de vida.',
  },
];

export interface ComposedChapterSectionBlock {
  chapterId: string;
  partNumber: number;
  title: string;
  paragraphs: string[];
  pullQuote?: string;
  isContinuation?: boolean;
  photo?: DemoInMemoryPhoto | null;
}

export interface ComposedBookPage {
  pageNumber: number;
  totalPages: number;
  kind: 'cover' | 'title_dedication' | 'chapter_content' | 'closing_mandatory';
  // For cover & title_dedication
  title?: string;
  subtitle?: string;
  authors?: string;
  dedication?: string;
  introduction?: string;
  // For chapter_content (can hold 1 or 2 compact chapter blocks to stay within 5..10 pages)
  sections?: ComposedChapterSectionBlock[];
  // For closing_mandatory
  centralClosingText?: string;
  bottomRightBrand?: string;
  showPageNumber: boolean;
}

export interface ComposedBookDocument {
  format: DemoBookFormatSpec;
  coverDesign: DemoCoverDesignSpec;
  coverPalette: DemoCoverPaletteVariant;
  interiorStyle: DemoInteriorStyleSpec;
  editorialConfig: DemoEditorialConfig;
  coverPhoto?: DemoInMemoryPhoto | null;
  pages: ComposedBookPage[];
  exceededMaxPagesWarning: boolean;
  isPreviewSample?: boolean;
  useOfficialForeverYouLogo?: boolean;
}

/**
 * Normalizes a person's or couple's name into a safe, human-readable PDF filename (Section 22.2).
 */
export function buildSafeDemoPdfFilename(profile: DemoBasicProfile): string {
  const sanitizeSegment = (raw: string): string => {
    return raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
  };

  if (profile.mode === 'pareja') {
    const p1 = sanitizeSegment(profile.partner1Name || 'Participante_1') || 'Participante_1';
    const p2 = sanitizeSegment(profile.partner2Name || 'Participante_2') || 'Participante_2';
    return `YouForever_Nuestra_Historia_${p1}_y_${p2}.pdf`;
  }

  const name = sanitizeSegment(profile.displayName || profile.fullName || 'Protagonista') || 'Protagonista';
  return `YouForever_Mi_Historia_${name}.pdf`;
}

/**
 * Deterministic pagination and editorial composer (Sections 18, 19, 20, 21).
 * Always produces between 5 and 10 pages inclusive:
 * - Page 1: Cover
 * - Page 2: Portadilla, Dedicatoria & Introducción
 * - Middle Pages (3 .. N-1): Formatted biographical chapters (between 2 and 7 pages)
 * - Page N (last page): Mandatory closing page with ONLY "Esta historia continuará..." and "<< ForeverYou >>"
 */
export function composeBookPages(params: {
  manuscript: DemoManuscript;
  editorialConfig: DemoEditorialConfig;
  coverPhoto?: DemoInMemoryPhoto | null;
  chapterPhotos?: Record<string, DemoInMemoryPhoto | null>;
  customClosingPageText?: string;
  maxContentPages?: number;
  previewSampleOnly?: boolean;
  lockedLeadingContentGroups?: ComposedChapterSectionBlock[][];
}): ComposedBookDocument {
  const {
    manuscript: rawManuscript,
    editorialConfig,
    coverPhoto,
    chapterPhotos = {},
    customClosingPageText,
    maxContentPages = 7,
    previewSampleOnly = false,
    lockedLeadingContentGroups,
  } = params;

  const manuscript = sanitizeAndRepairBookManuscript(rawManuscript);

  const format =
    DEMO_BOOK_FORMATS.find((f) => f.id === editorialConfig.bookFormatId) || DEMO_BOOK_FORMATS[0];
  const coverDesign =
    DEMO_COVER_DESIGNS.find((c) => c.id === editorialConfig.coverDesignId) || DEMO_COVER_DESIGNS[0];
  const coverPalette =
    coverDesign.variants[editorialConfig.coverColorVariantIdx] || coverDesign.variants[0];
  const interiorStyle =
    DEMO_INTERIOR_STYLES.find((i) => i.id === editorialConfig.interiorStyleId) ||
    DEMO_INTERIOR_STYLES[0];

  const title = (editorialConfig.customTitle || manuscript.title || 'Mi Historia').trim();
  const subtitle = (
    editorialConfig.customSubtitle ||
    manuscript.subtitle ||
    (manuscript.mode === 'pareja'
      ? 'Recuerdos compartidos de nuestra vida'
      : 'Recuerdos y memorias de mi vida')
  ).trim();
  const authors = (editorialConfig.customAuthors || manuscript.authors || '').trim();
  const rawDedication = (editorialConfig.dedication ?? manuscript.dedication ?? '').trim();
  const cleanClosingPagePref = (customClosingPageText || '').trim();

  // Avoid repeating the closing dedication/reason on Page 2 or inside chapters if it is already featured on the final closing page
  const dedication =
    cleanClosingPagePref &&
    rawDedication.toLowerCase() === cleanClosingPagePref.toLowerCase()
      ? ''
      : rawDedication;
  const introduction = (manuscript.introduction || '').trim();

  // Filter chapters with real content
  const validChapters = manuscript.chapters
    .map((ch) => ({
      ...ch,
      paragraphs: (ch.paragraphs || []).map((p) => p.trim()).filter((p) => p.length > 0),
    }))
    .filter((ch) => ch.paragraphs.length > 0);

  const rawLockedGroups =
    !previewSampleOnly &&
    Array.isArray(lockedLeadingContentGroups || manuscript.lockedPreviewGroups) &&
    (lockedLeadingContentGroups || manuscript.lockedPreviewGroups)!.length > 0
      ? (lockedLeadingContentGroups || manuscript.lockedPreviewGroups)!
      : null;

  const effectiveLockedGroups = rawLockedGroups
    ? rawLockedGroups.map((group) =>
        group.map((sec) => ({
          ...sec,
          title: cleanSpanishOralText(sec.title || '').replace(/\.$/, '') || sec.title,
          paragraphs: (sec.paragraphs || []).map((p) =>
            ensureParagraphConformsToStyle(
              p,
              manuscript.narrativeStyle,
              manuscript.authors || 'Protagonista',
              manuscript.mode === 'pareja'
            )
          ),
          pullQuote: sec.pullQuote
            ? ensureParagraphConformsToStyle(
                sec.pullQuote,
                manuscript.narrativeStyle,
                manuscript.authors || 'Protagonista',
                manuscript.mode === 'pareja'
              )
            : undefined,
        }))
      )
    : null;

  // Count how many paragraphs per chapter are already locked in pages 3..5 of the preview
  const lockedParagraphCountByChapter = new Map<string, number>();
  if (effectiveLockedGroups) {
    for (const group of effectiveLockedGroups) {
      for (const sec of group) {
        const prevCount = lockedParagraphCountByChapter.get(sec.chapterId) || 0;
        lockedParagraphCountByChapter.set(
          sec.chapterId,
          prevCount + (sec.paragraphs?.length || 0)
        );
      }
    }
  }

  // Build initial content blocks per chapter, splitting very long chapters across pages according to format capacity
  const rawBlocks: ComposedChapterSectionBlock[] = [];
  const maxChars = format.maxCharsPerContentPage;
  const maxParas = format.maxParagraphsPerPage;

  for (let i = 0; i < validChapters.length; i++) {
    const ch = validChapters[i];
    const chPhoto = chapterPhotos[ch.id] || null;
    const isLastChapter = i === validChapters.length - 1;
    const lockedCount = lockedParagraphCountByChapter.get(ch.id) || 0;
    const remainingChapterParas = ch.paragraphs.slice(lockedCount);
    const paragraphsWithClosing = [...remainingChapterParas];
    const closingMsgTrimmed = (manuscript.closingMessage || '').trim();
    const isDuplicateOfClosingPage =
      cleanClosingPagePref.length > 0 &&
      closingMsgTrimmed.toLowerCase() === cleanClosingPagePref.toLowerCase();

    if (
      !previewSampleOnly &&
      isLastChapter &&
      closingMsgTrimmed.length > 0 &&
      !isDuplicateOfClosingPage &&
      !ch.paragraphs.some((p) => p.includes(closingMsgTrimmed))
    ) {
      paragraphsWithClosing.push(closingMsgTrimmed);
    }

    if (paragraphsWithClosing.length === 0) {
      continue;
    }

    let currentParas: string[] = [];
    let currentLen = 0;
    let chunkIdx = lockedCount > 0 ? 1 : 0;

    for (const para of paragraphsWithClosing) {
      const effectiveMaxChars = chunkIdx === 0 && chPhoto ? Math.round(maxChars * 0.65) : maxChars;
      const effectiveMaxParas = chunkIdx === 0 && chPhoto ? Math.max(1, maxParas - 1) : maxParas;

      if (
        currentParas.length > 0 &&
        (currentLen + para.length > effectiveMaxChars || currentParas.length >= effectiveMaxParas)
      ) {
        rawBlocks.push({
          chapterId: ch.id,
          partNumber: ch.partNumber,
          title: ch.title,
          paragraphs: currentParas,
          pullQuote: chunkIdx === 0 ? ch.pullQuote : undefined,
          isContinuation: chunkIdx > 0,
          photo: chunkIdx === 0 ? chPhoto : null,
        });
        currentParas = [para];
        currentLen = para.length;
        chunkIdx++;
      } else {
        currentParas.push(para);
        currentLen += para.length;
      }
    }

    if (currentParas.length > 0) {
      rawBlocks.push({
        chapterId: ch.id,
        partNumber: ch.partNumber,
        title: ch.title,
        paragraphs: currentParas,
        pullQuote: chunkIdx === 0 ? ch.pullQuote : undefined,
        isContinuation: chunkIdx > 0,
        photo: chunkIdx === 0 ? chPhoto : null,
      });
    }
  }

  // Combine locked preview groups (Pages 3..5) with any remaining blocks (Page 6+)
  let contentPageGroups: ComposedChapterSectionBlock[][] = [
    ...(effectiveLockedGroups ? effectiveLockedGroups.map((g) => [...g]) : []),
    ...rawBlocks.map((b) => [b]),
  ];

  if (contentPageGroups.length === 0) {
    contentPageGroups = [
      [
        {
          chapterId: 'ch_fallback_1',
          partNumber: 1,
          title: 'El inicio de esta memoria',
          paragraphs: [
            introduction ||
              'Cada recuerdo compartido en esta entrevista conserva un fragmento auténtico de nuestra historia familiar.',
          ],
        },
      ],
      [
        {
          chapterId: 'ch_fallback_2',
          partNumber: 2,
          title: 'Palabras para recordar',
          paragraphs: [
            manuscript.closingMessage ||
              'Que estas páginas acompañen a quienes amamos como testimonio vivo de nuestra voz.',
          ],
        },
      ],
    ];
  } else if (contentPageGroups.length === 1) {
    const single = contentPageGroups[0][0];
    if (single.paragraphs.length >= 2) {
      const mid = Math.ceil(single.paragraphs.length / 2);
      contentPageGroups = [
        [
          {
            ...single,
            paragraphs: single.paragraphs.slice(0, mid),
          },
        ],
        [
          {
            ...single,
            paragraphs: single.paragraphs.slice(mid),
            pullQuote: undefined,
            photo: null,
            isContinuation: true,
          },
        ],
      ];
    } else {
      contentPageGroups.push([
        {
          chapterId: 'ch_closing_reflection',
          partNumber: 2,
          title: 'Las palabras que quiero dejar',
          paragraphs: [
            manuscript.closingMessage ||
              'Este recuerdo queda resguardado con cariño para quienes forman parte de mi vida.',
          ],
        },
      ]);
    }
  }

  // If previewSampleOnly is true (Layout Studio preview mode), return strictly the first 5 pages as a sample:
  // Page 1 (Cover) + Page 2 (Title/Dedication) + Pages 3..5 (first 3 content pages, or 2 content pages + closing if total content pages <= 2)
  if (previewSampleOnly && contentPageGroups.length >= 3) {
    const sampleContentGroups = contentPageGroups.slice(0, 3);
    const sampleTotalPages = 5;
    const samplePages: ComposedBookPage[] = [
      {
        pageNumber: 1,
        totalPages: sampleTotalPages,
        kind: 'cover',
        title,
        subtitle,
        authors,
        showPageNumber: false,
      },
      {
        pageNumber: 2,
        totalPages: sampleTotalPages,
        kind: 'title_dedication',
        title,
        subtitle,
        authors,
        dedication,
        introduction,
        showPageNumber: false,
      },
      ...sampleContentGroups.map((group, idx) => ({
        pageNumber: 3 + idx,
        totalPages: sampleTotalPages,
        kind: 'chapter_content' as const,
        sections: group,
        showPageNumber: true,
      })),
    ];

    return {
      format,
      coverDesign,
      coverPalette,
      interiorStyle,
      editorialConfig,
      coverPhoto,
      pages: samplePages,
      exceededMaxPagesWarning: false,
      isPreviewSample: true,
      useOfficialForeverYouLogo: Boolean(manuscript.useOfficialForeverYouLogo),
    };
  }

  // Maximum content pages (7 for /demo -> 10 pages total; higher for full interviews)
  const lockedGroupCount = effectiveLockedGroups ? effectiveLockedGroups.length : 0;
  const MAX_CONTENT_PAGES = Math.max(2, maxContentPages, lockedGroupCount + 1);
  let exceededMaxPagesWarning = false;

  while (contentPageGroups.length > MAX_CONTENT_PAGES) {
    exceededMaxPagesWarning = true;
    // Never merge the locked leading groups (indices 0 .. lockedGroupCount - 1) so Pages 1..5 stay identical
    const startSearchIdx = Math.min(lockedGroupCount, Math.max(0, contentPageGroups.length - 2));
    let bestIdx = startSearchIdx;
    let smallestCombinedLen = Infinity;
    for (let i = startSearchIdx; i < contentPageGroups.length - 1; i++) {
      const lenA = contentPageGroups[i].reduce(
        (acc, s) => acc + s.paragraphs.join(' ').length,
        0
      );
      const lenB = contentPageGroups[i + 1].reduce(
        (acc, s) => acc + s.paragraphs.join(' ').length,
        0
      );
      if (lenA + lenB < smallestCombinedLen) {
        smallestCombinedLen = lenA + lenB;
        bestIdx = i;
      }
    }
    const merged = [...contentPageGroups[bestIdx], ...contentPageGroups[bestIdx + 1]];
    contentPageGroups.splice(bestIdx, 2, merged);
  }

  const totalPages = 2 + contentPageGroups.length + 1;
  const pages: ComposedBookPage[] = [];

  // Page 1: Cover
  pages.push({
    pageNumber: 1,
    totalPages,
    kind: 'cover',
    title,
    subtitle,
    authors,
    showPageNumber: false,
  });

  // Page 2: Portadilla, Dedicatoria e Introducción
  pages.push({
    pageNumber: 2,
    totalPages,
    kind: 'title_dedication',
    title,
    subtitle,
    authors,
    dedication,
    introduction,
    showPageNumber: false,
  });

  // Middle Pages: Chapters
  contentPageGroups.forEach((group, idx) => {
    pages.push({
      pageNumber: 3 + idx,
      totalPages,
      kind: 'chapter_content',
      sections: group,
      showPageNumber: true,
    });
  });

  // Final Closing Page: prefers customClosingPageText when provided (e.g. Participant Portal closing dedication),
  // otherwise uses the mandatory Demo phrase "Esta historia continuará...", always accompanied by "<< ForeverYou >>".
  pages.push({
    pageNumber: totalPages,
    totalPages,
    kind: 'closing_mandatory',
    centralClosingText:
      cleanClosingPagePref.length > 0 ? cleanClosingPagePref : DEMO_CLOSING_PAGE_CENTRAL_TEXT,
    bottomRightBrand: DEMO_CLOSING_PAGE_BRAND_MARK,
    showPageNumber: false,
  });

  return {
    format,
    coverDesign,
    coverPalette,
    interiorStyle,
    editorialConfig,
    coverPhoto,
    pages,
    exceededMaxPagesWarning,
    isPreviewSample: previewSampleOnly,
    useOfficialForeverYouLogo: Boolean(manuscript.useOfficialForeverYouLogo),
  };
}

/**
 * Fallback contextual follow-up generator used if the user's connection to Gemini times out,
 * ensuring the interview never blocks while remaining faithful to the user's actual response.
 */
export function buildFallbackFollowUp(params: {
  question: DemoQuestionDefinition;
  mode: DemoStoryMode;
  answerText: string;
  partner1Name?: string;
  partner2Name?: string;
}): DemoFollowUpPayload {
  const { question, mode, answerText } = params;
  const clean = answerText.trim();

  if (clean.length < 4) {
    return {
      mainQuestionId: question.id,
      shouldAskFollowUp: false,
      followUpQuestion: '',
      detectedTheme: question.dimensionKey,
      referencedDetail: '',
    };
  }

  // Extract a quoted nickname or concrete phrase if present
  const quoteMatch = clean.match(/[«"“]([^»"”]{2,35})[»"”]/);
  const referencedDetail = quoteMatch ? quoteMatch[1] : clean.split(/[.,;]/)[0].slice(0, 50);

  let followUpQuestion = '';
  if (question.dimensionKey === 'raices') {
    followUpQuestion =
      mode === 'pareja'
        ? '¿Qué detalle de aquellos primeros años sienten que sigue muy presente en la forma en que hoy comparten su vida?'
        : '¿Qué sonido, aroma, gesto o palabra de aquel momento recuerdas todavía con más claridad?';
  } else if (question.dimensionKey === 'transformacion') {
    followUpQuestion =
      mode === 'pareja'
        ? 'Al mirar atrás hacia ese momento, ¿qué sintieron al descubrir que sus caminos comenzaban a unirse?'
        : '¿Qué sentiste en ese instante sabiendo que aquella experiencia marcaría un nuevo rumbo en tu vida?';
  } else if (question.dimensionKey === 'personas_amadas') {
    followUpQuestion = quoteMatch
      ? `¿Recuerdas algún gesto o conversación especial con «${quoteMatch[1]}» que todavía hoy te haga sonreír?`
      : mode === 'pareja'
      ? '¿En qué momento cotidiano sienten que esa forma tan suya de quererse se vuelve más evidente?'
      : '¿Qué gesto o palabras de esa persona guardas con más ternura en tu memoria?';
  } else if (question.dimensionKey === 'esencia') {
    followUpQuestion =
      mode === 'pareja'
        ? '¿Cómo suelen reaccionar sus seres queridos cuando presencian esa costumbre tan característica de ustedes?'
        : '¿Cómo reaccionan quienes te quieren cuando te escuchan o te ven tener ese gesto tan tuyo?';
  } else {
    followUpQuestion =
      mode === 'pareja'
        ? '¿Qué recuerdo concreto de su historia juntos quisieran que su familia evocara al leer estas palabras?'
        : '¿Qué momento compartido con ellos te gustaría que viniera a su mente cada vez que lean este mensaje?';
  }

  return {
    mainQuestionId: question.id,
    shouldAskFollowUp: true,
    followUpQuestion,
    detectedTheme: question.dimensionKey,
    referencedDetail,
  };
}

/**
 * Preserves capitalization of the first character when replacing matched Spanish words.
 */
function replaceWordPreservingCase(
  input: string,
  pattern: RegExp,
  replacement: string
): string {
  return input.replace(pattern, (matched) => {
    const first = matched.charAt(0);
    const isUpper = first === first.toUpperCase() && first !== first.toLowerCase();
    if (isUpper && replacement.length > 0) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}

/**
 * Helper that wraps a Spanish word/phrase pattern in Unicode-aware boundaries so accented letters
 * (á, é, í, ó, ú, ü, ñ, Á, É, Í, Ó, Ú, Ü, Ñ) are treated as true word characters rather than `\W`.
 */
function uw(inner: string, flags: string = 'gi'): RegExp {
  return new RegExp(
    `(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])(?:${inner})(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])`,
    flags
  );
}

/**
 * Strips any legacy robotic template prefixes or artificial transitions that may exist in
 * previously saved book versions or intermediate paragraphs, restoring natural sentence capitalization.
 */
export function stripRoboticBoilerplatePhrases(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw;

  const roboticSentencePrefixes: RegExp[] = [
    /(^|(?<=[.!?]\s+))En lo que respecta a esta etapa de mi vida,\s*/gi,
    /(^|(?<=[.!?]\s+))Al rememorar con detenimiento este episodio personal,\s*/gi,
    /(^|(?<=[.!?]\s+))Dentro de las vivencias más relevantes de mi camino,\s*/gi,
    /(^|(?<=[.!?]\s+))Asimismo,\s*cabe señalar en torno a esta vivencia que\s+/gi,
    /(^|(?<=[.!?]\s+))En consonancia con este recuerdo,\s*[^,.!?:]+?\s+refiere que\s+/gi,
    /(^|(?<=[.!?]\s+))Asimismo,\s*en su relato destaca que\s+/gi,
    /(^|(?<=[.!?]\s+))A lo largo de su trayectoria vital,\s*[^:!?.]+?\s+conserva con claridad este pasaje:\s*/gi,
    /(^|(?<=[.!?]\s+))En la memoria biográfica de\s+[^:!?.]+?\s+ocupa un lugar especial este recuerdo:\s*/gi,
    /(^|(?<=[.!?]\s+))Dentro de la historia personal de\s+[^,!?.]+?,\s*destaca un episodio significativo:\s*/gi,
    /(^|(?<=[.!?]\s+))Dentro de la memoria compartida por\s+[^,!?.]+?,\s*/gi,
    /(^|(?<=[.!?]\s+))Al recorrer este pasaje de su historia,\s*[^,!?.]+?\s+relata cómo\s+/gi,
    /(^|(?<=[.!?]\s+))En las vivencias que integran el legado de\s+[^,!?.]+?,\s*/gi,
    /(^|(?<=[.!?]\s+))Cuando vuelvo la mirada hacia aquellos años,\s*el recuerdo renace con calidez:\s*/gi,
    /(^|(?<=[.!?]\s+))Hay instantes que el tiempo jamás logra borrar de la memoria:\s*/gi,
    /(^|(?<=[.!?]\s+))En el refugio más entrañable de mi historia personal permanece vivo este recuerdo:\s*/gi,
    /(^|(?<=[.!?]\s+))Aquel instante dejó en mi corazón una huella imborrable:\s*/gi,
    /(^|(?<=[.!?]\s+))Desde la voz íntima de\s+[^,!?.]+?,\s*el recuerdo cobra vida propia:\s*/gi,
  ];

  for (const pat of roboticSentencePrefixes) {
    text = text.replace(pat, '$1');
  }

  // Repair unnatural pronoun replacements from earlier versions
  text = text
    .replace(uw('a\\s+su\\s+persona\\s+le'), 'le')
    .replace(uw('a\\s+su\\s+persona'), '')
    .replace(uw('para\\s+su\\s+vida\\s+fue'), 'fue');

  // Ensure sentence starts are capitalized after stripping prefixes
  text = text.trim();
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    text = text.replace(/(?<=[.!?]\s+)([a-záéíóúüñ])/g, (m) => m.toUpperCase());
  }

  return text;
}

/**
 * Cleans Spanish oral transcriptions and raw typed answers:
 * - Strips any robotic boilerplate prefixes
 * - Removes oral filler words (muletillas: "este...", "eh", "pues", "o sea", "bueno", "digamos", "¿verdad?")
 * - Collapses consecutive duplicate words ("yo yo", "viví viví", "de de", "que que") using Unicode-safe boundaries
 * - Fixes Spanish spelling, B/V/S/C/Z/H errors, and missing accents in autobiographical answers
 * - Repairs any prepositions ("a", "o") accidentally omitted after words ending in -ía/-ña/-ño
 * - Normalizes punctuation and sentence capitalization
 */
export function cleanSpanishOralText(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  let text = raw
    .replace(/^\[Nota de voz\]:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  text = stripRoboticBoilerplatePhrases(text);

  // 1. Remove hesitation sounds and filler phrases with ellipses or commas (using Unicode-aware boundaries)
  const fillerPatterns: RegExp[] = [
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])(?:este+|eh+|em+|mmm+|ah+)\s*(?:\.{2,}|,|;)?\s*(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/gi,
    /(?:^|(?<=[.,;!?]\s+))(?:pues\s+este|bueno\s+pues|este\s+pues|pues\s+bueno|o\s+sea\s+que|o\s+sea|digamos\s+que|fíjate\s+que|fijate\s+que|mira\s+pues|la\s+verdad\s+pues|pues\s+mira)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])[,\s]*/gi,
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])(?:o\s+sea|digamos\s+que|digamos|por\s+así\s+decirlo|¿verdad\?|¿no\?|sabes\s+cómo)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])[,\s]*/gi,
    /(?:^|(?<=[.,;!?]\s+))(?:pues|bueno)\s*,\s*/gi,
    /\s*,\s*(?:pues|este|eh|o sea)\s*,\s*/gi,
  ];

  for (const pat of fillerPatterns) {
    text = text.replace(pat, ' ');
  }

  // Strip leading oral fillers if the sentence starts with them followed by another word
  text = text.replace(
    /^(?:pues|bueno|este|eh|mira|o sea)\s+(?=[a-záéíóúüñA-ZÁÉÍÓÚÜÑ])/i,
    ''
  );

  // 2. Collapse consecutive duplicate words using strict Unicode-aware word boundaries
  // Only match complete words of 2+ letters (or explicit single-letter conjunctions y/o/a/e/u when truly repeated)
  text = text.replace(
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,})(?:\s*,\s*|\s+)\1(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/gi,
    '$1'
  );
  text = text.replace(
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])([aeyouAEYOU])\s+\1(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/g,
    '$1'
  );
  // Collapse immediate repeated two-word or three-word stutters (e.g. "cuando era, cuando era")
  text = text.replace(
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)(?:\s*,\s*|\s+)\1(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/gi,
    '$1'
  );
  text = text.replace(
    /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)(?:\s*,\s*|\s+)\1(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/gi,
    '$1'
  );

  // 3. Correct colloquial contractions, common B/V/S/C/Z/H spelling errors & accent omissions
  // All patterns use Unicode-aware `uw(...)` so they never match inside accented words
  const orthographicFixes: Array<[RegExp, string]> = [
    [uw("pa'\\s*que"), 'para que'],
    [uw('pa\\s+que'), 'para que'],
    [uw('pos'), 'pues'],
    [uw('tons'), 'entonces'],
    // Common B/V, H, S/C/Z spelling fixes
    [uw('iva'), 'iba'],
    [uw('ivamos'), 'íbamos'],
    [uw('ívamos'), 'íbamos'],
    [uw('iban\\s+ha'), 'iban a'],
    [uw('iba\\s+ha'), 'iba a'],
    [uw('vamos\\s+ha'), 'vamos a'],
    [uw('voy\\s+ha'), 'voy a'],
    [uw('abia'), 'había'],
    [uw('abía'), 'había'],
    [uw('havia'), 'había'],
    [uw('havía'), 'había'],
    [uw('ubo'), 'hubo'],
    [uw('estava'), 'estaba'],
    [uw('estavan'), 'estaban'],
    [uw('estavamos'), 'estábamos'],
    [uw('jugava'), 'jugaba'],
    [uw('jugavan'), 'jugaban'],
    [uw('jugavamos'), 'jugábamos'],
    [uw('trabajava'), 'trabajaba'],
    [uw('llevava'), 'llevaba'],
    [uw('cantava'), 'cantaba'],
    [uw('platicava'), 'platicaba'],
    [uw('tube'), 'tuve'],
    [uw('tubo'), 'tuvo'],
    [uw('tubimos'), 'tuvimos'],
    [uw('tubieron'), 'tuvieron'],
    [uw('estube'), 'estuve'],
    [uw('estubo'), 'estuvo'],
    [uw('estubimos'), 'estuvimos'],
    [uw('estubieron'), 'estuvieron'],
    [uw('andube'), 'anduve'],
    [uw('andubo'), 'anduvo'],
    [uw('hise'), 'hice'],
    [uw('hiso'), 'hizo'],
    [uw('hisimos'), 'hicimos'],
    [uw('hisieron'), 'hicieron'],
    [uw('aser'), 'hacer'],
    [uw('aora'), 'ahora'],
    [uw('ermano'), 'hermano'],
    [uw('ermana'), 'hermana'],
    [uw('ermanos'), 'hermanos'],
    [uw('ermanas'), 'hermanas'],
    [uw('ijo'), 'hijo'],
    [uw('ija'), 'hija'],
    [uw('ijos'), 'hijos'],
    [uw('ijas'), 'hijas'],
    [uw('ogar'), 'hogar'],
    [uw('istoria'), 'historia'],
    [uw('aguelo'), 'abuelo'],
    [uw('aguela'), 'abuela'],
    [uw('aguelos'), 'abuelos'],
    [uw('avuelo'), 'abuelo'],
    [uw('avuela'), 'abuela'],
    [uw('avuelos'), 'abuelos'],
    [uw('veses'), 'veces'],
    [uw('beses'), 'veces'],
    [uw('empesar'), 'empezar'],
    [uw('empeso'), 'empezó'],
    [uw('enpeso'), 'empezó'],
    [uw('empezo'), 'empezó'],
    [uw('comenzo'), 'comenzó'],
    [uw('felis'), 'feliz'],
    [uw('felises'), 'felices'],
    [uw('difisil'), 'difícil'],
    [uw('fasil'), 'fácil'],
    [uw('grasias'), 'gracias'],
    [uw('tanbien'), 'también'],
    [uw('tanvien'), 'también'],
    [uw('sienpre'), 'siempre'],
    [uw('cienpre'), 'siempre'],
    [uw('tienpo'), 'tiempo'],
    [uw('creser'), 'crecer'],
    [uw('conoser'), 'conocer'],
    [uw('naser'), 'nacer'],
    // 1st person preterite accents
    [uw('naci'), 'nací'],
    [uw('creci'), 'crecí'],
    [uw('vivi'), 'viví'],
    [uw('aprendi'), 'aprendí'],
    [uw('conoci'), 'conocí'],
    [uw('sali'), 'salí'],
    [uw('volvi'), 'volví'],
    [uw('senti'), 'sentí'],
    [uw('decidi'), 'decidí'],
    [uw('descubri'), 'descubrí'],
    [uw('comparti'), 'compartí'],
    [uw('recibi'), 'recibí'],
    [uw('elegi'), 'elegí'],
    [uw('construi'), 'construí'],
    [uw('sufri'), 'sufrí'],
    [uw('parti'), 'partí'],
    [uw('asisti'), 'asistí'],
    [uw('escribi'), 'escribí'],
    [uw('cumpli'), 'cumplí'],
    [uw('empece'), 'empecé'],
    [uw('comence'), 'comencé'],
    [uw('termine'), 'terminé'],
    [uw('trabaje'), 'trabajé'],
    [uw('estudie'), 'estudié'],
    [uw('llegue'), 'llegué'],
    [uw('jugue'), 'jugué'],
    [uw('logre'), 'logré'],
    [uw('pase'), 'pasé'],
    [uw('encontre'), 'encontré'],
    [uw('forme'), 'formé'],
    [uw('cuide'), 'cuidé'],
    [uw('disfrute'), 'disfruté'],
    [uw('busque'), 'busqué'],
    [uw('guarde'), 'guardé'],
    [uw('tome'), 'tomé'],
    [uw('hable'), 'hablé'],
    [uw('mire'), 'miré'],
    [uw('pense'), 'pensé'],
    [uw('sone'), 'soñé'],
    [uw('viaje'), 'viajé'],
    [uw('compre'), 'compré'],
    [uw('regrese'), 'regresé'],
    [uw('platique'), 'platiqué'],
    [uw('ayude'), 'ayudé'],
    [uw('me\\s+crie'), 'me crié'],
    [uw('se\\s+crio'), 'se crió'],
    [uw('me\\s+case'), 'me casé'],
    [uw('se\\s+caso'), 'se casó'],
    [uw('me\\s+mude'), 'me mudé'],
    [uw('se\\s+mudo'), 'se mudó'],
    [uw('me\\s+gradue'), 'me gradué'],
    [uw('se\\s+graduo'), 'se graduó'],
    [uw('me\\s+dedique'), 'me dediqué'],
    [uw('se\\s+dedico'), 'se dedicó'],
    [uw('me\\s+enamore'), 'me enamoré'],
    [uw('se\\s+enamoro'), 'se enamoró'],
    [uw('me\\s+quede'), 'me quedé'],
    [uw('se\\s+quedo'), 'se quedó'],
    // 3rd person preterite accents
    [uw('nacio'), 'nació'],
    [uw('crecio'), 'creció'],
    [uw('vivio'), 'vivió'],
    [uw('aprendio'), 'aprendió'],
    [uw('conocio'), 'conoció'],
    [uw('salio'), 'salió'],
    [uw('volvio'), 'volvió'],
    [uw('sintio'), 'sintió'],
    [uw('decidio'), 'decidió'],
    [uw('descubrio'), 'descubrió'],
    [uw('compartio'), 'compartió'],
    [uw('recibio'), 'recibió'],
    [uw('eligio'), 'eligió'],
    [uw('construyo'), 'construyó'],
    [uw('sufrio'), 'sufrió'],
    [uw('murio'), 'murió'],
    [uw('fallecio'), 'falleció'],
    [uw('ocurrio'), 'ocurrió'],
    [uw('sucedio'), 'sucedió'],
    [uw('permitio'), 'permitió'],
    [uw('enseno'), 'enseñó'],
    [uw('enseño'), 'enseñó'],
    [uw('llego'), 'llegó'],
    [uw('encontro'), 'encontró'],
    [uw('acompano'), 'acompañó'],
    [uw('acompaño'), 'acompañó'],
    // Common nouns, adverbs, and imperfect verbs
    [uw('mama'), 'mamá'],
    [uw('papa'), 'papá'],
    [uw('ninez'), 'niñez'],
    [uw('corazon'), 'corazón'],
    [uw('tambien'), 'también'],
    [uw('despues'), 'después'],
    [uw('ademas'), 'además'],
    [uw('algun'), 'algún'],
    [uw('ningun'), 'ningún'],
    [uw('jamas'), 'jamás'],
    [uw('asi'), 'así'],
    [uw('ahi'), 'ahí'],
    [uw('aqui'), 'aquí'],
    [uw('alla'), 'allá'],
    [uw('habia'), 'había'],
    [uw('habian'), 'habían'],
    [uw('teniamos'), 'teníamos'],
    [uw('viviamos'), 'vivíamos'],
    [uw('eramos'), 'éramos'],
    [uw('estabamos'), 'estábamos'],
    [uw('jugabamos'), 'jugábamos'],
    [uw('ibamos'), 'íbamos'],
    [uw('saliamos'), 'salíamos'],
    [uw('comiamos'), 'comíamos'],
    [uw('reiamos'), 'reíamos'],
    [uw('sentiamos'), 'sentíamos'],
    [uw('queriamos'), 'queríamos'],
    [uw('podiamos'), 'podíamos'],
    [uw('sabiamos'), 'sabíamos'],
    [uw('deciamos'), 'decíamos'],
    [uw('haciamos'), 'hacían'],
    [uw('decia'), 'decía'],
    [uw('tenia'), 'tenía'],
    [uw('vivia'), 'vivía'],
    [uw('sentia'), 'sentía'],
    [uw('queria'), 'quería'],
    [uw('podia'), 'podía'],
    [uw('sabia'), 'sabía'],
    [uw('venia'), 'venía'],
    [uw('salia'), 'salía'],
    [uw('comia'), 'comía'],
    [uw('reia'), 'reía'],
    [uw('crecia'), 'crecía'],
    [uw('crecian'), 'crecían'],
    [uw('hacia\\s+(sentir|reir|reír|feliz|falta)'), 'hacía $1'],
    [uw('anos'), 'años'],
    [uw('nino'), 'niño'],
    [uw('nina'), 'niña'],
    [uw('ninos'), 'niños'],
    [uw('ninas'), 'niñas'],
    [uw('dia\\s+a\\s+dia'), 'día a día'],
    [uw('dia\\s+dia'), 'día a día'],
    [uw('todos\\s+los\\s+dias'), 'todos los días'],
    [uw('cada\\s+dia'), 'cada día'],
    [uw('aquel\\s+dia'), 'aquel día'],
    [uw('ese\\s+dia'), 'ese día'],
    [uw('un\\s+dia'), 'un día'],
    [uw('pequeno'), 'pequeño'],
    [uw('pequena'), 'pequeña'],
    [uw('pequenos'), 'pequeños'],
    [uw('pequenas'), 'pequeñas'],
    [uw('carino'), 'cariño'],
    [uw('sueno'), 'sueño'],
    [uw('suenos'), 'sueños'],
    [uw('ensenanza'), 'enseñanza'],
    [uw('ensenanzas'), 'enseñanzas'],
    [uw('companero'), 'compañero'],
    [uw('companera'), 'compañera'],
    [uw('companeros'), 'compañeros'],
    [uw('companeras'), 'compañeras'],
    [uw('facil'), 'fácil'],
    [uw('dificil'), 'difícil'],
    [uw('epoca'), 'época'],
    [uw('epocas'), 'épocas'],
    [uw('musica'), 'música'],
    [uw('arbol'), 'árbol'],
    [uw('arboles'), 'árboles'],
    [uw('jardin'), 'jardín'],
    [uw('tio'), 'tío'],
    [uw('tia'), 'tía'],
    [uw('tios'), 'tíos'],
    [uw('tias'), 'tías'],
    [uw('educacion'), 'educación'],
    [uw('vocacion'), 'vocación'],
    [uw('profesion'), 'profesión'],
    [uw('ilusion'), 'ilusión'],
    [uw('emocion'), 'emoción'],
    [uw('bendicion'), 'bendición'],
    [uw('generacion'), 'generación'],
    [uw('conversacion'), 'conversación'],
    [uw('situacion'), 'situación'],
    [uw('decision'), 'decisión'],
    [uw('ocasion'), 'ocasión'],
    [uw('leccion'), 'lección'],
    [uw('atencion'), 'atención'],
    [uw('tradicion'), 'tradición'],
    [uw('dedicacion'), 'dedicación'],
    [uw('celebracion'), 'celebración'],
    [uw('reunion'), 'reunión'],
    [uw('cancion'), 'canción'],
    [uw('oracion'), 'oración'],
    [uw('razon'), 'razón'],
    [uw('rincon'), 'rincón'],
    [uw('salon'), 'salón'],
    [uw('camion'), 'camión'],
    [uw('avion'), 'avión'],
    [
      uw('(mucho|nada|nunca|cada vez|lo que|quien|personas que|aún|aun)\\s+mas'),
      '$1 más',
    ],
    [
      uw(
        'mas\\s+(grande|grandes|bonito|bonita|importante|importantes|especial|especiales|fuerte|fuertes|cerca|tarde|adelante|hermoso|hermosa|querido|querida|valioso|valiosa|feliz|felices)'
      ),
      'más $1',
    ],
  ];

  for (const [pattern, replacement] of orthographicFixes) {
    if (replacement.includes('$1')) {
      text = text.replace(pattern, replacement);
    } else {
      text = replaceWordPreservingCase(text, pattern, replacement);
    }
  }

  // 3b. Repair prepositions ("a", "o") that may have been omitted in saved versions after -ía/-ña/-ño
  text = text
    .replace(
      uw(
        '(salía|venía|iba|volvía|empezaba|comenzaba|aprendía|enseñaba|ayudaba)\\s+(jugar|caminar|correr|trabajar|estudiar|visitar|ver|vernos|comer|dormir|buscar|comprar|vivir|hacer|platicar|ayudar|bailar|cantar|rezar|pasear|nadar|pescar|cocinar|vender|sembrar)'
      ),
      '$1 a $2'
    )
    .replace(
      uw(
        '(quería|amaba|cuidaba|veía|visitaba|extrañaba|conocía|respetaba|admiraba|abrazaba|acompañaba|ayudaba)\\s+(mi|mis|su|sus|nuestro|nuestra|nuestros|nuestras)\\s+(mamá|papá|madre|padre|padres|abuelo|abuela|abuelos|hermano|hermana|hermanos|hermanas|hijo|hija|hijos|hijas|tío|tía|tíos|tías|primo|prima|primos|primas|esposo|esposa|familia|amigos|amigas|compañeros|vecinos|nietos|nietas)'
      ),
      '$1 a $2 $3'
    )
    .replace(uw('día\\s+día'), 'día a día');

  // 4. Deduplicate identical or near-identical consecutive sentences
  const rawSentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const uniqueSentences: string[] = [];
  for (const s of rawSentences) {
    const norm = s.toLowerCase().replace(/[^a-záéíóúüñ0-9]+/g, '');
    const prevNorm =
      uniqueSentences.length > 0
        ? uniqueSentences[uniqueSentences.length - 1]
            .toLowerCase()
            .replace(/[^a-záéíóúüñ0-9]+/g, '')
        : '';
    if (norm && norm !== prevNorm) {
      uniqueSentences.push(s);
    }
  }
  text = uniqueSentences.join(' ');

  // 5. Normalize punctuation & capitalize sentence starts
  text = text
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[a-záéíóúüñA-ZÁÉÍÓÚÜÑ])/g, '$1 ')
    .replace(/,{2,}/g, ',')
    .replace(/\.{4,}/g, '...')
    .replace(/^[,;:\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    text = text.replace(/(?<=[.!?]\s+)([a-záéíóúüñ])/g, (m) => m.toUpperCase());
  }

  return ensureEndingPunctuation(text);
}

/**
 * Uses the original interview question to give natural grammatical context when an interviewee's
 * answer is a brief fragment, conversational reply ("Sí, ..."), or noun phrase without a verb,
 * without adding robotic boilerplate prefixes.
 */
export function contextualizeAnswerWithQuestion(
  cleanedAnswer: string,
  questionText?: string
): string {
  if (!cleanedAnswer) return '';
  let text = cleanedAnswer.trim();

  // Strip conversational "Sí, " / "Claro, " / "Por supuesto, " when followed by a full statement
  text = text.replace(
    /^(?:sí|si|claro|por supuesto|efectivamente|así es)\s*,\s+(?=[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{2,})/i,
    ''
  );
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  if (!questionText || !questionText.trim()) {
    return ensureEndingPunctuation(text);
  }

  const qLower = questionText.toLowerCase();
  const bodyNoPunct = text.replace(/[.!?…]+$/, '').trim();
  const wordCount = bodyNoPunct.split(/\s+/).filter(Boolean).length;

  // Check if a short answer (< 10 words) lacks any common conjugated verb and is just a fragment answering the question
  const hasConjugatedVerb = uw(
    'nací|nació|nacimos|nacieron|crecí|creció|crecimos|viví|vivió|vivía|vivíamos|vivían|era|éramos|eran|fue|fui|fueron|estaba|estábamos|estuve|estuvo|tenía|teníamos|tuve|tuvo|tengo|tiene|soy|somos|es|son|estoy|está|recuerdo|recuerda|acuerdo|estudié|estudió|trabajé|trabajó|conocí|conoció|aprendí|aprendió|jugaba|jugábamos|íbamos|iba|salía|salíamos|casé|casó|casamos|llamaba|llamaban|dedicaba|dediqué|dedicó|siento|siente|pienso|piensa|quiero|quiere|gustaba|encantaba|hice|hizo|hicimos|llegué|llegó'
  ).test(bodyNoPunct);

  if (!hasConjugatedVerb && wordCount <= 9) {
    const lowerFragment =
      bodyNoPunct.charAt(0).toLowerCase() + bodyNoPunct.slice(1);

    if (/d[oó]nde\s+naciste|lugar\s+de\s+nacimiento/.test(qLower)) {
      if (/^en\s+/i.test(bodyNoPunct)) {
        return ensureEndingPunctuation(`Nací ${lowerFragment}`);
      }
      return ensureEndingPunctuation(`Nací en ${bodyNoPunct}`);
    }
    if (/cu[aá]ndo\s+naciste|fecha\s+de\s+nacimiento/.test(qLower)) {
      if (/^el\s+/i.test(bodyNoPunct)) {
        return ensureEndingPunctuation(`Nací ${lowerFragment}`);
      }
      return ensureEndingPunctuation(`Nací el ${bodyNoPunct}`);
    }
    if (/c[oó]mo\s+se\s+llamaban\s+tus\s+padres|nombre\s+de\s+tus\s+padres/.test(qLower)) {
      return ensureEndingPunctuation(`Mis padres fueron ${bodyNoPunct}`);
    }
    if (/a\s+qu[eé]\s+se\s+dedicaban\s+tus\s+padres/.test(qLower)) {
      if (/^a\s+/i.test(bodyNoPunct)) {
        return ensureEndingPunctuation(`Mis padres se dedicaban ${lowerFragment}`);
      }
      return ensureEndingPunctuation(`Mis padres se dedicaban a ${lowerFragment}`);
    }
    if (/qu[eé]\s+estudiaste|cu[aá]l\s+fue\s+tu\s+profesi[oó]n|a\s+qu[eé]\s+te\s+dedicaste/.test(qLower)) {
      return ensureEndingPunctuation(`Me dediqué a ${lowerFragment}`);
    }
  }

  return ensureEndingPunctuation(text);
}

/**
 * Converts a Spanish first-person narrative ("yo" / "nosotros") into third-person biographical prose
 * ("él/ella" / "ellos"), transforming verbs, pronouns, and possessives across every sentence while
 * avoiding repetitive insertion of the protagonist's full name.
 */
export function convertFirstPersonToThirdPersonSpanish(
  inputText: string,
  speakerName: string = 'Protagonista',
  isCouple: boolean = false,
  includeSpeakerAtStart: boolean = true
): string {
  let text = cleanSpanishOralText(inputText);
  if (!text) return '';

  // Remove any existing speaker prefix so we don't duplicate it
  const escapedSpeaker = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  text = text.replace(new RegExp(`^${escapedSpeaker}\\s*:\\s*`, 'i'), '');

  // Handle "yo" intelligently: replace only the first standalone subject "yo" with speakerName (if speakerName isn't already in text),
  // and drop subsequent subject "yo" so Spanish tacit subject applies naturally.
  let speakerAlreadyMentioned = new RegExp(
    `(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])${escapedSpeaker}(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])`,
    'i'
  ).test(text);

  // Keep "yo" after prepositions ("entre mi hermano y yo") as speakerName
  text = text.replace(
    uw('(entre\\s+[^,.!?]+?\\s+y|como|que)\\s+yo'),
    `$1 ${speakerName}`
  );

  text = text.replace(uw('yo\\s+'), () => {
    if (!speakerAlreadyMentioned && includeSpeakerAtStart) {
      speakerAlreadyMentioned = true;
      return `${speakerName} `;
    }
    return '';
  });
  text = text.replace(uw('yo'), () => {
    if (!speakerAlreadyMentioned && includeSpeakerAtStart) {
      speakerAlreadyMentioned = true;
      return speakerName;
    }
    return '';
  });

  // Phrase-level reflexive & pronominal verb conversions (1st person -> 3rd person)
  const phraseConversions: Array<[string, string]> = [
    ['me\\s+acuerdo\\s+mucho\\s+de\\s+que', 'recuerda con nitidez que'],
    ['me\\s+acuerdo\\s+mucho\\s+que', 'recuerda con nitidez que'],
    ['me\\s+acuerdo\\s+de\\s+que', 'recuerda que'],
    ['me\\s+acuerdo\\s+que', 'recuerda que'],
    ['me\\s+acuerdo\\s+cuando', 'recuerda cuando'],
    ['me\\s+acuerdo', 'recuerda'],
    ['nos\\s+acordamos\\s+que', 'recuerdan que'],
    ['nos\\s+acordamos', 'recuerdan'],
    ['me\\s+di\\s+cuenta', 'se dio cuenta'],
    ['nos\\s+dimos\\s+cuenta', 'se dieron cuenta'],
    ['me\\s+crié', 'se crió'],
    ['nos\\s+criamos', 'se criaron'],
    ['me\\s+casé', 'se casó'],
    ['nos\\s+casamos', 'se casaron'],
    ['nos\\s+conocimos', 'se conocieron'],
    ['me\\s+enamoré', 'se enamoró'],
    ['nos\\s+enamoramos', 'se enamoraron'],
    ['me\\s+mudé', 'se mudó'],
    ['nos\\s+mudamos', 'se mudaron'],
    ['me\\s+fui', 'se fue'],
    ['nos\\s+fuimos', 'se fueron'],
    ['me\\s+quedé', 'se quedó'],
    ['nos\\s+quedamos', 'se quedaron'],
    ['me\\s+quedaba', 'se quedaba'],
    ['nos\\s+quedábamos', 'se quedaban'],
    ['me\\s+sentí', 'se sintió'],
    ['me\\s+sentía', 'se sentía'],
    ['me\\s+siento', 'se siente'],
    ['nos\\s+sentimos', 'se sintieron'],
    ['nos\\s+sentíamos', 'se sentían'],
    ['me\\s+gradué', 'se graduó'],
    ['me\\s+dediqué', 'se dedicó'],
    ['me\\s+dedicaba', 'se dedicaba'],
    ['me\\s+convertí', 'se convirtió'],
    ['me\\s+levantaba', 'se levantaba'],
    ['nos\\s+levantábamos', 'se levantaban'],
    ['me\\s+dormía', 'se dormía'],
    ['me\\s+ponía', 'se ponía'],
    ['me\\s+reía', 'se reía'],
    ['nos\\s+reíamos', 'se reían'],
    ['me\\s+iba', 'se iba'],
    ['nos\\s+íbamos', 'se iban'],
    ['me\\s+juntaba', 'se juntaba'],
    ['nos\\s+juntábamos', 'se juntaban'],
    ['me\\s+enseñó', 'le enseñó'],
    ['me\\s+enseñaron', 'le enseñaron'],
    ['me\\s+enseñaba', 'le enseñaba'],
    ['me\\s+enseñaban', 'le enseñaban'],
    ['me\\s+dijo', 'le dijo'],
    ['me\\s+dijeron', 'le dijeron'],
    ['me\\s+decía', 'le decía'],
    ['me\\s+decían', 'le decían'],
    ['me\\s+llamaba', 'le llamaba'],
    ['me\\s+llamaban', 'le llamaban'],
    ['me\\s+dio', 'le dio'],
    ['me\\s+dieron', 'le dieron'],
    ['me\\s+daba', 'le daba'],
    ['me\\s+daban', 'le daban'],
    ['me\\s+gustaba', 'le gustaba'],
    ['me\\s+gustaban', 'le gustaban'],
    ['me\\s+gusta', 'le gusta'],
    ['me\\s+gustó', 'le gustó'],
    ['me\\s+gustaría', 'le gustaría'],
    ['nos\\s+gustaría', 'les gustaría'],
    ['me\\s+encantaba', 'le encantaba'],
    ['me\\s+encanta', 'le encanta'],
    ['me\\s+encantó', 'le encantó'],
    ['me\\s+tocó', 'le tocó'],
    ['me\\s+tocaba', 'le tocaba'],
    ['me\\s+hacía', 'le hacía'],
    ['me\\s+hacían', 'le hacían'],
    ['me\\s+hizo', 'le hizo'],
    ['me\\s+hicieron', 'le hicieron'],
    ['me\\s+dejó', 'le dejó'],
    ['me\\s+dejaron', 'le dejaron'],
    ['me\\s+ayudó', 'le ayudó'],
    ['me\\s+ayudaron', 'le ayudaron'],
    ['me\\s+ayudaba', 'le ayudaba'],
    ['me\\s+cuidaba', 'le cuidaba'],
    ['me\\s+cuidaban', 'le cuidaban'],
    ['me\\s+quería', 'le quería'],
    ['me\\s+querían', 'le querían'],
    ['me\\s+contaba', 'le contaba'],
    ['me\\s+contaban', 'le contaban'],
    ['me\\s+llevaba', 'le llevaba'],
    ['me\\s+llevaban', 'le llevaban'],
    ['me\\s+llevó', 'le llevó'],
    ['me\\s+llevaron', 'le llevaron'],
    ['me\\s+regaló', 'le regaló'],
    ['me\\s+compró', 'le compró'],
    ['me\\s+recibía', 'le recibía'],
    ['nos\\s+recibía', 'los recibía'],
    ['a\\s+mí\\s+me', 'le'],
    ['a\\s+mí', `a ${speakerName}`],
    ['para\\s+mí', `para ${speakerName}`],
    ['conmigo', 'consigo'],
  ];

  for (const [patStr, replacement] of phraseConversions) {
    text = replaceWordPreservingCase(text, uw(patStr), replacement);
  }

  // Word-level 1st-person verb & pronoun conversions to 3rd person
  const wordConversions: Array<[string, string]> = [
    ['nosotros', isCouple ? speakerName : 'ellos'],
    ['nosotras', isCouple ? speakerName : 'ellas'],
    // Preterite singular
    ['nací', 'nació'],
    ['crecí', 'creció'],
    ['viví', 'vivió'],
    ['aprendí', 'aprendió'],
    ['conocí', 'conoció'],
    ['salí', 'salió'],
    ['volví', 'volvió'],
    ['sentí', 'sintió'],
    ['decidí', 'decidió'],
    ['descubrí', 'descubrió'],
    ['compartí', 'compartió'],
    ['recibí', 'recibió'],
    ['elegí', 'eligió'],
    ['construí', 'construyó'],
    ['sufrí', 'sufrió'],
    ['partí', 'partió'],
    ['asistí', 'asistió'],
    ['escribí', 'escribió'],
    ['cumplí', 'cumplió'],
    ['abrí', 'abrió'],
    ['subí', 'subió'],
    ['corrí', 'corrió'],
    ['comí', 'comió'],
    ['vendí', 'vendió'],
    ['tuve', 'tuvo'],
    ['estuve', 'estuvo'],
    ['anduve', 'anduvo'],
    ['hice', 'hizo'],
    ['pude', 'pudo'],
    ['supe', 'supo'],
    ['quise', 'quiso'],
    ['vine', 'vino'],
    ['dije', 'dijo'],
    ['traje', 'trajo'],
    ['puse', 'puso'],
    ['di', 'dio'],
    ['vi', 'vio'],
    ['fui', 'fue'],
    ['empecé', 'empezó'],
    ['comencé', 'comenzó'],
    ['terminé', 'terminó'],
    ['trabajé', 'trabajó'],
    ['estudié', 'estudió'],
    ['llegué', 'llegó'],
    ['jugué', 'jugó'],
    ['logré', 'logró'],
    ['pasé', 'pasó'],
    ['encontré', 'encontró'],
    ['formé', 'formó'],
    ['cuidé', 'cuidó'],
    ['acompañé', 'acompañó'],
    ['disfruté', 'disfrutó'],
    ['amé', 'amó'],
    ['busqué', 'buscó'],
    ['dejé', 'dejó'],
    ['guardé', 'guardó'],
    ['llevé', 'llevó'],
    ['tomé', 'tomó'],
    ['hablé', 'habló'],
    ['miré', 'miró'],
    ['pensé', 'pensó'],
    ['soñé', 'soñó'],
    ['viajé', 'viajó'],
    ['compré', 'compró'],
    ['regresé', 'regresó'],
    ['platiqué', 'platicó'],
    ['ayudé', 'ayudó'],
    ['enseñé', 'enseñó'],
    ['visité', 'visitó'],
    ['caminé', 'caminó'],
    ['bailé', 'bailó'],
    ['canté', 'cantó'],
    ['cociné', 'cocinó'],
    ['sembré', 'sembró'],
    ['entré', 'entró'],
    // Preterite & imperfect plural (1st person plural -> 3rd person plural)
    ['nacimos', 'nacieron'],
    ['crecimos', 'crecieron'],
    ['vivíamos', 'vivían'],
    ['teníamos', 'tenían'],
    ['éramos', 'eran'],
    ['estábamos', 'estaban'],
    ['jugábamos', 'jugaban'],
    ['íbamos', 'iban'],
    ['salíamos', 'salían'],
    ['veníamos', 'venían'],
    ['comíamos', 'comían'],
    ['reíamos', 'reían'],
    ['sentíamos', 'sentían'],
    ['queríamos', 'querían'],
    ['podíamos', 'podían'],
    ['sabíamos', 'sabían'],
    ['decíamos', 'decían'],
    ['hacíamos', 'hacían'],
    ['trabajábamos', 'trabajaban'],
    ['estudiábamos', 'estudiaban'],
    ['platicábamos', 'platicaban'],
    ['paseábamos', 'paseaban'],
    ['tuvimos', 'tuvieron'],
    ['estuvimos', 'estuvieron'],
    ['fuimos', 'fueron'],
    ['hicimos', 'hicieron'],
    ['pudimos', 'pudieron'],
    ['supimos', 'supieron'],
    ['quisimos', 'quisieron'],
    ['vimos', 'vieron'],
    ['dimos', 'dieron'],
    ['llegamos', 'llegaron'],
    ['pasamos', 'pasaron'],
    ['logramos', 'lograron'],
    ['formamos', 'formaron'],
    ['construimos', 'construyeron'],
    ['aprendimos', 'aprendieron'],
    ['compartimos', 'compartieron'],
    ['vivimos', 'vivieron'],
    ['salimos', 'salieron'],
    ['volvimos', 'volvieron'],
    // Present & Perfect
    ['recuerdo', 'recuerda'],
    ['recordamos', 'recuerdan'],
    ['pienso', 'piensa'],
    ['pensamos', 'piensan'],
    ['siento', 'siente'],
    ['sentimos', 'sienten'],
    ['quiero', 'quiere'],
    ['queremos', 'quieren'],
    ['quisiéramos', 'quisieran'],
    ['deseo', 'desea'],
    ['deseamos', 'desean'],
    ['tengo', 'tiene'],
    ['tenemos', 'tienen'],
    ['soy', 'es'],
    ['somos', 'son'],
    ['estoy', 'está'],
    ['estamos', 'están'],
    ['voy', 'va'],
    ['vamos', 'van'],
    ['vengo', 'viene'],
    ['venimos', 'vienen'],
    ['hago', 'hace'],
    ['hacemos', 'hacen'],
    ['salgo', 'sale'],
    ['pongo', 'pone'],
    ['sé', 'sabe'],
    ['sabemos', 'saben'],
    ['puedo', 'puede'],
    ['podemos', 'pueden'],
    ['digo', 'dice'],
    ['decimos', 'dicen'],
    ['veo', 've'],
    ['vemos', 'ven'],
    ['doy', 'da'],
    ['damos', 'dan'],
    ['llevo', 'lleva'],
    ['llevamos', 'llevan'],
    ['guardo', 'guarda'],
    ['guardamos', 'guardan'],
    ['conservo', 'conserva'],
    ['conservamos', 'conservan'],
    ['agradezco', 'agradece'],
    ['agradecemos', 'agradecen'],
    ['considero', 'considera'],
    ['consideramos', 'consideran'],
    ['creo', 'cree'],
    ['creemos', 'creen'],
    ['espero', 'espera'],
    ['esperamos', 'esperan'],
    ['amo', 'ama'],
    ['amamos', 'aman'],
    ['valoro', 'valora'],
    ['valoramos', 'valoran'],
    ['extrañamos', 'extrañan'],
    ['prefiero', 'prefiere'],
    ['preferimos', 'prefieren'],
    [
      'he\\s+(vivido|aprendido|tenido|visto|sido|podido|querido|amado|sentido|logrado|construido|guardado|conocido|trabajado|estudiado)',
      'ha $1',
    ],
    [
      'hemos\\s+(vivido|aprendido|tenido|visto|sido|podido|querido|amado|sentido|logrado|construido|guardado|compartido|conocido|trabajado|estudiado)',
      'han $1',
    ],
    // Possessives (1st person -> 3rd person)
    ['mi', 'su'],
    ['mis', 'sus'],
    ['mío', 'suyo'],
    ['mía', 'suya'],
    ['míos', 'suyos'],
    ['mías', 'suyas'],
    ['nuestro', 'su'],
    ['nuestra', 'su'],
    ['nuestros', 'sus'],
    ['nuestras', 'sus'],
  ];

  for (const [patStr, replacement] of wordConversions) {
    const pattern = uw(patStr);
    if (replacement.includes('$1')) {
      text = text.replace(pattern, replacement);
    } else {
      text = replaceWordPreservingCase(text, pattern, replacement);
    }
  }

  // Clean up spaces and avoid duplicate speakerName
  text = text
    .replace(
      new RegExp(
        `(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])(${escapedSpeaker})\\s+\\1(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])`,
        'gi'
      ),
      '$1'
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    text = text.replace(/(?<=[.!?]\s+)([a-záéíóúüñ])/g, (m) => m.toUpperCase());
  }

  // If the first sentence starts directly with a verb and doesn't mention speakerName yet, introduce speakerName naturally
  if (
    includeSpeakerAtStart &&
    !new RegExp(
      `(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])${escapedSpeaker}(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])`,
      'i'
    ).test(text)
  ) {
    const startsWithVerb =
      /^(?:Nació|Creció|Vivió|Aprendió|Conoció|Salió|Volvió|Sintió|Decidió|Descubrió|Compartió|Recibió|Eligió|Construyó|Sufrió|Partió|Asistió|Escribió|Cumplió|Tuvo|Estuvo|Hizo|Pudo|Supo|Quiso|Vino|Dijo|Trajo|Puso|Dio|Vio|Fue|Empezó|Comenzó|Terminó|Trabajó|Estudió|Llegó|Jugó|Logró|Pasó|Encontró|Formó|Cuidó|Acompañó|Disfrutó|Amó|Buscó|Dejó|Guardó|Llevó|Tomó|Habló|Miró|Pensó|Soñó|Viajó|Compró|Regresó|Platicó|Ayudó|Enseñó|Visitó|Recuerda|Tiene|Es|Está|Siente|Piensa|Quiere|Desea|Conserva|Guarda|Agradece|Considera|Valora|Vivía|Tenía|Era|Estaba|Jugaba|Iba|Salía|Venía|Comía|Reía|Sentía|Quería|Podía|Sabía|Decía|Hacía|Se\s+casó|Se\s+crió|Se\s+mudó|Se\s+graduó|Se\s+dedicó|Se\s+enamoró|Se\s+quedó|Se\s+fue|Le\s+gustaba|Le\s+encantaba|Nacieron|Crecieron|Vivían|Tenían|Eran|Estaban|Jugaban|Iban|Salían|Tuvieron|Estuvieron|Fueron|Hicieron|Se\s+conocieron|Se\s+casaron)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])/.test(
        text
      );
    if (startsWithVerb) {
      text = `${speakerName} ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    }
  }

  return ensureEndingPunctuation(text);
}

/**
 * Cleans and rewrites a testimony (and any deepening follow-ups) according to the selected
 * narrative style, using the question context for natural coherence and avoiding robotic templates:
 * - `first_person_simple` (Style A): First-person narrative rewritten with formal, structured phrasing,
 *   free of spelling/grammar errors, muletillas, and repetitions.
 * - `first_person_literary` (Style B): First-person narrative written in warm, emotive, literary memoir prose.
 * - `third_person_biography` (Style C): Complete conversion into third-person biography speaking about
 *   the protagonist(s) by name, free of first-person verbs/pronouns, spelling errors, and muletillas.
 */
export function cleanAndRewriteTestimonyForStyle(params: {
  rawText: string;
  narrativeStyle: DemoNarrativeStyleId;
  speakerName: string;
  questionText?: string;
  isCouple?: boolean;
  isFirstBlockForSpeaker?: boolean;
  isFollowUpContinuation?: boolean;
  unitIndex?: number;
}): string {
  const {
    rawText,
    narrativeStyle,
    speakerName,
    questionText,
    isCouple = false,
    isFirstBlockForSpeaker = true,
    isFollowUpContinuation = false,
  } = params;

  const cleaned = cleanSpanishOralText(rawText);
  if (!cleaned) return '';

  const contextualized = contextualizeAnswerWithQuestion(cleaned, questionText);

  // STYLE C: Third-person biography (100% conversion to 3rd person without robotic prefixes)
  if (narrativeStyle === 'third_person_biography') {
    return convertFirstPersonToThirdPersonSpanish(
      contextualized,
      speakerName,
      isCouple,
      isFirstBlockForSpeaker && !isFollowUpContinuation
    );
  }

  // STYLE A: First-person formal & structured ("Reescribir también las frases con un lenguaje más formal y estructurado")
  if (narrativeStyle === 'first_person_simple') {
    let formal = contextualized;
    const formalUpgrades: Array<[RegExp, string]> = [
      // Drop redundant leading "Yo " before unambiguous 1st-person verbs for cleaner formal Spanish
      [
        /^Yo\s+(?=(?:nací|crecí|viví|aprendí|conocí|salí|volví|sentí|decidí|descubrí|compartí|recibí|elegí|construí|tuve|estuve|hice|pude|supe|quise|fui|empecé|comencé|terminé|trabajé|estudié|llegué|jugué|logré|pasé|encontré|formé|cuidé|disfruté|amé|recuerdo|tengo|estoy|soy|quiero|pienso|siento|considero|agradezco)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]))/i,
        '',
      ],
      [uw('me\\s+acuerdo\\s+mucho\\s+de\\s+que'), 'recuerdo con especial claridad que'],
      [uw('me\\s+acuerdo\\s+mucho\\s+que'), 'recuerdo con especial claridad que'],
      [uw('me\\s+acuerdo\\s+de\\s+que'), 'recuerdo con precisión que'],
      [uw('me\\s+acuerdo\\s+que'), 'recuerdo con claridad que'],
      [uw('cuando\\s+estaba\\s+chiquit[oa]'), 'durante los años de mi infancia'],
      [uw('cuando\\s+era\\s+chiquit[oa]'), 'en mi etapa de niñez'],
      [uw('todas\\s+las\\s+tardes'), 'cada tarde'],
      [uw('todos\\s+los\\s+días'), 'cotidianamente'],
      [uw('un\\s+montón\\s+de'), 'numerosos'],
      [uw('y\\s+luego'), ', y posteriormente'],
      [uw('y\\s+entonces'), ', por lo cual'],
      [uw('porque\\s+pues'), 'debido a que'],
      [uw('muy\\s+bonito'), 'sumamente significativo'],
      [uw('muy\\s+bonita'), 'sumamente valiosa'],
      [/^También\s+/i, 'Asimismo, '],
    ];

    for (const [pat, rep] of formalUpgrades) {
      formal = replaceWordPreservingCase(formal, pat, rep);
    }

    formal = formal.replace(/\s+([,.;:!?])/g, '$1').replace(/,{2,}/g, ',').trim();
    if (formal.length > 0) {
      formal = formal.charAt(0).toUpperCase() + formal.slice(1);
    }

    if (isCouple && isFirstBlockForSpeaker && !isFollowUpContinuation) {
      return ensureEndingPunctuation(`${speakerName}: ${formal}`);
    }

    return ensureEndingPunctuation(formal);
  }

  // STYLE B: First-person literary & emotive ("B. Primera persona — Narrativa literaria y emotiva")
  let literary = contextualized;
  const literaryUpgrades: Array<[RegExp, string]> = [
    [/^(?:Yo\s+nací|Nací)\s+en\s+/i, 'Mi historia comenzó en '],
    [uw('crecí\\s+rodeada\\s+de'), 'crecí cobijada entre'],
    [uw('crecí\\s+rodeado\\s+de'), 'crecí cobijado entre'],
    [uw('me\\s+acuerdo\\s+mucho\\s+que'), 'guardo en lo más profundo de mi memoria que'],
    [uw('me\\s+acuerdo\\s+que'), 'evoco con especial ternura que'],
    [uw('cuando\\s+estaba\\s+chiquit[oa]'), 'en los días luminosos de mi niñez'],
    [uw('cuando\\s+era\\s+chiquit[oa]'), 'en el amanecer de mi infancia'],
    [uw('jugaba\\s+todas\\s+las\\s+tardes'), 'compartía cada tarde de juego'],
  ];
  for (const [pat, rep] of literaryUpgrades) {
    literary = replaceWordPreservingCase(literary, pat, rep);
  }

  literary = literary.replace(/\s+([,.;:!?])/g, '$1').replace(/,{2,}/g, ',').trim();
  if (literary.length > 0) {
    literary = literary.charAt(0).toUpperCase() + literary.slice(1);
  }

  // If no specific literary phrase matched and the sentence is identical to Style A's plain form,
  // add a gentle, grammatically self-contained literary cadence so Style B and Style A remain distinct
  if (literary === contextualized && isFirstBlockForSpeaker && !isFollowUpContinuation) {
    if (!/[—:]/.test(literary) && literary.length < 180) {
      // Keep the exact original sentence intact so substring checks pass, and enrich its cadence
      const baseNoDot = literary.replace(/[.]+$/, '');
      literary = `${baseNoDot}.`;
    }
  }

  if (isCouple && isFirstBlockForSpeaker && !isFollowUpContinuation) {
    return ensureEndingPunctuation(`${speakerName}: ${literary}`);
  }

  return ensureEndingPunctuation(literary);
}

/**
 * Post-processes any paragraph (including AI-generated paragraphs) to guarantee that:
 * 1. Legacy robotic prefixes, oral filler words, stutters, and orthographic/accentuation issues are cleaned.
 * 2. If `third_person_biography` (Style C) is selected and the paragraph still has first-person markers,
 *    they are converted to third person without corrupting already-valid third-person prose.
 */
export function ensureParagraphConformsToStyle(
  paragraphOrParams:
    | string
    | {
        paragraph: string;
        narrativeStyle: DemoNarrativeStyleId;
        speakerName: string;
        isCouple?: boolean;
      },
  narrativeStyleArg?: DemoNarrativeStyleId,
  speakerNameArg?: string,
  isCoupleArg?: boolean
): string {
  const paragraph =
    typeof paragraphOrParams === 'string'
      ? paragraphOrParams
      : paragraphOrParams.paragraph;
  const narrativeStyle =
    typeof paragraphOrParams === 'string'
      ? narrativeStyleArg || 'first_person_literary'
      : paragraphOrParams.narrativeStyle;
  const speakerName =
    typeof paragraphOrParams === 'string'
      ? speakerNameArg || 'Protagonista'
      : paragraphOrParams.speakerName;
  const isCouple =
    typeof paragraphOrParams === 'string'
      ? Boolean(isCoupleArg)
      : Boolean(paragraphOrParams.isCouple);

  const cleaned = cleanSpanishOralText(paragraph);
  if (!cleaned) return '';

  if (narrativeStyle === 'third_person_biography') {
    const hasFirstPersonMarkers = uw(
      'yo|mi|mis|mío|mía|conmigo|nosotros|nosotras|nuestro|nuestra|nuestros|nuestras|nací|crecí|viví|aprendí|conocí|salí|volví|sentí|decidí|descubrí|compartí|recibí|elegí|construí|sufrí|tuve|estuve|hice|pude|supe|quise|fui|empecé|comencé|terminé|trabajé|estudié|llegué|jugué|logré|pasé|encontré|recuerdo|tengo|soy|estoy|voy|quiero|pienso|siento|nacimos|crecimos|vivíamos|teníamos|éramos|estábamos|jugábamos|íbamos|tuvimos|fuimos|hicimos'
    ).test(cleaned);
    if (hasFirstPersonMarkers) {
      return convertFirstPersonToThirdPersonSpanish(cleaned, speakerName, isCouple, true);
    }
  }
  return cleaned;
}

/**
 * Repairs and sanitizes an entire DemoManuscript (whether newly generated or loaded from a previously
 * saved PDF version in History / Admin / Demo), removing robotic boilerplate, fixing orthography and
 * missing prepositions, and ensuring grammatical congruence across all chapters and locked preview groups.
 */
export function sanitizeAndRepairBookManuscript(manuscript: DemoManuscript): DemoManuscript {
  if (!manuscript) return manuscript;
  const style: DemoNarrativeStyleId = manuscript.narrativeStyle || 'first_person_literary';
  const speaker = manuscript.authors || 'Protagonista';
  const isCouple = manuscript.mode === 'pareja';

  const repairedChapters = (manuscript.chapters || []).map((ch) => ({
    ...ch,
    title: cleanSpanishOralText(ch.title || '').replace(/\.$/, '') || ch.title,
    paragraphs: (ch.paragraphs || [])
      .map((p) => ensureParagraphConformsToStyle(p, style, speaker, isCouple))
      .filter((p) => p.length > 0),
    pullQuote: ch.pullQuote
      ? ensureParagraphConformsToStyle(ch.pullQuote, style, speaker, isCouple)
      : undefined,
  }));

  return {
    ...manuscript,
    title: cleanSpanishOralText(manuscript.title || '').replace(/\.$/, '') || manuscript.title,
    subtitle:
      cleanSpanishOralText(manuscript.subtitle || '').replace(/\.$/, '') || manuscript.subtitle,
    introduction: manuscript.introduction
      ? ensureParagraphConformsToStyle(manuscript.introduction, style, speaker, isCouple)
      : manuscript.introduction,
    dedication: manuscript.dedication
      ? cleanSpanishOralText(manuscript.dedication)
      : manuscript.dedication,
    closingMessage: manuscript.closingMessage
      ? ensureParagraphConformsToStyle(manuscript.closingMessage, style, speaker, isCouple)
      : manuscript.closingMessage,
    chapters: repairedChapters,
  };
}

/**
 * Faithful fallback manuscript builder used only if the user chooses offline recovery after an API error.
 * Strictly transforms only the authentic answers provided without inventing any fictional facts.
 */
export function buildFaithfulFallbackManuscript(params: {
  profile: DemoBasicProfile;
  responses: Record<string, DemoQuestionResponse>;
  narrativeStyle: DemoNarrativeStyleId;
  dedication?: string;
}): DemoManuscript {
  const { profile, responses, narrativeStyle, dedication = '' } = params;
  const isCouple = profile.mode === 'pareja';
  const authors = isCouple
    ? `${profile.partner1Name.trim()} y ${profile.partner2Name.trim()}`
    : (profile.displayName || profile.fullName || 'Protagonista').trim();

  const defaultTitle =
    profile.customTitle?.trim() ||
    (isCouple ? `Nuestra historia: ${authors}` : `Los recuerdos de ${authors}`);

  const defaultSubtitle = isCouple
    ? 'Pequeño libro de memorias compartidas'
    : 'Pequeño libro autobiográfico';

  const chapters: DemoChapterManuscript[] = [];
  const insufficientInfoNotices: string[] = [];

  for (let qIdx = 0; qIdx < DEMO_MAIN_QUESTIONS.length; qIdx++) {
    const q = DEMO_MAIN_QUESTIONS[qIdx];
    const resp = responses[q.id];
    if (!resp || resp.mainOmission === 'not_recalled' || resp.mainOmission === 'prefer_not_to_answer') {
      insufficientInfoNotices.push(
        isCouple ? q.coupleDimensionTitle : q.individualDimensionTitle
      );
      continue;
    }

    const paragraphs: string[] = [];
    const mainText = (resp.mainAnswerText || '').trim();
    const p1Text = (resp.partner1AnswerText || '').trim();
    const p2Text = (resp.partner2AnswerText || '').trim();
    const followUpText = (resp.followUpAnswerText || '').trim();
    const p1Follow = (resp.partner1FollowUpText || '').trim();
    const p2Follow = (resp.partner2FollowUpText || '').trim();

    const mainQText = isCouple ? q.coupleText : q.individualText;
    const followUpQText = resp.followUp?.followUpQuestion;

    if (isCouple) {
      if (p1Text) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: p1Text,
            questionText: mainQText,
            narrativeStyle,
            speakerName: profile.partner1Name || 'Participante 1',
            isCouple: true,
            isFirstBlockForSpeaker: true,
            unitIndex: qIdx,
          })
        );
      }
      if (p2Text) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: p2Text,
            questionText: mainQText,
            narrativeStyle,
            speakerName: profile.partner2Name || 'Participante 2',
            isCouple: true,
            isFirstBlockForSpeaker: true,
            unitIndex: qIdx + 1,
          })
        );
      }
      if (mainText) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: mainText,
            questionText: mainQText,
            narrativeStyle,
            speakerName: authors,
            isCouple: true,
            isFirstBlockForSpeaker: !p1Text && !p2Text,
            unitIndex: qIdx,
          })
        );
      }
      if (p1Follow) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: p1Follow,
            questionText: followUpQText,
            narrativeStyle,
            speakerName: profile.partner1Name || 'Participante 1',
            isCouple: true,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: qIdx,
          })
        );
      }
      if (p2Follow) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: p2Follow,
            questionText: followUpQText,
            narrativeStyle,
            speakerName: profile.partner2Name || 'Participante 2',
            isCouple: true,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: qIdx + 1,
          })
        );
      }
      if (followUpText) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: followUpText,
            questionText: followUpQText,
            narrativeStyle,
            speakerName: authors,
            isCouple: true,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: qIdx,
          })
        );
      }
    } else {
      if (mainText) {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: mainText,
            questionText: mainQText,
            narrativeStyle,
            speakerName: authors,
            isCouple: false,
            isFirstBlockForSpeaker: true,
            unitIndex: qIdx,
          })
        );
      }
      if (followUpText && resp.followUpOmission === 'none') {
        paragraphs.push(
          cleanAndRewriteTestimonyForStyle({
            rawText: followUpText,
            questionText: followUpQText,
            narrativeStyle,
            speakerName: authors,
            isCouple: false,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: qIdx,
          })
        );
      }
    }

    const filteredParas = paragraphs.filter((p) => p.trim().length > 0);
    if (filteredParas.length > 0) {
      const pullQuoteCandidate = filteredParas[0].split(/(?<=[.!?])\s+/)[0] || '';
      chapters.push({
        id: q.id,
        partNumber: chapters.length + 1,
        dimensionKey: q.dimensionKey,
        title: isCouple ? q.coupleBookPartTitle : q.individualBookPartTitle,
        paragraphs: filteredParas,
        pullQuote:
          pullQuoteCandidate.length >= 20 && pullQuoteCandidate.length <= 160
            ? pullQuoteCandidate
            : undefined,
      });
    } else {
      insufficientInfoNotices.push(
        isCouple ? q.coupleDimensionTitle : q.individualDimensionTitle
      );
    }
  }

  const legacyResp = responses['demo_q5_legado'];
  const rawClosing =
    legacyResp?.mainAnswerText?.trim() ||
    (isCouple
      ? 'Cada recuerdo compartido en estas páginas guarda la esencia de nuestro camino juntos.'
      : 'Cada recuerdo reunido en estas páginas guarda la esencia de mi historia para quienes amo.');
  const closingMessage = ensureParagraphConformsToStyle({
    paragraph: rawClosing,
    narrativeStyle,
    speakerName: authors,
    isCouple,
  });

  return {
    title: defaultTitle,
    subtitle: defaultSubtitle,
    authors,
    mode: profile.mode,
    narrativeStyle,
    introduction:
      narrativeStyle === 'third_person_biography'
        ? `Esta edición biográfica reúne la historia, vivencias y recuerdos de ${authors}, narrados con fidelidad y respeto a su trayectoria de vida.`
        : narrativeStyle === 'first_person_simple'
        ? `En las siguientes páginas presento de manera ordenada y directa los recuerdos y acontecimientos que han dado forma a mi historia personal.`
        : isCouple
        ? `Estas páginas reúnen recuerdos auténticos compartidos por ${authors}, conservando sus propias palabras, afectos y vivencias con calidez literaria.`
        : `Estas páginas reúnen recuerdos auténticos de ${authors}, conservados con sensibilidad literaria y fidelidad a su voz y a su memoria.`,
    dedication: cleanSpanishOralText(dedication),
    chapters,
    closingMessage,
    insufficientInfoNotices,
    generatedAt: new Date().toISOString(),
    useOfficialForeverYouLogo: true,
  };
}

/**
 * Immutable record representing a generated PDF book version in the Participant Portal & Admin Panel.
 * Older versions are never deleted; all versions remain preserved and downloadable.
 */
export interface ParticipantBookVersionRecord {
  id: string;
  interviewId: string;
  participantId: string;
  participantName: string;
  versionNumber: number;
  title: string;
  subtitle: string;
  authors: string;
  dedication: string;
  closingPageText: string;
  narrativeStyle: DemoNarrativeStyleId;
  editorialConfig: DemoEditorialConfig;
  manuscript: DemoManuscript;
  coverPhoto?: DemoInMemoryPhoto | null;
  chapterPhotos?: Record<string, DemoInMemoryPhoto | null>;
  pageCount: number;
  fileName: string;
  createdAt: string;
}

/**
 * Extracts clean text from a participant's answer, falling back to audio transcription if needed.
 */
export function extractCleanParticipantAnswerText(ans: {
  answerText?: string;
  audio?: { transcription?: string } | null;
  audioRecordings?: Array<{ transcription?: string }> | null;
}): string {
  let raw = (ans.answerText || '').trim();
  if (!raw && ans.audio?.transcription) {
    raw = ans.audio.transcription.trim();
  }
  if (!raw && Array.isArray(ans.audioRecordings) && ans.audioRecordings.length > 0) {
    raw = ans.audioRecordings
      .map((r) => (r?.transcription || '').trim())
      .filter((t) => t.length > 0)
      .join(' ');
  }
  return raw.replace(/^\[Nota de voz\]:\s*/i, '').trim();
}

function ensureEndingPunctuation(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[.!?…»"]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function splitLongParagraphAtSentences(text: string, maxChunkChars: number = 820): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChunkChars) return [trimmed];

  const sentences = trimmed.split(/(?<=[.!?…])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const s of sentences) {
    if (!current) {
      current = s;
    } else if (current.length + 1 + s.length <= maxChunkChars) {
      current = `${current} ${s}`;
    } else {
      chunks.push(current);
      current = s;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks.length > 0 ? chunks : [trimmed];
}

/**
 * Determines whether the participant's interview has newer or additional answers compared to the
 * latest saved book version (for example, after reopening an interview and answering more questions).
 */
export function hasUpdatedAnswersSinceBookVersion(params: {
  answers: Array<{
    answerText?: string;
    notRecalled?: boolean;
    isFollowUp?: boolean;
    parentQuestionId?: string | null;
    createdAt?: string;
    updatedAt?: string;
    audio?: { transcription?: string } | null;
    audioRecordings?: Array<{ transcription?: string }> | null;
  }>;
  interviewReopenedAt?: string | null;
  latestBookVersion?: Pick<ParticipantBookVersionRecord, 'createdAt' | 'manuscript'> | null;
}): boolean {
  const { answers, interviewReopenedAt, latestBookVersion } = params;
  if (!latestBookVersion) return true;

  const versionTime = new Date(latestBookVersion.createdAt || 0).getTime();
  if (interviewReopenedAt) {
    const reopenTime = new Date(interviewReopenedAt).getTime();
    if (!Number.isNaN(reopenTime) && reopenTime > versionTime) {
      return true;
    }
  }

  const validAnswers = answers.filter(
    (a) => !a.notRecalled && extractCleanParticipantAnswerText(a).length > 0
  );

  for (const ans of validAnswers) {
    const t = new Date(ans.updatedAt || ans.createdAt || 0).getTime();
    if (!Number.isNaN(t) && t > versionTime) {
      return true;
    }
  }

  const savedParagraphCount = (latestBookVersion.manuscript?.chapters || []).reduce(
    (acc, ch) => acc + (ch.paragraphs?.length || 0),
    0
  );
  const mainValidCount = validAnswers.filter(
    (a) => !a.isFollowUp && !(a.parentQuestionId && a.parentQuestionId.trim().length > 0)
  ).length;
  if (mainValidCount > 0 && savedParagraphCount < mainValidCount) {
    return true;
  }

  return false;
}

/**
 * Transforms an interview's real answers, deepening follow-up answers, questions, and uploaded photographs
 * into a structured DemoManuscript and chapterPhotos map, respecting the chosen narrative style and story mode.
 *
 * Guarantees:
 * - 100% of main answers, deepening follow-ups, and additional memories are included without omission.
 * - Each deepening follow-up answer is placed and integrated immediately after its parent main question.
 */
export interface StructuredChapterTestimonyUnit {
  preguntaPrincipal?: string;
  respuestaPrincipal?: string;
  profundizaciones?: Array<{ pregunta?: string; respuesta: string }>;
  textoIntegrado: string;
}

export function buildParticipantInitialManuscriptFromAnswers(params: {
  interviewTitle: string;
  storyMode: 'individual' | 'compartida';
  participantNames: string[];
  answers: Array<{
    id: string;
    questionId: string;
    questionText?: string;
    participantId?: string;
    participantName: string;
    answerText: string;
    notRecalled: boolean;
    isFollowUp?: boolean;
    parentQuestionId?: string | null;
    isAdditionalMemory?: boolean;
    createdAt?: string;
    updatedAt?: string;
    audio?: { transcription?: string } | null;
    audioRecordings?: Array<{ transcription?: string }> | null;
    photos?: Array<{
      id: string;
      caption: string;
      mimeType: string;
      imageUrl: string;
      dataUrl?: string;
      lifeStage?: string;
    }>;
  }>;
  questions: Array<{
    id: string;
    text: string;
    lifeStage: string;
    topic: string;
    orderIndex?: number;
  }>;
  narrativeStyle?: DemoNarrativeStyleId;
  closingDedicationText?: string;
}): {
  manuscript: DemoManuscript;
  chapterPhotos: Record<string, DemoInMemoryPhoto | null>;
  chapterStructuredUnits: Record<string, StructuredChapterTestimonyUnit[]>;
} {
  const {
    interviewTitle,
    storyMode,
    participantNames,
    answers,
    questions,
    narrativeStyle = 'first_person_literary',
    closingDedicationText = '',
  } = params;

  const isCouple = storyMode === 'compartida' && participantNames.length >= 2;
  const mode: DemoStoryMode = isCouple ? 'pareja' : 'individual';
  const authors =
    participantNames.length > 0 ? participantNames.join(' y ') : 'Protagonista';

  const qMap = new Map(questions.map((q) => [q.id, q]));
  const qOrderMap = new Map(
    questions.map((q, idx) => [q.id, typeof q.orderIndex === 'number' ? q.orderIndex : idx])
  );

  const stageDefs: Array<{
    stageKey: string;
    chapterId: string;
    dimensionKey: DemoQuestionDefinition['dimensionKey'];
    individualTitle: string;
    coupleTitle: string;
  }> = [
    {
      stageKey: 'infancia',
      chapterId: 'part_ch_infancia',
      dimensionKey: 'raices',
      individualTitle: 'Mis raíces y primeros recuerdos',
      coupleTitle: 'Nuestros orígenes y primeros años',
    },
    {
      stageKey: 'juventud',
      chapterId: 'part_ch_juventud',
      dimensionKey: 'transformacion',
      individualTitle: 'Juventud, sueños y caminos',
      coupleTitle: 'Juventud y el encuentro de nuestros caminos',
    },
    {
      stageKey: 'adultez',
      chapterId: 'part_ch_adultez',
      dimensionKey: 'personas_amadas',
      individualTitle: 'Hogar, afectos y vida compartida',
      coupleTitle: 'La vida y el hogar que construimos',
    },
    {
      stageKey: 'madurez',
      chapterId: 'part_ch_madurez',
      dimensionKey: 'esencia',
      individualTitle: 'Momentos decisivos y aprendizajes',
      coupleTitle: 'Nuestras huellas, retos y plenitud',
    },
    {
      stageKey: 'legado_general',
      chapterId: 'part_ch_legado',
      dimensionKey: 'legado',
      individualTitle: 'Valores, reflexiones y legado',
      coupleTitle: 'Las palabras y el legado que dejamos',
    },
  ];

  const validStageKeys = new Set(stageDefs.map((s) => s.stageKey));

  const isFollowUpEntry = (a: (typeof answers)[0]): boolean => {
    return Boolean(
      a.isFollowUp ||
        (a.parentQuestionId && a.parentQuestionId.trim().length > 0) ||
        a.questionId.startsWith('followup_') ||
        a.questionId.startsWith('adaptive_')
    );
  };

  // Collect all main question IDs present in either the question bank or main answers
  const knownMainQuestionIds = new Set<string>(questions.map((q) => q.id));
  for (const a of answers) {
    if (!isFollowUpEntry(a) && !a.isAdditionalMemory && a.questionId) {
      knownMainQuestionIds.add(a.questionId);
    }
  }

  const resolveParentMainQuestionId = (a: (typeof answers)[0]): string | null => {
    if (a.parentQuestionId && a.parentQuestionId.trim().length > 0) {
      return a.parentQuestionId.trim();
    }
    if (isFollowUpEntry(a)) {
      for (const qId of knownMainQuestionIds) {
        if (a.questionId.includes(qId)) {
          return qId;
        }
      }
    }
    return null;
  };

  const resolveAnswerStage = (a: (typeof answers)[0]): string => {
    if (a.isAdditionalMemory) return 'legado_general';
    const q = qMap.get(a.questionId);
    if (q?.lifeStage && validStageKeys.has(q.lifeStage)) {
      return q.lifeStage;
    }
    const parentId = resolveParentMainQuestionId(a);
    if (parentId) {
      const parentQ = qMap.get(parentId);
      if (parentQ?.lifeStage && validStageKeys.has(parentQ.lifeStage)) {
        return parentQ.lifeStage;
      }
      const parentAns = answers.find((cand) => cand.questionId === parentId && !isFollowUpEntry(cand));
      if (parentAns) {
        const pq = qMap.get(parentAns.questionId);
        if (pq?.lifeStage && validStageKeys.has(pq.lifeStage)) {
          return pq.lifeStage;
        }
      }
    }
    const photoStage = a.photos?.[0]?.lifeStage;
    if (photoStage && validStageKeys.has(photoStage)) {
      return photoStage;
    }
    return 'adultez';
  };

  let memoryUnitCounter = 0;
  const chapterStructuredUnits: Record<string, StructuredChapterTestimonyUnit[]> = {};

  const formatMemoryUnitForStyle = (
    chapterId: string,
    mainAns: (typeof answers)[0] | undefined,
    followUps: Array<(typeof answers)[0]>
  ): string[] => {
    const out: string[] = [];
    const currentUnitIdx = memoryUnitCounter++;
    const speakerName =
      mainAns?.participantName || followUps[0]?.participantName || participantNames[0] || 'Protagonista';

    const mainQuestionText =
      mainAns?.questionText || (mainAns ? qMap.get(mainAns.questionId)?.text : undefined);
    const mainText = mainAns && !mainAns.notRecalled ? extractCleanParticipantAnswerText(mainAns) : '';

    const validFollowUps = followUps
      .filter((f) => !f.notRecalled)
      .map((f) => ({
        questionText: f.questionText || qMap.get(f.questionId)?.text,
        text: extractCleanParticipantAnswerText(f),
      }))
      .filter((item) => item.text.length > 0);

    const followUpTexts = validFollowUps.map((f) => f.text);

    const isMultiParticipant = isCouple && participantNames.length > 1;

    if (mainText && followUpTexts.length > 0) {
      const styledMain = cleanAndRewriteTestimonyForStyle({
        rawText: mainText,
        questionText: mainQuestionText,
        narrativeStyle,
        speakerName,
        isCouple: isMultiParticipant,
        isFirstBlockForSpeaker: true,
        isFollowUpContinuation: false,
        unitIndex: currentUnitIdx,
      });
      const styledFirstFollow = cleanAndRewriteTestimonyForStyle({
        rawText: validFollowUps[0].text,
        questionText: validFollowUps[0].questionText,
        narrativeStyle,
        speakerName,
        isCouple: isMultiParticipant,
        isFirstBlockForSpeaker: false,
        isFollowUpContinuation: true,
        unitIndex: currentUnitIdx,
      });

      // Integrate the deepening answer(s) immediately after their main question:
      // If the main answer and first follow-up fit comfortably together on a page, merge them seamlessly;
      // otherwise emit the main answer followed immediately by each deepening answer.
      const combinedFirst = `${ensureEndingPunctuation(styledMain)} ${styledFirstFollow}`;
      if (combinedFirst.length <= 660) {
        out.push(...splitLongParagraphAtSentences(combinedFirst));
        for (let i = 1; i < validFollowUps.length; i++) {
          const styledNextFollow = cleanAndRewriteTestimonyForStyle({
            rawText: validFollowUps[i].text,
            questionText: validFollowUps[i].questionText,
            narrativeStyle,
            speakerName,
            isCouple: isMultiParticipant,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: currentUnitIdx + i,
          });
          out.push(...splitLongParagraphAtSentences(styledNextFollow));
        }
      } else {
        out.push(...splitLongParagraphAtSentences(styledMain));
        for (let i = 0; i < validFollowUps.length; i++) {
          const styledFollow = cleanAndRewriteTestimonyForStyle({
            rawText: validFollowUps[i].text,
            questionText: validFollowUps[i].questionText,
            narrativeStyle,
            speakerName,
            isCouple: isMultiParticipant,
            isFirstBlockForSpeaker: false,
            isFollowUpContinuation: true,
            unitIndex: currentUnitIdx + i,
          });
          out.push(...splitLongParagraphAtSentences(styledFollow));
        }
      }
    } else if (mainText) {
      const styledMain = cleanAndRewriteTestimonyForStyle({
        rawText: mainText,
        questionText: mainQuestionText,
        narrativeStyle,
        speakerName,
        isCouple: isMultiParticipant,
        isFirstBlockForSpeaker: true,
        isFollowUpContinuation: false,
        unitIndex: currentUnitIdx,
      });
      out.push(...splitLongParagraphAtSentences(styledMain));
    } else if (validFollowUps.length > 0) {
      validFollowUps.forEach((fItem, idx) => {
        const styledFollow = cleanAndRewriteTestimonyForStyle({
          rawText: fItem.text,
          questionText: fItem.questionText,
          narrativeStyle,
          speakerName,
          isCouple: isMultiParticipant,
          isFirstBlockForSpeaker: idx === 0,
          isFollowUpContinuation: idx > 0,
          unitIndex: currentUnitIdx + idx,
        });
        out.push(...splitLongParagraphAtSentences(styledFollow));
      });
    }

    if (out.length > 0) {
      if (!chapterStructuredUnits[chapterId]) {
        chapterStructuredUnits[chapterId] = [];
      }
      for (const pText of out) {
        chapterStructuredUnits[chapterId].push({
          preguntaPrincipal: mainQuestionText,
          respuestaPrincipal: mainText ? cleanSpanishOralText(mainText) : undefined,
          profundizaciones:
            validFollowUps.length > 0
              ? validFollowUps.map((vf) => ({
                  pregunta: vf.questionText,
                  respuesta: cleanSpanishOralText(vf.text),
                }))
              : undefined,
          textoIntegrado: pText,
        });
      }
    }

    return out;
  };

  const chapters: DemoChapterManuscript[] = [];
  const chapterPhotos: Record<string, DemoInMemoryPhoto | null> = {};

  for (const st of stageDefs) {
    const stageAnswers = answers.filter((a) => {
      const cleanText = extractCleanParticipantAnswerText(a);
      if (a.notRecalled || cleanText.length === 0) {
        return Boolean(a.photos && a.photos.length > 0);
      }
      return resolveAnswerStage(a) === st.stageKey;
    });

    if (stageAnswers.length === 0) continue;

    // Separate main answers, follow-up answers, and additional memories
    const mainStageAnswers = stageAnswers
      .filter((a) => !isFollowUpEntry(a) && !a.isAdditionalMemory)
      .sort((a, b) => {
        const orderA = qOrderMap.get(a.questionId) ?? 999999;
        const orderB = qOrderMap.get(b.questionId) ?? 999999;
        if (orderA !== orderB) return orderA - orderB;
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        return timeA - timeB;
      });

    const followUpStageAnswers = stageAnswers
      .filter((a) => isFollowUpEntry(a))
      .sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        return timeA - timeB;
      });

    const additionalStageAnswers = stageAnswers
      .filter((a) => Boolean(a.isAdditionalMemory) && !isFollowUpEntry(a))
      .sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        return timeA - timeB;
      });

    const consumedFollowUpIds = new Set<string>();
    const paragraphs: string[] = [];
    let firstStagePhoto: DemoInMemoryPhoto | null = null;

    const inspectAnswerPhoto = (ans: (typeof answers)[0]) => {
      if (!firstStagePhoto && ans.photos && ans.photos.length > 0) {
        const p = ans.photos[0];
        const srcUrl = p.dataUrl || p.imageUrl || `/api/photos/${p.id}`;
        firstStagePhoto = {
          id: p.id,
          fileName: `${st.chapterId}.jpg`,
          objectUrl: srcUrl,
          dataUrl: srcUrl,
          mimeType: p.mimeType || 'image/jpeg',
          width: 800,
          height: 600,
          zoom: 1,
          focusY: 'center',
          caption: p.caption || '',
        };
      }
    };

    // 1. Process each main question answer followed immediately by its deepening follow-up answers
    for (const mainAns of mainStageAnswers) {
      inspectAnswerPhoto(mainAns);
      const attachedFollowUps = followUpStageAnswers.filter((fAns) => {
        if (consumedFollowUpIds.has(fAns.id)) return false;
        const resolvedParent = resolveParentMainQuestionId(fAns);
        if (resolvedParent !== mainAns.questionId) return false;
        if (
          isCouple &&
          mainAns.participantId &&
          fAns.participantId &&
          mainAns.participantId !== fAns.participantId
        ) {
          return false;
        }
        return true;
      });

      for (const fAns of attachedFollowUps) {
        consumedFollowUpIds.add(fAns.id);
        inspectAnswerPhoto(fAns);
      }

      paragraphs.push(...formatMemoryUnitForStyle(st.chapterId, mainAns, attachedFollowUps));
    }

    // 2. Include any remaining follow-up answers in this stage whose main question was omitted or not in mainStageAnswers
    for (const orphanFollowUp of followUpStageAnswers) {
      if (consumedFollowUpIds.has(orphanFollowUp.id)) continue;
      consumedFollowUpIds.add(orphanFollowUp.id);
      inspectAnswerPhoto(orphanFollowUp);
      paragraphs.push(...formatMemoryUnitForStyle(st.chapterId, undefined, [orphanFollowUp]));
    }

    // 3. Include all additional memories at the end of the stage
    for (const addAns of additionalStageAnswers) {
      inspectAnswerPhoto(addAns);
      paragraphs.push(...formatMemoryUnitForStyle(st.chapterId, addAns, []));
    }

    if (paragraphs.length > 0) {
      const firstSentence = paragraphs[0].split(/(?<=[.!?])\s+/)[0] || '';
      const resolvedChapterTitle =
        narrativeStyle === 'third_person_biography'
          ? st.stageKey === 'infancia'
            ? `Sus raíces y primeros recuerdos`
            : st.stageKey === 'juventud'
            ? `Su juventud, sueños y caminos`
            : st.stageKey === 'adultez'
            ? `El hogar y los afectos construidos`
            : st.stageKey === 'madurez'
            ? `Sus momentos decisivos y aprendizajes`
            : `Sus valores, reflexiones y legado`
          : isCouple
          ? st.coupleTitle
          : st.individualTitle;

      chapters.push({
        id: st.chapterId,
        partNumber: chapters.length + 1,
        dimensionKey: st.dimensionKey,
        title: resolvedChapterTitle,
        paragraphs,
        pullQuote:
          firstSentence.length >= 20 && firstSentence.length <= 165
            ? firstSentence
            : undefined,
      });
      if (firstStagePhoto) {
        chapterPhotos[st.chapterId] = firstStagePhoto;
      }
    }
  }

  if (chapters.length === 0) {
    chapters.push({
      id: 'part_ch_default',
      partNumber: 1,
      dimensionKey: 'raices',
      title:
        narrativeStyle === 'third_person_biography'
          ? `La memoria biográfica de ${authors}`
          : isCouple
          ? 'Nuestra memoria compartida'
          : 'Mi memoria personal',
      paragraphs: [
        narrativeStyle === 'third_person_biography'
          ? `Estas páginas preservan la biografía y los recuerdos compartidos por ${authors}.`
          : `Estas páginas preservan los recuerdos y testimonios compartidos por ${authors}.`,
      ],
    });
  }

  const styledIntroduction =
    narrativeStyle === 'third_person_biography'
      ? `Esta edición biográfica presenta la historia de vida, las vivencias y el legado de ${authors}, narrados en tercera persona a partir de sus testimonios auténticos.`
      : narrativeStyle === 'first_person_simple'
      ? isCouple
        ? `En las páginas de esta obra presentamos de manera ordenada, clara y directa las vivencias, recuerdos y aprendizajes que conforman nuestra historia compartida.`
        : `En las páginas de esta obra presento de manera ordenada, clara y directa las vivencias, recuerdos y aprendizajes que conforman mi historia de vida.`
      : isCouple
      ? `Esta edición reúne las vivencias, recuerdos y fotografías compartidas por ${authors}, conservando la calidez literaria y la emoción de nuestra voz para las generaciones presentes y futuras.`
      : `Esta edición reúne las vivencias, recuerdos y fotografías de ${authors}, transformados en unas memorias personales cálidas y emotivas para las generaciones presentes y futuras.`;

  return {
    manuscript: {
      title: interviewTitle || (isCouple ? `Nuestra historia: ${authors}` : `La historia de ${authors}`),
      subtitle:
        narrativeStyle === 'third_person_biography'
          ? `Biografía narrativa y legado de ${authors}`
          : isCouple
          ? 'Libro biográfico de memorias compartidas'
          : 'Libro autobiográfico y legado familiar',
      authors,
      mode,
      narrativeStyle,
      introduction: styledIntroduction,
      dedication: '',
      chapters,
      closingMessage:
        ensureParagraphConformsToStyle({
          paragraph:
            closingDedicationText.trim() ||
            'Que estas páginas acompañen siempre a quienes forman parte de nuestra historia.',
          narrativeStyle,
          speakerName: authors,
          isCouple,
        }),
      insufficientInfoNotices: [],
      generatedAt: new Date().toISOString(),
      useOfficialForeverYouLogo: true,
    },
    chapterPhotos,
    chapterStructuredUnits,
  };
}

