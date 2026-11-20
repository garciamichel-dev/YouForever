/**
 * V5.9.1 — Textos para leer en voz alta al grabar la muestra adicional de voz.
 *
 * Son originales, de unas 170–190 palabras (alrededor de 60–90 segundos a ritmo natural),
 * con preguntas y exclamaciones para que la muestra tenga distintas entonaciones,
 * y redactados sin marcas de género para que sirvan a cualquier participante.
 */
export interface VoiceReadingText {
  id: string;
  title: string;
  paragraphs: string[];
}

export const VOICE_READING_TEXTS: VoiceReadingText[] = [
  {
    id: 'recuerdos-de-casa',
    title: 'Recuerdos de casa',
    paragraphs: [
      'Cuando pienso en mi casa, lo primero que recuerdo es el olor del café recién hecho por la mañana. En la cocina siempre había ruido: la radio encendida, alguien buscando las llaves y la tetera silbando sobre la estufa. ¡Qué tiempos aquellos!',
      'Los domingos nos juntábamos alrededor de la mesa grande, la de madera, y cada quien contaba cómo le había ido en la semana. A veces hablábamos tanto que la comida se enfriaba, pero a nadie le importaba.',
      '¿Te acuerdas de las tardes de lluvia? Nos quedábamos junto a la ventana viendo caer el agua, jugando cartas o escuchando las historias de los abuelos. Aprendí que la familia no es solo compartir un apellido, sino compartir el tiempo, la paciencia y la risa.',
      'Hoy quiero que sepas que cada uno de esos momentos sigue conmigo. Guardo en el corazón las canciones, los abrazos y hasta los regaños, porque todo eso me hizo quien soy. Y si alguna vez sientes nostalgia, recuerda que aquí estoy, contándote estas historias con cariño.',
    ],
  },
  {
    id: 'un-consejo-para-la-vida',
    title: 'Un consejo para la vida',
    paragraphs: [
      'Quiero contarte algo que aprendí con los años. La vida no siempre sale como uno la planea, y eso está bien. Hubo días en que todo parecía difícil: el trabajo, las cuentas, las preocupaciones de cada mañana. Sin embargo, siempre encontré a alguien dispuesto a echarme la mano.',
      'Por eso te pido que compartas con generosidad, que escuches con atención y que no tengas miedo de pedir ayuda cuando la necesites.',
      '¿Sabes qué es lo que más valoro hoy? Las cosas sencillas: una caminata por el parque, un pan dulce con chocolate caliente, una llamada inesperada de una amistad. ¡No dejes pasar esos momentos! Viaja cuando puedas, aprende algo nuevo cada año y celebra tus logros, aunque parezcan pequeños.',
      'Cuida tu salud, duerme bien y ríete mucho, incluso de tus propios tropiezos. Y cuando te equivoques, que te vas a equivocar, levántate, sacúdete el polvo y vuelve a intentarlo. Siento un enorme orgullo por ti, hoy y siempre.',
    ],
  },
  {
    id: 'un-viaje-inolvidable',
    title: 'Un viaje inolvidable',
    paragraphs: [
      'Una vez hicimos un viaje largo por carretera, de esos que se recuerdan toda la vida. Salimos muy temprano, todavía de noche, con la cajuela llena de maletas, cobijas y una hielera con tortas y refrescos. Poco a poco el cielo se fue pintando de naranja y rosa, y apareció el sol detrás de las montañas. ¡Era precioso!',
      'Pasamos por pueblos pequeños con iglesias antiguas, mercados llenos de fruta y puestos de tamales en la plaza. En una parada conocimos a un señor que nos contó la historia de su rancho y nos regaló unas naranjas enormes. ¿Quién iba a imaginar que esa conversación sería lo que más recordaríamos?',
      'Al final del día llegamos al mar. El agua estaba tibia, las olas sonaban fuerte y el viento traía olor a sal. Nos sentamos en la arena a mirar las estrellas, con cansancio pero con mucha alegría. Desde entonces pienso que lo importante no es el destino, sino con quién compartes el camino.',
    ],
  },
];
