/**
 * V5.8.0 — Sample book of the «Conóceme» page («Vista Previa Interactiva del Legado»).
 *
 * A complete, well written biography in THIRD PERSON (style C, «Biografía narrativa»), long enough for
 * every chapter to fill its pages, laid out with the same measured layout as the books of the
 * participant portal (ScaledBookPageView + useMeasuredBook). Everything is in memory: no Firestore.
 *
 * The facts are the ones the rest of «Conóceme» already shows (SAMPLE_BOOK_CHAPTERS): Guadalajara
 * 1948–1962, the trip to the capital in 1967, the umbrella of October 1972 and the lessons of 1985.
 */
import type { DemoEditorialConfig, DemoInMemoryPhoto, DemoManuscript } from './demoStoryRules.ts';

/** Archival sepia-toned SVG photograph (data URI) used by the sample book. */
export function buildArchivalSamplePhotoDataUrl(params: {
  title: string;
  subtitle: string;
  year: string;
  bgFrom: string;
  bgTo: string;
  accent: string;
}): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520" viewBox="0 0 800 520">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${params.bgFrom}" />
        <stop offset="100%" stop-color="${params.bgTo}" />
      </linearGradient>
    </defs>
    <rect width="800" height="520" fill="url(#bg)" rx="12" />
    <rect x="24" y="24" width="752" height="472" fill="none" stroke="${params.accent}" stroke-opacity="0.45" stroke-width="2" rx="8" />
    <circle cx="400" cy="210" r="68" fill="none" stroke="${params.accent}" stroke-opacity="0.55" stroke-width="2" />
    <path d="M350 280 C365 245, 435 245, 450 280" fill="none" stroke="${params.accent}" stroke-opacity="0.65" stroke-width="3" stroke-linecap="round" />
    <text x="400" y="105" text-anchor="middle" fill="${params.accent}" font-family="Georgia, serif" font-size="18" letter-spacing="3">${params.year.toUpperCase()}</text>
    <text x="400" y="365" text-anchor="middle" fill="#FAF8F5" font-family="Georgia, serif" font-size="25" font-weight="bold">${params.title}</text>
    <text x="400" y="405" text-anchor="middle" fill="#E7E0D6" font-family="Georgia, serif" font-size="17" font-style="italic">${params.subtitle}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const SAMPLE_TITLE = 'El Patio de los Geranios';
const SAMPLE_SUBTITLE = 'Biografía de Elena Martínez de Gómez';
const SAMPLE_AUTHOR = 'Elena Martínez de Gómez';
const SAMPLE_DEDICATION =
  'Para mis hijos y nietos: que cada vez que abran estas páginas recuerden que nuestra mayor fortuna siempre ha sido querernos y caminar juntos con honestidad.';

export const CONOCEME_SAMPLE_EDITORIAL_CONFIG: DemoEditorialConfig = {
  narrativeStyle: 'third_person_biography',
  coverDesignId: 'clasica_eterna',
  coverColorVariantIdx: 0,
  coverVisualType: 'illustration',
  coverIllustrationId: 'arbol_raices',
  interiorStyleId: 'clasico_editorial',
  bookFormatId: '6x9',
  customTitle: SAMPLE_TITLE,
  customSubtitle: SAMPLE_SUBTITLE,
  customAuthors: SAMPLE_AUTHOR,
  dedication: SAMPLE_DEDICATION,
};

export const CONOCEME_SAMPLE_MANUSCRIPT: DemoManuscript = {
  title: SAMPLE_TITLE,
  subtitle: SAMPLE_SUBTITLE,
  authors: SAMPLE_AUTHOR,
  mode: 'individual',
  narrativeStyle: 'third_person_biography',
  dedication: SAMPLE_DEDICATION,
  introduction:
    'Este libro reúne los recuerdos que Elena Martínez de Gómez compartió en YouForever a lo largo de varias tardes de conversación: sus respuestas escritas, sus grabaciones de voz y las fotografías que guardó durante más de setenta años. Cada página respeta sus palabras y su manera de contar. Aquí está la niña que creció entre geranios en Guadalajara, la joven que se atrevió a viajar sola a la capital, la mujer que construyó un hogar bajo un paraguas prestado y la abuela que quiso dejar por escrito lo que la vida le enseñó.',
  closingMessage: 'Esta historia continuará...',
  insufficientInfoNotices: [],
  generatedAt: '2026-03-20T12:00:00.000Z',
  useOfficialForeverYouLogo: true,
  // Written like the books of the portal (style C already applied): keep the text exactly as written.
  aiGenerated: true,
  chapters: [
    {
      id: 'cap-1',
      partNumber: 1,
      dimensionKey: 'raices',
      title: 'El Patio de los Geranios y la Voz de la Abuela',
      paragraphs: [
        'Elena nació en 1948 en una casa de techos altos del Barrio de Analco, en Guadalajara, donde el día empezaba con las campanas de San José y terminaba con el olor del pan recién horneado. La casa se ordenaba alrededor de un patio central lleno de macetas de barro con geranios rojos, y en ese patio transcurrió casi toda su infancia: ahí aprendió a caminar, a leer en voz alta y a escuchar a los mayores sin interrumpir.',
        'La figura más importante de aquellos años fue su abuela, también llamada Elena. Era una mujer menuda, de manos fuertes, que se levantaba antes que nadie para encender el horno de leña. Cada tarde, a las seis en punto, sacaba las charolas de pan tibio y las repartía entre sus nietos y los vecinos del barrio. Nunca necesitó alzar la voz para enseñar algo; bastaba con ver el cuidado con el que partía cada pieza para que todos entendieran que en esa casa lo que había se compartía.',
        'Mientras el pan se enfriaba, la radio de bulbos llenaba el patio con boleros y radionovelas. Elena y sus primos jugaban bajo la sombra del limonero, inventando historias con los personajes que escuchaban. Cuando oscurecía, la abuela los sentaba en las bancas de hierro y les contaba cómo había llegado a Guadalajara desde un rancho de Los Altos, con un rebozo y una canasta como único equipaje. Elena recordaría toda su vida que su abuela terminaba esas historias con la misma frase: lo que uno sabe hacer con las manos nadie se lo puede quitar.',
        'Su padre trabajaba como tipógrafo en una imprenta del centro y su madre cosía por encargo en la sala, frente a la ventana que daba a la calle. De él heredó el gusto por las letras bien alineadas y los libros cuidados; de ella, la paciencia para terminar lo que empezaba. Los domingos la familia caminaba hasta el jardín de San Francisco y de regreso compraba nieve de garrafa. Eran días sencillos, pero Elena los recordaba como los más ordenados y felices de su vida.',
        'En octubre de 1954 su tío Roberto llegó de visita con una cámara de rollo recién comprada y reunió a toda la familia en el patio. Esa fotografía, con las macetas de geranios al fondo y la abuela sentada al centro, es la imagen más antigua que Elena conservó. Durante décadas la tuvo enmarcada junto a su cama, y cuando alguien le preguntaba por ella respondía que ahí estaba todo lo que necesitaba saber sobre su origen.',
        'La abuela murió en el invierno de 1962, cuando Elena tenía catorce años. La casa siguió en pie, pero el horno de leña ya no volvió a encenderse a las seis. Elena decidió entonces que algún día tendría una cocina propia con la puerta siempre abierta para quien llegara con hambre, y aunque pasaron muchos años antes de cumplirlo, nunca olvidó esa promesa hecha en silencio en el patio de los geranios.',
      ],
      pullQuote:
        'El olor a canela y leña del pan que su abuela sacaba a las seis de la tarde siguió siendo, toda su vida, el verdadero significado de hogar.',
    },
    {
      id: 'cap-2',
      partNumber: 2,
      dimensionKey: 'transformacion',
      title: 'Una Maleta de Cuero y una Carta Doblada',
      paragraphs: [
        'En 1967, cuando cumplió diecinueve años, Elena consiguió una beca para estudiar ingeniería en la Ciudad de México. Era la primera mujer de su familia que iba a la universidad y la única de su generación en el bachillerato que eligió esa carrera. Algunos parientes opinaron que era una locura que una muchacha se fuera sola a la capital; su padre, en cambio, la escuchó en silencio y al día siguiente apareció con su vieja maleta de cuero café, limpia y engrasada, para que se la llevara.',
        'Viajó en el autobús nocturno de septiembre con esa única maleta, un suéter tejido por su madre y una bolsa de pan para el camino. En la estación se despidió de su padre con un abrazo corto, como se hacía entonces, y no lloró hasta que el autobús salió de la ciudad. Pasó la noche mirando por la ventana las luces de los pueblos y repasando mentalmente la dirección de la casa de huéspedes donde la esperaban en la colonia Roma.',
        'Al abrir la maleta en su pequeña habitación encontró, doblada entre las camisas, una carta escrita a mano por su madre. En ella le recordaba que ningún título valía más que la palabra empeñada, que debía comer bien aunque tuviera exámenes y que en casa siempre habría un lugar esperándola. Elena la leyó tres veces antes de dormir. Durante los cinco años de la carrera la guardó en el bolsillo interior de la maleta y la releía cada vez que algo le salía mal. Con los años el papel se volvió tan delgado que tuvo que guardarlo dentro de un sobre para que no se rompiera.',
        'Los primeros meses fueron difíciles. En los salones de la facultad casi no había mujeres, algunos profesores la llamaban señorita con un tono que no era amable y el dinero de la beca apenas alcanzaba para los libros. Para completar sus gastos daba clases de matemáticas a los hijos de la dueña de la casa de huéspedes. Aprendió a moverse en tranvía y en camión, a estudiar en las bibliotecas hasta que las cerraban y a no pedir permiso para ocupar el lugar que se había ganado.',
        'Con el tiempo encontró compañeras y compañeros que se volvieron su familia en la ciudad. Los sábados cocinaban juntos en la azotea y Elena preparaba el pan de su abuela en un horno prestado, ante la sorpresa de quienes nunca habían probado algo así. Fue en esas reuniones donde descubrió que la promesa del patio de los geranios podía cumplirse en cualquier lugar donde hubiera una mesa y gente dispuesta a compartirla.',
        'En 1972 terminó la carrera con uno de los mejores promedios de su generación. Su padre viajó a la ceremonia con el mismo traje de su boda y, al verla recibir el título, sólo alcanzó a decir que la maleta había hecho un buen viaje. Elena la conservó el resto de su vida, con la carta de su madre todavía guardada en el bolsillo interior. Esa noche, de regreso en la casa de huéspedes, escribió a su madre una respuesta de una sola línea para contarle que había cumplido su palabra.',
      ],
      pullQuote:
        'Al abrir la maleta en aquella habitación estudiantil encontró la carta de su madre entre las camisas, y la leyó tres veces antes de dormir.',
    },
    {
      id: 'cap-3',
      partNumber: 3,
      dimensionKey: 'personas_amadas',
      title: 'El Amor que Construyó su Hogar',
      paragraphs: [
        'Una tarde lluviosa de octubre de 1972, pocas semanas después de su graduación, Elena salió del café de la universidad y descubrió que había olvidado su paraguas. En la puerta, un joven estudiante de arquitectura llamado Arturo Gómez le ofreció el suyo y se ofreció también a acompañarla hasta la parada del camión. La parada estaba a dos cuadras, pero caminaron diez, sin prisa, hablando de libros, de Guadalajara y de lo que cada uno quería construir.',
        'Arturo era originario de Puebla, hijo de un carpintero, y tenía la costumbre de dibujar en servilletas todo lo que le llamaba la atención. Aquella misma tarde dibujó el patio de los geranios mientras Elena se lo describía, y ella guardó ese dibujo durante cincuenta años. Un mes después se tomaron juntos su primera fotografía frente al café, en el que ya llamaban, entre risas, su primer otoño.',
        'Se casaron en 1974 en la parroquia de Analco, rodeados de geranios que la madre de Elena cultivó durante meses para la ocasión. Su primer departamento, en la colonia Narvarte, tenía dos cuartos, una mesa plegable y una ventana por la que entraba el sol de la mañana. Ahí establecieron la costumbre que mantendrían toda la vida: escucharse al final de cada día, por cansados que estuvieran, y no irse a dormir sin darse la mano en señal de gratitud.',
        'En 1976 nació Lucía y en 1979 llegó Andrés. Elena trabajaba en una empresa constructora, donde con los años llegó a dirigir proyectos de obra hidráulica, y Arturo diseñaba escuelas para el gobierno. Los dos aprendieron a repartirse las tareas sin llevar cuentas: quien llegaba primero preparaba la cena y quien llegaba después revisaba las tareas. Los domingos, como en Guadalajara, la familia salía a caminar y regresaba con nieve.',
        'La casa se volvió pronto el lugar de reunión de amigos, compañeros de trabajo y parientes de paso por la capital. Elena cumplió por fin su promesa de tener una cocina con la puerta abierta, y el pan de la abuela volvió a salir del horno los sábados por la tarde. Arturo solía decir que cualquiera que entrara a esa casa con hambre salía con una bolsa de pan y un consejo que no había pedido.',
        'Cuando sus hijos le preguntaban cuál era el secreto de un matrimonio largo, Elena respondía que no había secreto, sólo constancia: elegir a la misma persona todos los días, también los días difíciles, y no dejar nunca que una discusión durara más que la cena. Arturo añadía que también hacía falta buen humor, y contaba que en cincuenta años nunca había logrado ganarle una discusión, pero que tampoco le había importado perderlas. Los nietos crecieron escuchando esa respuesta repetida en cada aniversario, siempre acompañada de la misma risa y de la mano de Elena buscando la de Arturo sobre el mantel.',
      ],
      pullQuote:
        'Caminaron diez cuadras bajo un mismo paraguas y sintieron que la conversación había empezado muchos años atrás.',
    },
    {
      id: 'cap-4',
      partNumber: 4,
      dimensionKey: 'legado',
      title: 'Lecciones de Vida para sus Nietos',
      paragraphs: [
        'La mañana del 19 de septiembre de 1985 el terremoto sacudió la Ciudad de México. El edificio donde vivía la familia resistió, pero quedó tan dañado que tuvieron que abandonarlo con lo que alcanzaron a cargar. Elena salió con sus hijos de la mano, la fotografía del patio de los geranios y la vieja maleta de cuero de su padre. Durante semanas vivieron en casa de unos amigos mientras Arturo y ella ayudaban en las brigadas del barrio.',
        'De aquellos meses Elena sacó la lección que repetiría el resto de su vida: los bienes materiales pueden levantarse de nuevo con esfuerzo, pero la unión de la familia y el buen nombre permanecen. Con los ahorros de años y la ayuda de sus hermanos, que viajaron desde Guadalajara con herramientas y comida, reconstruyeron poco a poco un hogar en Coyoacán. Arturo diseñó la casa alrededor de un patio, y Elena llenó ese patio de macetas con geranios rojos.',
        'En los años siguientes la casa de Coyoacán vio crecer a los hijos, recibió a los primeros nietos y acogió a muchos jóvenes de provincia que llegaban a estudiar a la capital, como ella lo había hecho en 1967. A todos les ofrecía lo mismo: un lugar en la mesa, pan de los sábados y la advertencia de que en esa casa se hablaba con la verdad, aunque costara.',
        'Elena se jubiló en 2008, después de más de treinta años dedicados a la ingeniería, y se convirtió en la abuela que organizaba las comidas de los domingos. Enseñó a sus nietos a amasar el pan de canela, a escribir cartas a mano y a escuchar con atención las historias de los mayores. Cuando alguno le preguntaba por qué insistía tanto en escuchar, contestaba que las personas se van, pero sus palabras se quedan si alguien las guarda.',
        'Por eso, ya pasados los setenta años, decidió contar su vida en estas páginas. Quiso dejar constancia de que la verdadera riqueza no está en lo que se acumula, sino en tener paz en la conciencia y una mesa familiar donde todos sepan que siempre pueden regresar. A quienes lean este libro dentro de cincuenta años les pide una sola cosa: que no cambien nunca la honestidad ni el tiempo con quienes aman por la prisa del mundo.',
        'Hoy la fotografía del patio de los geranios sigue sobre su buró, junto al dibujo que Arturo hizo en una servilleta aquella tarde de lluvia y la carta de su madre, guardada en su sobre. Los sábados por la tarde, a las seis en punto, la casa de Coyoacán todavía huele a pan de canela. Elena dice que mientras alguien encienda el horno y abra la puerta, la historia de su familia seguirá escribiéndose. Y cuando un nieto le pregunta cómo termina el libro, ella sonríe y le contesta que eso todavía le toca escribirlo a él.',
      ],
      pullQuote:
        'Para Elena, la verdadera riqueza estaba en tener paz en la conciencia y una mesa familiar donde todos supieran que siempre podían regresar.',
    },
  ],
};

const photo = (params: {
  id: string;
  fileName: string;
  caption: string;
  title: string;
  subtitle: string;
  year: string;
  bgFrom: string;
  bgTo: string;
  accent: string;
}): DemoInMemoryPhoto => {
  const url = buildArchivalSamplePhotoDataUrl(params);
  return {
    id: params.id,
    fileName: params.fileName,
    mimeType: 'image/svg+xml',
    width: 800,
    height: 520,
    focusY: 'center',
    zoom: 1,
    caption: params.caption,
    objectUrl: url,
    dataUrl: url,
  };
};

export const CONOCEME_SAMPLE_PHOTOS: Record<string, DemoInMemoryPhoto | null> = {
  'cap-1': photo({
    id: 'sample-photo-cap-1',
    fileName: 'patio_geranios_1954.jpg',
    caption: 'La familia reunida en el patio de la abuela Elena, fotografiada por el tío Roberto (Octubre 1954, Barrio de Analco, Guadalajara).',
    title: 'Tarde de domingo en el patio de la abuela Elena',
    subtitle: 'Barrio de Analco, Guadalajara',
    year: 'Octubre 1954',
    bgFrom: '#451a03',
    bgTo: '#78350f',
    accent: '#f59e0b',
  }),
  'cap-2': photo({
    id: 'sample-photo-cap-2',
    fileName: 'partida_capital_1967.jpg',
    caption: 'Elena con su padre en la estación, minutos antes de abordar el autobús nocturno a la capital (Septiembre 1967).',
    title: 'El día de la partida hacia la universidad',
    subtitle: 'Estación Central de Autobuses',
    year: 'Septiembre 1967',
    bgFrom: '#1c1917',
    bgTo: '#44403c',
    accent: '#d97706',
  }),
  'cap-3': photo({
    id: 'sample-photo-cap-3',
    fileName: 'cafe_universidad_1972.jpg',
    caption: 'Elena y Arturo un mes después de aquella caminata bajo la lluvia, frente al Café de la Universidad (Noviembre 1972).',
    title: 'Su primer otoño juntos',
    subtitle: 'Café de la Universidad',
    year: 'Noviembre 1972',
    bgFrom: '#31102F',
    bgTo: '#581C4F',
    accent: '#FBBF24',
  }),
  'cap-4': photo({
    id: 'sample-photo-cap-4',
    fileName: 'patio_coyoacan_1990.jpg',
    caption: 'El nuevo patio de geranios de la casa de Coyoacán, reconstruida después del terremoto (Primavera 1990).',
    title: 'Un patio de geranios en Coyoacán',
    subtitle: 'La casa reconstruida',
    year: 'Primavera 1990',
    bgFrom: '#14532d',
    bgTo: '#166534',
    accent: '#fbbf24',
  }),
};
