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
export const DEMO_CLOSING_PAGE_BRAND_MARK = '<< ForeverYou >>';

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
    return `ForeverYou_Nuestra_Historia_${p1}_y_${p2}.pdf`;
  }

  const name = sanitizeSegment(profile.displayName || profile.fullName || 'Protagonista') || 'Protagonista';
  return `ForeverYou_Mi_Historia_${name}.pdf`;
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
}): ComposedBookDocument {
  const {
    manuscript,
    editorialConfig,
    coverPhoto,
    chapterPhotos = {},
    customClosingPageText,
    maxContentPages = 7,
  } = params;

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

  // Build initial content blocks per chapter, splitting very long chapters across pages according to format capacity
  const rawBlocks: ComposedChapterSectionBlock[] = [];
  const maxChars = format.maxCharsPerContentPage;
  const maxParas = format.maxParagraphsPerPage;

  for (let i = 0; i < validChapters.length; i++) {
    const ch = validChapters[i];
    const chPhoto = chapterPhotos[ch.id] || null;
    const isLastChapter = i === validChapters.length - 1;
    const paragraphsWithClosing = [...ch.paragraphs];
    const closingMsgTrimmed = (manuscript.closingMessage || '').trim();
    const isDuplicateOfClosingPage =
      cleanClosingPagePref.length > 0 &&
      closingMsgTrimmed.toLowerCase() === cleanClosingPagePref.toLowerCase();

    if (
      isLastChapter &&
      closingMsgTrimmed.length > 0 &&
      !isDuplicateOfClosingPage &&
      !paragraphsWithClosing.some((p) => p.includes(closingMsgTrimmed))
    ) {
      paragraphsWithClosing.push(closingMsgTrimmed);
    }

    let currentParas: string[] = [];
    let currentLen = 0;
    let chunkIdx = 0;

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

  // Ensure we have at least 2 content pages so total pages (Cover + Title + Content + Closing) >= 5 pages
  let contentPageGroups: ComposedChapterSectionBlock[][] = rawBlocks.map((b) => [b]);

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

  // Maximum content pages (7 for /demo -> 10 pages total; higher for full interviews)
  const MAX_CONTENT_PAGES = Math.max(2, maxContentPages);
  let exceededMaxPagesWarning = false;

  while (contentPageGroups.length > MAX_CONTENT_PAGES) {
    exceededMaxPagesWarning = true;
    // Combine the two shortest adjacent groups so no text is silently truncated
    let bestIdx = 0;
    let smallestCombinedLen = Infinity;
    for (let i = 0; i < contentPageGroups.length - 1; i++) {
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

  for (const q of DEMO_MAIN_QUESTIONS) {
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

    if (isCouple) {
      if (p1Text) {
        paragraphs.push(
          narrativeStyle === 'third_person_biography'
            ? `En los recuerdos de ${profile.partner1Name}: ${p1Text}`
            : `${profile.partner1Name} recuerda: ${p1Text}`
        );
      }
      if (p2Text) {
        paragraphs.push(
          narrativeStyle === 'third_person_biography'
            ? `Por su parte, ${profile.partner2Name} comparte: ${p2Text}`
            : `${profile.partner2Name} recuerda: ${p2Text}`
        );
      }
      if (mainText) {
        paragraphs.push(mainText);
      }
      if (p1Follow) {
        paragraphs.push(`${profile.partner1Name}: ${p1Follow}`);
      }
      if (p2Follow) {
        paragraphs.push(`${profile.partner2Name}: ${p2Follow}`);
      }
      if (followUpText) {
        paragraphs.push(followUpText);
      }
    } else {
      if (mainText) {
        if (narrativeStyle === 'third_person_biography') {
          paragraphs.push(`En la memoria de ${authors} permanece vivo este recuerdo: ${mainText}`);
        } else {
          paragraphs.push(mainText);
        }
      }
      if (followUpText && resp.followUpOmission === 'none') {
        paragraphs.push(followUpText);
      }
    }

    if (paragraphs.length > 0) {
      const pullQuoteCandidate = paragraphs[0].split(/(?<=[.!?])\s+/)[0] || '';
      chapters.push({
        id: q.id,
        partNumber: chapters.length + 1,
        dimensionKey: q.dimensionKey,
        title: isCouple ? q.coupleBookPartTitle : q.individualBookPartTitle,
        paragraphs,
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
  const closingMessage =
    legacyResp?.mainAnswerText?.trim() ||
    (isCouple
      ? 'Cada recuerdo compartido en estas páginas guarda la esencia de nuestro camino juntos.'
      : 'Cada recuerdo reunido en estas páginas guarda la esencia de mi historia para quienes amo.');

  return {
    title: defaultTitle,
    subtitle: defaultSubtitle,
    authors,
    mode: profile.mode,
    narrativeStyle,
    introduction: isCouple
      ? `Estas páginas reúnen recuerdos auténticos compartidos por ${authors}, conservando sus propias palabras, afectos y vivencias.`
      : `Estas páginas reúnen recuerdos auténticos de ${authors}, conservados con fidelidad a su voz y a su memoria.`,
    dedication,
    chapters,
    closingMessage,
    insufficientInfoNotices,
    generatedAt: new Date().toISOString(),
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
 * Transforms an interview's real answers, questions, and uploaded photographs into a structured
 * DemoManuscript and chapterPhotos map, respecting the chosen narrative style and story mode.
 */
export function buildParticipantInitialManuscriptFromAnswers(params: {
  interviewTitle: string;
  storyMode: 'individual' | 'compartida';
  participantNames: string[];
  answers: Array<{
    id: string;
    questionId: string;
    questionText?: string;
    participantName: string;
    answerText: string;
    notRecalled: boolean;
    isFollowUp?: boolean;
    parentQuestionId?: string | null;
    isAdditionalMemory?: boolean;
    photos?: Array<{
      id: string;
      caption: string;
      mimeType: string;
      imageUrl: string;
      dataUrl?: string;
    }>;
  }>;
  questions: Array<{
    id: string;
    text: string;
    lifeStage: string;
    topic: string;
  }>;
  narrativeStyle: DemoNarrativeStyleId;
  closingDedicationText?: string;
}): {
  manuscript: DemoManuscript;
  chapterPhotos: Record<string, DemoInMemoryPhoto | null>;
} {
  const {
    interviewTitle,
    storyMode,
    participantNames,
    answers,
    questions,
    narrativeStyle,
    closingDedicationText = '',
  } = params;

  const isCouple = storyMode === 'compartida' && participantNames.length >= 2;
  const mode: DemoStoryMode = isCouple ? 'pareja' : 'individual';
  const authors =
    participantNames.length > 0 ? participantNames.join(' y ') : 'Protagonista';

  const qMap = new Map(questions.map((q) => [q.id, q]));

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

  const chapters: DemoChapterManuscript[] = [];
  const chapterPhotos: Record<string, DemoInMemoryPhoto | null> = {};

  for (const st of stageDefs) {
    const stageAnswers = answers.filter((a) => {
      if (a.notRecalled || !a.answerText || a.answerText.trim().length === 0) {
        return a.photos && a.photos.length > 0;
      }
      const q = qMap.get(a.questionId);
      const parentQ = a.parentQuestionId ? qMap.get(a.parentQuestionId) : undefined;
      const resolvedStage =
        q?.lifeStage ||
        parentQ?.lifeStage ||
        (a.isAdditionalMemory ? 'legado_general' : 'adultez');
      return resolvedStage === st.stageKey;
    });

    if (stageAnswers.length === 0) continue;

    const paragraphs: string[] = [];
    let firstStagePhoto: DemoInMemoryPhoto | null = null;

    for (const ans of stageAnswers) {
      const cleanText = (ans.answerText || '').trim();
      if (cleanText.length > 0 && !ans.notRecalled) {
        if (narrativeStyle === 'third_person_biography') {
          paragraphs.push(
            isCouple
              ? `En las memorias compartidas por ${ans.participantName}: ${cleanText}`
              : `${ans.participantName} evoca así este pasaje de su vida: ${cleanText}`
          );
        } else if (isCouple && participantNames.length > 1) {
          paragraphs.push(`${ans.participantName}: ${cleanText}`);
        } else {
          paragraphs.push(cleanText);
        }
      }

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
    }

    if (paragraphs.length > 0) {
      const firstSentence = paragraphs[0].split(/(?<=[.!?])\s+/)[0] || '';
      chapters.push({
        id: st.chapterId,
        partNumber: chapters.length + 1,
        dimensionKey: st.dimensionKey,
        title: isCouple ? st.coupleTitle : st.individualTitle,
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
      title: isCouple ? 'Nuestra memoria compartida' : 'Mi memoria personal',
      paragraphs: [
        isCouple
          ? `Estas páginas preservan los recuerdos y testimonios compartidos por ${authors}.`
          : `Estas páginas preservan los recuerdos y testimonios compartidos por ${authors}.`,
      ],
    });
  }

  return {
    manuscript: {
      title: interviewTitle || (isCouple ? `Nuestra historia: ${authors}` : `La historia de ${authors}`),
      subtitle: isCouple
        ? 'Libro biográfico de memorias compartidas'
        : 'Libro autobiográfico y legado familiar',
      authors,
      mode,
      narrativeStyle,
      introduction: isCouple
        ? `Esta edición reúne las vivencias, recuerdos y fotografías compartidas por ${authors}, conservando la autenticidad de su voz para las generaciones presentes y futuras.`
        : `Esta edición reúne las vivencias, recuerdos y fotografías de ${authors}, conservando la autenticidad de su voz para las generaciones presentes y futuras.`,
      dedication: '',
      chapters,
      closingMessage:
        closingDedicationText.trim() ||
        'Que estas páginas acompañen siempre a quienes forman parte de nuestra historia.',
      insufficientInfoNotices: [],
      generatedAt: new Date().toISOString(),
    },
    chapterPhotos,
  };
}

