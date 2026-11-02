export type DemoStageId = 'infancia' | 'juventud' | 'adultez' | 'madurez' | 'legado_general';
export type DemoInterviewMode = 'individual' | 'compartida';
export type BookEditionType = 'cronologica' | 'tematica';

export interface DemoStagePreset {
  id: DemoStageId;
  label: string;
  periodLabel: string;
  baseQuestionIndividual: string;
  baseQuestionShared: string;
  sampleAnswerIndividual: string;
  sampleAnswerShared: string;
  defaultFollowUpIndividual: string;
  defaultFollowUpShared: string;
  extractedContextTags: string[];
}

export interface SimuladorChatMessage {
  id: string;
  sender: 'ai' | 'user';
  roleLabel: string;
  text: string;
  isFollowUp?: boolean;
  detectedMotifs?: string[];
}

export interface BookChapterSample {
  id: string;
  edition: BookEditionType;
  chapterNumber: string;
  title: string;
  subtitle: string;
  pageNumber: number;
  excerptParagraphs: string[];
  originalVoiceQuote: string;
  audioDuration: string;
  stageReference: string;
  photoYear: string;
  photoLocation: string;
  photoTitle: string;
  photoCaption: string;
  photoPalette: {
    bgFrom: string;
    bgTo: string;
    accent: string;
  };
}

export interface LegacyLayoutDisposition {
  sliderValue: number;
  photoWeight: number;
  transcriptionWeight: number;
  mode: 'photo-focus' | 'balanced' | 'transcription-focus';
  modeLabel: string;
}

export interface DemoPhotoMemory {
  id: string;
  year: string;
  location: string;
  title: string;
  caption: string;
  stageLabel: string;
  palette: {
    bgFrom: string;
    bgTo: string;
    accent: string;
  };
}

export interface InquiryFormInput {
  fullName: string;
  contactInfo: string;
  recipientRelation: string;
  modality: 'individual' | 'compartida' | 'familiar';
  message: string;
}

export interface InquiryValidationResult {
  valid: boolean;
  errors: {
    fullName?: string;
    contactInfo?: string;
    recipientRelation?: string;
  };
}

export const DEMO_STAGE_PRESETS: DemoStagePreset[] = [
  {
    id: 'infancia',
    label: '01. Infancia',
    periodLabel: 'Hogar y raíces',
    baseQuestionIndividual: '¿Cómo recuerdas la casa donde creciste y cuál era tu rincón favorito cuando eras niño?',
    baseQuestionShared: '¿Qué recuerdos de la infancia descubrieron que tenían en común cuando se conocieron?',
    sampleAnswerIndividual:
      'Crecimos en una casa con patio de geranios en Guadalajara. Mi abuela Elena horneaba pan por las tardes y nos sentábamos a escuchar la radio.',
    sampleAnswerShared:
      'Los dos recordábamos los domingos en la plaza principal escuchando la banda municipal con nuestros abuelos y el aroma a tierra mojada.',
    defaultFollowUpIndividual:
      'Mencionas a tu abuela Elena y aquellas tardes escuchando la radio entre el aroma a pan recién horneado en Guadalajara. ¿Qué enseñanza de ella sientes que te acompañó toda la vida?',
    defaultFollowUpShared:
      'Qué coincidencia compartir esos domingos de plaza con sus abuelos. ¿Qué valores familiares sintieron que los unían desde antes de conocerse?',
    extractedContextTags: ['Abuela Elena', 'Patio de geranios', 'Guadalajara', 'Tardes de radio'],
  },
  {
    id: 'juventud',
    label: '02. Juventud',
    periodLabel: 'Sueños y estudios',
    baseQuestionIndividual: '¿Cuál fue la decisión o momento en tu juventud que cambió el rumbo de tu camino?',
    baseQuestionShared: '¿Cómo fue el día en que se vieron por primera vez y qué pensó cada uno en ese instante?',
    sampleAnswerIndividual:
      'A los 19 años conseguí mi primera beca para estudiar en la capital. Viajé con una maleta de cuero de mi padre y una carta escrita por mi madre.',
    sampleAnswerShared:
      'Nos conocimos en el café de la universidad una tarde lluviosa de octubre de 1972. Compartimos un paraguas y caminamos diez cuadras platicando sin parar.',
    defaultFollowUpIndividual:
      'Recuerdas con mucha claridad aquella maleta de cuero de tu padre y la carta de tu madre a los 19 años. ¿Qué decía esa carta y qué sentiste tu primera noche lejos de casa?',
    defaultFollowUpShared:
      'Aquella caminata bajo la lluvia en octubre de 1972 marcó el inicio de todo. ¿De qué platicaron durante esas diez cuadras y cuándo supieron que querían volver a verse?',
    extractedContextTags: ['Maleta de cuero', 'Carta materna', '19 años', 'Primer viaje'],
  },
  {
    id: 'adultez',
    label: '03. Adultez',
    periodLabel: 'Hogar y vocación',
    baseQuestionIndividual: '¿Cuál fue el mayor reto al formar tu propio hogar y cómo lograste superarlo?',
    baseQuestionShared: '¿Cómo recuerdan la etapa en que construyeron su primer hogar juntos y llegaron los hijos?',
    sampleAnswerIndividual:
      'En 1985 empezamos de cero nuestro pequeño taller familiar. Trabajábamos día y noche, pero nunca faltó la risa en la mesa ni el apoyo de mis hermanos.',
    sampleAnswerShared:
      'Nuestro primer departamento tenía apenas dos sillas y una mesa pequeña, pero ahí celebramos la llegada de nuestra hija mayor con amigos y guitarra.',
    defaultFollowUpIndividual:
      'Empezar de cero el taller familiar en 1985 requirió gran fortaleza. ¿Qué momento de unión con tus hermanos recuerdas con más gratitud al ver prosperar su esfuerzo?',
    defaultFollowUpShared:
      'Aquel primer departamento con dos sillas y guitarra guarda la esencia de su familia. ¿Cómo transformó la llegada de su hija mayor su manera de ver la vida?',
    extractedContextTags: ['Taller familiar', 'Año 1985', 'Unión fraternal', 'Resiliencia'],
  },
  {
    id: 'madurez',
    label: '04. Madurez',
    periodLabel: 'Plenitud y cosecha',
    baseQuestionIndividual: 'Al mirar atrás con serenidad, ¿de qué logro familiar o personal te sientes más orgulloso hoy?',
    baseQuestionShared: 'Después de tantas décadas juntos, ¿cuál ha sido el secreto para mantener vivo su compañerismo?',
    sampleAnswerIndividual:
      'Ver a mis hijos y nietos reunidos en la misma mesa donde nos sentábamos nosotros, sabiendo que se quieren y mantienen vivas nuestras costumbres.',
    sampleAnswerShared:
      'Nunca irnos a dormir sin darnos la mano y agradecer por el día, tanto en tiempos de abundancia como en las pruebas que superamos juntos.',
    defaultFollowUpIndividual:
      'Ver esa mesa familiar llena de tus hijos y nietos refleja lo que sembraste. ¿Cuál costumbre familiar te emociona más ver que tus nietos siguen practicando hoy?',
    defaultFollowUpShared:
      'Ese pacto de darse la mano y agradecer cada noche habla de un amor profundo. ¿Recuerdan algún momento difícil en que ese gesto les devolvió la paz?',
    extractedContextTags: ['Mesa familiar', 'Nietos', 'Costumbres vivas', 'Gratitud'],
  },
  {
    id: 'legado_general',
    label: '05. Legado',
    periodLabel: 'Mensaje al futuro',
    baseQuestionIndividual: 'Si tus bisnietos leyeran este libro dentro de cincuenta años, ¿qué consejo te gustaría dejarles?',
    baseQuestionShared: '¿Qué mensaje desean dejar escrito juntos para las próximas generaciones de su familia?',
    sampleAnswerIndividual:
      'Que nunca cambien la honestidad ni el tiempo con quienes aman por la prisa del mundo. La verdadera riqueza es tener paz y una familia donde regresar.',
    sampleAnswerShared:
      'Que cuiden el amor familiar con paciencia y ternura, recordando que su historia comenzó con dos personas que creyeron en la bondad y el trabajo honrado.',
    defaultFollowUpIndividual:
      'Hablas de la paz interior y de tener siempre un hogar al cual regresar. ¿Quién fue la persona en tu vida que te enseñó con su ejemplo el valor de esa honestidad?',
    defaultFollowUpShared:
      'Su mensaje sobre la paciencia y el trabajo honrado es una guía para el futuro. ¿Qué anécdota de su vida juntos les gustaría que sus bisnietos contaran con orgullo?',
    extractedContextTags: ['Honestidad', 'Paz interior', 'Futuras generaciones', 'Hogar'],
  },
];

export const SAMPLE_BOOK_CHAPTERS: BookChapterSample[] = [
  {
    id: 'cron-1',
    edition: 'cronologica',
    chapterNumber: 'Capítulo I',
    title: 'El Patio de los Geranios y la Voz de la Abuela',
    subtitle: 'Guadalajara, 1948 – 1962',
    pageNumber: 14,
    stageReference: 'Etapa: Infancia · Audio y Foto vinculados',
    audioDuration: '02:45 min',
    originalVoiceQuote:
      '«Mi abuela Elena sacaba las charolas de pan tibio a las seis de la tarde; ese olor a canela y leña sigue siendo para mí el verdadero significado de hogar.»',
    excerptParagraphs: [
      'Crecimos en una casa de techos altos con un patio central lleno de macetas con geranios rojos en Guadalajara. Por las tardes jugábamos bajo la sombra del limonero mientras mi abuela Elena horneaba pan y escuchábamos la radio.',
      'Ella no necesitaba alzar la voz para enseñarnos; bastaba con ver el cariño con el que repartía cada pieza de pan entre nosotros y los vecinos del barrio.',
    ],
    photoYear: 'Octubre 1954',
    photoLocation: 'Barrio de Analco, Guadalajara',
    photoTitle: 'Tarde de domingo en el patio de la abuela Elena',
    photoCaption:
      '«Fotografía tomada con la cámara de rollo de mi tío Roberto. Al fondo se ven las macetas de geranios que cuidaba mi abuela.»',
    photoPalette: {
      bgFrom: '#451a03',
      bgTo: '#78350f',
      accent: '#f59e0b',
    },
  },
  {
    id: 'cron-2',
    edition: 'cronologica',
    chapterNumber: 'Capítulo II',
    title: 'Una Maleta de Cuero y una Carta Doblada',
    subtitle: 'El Viaje a la Capital, 1967',
    pageNumber: 42,
    stageReference: 'Etapa: Juventud · Audio y Foto vinculados',
    audioDuration: '03:18 min',
    originalVoiceQuote:
      '«Cuando abrí la maleta en aquella habitación estudiantil, encontré la carta de mi madre entre mis camisas. La leí tres veces antes de dormir.»',
    excerptParagraphs: [
      'Cuando cumplí diecinueve años conseguí mi primera beca para estudiar ingeniería en la capital. Viajé en el autobús nocturno con una sola maleta de cuero café que me prestó mi padre.',
      'Dentro llevaba una carta escrita a mano por mi madre recordándome que ningún título valía más que la palabra empeñada y que en casa siempre habría un lugar esperándome.',
    ],
    photoYear: 'Septiembre 1967',
    photoLocation: 'Estación Central de Autobuses',
    photoTitle: 'El día de mi partida hacia la universidad',
    photoCaption:
      '«Con mi padre antes de abordar el autobús nocturno. En mi mano derecha llevo la maleta de cuero que me acompañó toda la carrera.»',
    photoPalette: {
      bgFrom: '#1c1917',
      bgTo: '#44403c',
      accent: '#d97706',
    },
  },
  {
    id: 'tem-1',
    edition: 'tematica',
    chapterNumber: 'Capítulo III',
    title: 'El Amor que Construyó Nuestro Hogar',
    subtitle: 'Encuentros y Promesas, 1972',
    pageNumber: 68,
    stageReference: 'Historia en Pareja · Audio y Foto vinculados',
    audioDuration: '04:05 min',
    originalVoiceQuote:
      '«Caminamos diez cuadras bajo un mismo paraguas en octubre de 1972 y sentimos que la conversación había empezado muchos años atrás.»',
    excerptParagraphs: [
      'Nuestra historia compartida nació en una tarde lluviosa de octubre de 1972, afuera del café de la universidad. Aquel paraguas prestado fue el inicio de una caminata sin prisa por diez cuadras.',
      'En nuestro primer departamento mantuvimos intacta la misma costumbre: escucharnos al final del día y nunca irnos a dormir sin darnos la mano con gratitud.',
    ],
    photoYear: 'Noviembre 1972',
    photoLocation: 'Café de la Universidad',
    photoTitle: 'Nuestro primer otoño juntos',
    photoCaption:
      '«Un mes después de aquella caminata bajo la lluvia. Aquí ya sabíamos que queríamos construir toda una vida juntos.»',
    photoPalette: {
      bgFrom: '#31102F',
      bgTo: '#581C4F',
      accent: '#FBBF24',
    },
  },
  {
    id: 'tem-2',
    edition: 'tematica',
    chapterNumber: 'Capítulo IV',
    title: 'Lecciones de Vida para Nuestros Nietos',
    subtitle: 'Valores y Trabajo Honrado, 1985',
    pageNumber: 96,
    stageReference: 'Etapa: Legado · Audio y Foto vinculados',
    audioDuration: '02:52 min',
    originalVoiceQuote:
      '«La verdadera riqueza está en tener paz en la conciencia y una mesa familiar donde todos sepan que siempre pueden regresar.»',
    excerptParagraphs: [
      'En 1985 aprendimos que los bienes materiales pueden levantarse de nuevo con esfuerzo, pero la unión entre hermanos y el buen nombre permanecen para siempre.',
      'A quienes lean estas páginas dentro de cincuenta años les dejamos esta certeza: nunca cambien la honestidad ni el tiempo con quienes aman por la prisa del mundo.',
    ],
    photoYear: 'Mayo 1985',
    photoLocation: 'Primer Taller Familiar',
    photoTitle: 'Inauguración de nuestro taller con mis hermanos',
    photoCaption:
      '«Recién pintada la fachada. No teníamos grandes máquinas todavía, pero nos sobraba entusiasmo y fe en el porvenir.»',
    photoPalette: {
      bgFrom: '#1e293b',
      bgTo: '#334155',
      accent: '#eab308',
    },
  },
];

export const DEMO_PHOTO_MEMORIES: DemoPhotoMemory[] = [
  {
    id: 'photo-1968',
    year: 'Octubre 1968',
    location: 'Plaza de los Laureles, Guadalajara',
    title: 'Domingo en la plaza con los abuelos',
    caption:
      '«Esta fotografía la tomó mi tío Roberto después de misa. Todavía recuerdo el sonido de las campanas.»',
    stageLabel: 'Infancia y Familia',
    palette: {
      bgFrom: '#451a03',
      bgTo: '#78350f',
      accent: '#f59e0b',
    },
  },
  {
    id: 'photo-1972',
    year: 'Noviembre 1972',
    location: 'Café de la Universidad',
    title: 'Nuestro primer otoño juntos',
    caption:
      '«Un mes después de aquella caminata bajo la lluvia. Aquí ya sabíamos que construiríamos una vida juntos.»',
    stageLabel: 'Juventud y Encuentro',
    palette: {
      bgFrom: '#1c1917',
      bgTo: '#44403c',
      accent: '#d97706',
    },
  },
  {
    id: 'photo-1985',
    year: 'Mayo 1985',
    location: 'Primer Taller Familiar',
    title: 'El día que abrimos las puertas del taller',
    caption:
      '«Recién pintada la fachada con ayuda de mis hermanos. Nos sobraba entusiasmo y fe en el futuro.»',
    stageLabel: 'Adultez y Vocación',
    palette: {
      bgFrom: '#1e293b',
      bgTo: '#334155',
      accent: '#eab308',
    },
  },
];

/**
 * Generates an empathetic, context-grounded follow-up question based on the participant's answer
 * without inventing facts or saving anything to Firestore.
 */
export function generateDemoFollowUpQuestion(
  stageId: DemoStageId,
  mode: DemoInterviewMode,
  userResponseText: string
): { followUpQuestion: string; detectedMotifs: string[] } {
  const preset = DEMO_STAGE_PRESETS.find((p) => p.id === stageId) || DEMO_STAGE_PRESETS[0];
  const cleanText = userResponseText.trim();

  if (!cleanText) {
    return {
      followUpQuestion:
        mode === 'compartida' ? preset.defaultFollowUpShared : preset.defaultFollowUpIndividual,
      detectedMotifs: preset.extractedContextTags,
    };
  }

  if (
    cleanText === preset.sampleAnswerIndividual.trim() ||
    cleanText === preset.sampleAnswerShared.trim()
  ) {
    return {
      followUpQuestion:
        mode === 'compartida' ? preset.defaultFollowUpShared : preset.defaultFollowUpIndividual,
      detectedMotifs: preset.extractedContextTags,
    };
  }

  const stopwords = new Set([
    'cuando',
    'donde',
    'porque',
    'habia',
    'había',
    'tenia',
    'tenía',
    'mucho',
    'mucha',
    'todos',
    'todas',
    'siempre',
    'nunca',
    'desde',
    'hasta',
    'entre',
    'sobre',
    'nosotros',
    'estaba',
    'fueron',
    'recuerdo',
    'hacia',
  ]);

  const words = cleanText
    .replace(/[.,;:¡!¿?"'()«»]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !stopwords.has(w.toLowerCase()));

  const uniqueMotifs = Array.from(new Set(words.slice(0, 4)));
  const primaryMotif = uniqueMotifs[0] || 'ese momento tan especial';
  const secondaryMotif = uniqueMotifs[1] ? ` y "${uniqueMotifs[1]}"` : '';

  if (mode === 'compartida') {
    return {
      followUpQuestion: `Al escucharles recordar "${primaryMotif}"${secondaryMotif}, se percibe un vínculo muy especial. ¿Qué sintió cada uno en ese instante y cómo influyó esa vivencia en su camino juntos?`,
      detectedMotifs: uniqueMotifs.length > 0 ? uniqueMotifs : ['Recuerdo compartido', 'Vínculo familiar'],
    };
  }

  return {
    followUpQuestion: `Mencionas "${primaryMotif}"${secondaryMotif} como parte importante de este recuerdo. Si vuelves a ese instante, ¿qué personas estaban contigo y qué enseñanza dejó en tu vida?`,
    detectedMotifs: uniqueMotifs.length > 0 ? uniqueMotifs : ['Memoria personal', 'Huella de vida'],
  };
}

/**
 * Creates the initial in-memory chat thread for the Simulador de Entrevista.
 */
export function createInitialChatThread(
  stageId: DemoStageId,
  mode: DemoInterviewMode
): SimuladorChatMessage[] {
  const preset = DEMO_STAGE_PRESETS.find((p) => p.id === stageId) || DEMO_STAGE_PRESETS[0];
  const initialQuestion =
    mode === 'compartida' ? preset.baseQuestionShared : preset.baseQuestionIndividual;

  return [
    {
      id: `ai-init-${stageId}-${mode}`,
      sender: 'ai',
      roleLabel: 'Entrevistador IA · Pregunta Inicial',
      text: initialQuestion,
      isFollowUp: false,
    },
  ];
}

/**
 * Computes the visual layout disposition of photos vs. transcriptions for the Legacy Book Preview slider.
 */
export function computeLegacyLayoutDisposition(sliderValue: number): LegacyLayoutDisposition {
  const clamped = Math.max(0, Math.min(100, Math.round(sliderValue)));
  const photoWeight = clamped;
  const transcriptionWeight = 100 - clamped;

  if (clamped >= 65) {
    return {
      sliderValue: clamped,
      photoWeight,
      transcriptionWeight,
      mode: 'photo-focus',
      modeLabel: `Protagonismo Fotográfico (${photoWeight}% Foto · ${transcriptionWeight}% Transcripción)`,
    };
  }

  if (clamped <= 35) {
    return {
      sliderValue: clamped,
      photoWeight,
      transcriptionWeight,
      mode: 'transcription-focus',
      modeLabel: `Protagonismo Narrativo (${photoWeight}% Foto · ${transcriptionWeight}% Transcripción)`,
    };
  }

  return {
    sliderValue: clamped,
    photoWeight,
    transcriptionWeight,
    mode: 'balanced',
    modeLabel: `Disposición Editorial Equilibrada (${photoWeight}% Foto · ${transcriptionWeight}% Transcripción)`,
  };
}

/**
 * Validates the commercial gift/contact inquiry form without substituting fake fallbacks.
 */
export function validateInquiryForm(input: InquiryFormInput): InquiryValidationResult {
  const errors: InquiryValidationResult['errors'] = {};

  const nameClean = (input.fullName || '').trim();
  const contactClean = (input.contactInfo || '').trim();
  const relationClean = (input.recipientRelation || '').trim();

  if (nameClean.length < 2) {
    errors.fullName = 'Por favor ingresa tu nombre completo.';
  }

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactClean);
  const digitsOnly = contactClean.replace(/\D/g, '');
  const isPhone = digitsOnly.length >= 8 && digitsOnly.length <= 15;

  if (!contactClean) {
    errors.contactInfo = 'Ingresa tu correo electrónico o número de WhatsApp.';
  } else if (!isEmail && !isPhone) {
    errors.contactInfo = 'Ingresa un correo válido (ej. nombre@correo.com) o teléfono de 10 dígitos.';
  }

  if (relationClean.length < 2) {
    errors.recipientRelation = 'Indica para quién deseas regalar la historia (ej. Mis padres, Mi abuela).';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function buildWhatsAppInquiryUrl(input: Partial<InquiryFormInput>): string {
  const modalityLabels: Record<string, string> = {
    individual: 'Legado Individual',
    compartida: 'Historia Compartida (Pareja)',
    familiar: 'Edición Familiar Especial',
  };
  const chosenModality = modalityLabels[input.modality || 'individual'] || 'Legado Individual';
  const namePart = input.fullName?.trim() ? `Soy ${input.fullName.trim()}. ` : '';
  const relationPart = input.recipientRelation?.trim()
    ? `Me interesa regalar ForeverYou para: ${input.recipientRelation.trim()} (${chosenModality}). `
    : `Me interesa conocer más sobre ForeverYou en la modalidad ${chosenModality}. `;
  const extraMsg = input.message?.trim() ? `Detalles adicionales: ${input.message.trim()}` : '';

  const fullText = `Hola, vengo de la página /conoceme de ForeverYou. ${namePart}${relationPart}${extraMsg}`.trim();
  return `https://wa.me/?text=${encodeURIComponent(fullText)}`;
}

export function buildMailtoInquiryUrl(input: Partial<InquiryFormInput>): string {
  const subject = `Interés en ForeverYou - Regalo de Historia de Vida${
    input.recipientRelation?.trim() ? ` (${input.recipientRelation.trim()})` : ''
  }`;
  const bodyLines = [
    'Hola equipo de ForeverYou,',
    '',
    'Me gustaría recibir atención personalizada para adquirir ForeverYou.',
    input.fullName?.trim() ? `• Nombre: ${input.fullName.trim()}` : '',
    input.contactInfo?.trim() ? `• Contacto: ${input.contactInfo.trim()}` : '',
    input.recipientRelation?.trim() ? `• Para quién es la entrevista: ${input.recipientRelation.trim()}` : '',
    input.modality ? `• Modalidad de interés: ${input.modality}` : '',
    input.message?.trim() ? `• Comentarios: ${input.message.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `mailto:garcia.michel@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines)}`;
}
