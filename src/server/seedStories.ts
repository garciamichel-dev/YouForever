import {
  InterviewRecord,
  ParticipantRecord,
  AnswerRecord,
  hashToken,
  generateInvitationToken,
} from '../logic/interviewRules.ts';
import type { PersistedTokenRecord } from './storage.ts';

export interface CompleteTestStorySeed {
  interview: InterviewRecord;
  participants: Array<ParticipantRecord & { plainToken: string; accessCode: string }>;
  answers: AnswerRecord[];
  tokens: PersistedTokenRecord[];
}

/**
 * V5.6.2 — The test stories ship with fixed, public credentials (SAN-7841, tok_santiago_ramos_demo_2026…)
 * in this open-source file. Before they are loaded, every participant receives a fresh random link
 * and YF-XXXXX code; the administrator sees them in the panel as for any interview. Content, IDs and
 * answers are unchanged.
 */
export function assignFreshTestStoryCredentials(
  stories: CompleteTestStorySeed[],
  generate: () => { plainToken: string; tokenHash: string; accessCode: string } = generateInvitationToken
): CompleteTestStorySeed[] {
  for (const story of stories) {
    for (const tok of story.tokens) {
      const fresh = generate();
      tok.plainToken = fresh.plainToken;
      tok.tokenHash = fresh.tokenHash;
      tok.accessCode = fresh.accessCode;
      delete (tok as any).legacyAccessCode;
      const part = story.participants.find((p) => p.id === tok.participantId);
      if (part) {
        part.plainToken = fresh.plainToken;
        part.accessCode = fresh.accessCode;
      }
    }
  }
  return stories;
}

/**
 * V5.6.2 — Whether the demo / test stories are seeded automatically when the server starts.
 * YF_SEED_TEST_STORIES=1 → always; =0 → never; unset → only outside production (NODE_ENV or Cloud
 * Run). In production the administrator still creates them on demand with the panel button
 * (POST /api/interviews/seed-test-stories), and once deleted they no longer come back by themselves.
 */
export function shouldAutoSeedTestStories(env: Record<string, string | undefined> = process.env): boolean {
  const flag = String(env.YF_SEED_TEST_STORIES ?? '').trim();
  if (flag === '1') return true;
  if (flag === '0') return false;
  const isProduction = env.NODE_ENV === 'production' || Boolean(env.K_SERVICE);
  return !isProduction;
}

/**
 * 100 Canonical Autobiographical Questions structured evenly across 5 life stages (20 questions each).
 */
export interface CanonicalQuestion {
  id: string;
  stageId: string;
  stageName: string;
  text: string;
  branchChoice?: 'yes' | 'no' | null;
}

export const CANONICAL_QUESTIONS_100: CanonicalQuestion[] = [
  // =========================================================================
  // ETAPA 1: Orígenes, infancia y primeros recuerdos (Preguntas 1 a 20)
  // =========================================================================
  { id: 'q_et1_01', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Dónde naciste y cuál es tu recuerdo más temprano de la infancia?' },
  { id: 'q_et1_02', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Cómo describirías la casa donde creciste y los aromas que la distinguían?' },
  { id: 'q_et1_03', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Quiénes integraban tu núcleo familiar en aquellos primeros años?' },
  { id: 'q_et1_04', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Cómo eran tus padres y qué rasgos de carácter aprendiste o heredaste de cada uno?' },
  { id: 'q_et1_05', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Qué anécdota o recuerdo con tus abuelos permanece más vivo en tu memoria?' },
  { id: 'q_et1_06', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿A qué jugabas en la calle, el campo o el patio con tus amigos y hermanos?' },
  { id: 'q_et1_07', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Cuál era tu juguete o posesión infantil más querida y qué historia guardaba?' },
  { id: 'q_et1_08', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Cómo era tu escuela primaria y qué maestro o maestra dejó una huella en ti?' },
  { id: 'q_et1_09', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Qué festividad o tradición familiar esperabas con mayor ilusión cada año?' },
  { id: 'q_et1_10', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Cuál era el platillo casero favorito que preparaban en tu hogar en días especiales?' },
  { id: 'q_et1_11', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Qué música, canciones o programas de radio se escuchaban habitualmente en tu casa?' },
  { id: 'q_et1_12', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Qué travesura o aventura infantil recuerdas hoy con una sonrisa?' },
  { id: 'q_et1_13', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Tuviste alguna mascota o animal entrañable en tu niñez y qué significaba para ti?' },
  { id: 'q_et1_14', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Cómo eran las vacaciones o paseos familiares en aquellos tiempos de sencillez?' },
  { id: 'q_et1_15', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Qué valores morales o normas de convivencia se inculcaban con mayor firmeza en el hogar?' },
  { id: 'q_et1_16', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Cuál fue el primer libro, cuento o leyenda popular que te fascinó escuchar o leer?' },
  { id: 'q_et1_17', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Cómo era el barrio, pueblo o entorno geográfico donde diste tus primeros pasos?' },
  { id: 'q_et1_18', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Qué miedos infantiles experimentabas y cómo aprendiste a superarlos?' },
  { id: 'q_et1_19', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Cuál fue el primer gesto de cariño o lealtad de un amigo que recuerdas con gratitud?' },
  { id: 'q_et1_20', stageId: 'etapa_1', stageName: 'Orígenes e Infancia', text: '¿Qué imagen mental resume para ti la felicidad inocente y pura de tu niñez?' },

  // =========================================================================
  // ETAPA 2: Juventud, descubrimientos y formación (Preguntas 21 a 40)
  // =========================================================================
  { id: 'q_et2_01', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Cómo viviste la transición de la niñez a la adolescencia y qué inquietudes surgieron?' },
  { id: 'q_et2_02', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Cuáles eran tus mayores sueños y anhelos al cumplir quince años?' },
  { id: 'q_et2_03', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Qué música, artistas o expresiones culturales marcaron el compás de tu juventud?' },
  { id: 'q_et2_04', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Quiénes fueron tus amigos más entrañables en los años de secundaria o bachillerato?' },
  { id: 'q_et2_05', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Cómo recuerdas el despertar del primer amor o la primera persona que te conmovió?' },
  { id: 'q_et2_06', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Qué asignaturas, lecturas o conversaciones despertaron tu curiosidad y pensamiento?' },
  { id: 'q_et2_07', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Practicabas algún deporte, afición artística o actividad comunitaria en tus tardes libres?' },
  { id: 'q_et2_08', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿A qué lugares solían acudir a reunirse, pasear o bailar los fines de semana?' },
  { id: 'q_et2_09', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Cuál fue tu primer empleo, encargo o forma en que ganaste tu propio sustento económico?' },
  { id: 'q_et2_10', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿En qué invertiste o qué compraste con aquel primer salario fruto de tu esfuerzo?' },
  { id: 'q_et2_11', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Qué acontecimiento social, político o cultural de la época impactó tu manera de ver el mundo?' },
  { id: 'q_et2_12', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Cómo se dieron las primeras decisiones o conversaciones sobre qué camino profesional tomar?' },
  { id: 'q_et2_13', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Qué viaje, excursión o salida juvenil te abrió la mente a nuevas realidades y personas?' },
  { id: 'q_et2_14', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Tuviste algún maestro, mentor o figura adulta que creyó en tu potencial y te orientó?' },
  { id: 'q_et2_15', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Cuál fue el mayor reto de independencia o discrepancia que afrontaste con tus mayores?' },
  { id: 'q_et2_16', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Qué desilusión o tropiezo juvenil te enseñó tu primera gran lección de fortaleza?' },
  { id: 'q_et2_17', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Cómo concebías la lealtad y el compañerismo con tus pares durante aquellos años?' },
  { id: 'q_et2_18', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Qué meta o proyecto que parecía difícil o distante lograste conquistar siendo joven?' },
  { id: 'q_et2_19', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: '¿Qué valor ético o convicción profunda se forjó con fuerza inquebrantable en esa etapa?' },
  { id: 'q_et2_20', stageId: 'etapa_2', stageName: 'Juventud y Formación', text: 'Al recordar a tu versión de veinte años, ¿qué sentimiento te produce y qué le dirías hoy?' },

  // =========================================================================
  // ETAPA 3: Adultez, vocación, proyectos y vida familiar (Preguntas 41 a 60)
  // =========================================================================
  { id: 'q_et3_01', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cómo encontraste tu verdadera vocación u oficio y cómo fueron tus primeros pasos laborales?' },
  { id: 'q_et3_02', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cómo se cruzaron los caminos con tu compañero o compañera de vida y qué te enamoró?' },
  { id: 'q_et3_03', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cómo fue la etapa de noviazgo y el momento en que decidieron dar el paso hacia un proyecto común?' },
  { id: 'q_et3_04', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cómo recuerdas la celebración de su enlace, boda o el inicio de su vida en común?' },
  { id: 'q_et3_05', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cómo era el primer hogar independiente que habitaron y con qué muebles y detalles iniciaron?' },
  { id: 'q_et3_06', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cuáles fueron los mayores desafíos de adaptación económica y cotidiana en los primeros años juntos?' },
  { id: 'q_et3_07', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cómo viviste la noticia y la experiencia de traer al mundo a tu primer hijo o hija?' },
  { id: 'q_et3_08', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Qué transformaciones trajo a tu existencia la responsabilidad de cuidar y educar a tus hijos?' },
  { id: 'q_et3_09', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Qué valores primordiales te esmeraste en inculcar día con día a tus descendientes?' },
  { id: 'q_et3_10', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Qué logros o momentos de plenitud profesional recuerdas con especial satisfacción?' },
  { id: 'q_et3_11', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Qué etapas de estrechez económica o sacrificio laboral lograron vencer con perseverancia?' },
  { id: 'q_et3_12', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cómo lograbas equilibrar las largas jornadas de trabajo con la presencia cariñosa en el hogar?' },
  { id: 'q_et3_13', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Qué costumbres familiares, rituales dominicales o festejos consolidaron como propios?' },
  { id: 'q_et3_14', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cuál fue el viaje, paseo o aventura que más unió y alegró a la familia completa?' },
  { id: 'q_et3_15', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cómo se complementaban los roles, las decisiones y la corresponsabilidad en la pareja?' },
  { id: 'q_et3_16', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Qué patrimonio, casa o proyecto familiar lograron construir ladrillo a ladrillo con su esfuerzo?' },
  { id: 'q_et3_17', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cómo resolvían los desacuerdos o momentos difíciles con paciencia y comunicación sincera?' },
  { id: 'q_et3_18', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Qué amistades fraternas o familias queridas compartieron con ustedes esa etapa de vida?' },
  { id: 'q_et3_19', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Qué emoción sentiste al ver a tus hijos graduarse, emprender su camino o formar sus propios hogares?' },
  { id: 'q_et3_20', stageId: 'etapa_3', stageName: 'Adultez y Vocación', text: '¿Cuál consideras que ha sido la mayor bendición que te brindó construir un hogar y una carrera?' },

  // =========================================================================
  // ETAPA 4: Madurez, retos superados y momentos clave (Preguntas 61 a 80)
  // =========================================================================
  { id: 'q_et4_01', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Cómo evolucionó tu visión y serenidad ante la vida al entrar en la etapa de plena madurez?' },
  { id: 'q_et4_02', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué prueba personal o de salud puso a prueba tu temple y cómo la superaste con dignidad?' },
  { id: 'q_et4_03', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Cómo experimentaste la etapa del nido vacío y el reencuentro íntimo con tu pareja o contigo mismo?' },
  { id: 'q_et4_04', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Cómo fue la llegada de los nietos a tu vida y qué renovación de alegría trajeron?' },
  { id: 'q_et4_05', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué diferencias encuentras entre el rol de educar como padre y el de consentir y guiar como abuelo?' },
  { id: 'q_et4_06', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué despedidas o partidas de seres muy queridos te marcaron y cómo honras su recuerdo?' },
  { id: 'q_et4_07', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿En qué refugios del espíritu encontraste consuelo y fortaleza para sanar los duelos?' },
  { id: 'q_et4_08', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Cómo viviste el cierre o la culminación de tu vida laboral activa y la llegada de la jubilación?' },
  { id: 'q_et4_09', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué pasatiempos, talentos artísticos o aficiones postergadas redescubriste con tiempo libre?' },
  { id: 'q_et4_10', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué hábitos y cuidados cultivas para mantener la vitalidad física y la lucidez mental?' },
  { id: 'q_et4_11', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Cuál ha sido el viaje o experiencia que viviste con mayor sosiego y contemplación en estos años?' },
  { id: 'q_et4_12', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué amistades de toda una vida han permanecido a tu lado como hermanos del alma?' },
  { id: 'q_et4_13', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Cómo se ha transformado y consolidado el amor, la ternura y la complicidad en el matrimonio?' },
  { id: 'q_et4_14', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué reconocimientos, muestras de aprecio o gratitud de tu comunidad o colegas has recibido?' },
  { id: 'q_et4_15', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Cómo procuras mantener la unión de toda la familia en las sobremesas, navidades y reuniones?' },
  { id: 'q_et4_16', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué transformaciones del mundo moderno te han resultado más sorprendentes de presenciar?' },
  { id: 'q_et4_17', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué errores o decisiones difíciles has aprendido a perdonar y aceptar en tu historia personal?' },
  { id: 'q_et4_18', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué aportación social, servicio voluntario o apoyo al prójimo consideras tu granito de arena?' },
  { id: 'q_et4_19', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Qué momentos cotidianos de paz contemplativa consideras los regalos más sublimes del día?' },
  { id: 'q_et4_20', stageId: 'etapa_4', stageName: 'Madurez y Retos', text: '¿Cómo describirías el estado de tu corazón y la serenidad que habita en ti en este tiempo?' },

  // =========================================================================
  // ETAPA 5: Valores, reflexiones y legado trascendente (Preguntas 81 a 100)
  // =========================================================================
  { id: 'q_et5_01', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Cuál consideras que ha sido la mayor riqueza o el verdadero tesoro de tu existencia?' },
  { id: 'q_et5_02', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué principios éticos y morales consideraste siempre innegociables en tu conducta?' },
  { id: 'q_et5_03', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué papel han tenido la fe, la espiritualidad o el sentido de gratitud en tu caminar diario?' },
  { id: 'q_et5_04', stageId: 'etapa_5', stageName: 'Valores y Legado', text: 'Si tuvieras que sintetizar tu filosofía de vida en una máxima o frase, ¿cuál sería?' },
  { id: 'q_et5_05', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué consejo fundamental sobre el amor conyugal y el respeto mutuo quisieras heredar?' },
  { id: 'q_et5_06', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué consejo sobre el trabajo honrado y la administración de los recursos dejas a los jóvenes?' },
  { id: 'q_et5_07', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Cómo aconsejas a tus seres queridos afrontar los momentos de dolor, fracaso o incertidumbre?' },
  { id: 'q_et5_08', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué anécdota o recuerdo gracioso tuyo te gustaría que sigan contando en las sobremesas familiares?' },
  { id: 'q_et5_09', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué agradecimiento sincero guardas en el alma hacia tus padres por lo que te entregaron?' },
  { id: 'q_et5_10', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué palabras de profundo afecto y reconocimiento guardas para tu compañero o compañera de vida?' },
  { id: 'q_et5_11', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué mensaje especial e íntimo le dedicas a cada uno de tus hijos, nietos y familiares?' },
  { id: 'q_et5_12', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué causas sociales o valores de solidaridad humana consideras indispensable seguir defendiendo?' },
  { id: 'q_et5_13', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿De qué te sientes más íntima y hondamente agradecido al contemplar el camino recorrido?' },
  { id: 'q_et5_14', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Hay algo que hoy harías de manera diferente o que la madurez te enseñó a comprender mejor?' },
  { id: 'q_et5_15', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Cómo defines la verdadera felicidad tras todos los años y experiencias acumuladas?' },
  { id: 'q_et5_16', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué objeto, joya, libro o recuerdo tangible quisieras que conserve la familia como símbolo?' },
  { id: 'q_et5_17', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Cómo sueñas y visualizas el porvenir de tus descendientes y de las futuras generaciones?' },
  { id: 'q_et5_18', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué significado íntimo tiene para ti ver tus memorias plasmadas en este libro de vida?' },
  { id: 'q_et5_19', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Qué huella de bondad, ejemplo y alegría aspiras a dejar en la memoria de los tuyos?' },
  { id: 'q_et5_20', stageId: 'etapa_5', stageName: 'Valores y Legado', text: '¿Cuál es tu última bendición, deseo y pensamiento final para coronar este libro de vida?' },
];

/**
 * Persona biography definitions for generating 100 deep, character-specific responses.
 */
interface PersonaContext {
  partId: string;
  name: string;
  role: 'primary' | 'contributor';
  relationship: string;
  email: string;
  token: string;
  accessCode: string;
  hometown: string;
  profession: string;
  birthYear: number;
  spouseOrPartner?: string;
  relativesContext: string;
  voiceStyle: string; // Brief tone guidance
  biographySummary: string;
  customThemes: {
    etapa1Key: string;
    etapa2Key: string;
    etapa3Key: string;
    etapa4Key: string;
    etapa5Key: string;
  };
}

/**
 * Generates 100 complete, coherent and personalized autobiographical answers for a participant.
 */
function generate100AnswersForParticipant(
  interviewId: string,
  persona: PersonaContext,
  createdDate: string
): AnswerRecord[] {
  return CANONICAL_QUESTIONS_100.map((q, idx) => {
    const qNum = idx + 1;
    let answerText = '';

    // Stage 1: Questions 1 to 20
    if (qNum <= 20) {
      answerText = buildStage1Answer(qNum, persona);
    }
    // Stage 2: Questions 21 to 40
    else if (qNum <= 40) {
      answerText = buildStage2Answer(qNum - 20, persona);
    }
    // Stage 3: Questions 41 to 60
    else if (qNum <= 60) {
      answerText = buildStage3Answer(qNum - 40, persona);
    }
    // Stage 4: Questions 61 to 80
    else if (qNum <= 80) {
      answerText = buildStage4Answer(qNum - 60, persona);
    }
    // Stage 5: Questions 81 to 100
    else {
      answerText = buildStage5Answer(qNum - 80, persona);
    }

    return {
      id: `ans_${persona.partId}_q${String(qNum).padStart(3, '0')}`,
      interviewId,
      questionId: q.id,
      questionText: q.text,
      participantId: persona.partId,
      participantName: persona.name,
      answerText,
      notRecalled: false,
      isFollowUp: false,
      parentQuestionId: null,
      isAdditionalMemory: false,
      branchChoice: q.branchChoice || null,
      idempotencyKey: `seed_${persona.partId}_q${qNum}`,
      createdAt: createdDate,
      updatedAt: createdDate,
    };
  });
}

function buildStage1Answer(num: number, p: PersonaContext): string {
  switch (num) {
    case 1:
      return `Nací en el año ${p.birthYear} en ${p.hometown}. Mi recuerdo más temprano es la luz dorada entrando por los postigos de madera al amanecer y la voz cariñosa de mi madre llamándome a desayunar.`;
    case 2:
      return `La casa familiar en ${p.hometown} era amplia, con techos altos de teja y un patio lleno de macetas de geranios. Olía a café recién colado, a leña de encino y a ropa recién tendida al sol de la mañana.`;
    case 3:
      return `Éramos una familia muy unida: mis padres, mis hermanos y a menudo tíos y abuelos que vivían en la misma calle. La convivencia cotidiana era alegre y solidaria en todo momento.`;
    case 4:
      return `De mi padre aprendí el valor de la palabra de honor y el trabajo incansable; de mi madre, la paciencia infinita, la generosidad para compartir el pan y la fe en los momentos difíciles.`;
    case 5:
      return `Mis abuelos representaban la sabiduría del pueblo. Recuerdo sentarme a sus pies en las tardes de lluvia a escuchar relatos de tiempos remotos que encendían mi imaginación infantil.`;
    case 6:
      return `Jugábamos en la calle empedrada al trompo, al escondite y a las canicas. No había coches y la calle entera era nuestro patio de recreo hasta que caía la noche y sonaban las campanas de la iglesia.`;
    case 7:
      return `Mi posesión más querida era un camión de madera tallado a mano con llantas de corcho que mi padre me construyó para mi cumpleaños número seis; aún recuerdo el tacto pulido del pino.`;
    case 8:
      return `Estudié en la escuela del pueblo. El maestro don Ramón nos enseñaba caligrafía y declamación; con su mirada bondadosa nos hacía sentir capaces de alcanzar cualquier meta en la vida.`;
    case 9:
      return `La Navidad y el Día de Muertos eran celebraciones mágicas. Colocar los altares de cempasúchil o romper la piñata de barro llena de tejocotes y cañas unía a todo el vecindario.`;
    case 10:
      return `El mole casero con tortillas recién salidas del comal y el atole de masa con piloncillo. Nadie en el mundo ha logrado igualar la sazón y el cariño con que se cocinaba en aquella mesa.`;
    case 11:
      return `En casa teníamos un radio de bulbos donde sonaban las canciones de Agustín Lara, Pedro Infante y las transmisiones de noticias de la tarde que papá escuchaba en silencio respetuoso.`;
    case 12:
      return `Una tarde nos escapamos al huerto vecino a cortar capulines; terminamos con las manos moradas y escondiéndonos en el granero entre risas mientras mi tía nos buscaba por todo el patio.`;
    case 13:
      return `Tuvimos un perro criollo de color canela llamado 'Centinela'; era mi sombra, me acompañaba al portón de la escuela y me esperaba paciente cada tarde sentado en la acera.`;
    case 14:
      return `Las vacaciones consistían en ir al río del pueblo con sandías al fresco del agua y pan dulce. No se necesitaban grandes lujos para sentirnos los reyes del universo.`;
    case 15:
      return `Nos enseñaron que el respeto a los mayores, decir siempre la verdad y saludar a quien cruzara por nuestro camino eran principios sagrados que abrían todas las puertas.`;
    case 16:
      return `Las fábulas de Esopo y las leyendas coloniales que venían en los libros de texto gratuitos. Leía a la luz de una vela cuando todos dormían, fascinado por mundos lejanos.`;
    case 17:
      return `${p.hometown} era entonces un lugar apacible, de gente cordial donde todos nos conocíamos por nuestros nombres y apellidos, y las puertas de las casas permanecían abiertas de par en par.`;
    case 18:
      return `De niño le temía a la oscuridad y a los ruidos del tejado cuando arreciaba el viento; mi madre me tomaba de la mano, rezaba una plegaria y me decía que los ángeles velaban mi sueño.`;
    case 19:
      return `Un compañero de escuela que compartió su lonche de frijoles con queso conmigo el día que olvidé el mío en casa; aquel gesto humilde selló una hermandad que duró muchos años.`;
    case 20:
      return `Correr descalzo sobre el pasto húmedo tras una llovizna de verano, sintiendo el aire limpio y la seguridad de que nada malo podía pasar teniendo a mis padres cerca.`;
    default:
      return `Recuerdos entrañables de mis primeros años que cimentaron quién soy el día de hoy.`;
  }
}

function buildStage2Answer(num: number, p: PersonaContext): string {
  switch (num) {
    case 1:
      return `La adolescencia trajo un afán de descubrir quién era yo. Empecé a mirar más allá de mi entorno inmediato y a preguntarme cómo podría contribuir con algo significativo a la sociedad.`;
    case 2:
      return `Al cumplir quince años soñaba con estudiar, tener una profesión digna y algún día poder retribuir a mis padres todo el esfuerzo y los desvelos que hicieron por mi educación.`;
    case 3:
      return `Eran los tiempos de las baladas románticas, el rock en español y las serenatas en las ventanas. La música nos acompañaba en cada reunión y le ponía letra a nuestras primeras ilusiones.`;
    case 4:
      return `Formamos una pandilla entrañable de compañeros de estudio. Compartíamos libros, secretos, sueños de futuro y horas interminables de plática sentados en la plaza principal.`;
    case 5:
      return `Recuerdo el latido acelerado del corazón al cruzar miradas en el parque. Una timidez dulce nos invadía, donde escribir una carta en papel perfumado era el mayor acto de valentía.`;
    case 6:
      return `Las clases de historia, literatura y ciencias naturales abrieron mis horizontes. Descubrí que la lectura era un pasaporte hacia el entendimiento del alma humana y del mundo.`;
    case 7:
      return `Me apasionaba practicar deporte con mis amigos por las tardes y dedicar horas a cultivar inquietudes como la escritura, el dibujo y las actividades del grupo comunitario.`;
    case 8:
      return `Los domingos acudíamos a las tardeadas de la plaza, al cine del pueblo y a la nevería a tomar aguas frescas de horchata y limón mientras veíamos pasar la tarde entre bromas.`;
    case 9:
      return `Mi primer trabajo formal fue como aprendiz y asistente; gané mis primeras monedas desempeñando labores con puntualidad y me sentí el ser más orgulloso e independiente de la tierra.`;
    case 10:
      return `Con mi primer sueldo le compré un rebozo a mi madre y unos zapatos nuevos para mí; entregarle ese regalo a ella con mis propias manos ha sido una de las emociones más puras de mi vida.`;
    case 11:
      return `Vivimos momentos de grandes movimientos cívicos y cambios culturales en el país que nos hicieron tomar conciencia de la importancia de la justicia, la libertad y la dignidad ciudadana.`;
    case 12:
      return `Mi padre me sentó una tarde bajo la sombra de un árbol y me dijo: 'Hijo, el único tesoro que nadie podrá quitarte es lo que lleves en la cabeza y en el corazón; estudia lo que ames'.`;
    case 13:
      return `Un viaje en tren a la capital y hacia las costas me deslumbró por completo: contemplar la inmensidad del paisaje confirmó que el mundo era vasto y estaba esperando a ser recorrido.`;
    case 14:
      return `El profesor de filosofía en el bachillerato; él me enseñó a no conformarme con respuestas fáciles, a ser riguroso en el pensar y compasivo en el actuar diario.`;
    case 15:
      return `El día que decidí buscar mi propio rumbo profesional y salir temporalmente de casa; costó lágrimas pero mis padres entendieron que era el vuelo natural de quien han criado fuerte.`;
    case 16:
      return `Un examen de ingreso difícil que no aprobé en el primer intento; aquello me enseñó la humildad, la tenacidad de volver a estudiar el doble y que los fracasos son maestros disfrazados.`;
    case 17:
      return `La lealtad era un pacto no escrito: si un amigo caía en desgracia o necesitaba apoyo, todos acudíamos sin dudarlo. Esos lazos sellaron mi fe en la verdadera hermandad humana.`;
    case 18:
      return `Terminar mis estudios con excelentes calificaciones a pesar de tener que trabajar al mismo tiempo para costear pasajes y libros; recibir mi certificado fue una victoria colectiva.`;
    case 19:
      return `La convicción inamovible de que la rectitud moral, el respeto a la verdad y el compromiso social deben guiar cada paso, sin importar qué tan difícil parezca la senda.`;
    case 20:
      return `Aquel joven soñador de veinte años tenía el corazón desbordante de esperanza y temores. Hoy le diría: 'No temas, el camino será arduo pero valdrá cada gota de entrega y amor'.`;
    default:
      return `Años dorados de juventud que templaron mi carácter para la vida adulta.`;
  }
}

function buildStage3Answer(num: number, p: PersonaContext): string {
  switch (num) {
    case 1:
      return `Inicié mi carrera en el campo de ${p.profession}. Mis primeros años exigieron jornadas agotadoras, pero la pasión por hacer las cosas con maestría convirtió el deber en una auténtica fiesta del espíritu.`;
    case 2:
      return `Conocí a mi pareja ${p.spouseOrPartner ? `(${p.spouseOrPartner})` : ''} en una reunión familiar. Lo primero que me cautivó fue su mirada honesta, su inteligencia serena y una bondad natural que iluminaba el lugar.`;
    case 3:
      return `El noviazgo duró varios años de respeto, caminatas compartidas y proyectos trazados en servilletas de café. Sabíamos que éramos compañeros de viaje destinados a construir algo duradero.`;
    case 4:
      return `El día de nuestro matrimonio fue conmovedor y sencillo: rodeados de nuestras familias, bendecidos por nuestros padres y con la convicción jurada de cuidarnos en la salud y en la enfermedad.`;
    case 5:
      return `Nuestro primer hogar era un modesto departamento con dos sillas, una mesa prestada y una cama firme; sin embargo, para nosotros era un palacio porque rebosaba de amor y proyectos.`;
    case 6:
      return `El mayor reto al principio fue la estrechez presupuestaria: hacíamos milagros con el gasto, pero cada pequeño logro, como comprar nuestro primer refrigerador, lo celebrábamos como una hazaña.`;
    case 7:
      return `Cuando el médico confirmó la llegada de nuestro primer bebé, lloramos de felicidad abrazados. Sentir la primera patadita en el vientre me transformó para siempre en un ser protector.`;
    case 8:
      return `Tener en brazos a nuestro primer hijo fue una revelación cósmica: comprendí que mi vida ya no me pertenecía solo a mí, sino que existía para velar por el florecimiento de una nueva alma.`;
    case 9:
      return `Procuramos que en nuestra casa se respirara respeto, honestidad a toda prueba, gusto por el estudio y solidaridad activa con quien menos tuviera. Esos fueron nuestros pilares irremplazables.`;
    case 10:
      return `En mi vida como ${p.profession}, lograr reconocimiento por mi integridad y ver proyectos concluidos con excelencia me dejó una satisfacción honda que el dinero no puede comprar.`;
    case 11:
      return `Hubo épocas de crisis económica severa en el país; recortamos gastos superfluos, redoblamos esfuerzos y salimos adelante más unidos y agradecidos por lo verdaderamente esencial.`;
    case 12:
      return `Llegar a casa cansado y dejar las preocupaciones en el felpudo para tirarme al suelo a jugar con mis hijos y escuchar cómo les había ido en la escuela; ese era mi verdadero descanso.`;
    case 13:
      return `Instauramos la comida de los domingos como un templo inquebrantable de reunión familiar: sobremesa larga, café de olla, risas y la consigna de que todos éramos bienvenidos a la mesa.`;
    case 14:
      return `Un viaje por carretera que hicimos todos juntos cantando en el coche: se nos ponchó una llanta bajo la lluvia y terminamos cenando tortas en una fondita de carretera riendo como nunca.`;
    case 15:
      return `En el matrimonio no había superioridades; éramos un equipo solidario donde las decisiones importantes se consultaban siempre en la almohada y se resolvían de común acuerdo.`;
    case 16:
      return `Con años de ahorro y sacrificios logramos edificar nuestra casa propia. Cada tabique, cada puerta de madera y cada árbol sembrado en el jardín representaban el sudor honrado de nuestras frentes.`;
    case 17:
      return `Aprendimos que antes de que se ponga el sol hay que pedir disculpas si uno erró. La humildad y la escucha sincera salvaron a nuestra relación de cualquier amargura duradera.`;
    case 18:
      return `Los compadres y vecinos de toda la vida fueron una bendición: cuidaban a nuestros hijos cuando teníamos urgencias laborales y compartíamos los aniversarios como una sola gran familia.`;
    case 19:
      return `Ver a mis hijos vestidos con su toga de graduación y luego emprendiendo sus propios vuelos con valores firmes ha sido el mayor honor y orgullo de mi trayectoria como padre y guía.`;
    case 20:
      return `Mirar la mesa llena en una tarde cualquiera y ver a quienes amas con salud, dignidad y cariño sincero; no existe éxito profesional que se compare a esa bendición divina.`;
    default:
      return `Los años más fecundos de trabajo y siembra en el hogar que hoy dan frutos de amor.`;
  }
}

function buildStage4Answer(num: number, p: PersonaContext): string {
  switch (num) {
    case 1:
      return `Al llegar a la madurez comprendí que la prisa es enemiga de la dicha. Aprendí a saborear cada amanecer, a juzgar menos a los semejantes y a agradecer más cada respiración.`;
    case 2:
      return `Enfrenté una cirugía compleja y un periodo de convalecencia delicado; la cercanía de mi familia y las oraciones de los míos me devolvieron las fuerzas y renovaron mi gratitud hacia la vida.`;
    case 3:
      return `Cuando el último hijo partió del hogar sentimos un silencio inicial en las habitaciones, pero pronto redescubrimos el encanto de la charla tranquila en pareja y la satisfacción del deber cumplido.`;
    case 4:
      return `El nacimiento de los nietos fue un renacimiento milagroso. Volver a sostener manitas diminutas y escuchar risas infantiles llenó de nuevo nuestra casa de luz y primavera.`;
    case 5:
      return `A los hijos se les educa con disciplina amorosa; a los nietos se les colma de caricias, se les transmiten historias familiares y se les da un refugio de ternura incondicional.`;
    case 6:
      return `La partida de mis padres y de hermanos queridos dejó un vacío que nada material puede llenar; sin embargo, aprendí que mientras los recordemos con amor, siguen viviendo en nosotros.`;
    case 7:
      return `Encontré paz en la oración serena, en las caminatas tempranas y en saber que la muerte no tiene la última palabra frente al amor que trasciende todas las dimensiones.`;
    case 8:
      return `El día que concluí mi ciclo laboral activo sentí una paz inmensa: dejé un expediente limpio, el cariño de mis compañeros de trabajo y la satisfacción de no haberle fallado a mi vocación.`;
    case 9:
      return `Retomé la jardinería, el cuidado de las plantas, la lectura reposada de biografías y el gusto por escribir notas personales para que no se pierdan las memorias del ayer.`;
    case 10:
      return `Camino todos los días al amanecer, cuido mi alimentación sin excesos, mantengo el buen humor y procuro que ningún resentimiento anide jamás en mi pecho al caer la noche.`;
    case 11:
      return `Un viaje sereno por los pueblos mágicos y costas de nuestra tierra: sentarme a contemplar el horizonte con mi pareja sintiendo la brisa suave y dando gracias por llegar juntos hasta aquí.`;
    case 12:
      return `Pocos amigos quedan de la infancia, pero los que permanecen son joyas invaluables: basta una mirada o una taza de café caliente para que cincuenta años de historia se hagan presentes.`;
    case 13:
      return `El amor conyugal en la vejez es sublime: ya no necesita palabras grandilocuentes, se expresa en arropar al otro por la noche, en preparar el té y en una complicidad llena de ternura.`;
    case 14:
      return `El agradecimiento espontáneo de personas a quienes serví en mi oficio de ${p.profession} que me detienen en la calle para decirme: 'Don ${p.name.split(' ')[0]}, gracias por su consejo'.`;
    case 15:
      return `Preparamos con esmero las reuniones de fin de año y los cumpleaños: cocinar juntos, abrazar a los nietos y presidir la mesa con una sonrisa cálida que haga sentir a todos amados y seguros.`;
    case 16:
      return `Ver cómo la tecnología y la comunicación han acortado distancias es asombroso; hoy hablo por videollamada con familiares lejanos y me parece un prodigio que jamás imaginé de niño.`;
    case 17:
      return `Con los años comprendí que todos cometemos tropiezos por inexperiencia o premura; pedir perdón y otorgarlo de corazón me liberó de cargas inútiles para caminar ligero.`;
    case 18:
      return `He procurado apoyar a jóvenes de escasos recursos para que continúen sus estudios y ayudar discretamente a vecinos en apuros; dar en silencio es la mayor alegría del alma.`;
    case 19:
      return `Sentarme en el patio al atardecer a contemplar las hojas movidas por el viento, con una taza de café en la mano y la certeza de que mi familia está en paz; ese es el paraíso en la tierra.`;
    case 20:
      return `Mi corazón rebosa de sosiego y plenitud. No guardo rencor hacia nadie, no le temo al porvenir y me siento inmensamente afortunado por cada día de vida que se me concede.`;
    default:
      return `Madurez fecunda y serena donde se cosecha la dicha del bien sembrado.`;
  }
}

function buildStage5Answer(num: number, p: PersonaContext): string {
  switch (num) {
    case 1:
      return `La mayor riqueza de mi existencia jamás estuvo en las cuentas bancarias ni en los bienes materiales, sino en el honor de mi nombre, la paz de mi conciencia y el amor fiel de mi familia.`;
    case 2:
      return `Jamás tomar lo ajeno, no faltar a la palabra empeñada, defender al inocente y actuar con la misma rectitud tanto en público como cuando nadie me está mirando.`;
    case 3:
      return `La gratitud ha sido mi brújula diaria. Despertar cada mañana dando gracias a Dios por la luz del día y por las bendiciones recibidas me ha mantenido con los pies en la tierra y el alma en alto.`;
    case 4:
      return `'Haz el bien sin mirar a quién, vive con honradez intachable y ten la humildad de servir a los demás con una sonrisa'. Esa ha sido la brújula que guio todos mis pasos.`;
    case 5:
      return `El amor verdadero no es un arrebato pasajero sino una decisión cotidiana de paciencia, ternura, lealtad y perdón mutuo. Cuídense como el tesoro más frágil y sagrado.`;
    case 6:
      return `Ganen su pan con el sudor honesto de su frente, no busquen atajos fáciles que manchen su reputación y ahorren con prudencia para que nunca les falte el sustento ni la paz.`;
    case 7:
      return `Cuando arrecia la tormenta, no pierdan la fe ni la serenidad; abrácense fuerte como familia, tengan paciencia y recuerden que no hay noche, por oscura que sea, que no ceda al amanecer.`;
    case 8:
      return `Me encantaría que recuerden mis anécdotas cómicas, los chistes sencillos que contaba en la sobremesa y cómo me gustaba cantar desafinado para hacer reír a los nietos.`;
    case 9:
      return `A mis amados padres les debo la vida, el ejemplo imperecedero de su dignidad y el haberme enseñado a caminar con la frente en alto. Su memoria bendita me acompaña siempre.`;
    case 10:
      return `A mi entrañable compañero/a de vida: gracias por ser mi faro en la tempestad, mi alegría cotidiana, la madre/padre ejemplar de mis hijos y el amor más hermoso que me regaló el cielo.`;
    case 11:
      return `A mis hijos y nietos: los amo con cada fibra de mi ser. Sean hombres y mujeres de bien, manténganse siempre unidos como hermanos y jamás olviden de dónde vienen sus raíces.`;
    case 12:
      return `Defender la justicia social, la educación para todos, el amor a nuestra patria y la solidaridad con los más desprotegidos. Esas causas deben seguir vivas en su corazón.`;
    case 13:
      return `Me siento profundamente satisfecho de haber vivido con honestidad, de haber amado sin reservas y de saber que dejo sembrado en el mundo un linaje de personas de bien.`;
    case 14:
      return `Quizá me habría gustado preocuparme menos por cosas pequeñas que el tiempo demostró que eran triviales, pero todo lo vivido sirvió para cincelar la persona que hoy concluye este relato.`;
    case 15:
      return `La felicidad es la paz interior: saber que diste lo mejor de ti, que no dañaste a nadie a sabiendas y que estás rodeado de seres que te quieren por lo que eres, no por lo que tienes.`;
    case 16:
      return `El reloj antiguo de la familia y este mismo libro de vida que hoy escribo; que pasen de generación en generación como testimonio de que un amor inmenso los antecedió.`;
    case 17:
      return `Visualizo a mis descendientes alcanzando metas que yo solo pude soñar, viviendo con libertad y dignidad, pero manteniendo siempre encendida la llama de los valores familiares.`;
    case 18:
      return `Poder plasmar hoy mis recuerdos en este libro YouForever es un milagro de memoria: es tender un puente de amor directo desde mi corazón hacia los corazones de quienes aún no han nacido.`;
    case 19:
      return `Quisiera que al recordarme brote en ustedes una sonrisa cálida y digan con orgullo: 'Nos enseñó a vivir con nobleza, nos amó con locura y nos dejó un hogar lleno de luz'.`;
    case 20:
      return `Que Dios y la vida bendigan sus pasos, iluminen sus decisiones y colmen sus hogares de salud, dicha y armonía. Esta es mi bendición eterna para todos ustedes con todo mi amor.`;
    default:
      return `Mi testimonio de amor, gratitud y trascendencia para todas las generaciones familiares.`;
  }
}

/**
 * Builds all 7 complete test stories with >= 100 answers per participant.
 */
export function buildCompleteTestStories(): CompleteTestStorySeed[] {
  const now = new Date();
  const createdDate = new Date(now.getTime() - 5 * 86400000).toISOString();
  const closedDate = new Date(now.getTime() - 1 * 86400000).toISOString();
  const expiresAt = new Date(now.getTime() + 30 * 86400000).toISOString();

  const stories: CompleteTestStorySeed[] = [];

  // =========================================================================
  // 1. INDIVIDUAL STORY 1: "Memorias y Raíces de Don Santiago Ramos"
  // =========================================================================
  {
    const intId = 'int_test_santiago_ramos';
    const persona: PersonaContext = {
      partId: 'part_santiago_ramos',
      name: 'Santiago Ramos Beltrán',
      role: 'primary',
      relationship: 'Titular',
      email: 'santiago.ramos@ejemplo.com',
      token: 'tok_santiago_ramos_demo_2026',
      accessCode: 'SAN-7841',
      hometown: 'Miahuatlán de Porfirio Díaz, Oaxaca',
      profession: 'Maestro Rural y Profesor de Primaria',
      birthYear: 1948,
      spouseOrPartner: 'Guadalupe Huixtepec',
      relativesContext: 'Padre de tres profesionistas y abuelo de cinco nietos.',
      voiceStyle: 'Cálido, sereno, profundamente vocacional y reflexivo.',
      biographySummary: 'Dediqué 36 años a la enseñanza rural en las serranías oaxaqueñas.',
      customThemes: {
        etapa1Key: 'Serranía y metate oaxaqueño',
        etapa2Key: 'Escuela Normal de Maestros',
        etapa3Key: 'Aulas rurales y hogar familiar',
        etapa4Key: 'Jubilación con honores cívicos',
        etapa5Key: 'Sabiduría pedagógica y bendición',
      },
    };

    const answers = generate100AnswersForParticipant(intId, persona, createdDate);
    const participant: ParticipantRecord & { plainToken: string; accessCode: string } = {
      id: persona.partId,
      interviewId: intId,
      name: persona.name,
      relationship: persona.relationship,
      role: persona.role,
      email: persona.email,
      joinedAt: createdDate,
      status: 'active',
      plainToken: persona.token,
      accessCode: persona.accessCode,
    };

    const tokenDoc: PersistedTokenRecord = {
      id: `tok_${persona.partId}`,
      tokenHash: hashToken(persona.token),
      plainToken: persona.token,
      accessCode: persona.accessCode,
      interviewId: intId,
      participantId: persona.partId,
      expiresAt,
      revoked: false,
      createdAt: createdDate,
    };

    const interview: InterviewRecord = {
      id: intId,
      title: 'Memorias y Raíces de Don Santiago Ramos',
      storyMode: 'individual',
      storyType: 'biografia_personal',
      status: 'completed',
      questionnaireVersionId: 'v1_standard',
      openedAt: createdDate,
      expiresAt,
      closedAt: closedDate,
      closureReason: 'Entrevista completada con 100 respuestas y cerrada para maquetación editorial.',
      participantClosingText: 'Para mis queridos hijos y nietos: la mayor riqueza de nuestra familia está en la dignidad de servir y en el amor incondicional que nos une.',
      userDeclaredComplete: true,
      sufficiencyStatus: 'sufficient',
      completedQuestionCount: answers.length,
      sufficiencyThreshold: 100,
      openDaysAtCreation: 30,
      maxFollowUpsAtCreation: 2,
      lastActivityAt: closedDate,
      bookGeneratedCount: 0,
      layoutEditsAllowed: 2,
      layoutEditsUsed: 0,
    };

    stories.push({ interview, participants: [participant], answers, tokens: [tokenDoc] });
  }

  // =========================================================================
  // 2. INDIVIDUAL STORY 2: "El Telar de la Vida de Doña Carmen Valenzuela"
  // =========================================================================
  {
    const intId = 'int_test_carmen_valenzuela';
    const persona: PersonaContext = {
      partId: 'part_carmen_valenzuela',
      name: 'Carmen Valenzuela Pineda',
      role: 'primary',
      relationship: 'Titular',
      email: 'carmen.valenzuela@ejemplo.com',
      token: 'tok_carmen_valenzuela_demo_2026',
      accessCode: 'CAR-4923',
      hometown: 'Uruapan y la Meseta Purépecha, Michoacán',
      profession: 'Maestra Artesana Textil y Tejedora de Rebozos',
      birthYear: 1952,
      spouseOrPartner: 'Roberto Cárdenas (finado)',
      relativesContext: 'Madre de cuatro hijas emprendedoras y abuela de seis nietos.',
      voiceStyle: 'Poético, entrañable, arraigado a la tierra y a la autonomía femenina.',
      biographySummary: 'Fundadora de cooperativas textiles y guardiana de tintes naturales prehispánicos.',
      customThemes: {
        etapa1Key: 'Telares de cintura y aroma a pino',
        etapa2Key: 'Tintes naturales y primeras exposiciones',
        etapa3Key: 'Cooperativa de mujeres bordadoras',
        etapa4Key: 'Premios nacionales de arte popular',
        etapa5Key: 'El hilo invisible del amor materno',
      },
    };

    const answers = generate100AnswersForParticipant(intId, persona, createdDate);
    const participant: ParticipantRecord & { plainToken: string; accessCode: string } = {
      id: persona.partId,
      interviewId: intId,
      name: persona.name,
      relationship: persona.relationship,
      role: persona.role,
      email: persona.email,
      joinedAt: createdDate,
      status: 'active',
      plainToken: persona.token,
      accessCode: persona.accessCode,
    };

    const tokenDoc: PersistedTokenRecord = {
      id: `tok_${persona.partId}`,
      tokenHash: hashToken(persona.token),
      plainToken: persona.token,
      accessCode: persona.accessCode,
      interviewId: intId,
      participantId: persona.partId,
      expiresAt,
      revoked: false,
      createdAt: createdDate,
    };

    const interview: InterviewRecord = {
      id: intId,
      title: 'El Telar de la Vida de Doña Carmen Valenzuela',
      storyMode: 'individual',
      storyType: 'biografia_personal',
      status: 'completed',
      questionnaireVersionId: 'v1_standard',
      openedAt: createdDate,
      expiresAt,
      closedAt: closedDate,
      closureReason: 'Entrevista completada con 100 respuestas y cerrada para maquetación editorial.',
      participantClosingText: 'Para mis hijas y nietos: la vida es como un telar donde cada hilo de alegría y tristeza entreteje la fuerza indomable de nuestro linaje.',
      userDeclaredComplete: true,
      sufficiencyStatus: 'sufficient',
      completedQuestionCount: answers.length,
      sufficiencyThreshold: 100,
      openDaysAtCreation: 30,
      maxFollowUpsAtCreation: 2,
      lastActivityAt: closedDate,
      bookGeneratedCount: 0,
      layoutEditsAllowed: 2,
      layoutEditsUsed: 0,
    };

    stories.push({ interview, participants: [participant], answers, tokens: [tokenDoc] });
  }

  // =========================================================================
  // 3. INDIVIDUAL STORY 3: "Senderos y Pasiones de Alejandro Vega"
  // =========================================================================
  {
    const intId = 'int_test_alejandro_vega';
    const persona: PersonaContext = {
      partId: 'part_alejandro_vega',
      name: 'Alejandro Vega Montes',
      role: 'primary',
      relationship: 'Titular',
      email: 'alejandro.vega@ejemplo.com',
      token: 'tok_alejandro_vega_demo_2026',
      accessCode: 'ALE-3158',
      hometown: 'La Paz, Baja California Sur',
      profession: 'Biólogo Marino y Fotógrafo de Naturaleza',
      birthYear: 1966,
      spouseOrPartner: 'Dra. Sofía Mendoza',
      relativesContext: 'Padre de dos jóvenes ambientalistas.',
      voiceStyle: 'Vibrante, reflexivo, amante del mar y el desierto.',
      biographySummary: 'Explorador del Mar de Cortés y conservacionista de ecosistemas litorales.',
      customThemes: {
        etapa1Key: 'El malecón y los atardeceres bermejos',
        etapa2Key: 'Facultad de Ciencias y primeras expediciones',
        etapa3Key: 'Investigación marina y publicaciones',
        etapa4Key: 'Fotografía documental internacional',
        etapa5Key: 'La protección de la casa común',
      },
    };

    const answers = generate100AnswersForParticipant(intId, persona, createdDate);
    const participant: ParticipantRecord & { plainToken: string; accessCode: string } = {
      id: persona.partId,
      interviewId: intId,
      name: persona.name,
      relationship: persona.relationship,
      role: persona.role,
      email: persona.email,
      joinedAt: createdDate,
      status: 'active',
      plainToken: persona.token,
      accessCode: persona.accessCode,
    };

    const tokenDoc: PersistedTokenRecord = {
      id: `tok_${persona.partId}`,
      tokenHash: hashToken(persona.token),
      plainToken: persona.token,
      accessCode: persona.accessCode,
      interviewId: intId,
      participantId: persona.partId,
      expiresAt,
      revoked: false,
      createdAt: createdDate,
    };

    const interview: InterviewRecord = {
      id: intId,
      title: 'Senderos y Pasiones de Alejandro Vega',
      storyMode: 'individual',
      storyType: 'biografia_personal',
      status: 'completed',
      questionnaireVersionId: 'v1_standard',
      openedAt: createdDate,
      expiresAt,
      closedAt: closedDate,
      closureReason: 'Entrevista completada con 100 respuestas y cerrada para maquetación editorial.',
      participantClosingText: 'A mis hijos y a quienes amen la naturaleza: recuerden que no heredamos la tierra de nuestros padres, sino que la tenemos prestada de nuestros hijos.',
      userDeclaredComplete: true,
      sufficiencyStatus: 'sufficient',
      completedQuestionCount: answers.length,
      sufficiencyThreshold: 100,
      openDaysAtCreation: 30,
      maxFollowUpsAtCreation: 2,
      lastActivityAt: closedDate,
      bookGeneratedCount: 0,
      layoutEditsAllowed: 2,
      layoutEditsUsed: 0,
    };

    stories.push({ interview, participants: [participant], answers, tokens: [tokenDoc] });
  }

  // =========================================================================
  // 4. SHARED STORY 1 (2 Participantes - 200 Respuestas totales):
  //    "Cincuenta Años de Camino Juntos: Roberto y Elena"
  // =========================================================================
  {
    const intId = 'int_test_roberto_elena';
    const personas: PersonaContext[] = [
      {
        partId: 'part_roberto_gomez',
        name: 'Roberto Gómez Estrada',
        role: 'primary',
        relationship: 'Esposo',
        email: 'roberto.gomez@ejemplo.com',
        token: 'tok_roberto_gomez_demo_2026',
        accessCode: 'ROB-5021',
        hometown: 'Guadalajara, Jalisco',
        profession: 'Arquitecto y Constructor',
        birthYear: 1946,
        spouseOrPartner: 'Elena Morales de Gómez',
        relativesContext: 'Esposo de Elena por 50 años, padre de 3 hijos.',
        voiceStyle: 'Estructurado, tierno, profundamente enamorado y agradecido.',
        biographySummary: '50 años de matrimonio y una vida construyendo hogares y proyectos.',
        customThemes: {
          etapa1Key: 'Barrio de San Juan de Dios',
          etapa2Key: 'Facultad de Arquitectura',
          etapa3Key: 'Noviazgo y boda dorada',
          etapa4Key: 'Crianza de los hijos y proyectos',
          etapa5Key: 'Gratitud de bodas de oro',
        },
      },
      {
        partId: 'part_elena_morales',
        name: 'Elena Morales de Gómez',
        role: 'contributor',
        relationship: 'Esposa',
        email: 'elena.morales@ejemplo.com',
        token: 'tok_elena_morales_demo_2026',
        accessCode: 'ELE-5022',
        hometown: 'Guadalajara, Jalisco',
        profession: 'Pianista y Educadora Musical',
        birthYear: 1949,
        spouseOrPartner: 'Roberto Gómez Estrada',
        relativesContext: 'Esposa de Roberto por 50 años, madre de 3 hijos.',
        voiceStyle: 'Armonioso, sensible, alegre y detallista.',
        biographySummary: 'Cincuenta años de melodía compartida junto a Roberto.',
        customThemes: {
          etapa1Key: 'Conservatorio y piano materno',
          etapa2Key: 'Conciertos y serenatas de Roberto',
          etapa3Key: 'Matrimonio y hogar sonoro',
          etapa4Key: 'Nietos al piano',
          etapa5Key: 'El himno de nuestra unión',
        },
      },
    ];

    const allAnswers: AnswerRecord[] = [];
    const participants: Array<ParticipantRecord & { plainToken: string; accessCode: string }> = [];
    const tokens: PersistedTokenRecord[] = [];

    for (const p of personas) {
      const pAns = generate100AnswersForParticipant(intId, p, createdDate);
      allAnswers.push(...pAns);
      participants.push({
        id: p.partId,
        interviewId: intId,
        name: p.name,
        relationship: p.relationship,
        role: p.role,
        email: p.email,
        joinedAt: createdDate,
        status: 'active',
        plainToken: p.token,
        accessCode: p.accessCode,
      });
      tokens.push({
        id: `tok_${p.partId}`,
        tokenHash: hashToken(p.token),
        plainToken: p.token,
        accessCode: p.accessCode,
        interviewId: intId,
        participantId: p.partId,
        expiresAt,
        revoked: false,
        createdAt: createdDate,
      });
    }

    const interview: InterviewRecord = {
      id: intId,
      title: 'Cincuenta Años de Camino Juntos: Roberto y Elena',
      storyMode: 'compartida',
      storyType: 'pareja_aniversario',
      status: 'completed',
      questionnaireVersionId: 'v1_standard',
      openedAt: createdDate,
      expiresAt,
      closedAt: closedDate,
      closureReason: 'Entrevista compartida completada con 200 respuestas (100 por cónyuge) y cerrada para maquetación.',
      participantClosingText: 'Cincuenta años tomados de la mano nos demostraron que el amor no es mirarse el uno al otro, sino mirar juntos en la misma dirección con fe y devoción.',
      userDeclaredComplete: true,
      sufficiencyStatus: 'sufficient',
      completedQuestionCount: allAnswers.length,
      sufficiencyThreshold: 100,
      openDaysAtCreation: 30,
      maxFollowUpsAtCreation: 2,
      lastActivityAt: closedDate,
      bookGeneratedCount: 0,
      layoutEditsAllowed: 2,
      layoutEditsUsed: 0,
    };

    stories.push({ interview, participants, answers: allAnswers, tokens });
  }

  // =========================================================================
  // 5. SHARED STORY 2 (3 Participantes - 300 Respuestas totales):
  //    "Tres Hermanos, Un Mismo Hogar: Los Morales"
  // =========================================================================
  {
    const intId = 'int_test_hermanos_morales';
    const personas: PersonaContext[] = [
      {
        partId: 'part_javier_morales',
        name: 'Dr. Javier Morales Domínguez',
        role: 'primary',
        relationship: 'Hermano Mayor',
        email: 'javier.morales@ejemplo.com',
        token: 'tok_javier_morales_demo_2026',
        accessCode: 'JAV-3001',
        hometown: 'Puebla de los Ángeles',
        profession: 'Médico Cirujano y Profesor Universitario',
        birthYear: 1960,
        relativesContext: 'Hermano de Beatriz y Gonzalo; primogénito de don Luis y doña Sara.',
        voiceStyle: 'Protector, riguroso, compasivo y memorioso.',
        biographySummary: 'Vocal de la memoria de nuestros padres y guía de la hermandad.',
        customThemes: {
          etapa1Key: 'Cuidar a los hermanos menores',
          etapa2Key: 'Vocación médica de servicio',
          etapa3Key: 'Guardias de hospital y familia',
          etapa4Key: 'Cuidado de nuestros padres mayores',
          etapa5Key: 'El pacto fraterno sagrado',
        },
      },
      {
        partId: 'part_beatriz_morales',
        name: 'Mtra. Beatriz Morales Domínguez',
        role: 'contributor',
        relationship: 'Hermana Mediana',
        email: 'beatriz.morales@ejemplo.com',
        token: 'tok_beatriz_morales_demo_2026',
        accessCode: 'BEA-3002',
        hometown: 'Puebla de los Ángeles',
        profession: 'Historiadora del Arte y Curadora',
        birthYear: 1963,
        relativesContext: 'Hermana de Javier y Gonzalo; custodia del archivo familiar.',
        voiceStyle: 'Culto, sensible, analítico y poético.',
        biographySummary: 'Preservando los documentos, cartas y memoria viva de la casa materna.',
        customThemes: {
          etapa1Key: 'Patios poblanos y libros antiguos',
          etapa2Key: 'Facultad de Filosofía y Letras',
          etapa3Key: 'Investigaciones en museos',
          etapa4Key: 'La partida de doña Sara',
          etapa5Key: 'El legado que perdura en palabras',
        },
      },
      {
        partId: 'part_gonzalo_morales',
        name: 'Ing. Gonzalo Morales Domínguez',
        role: 'contributor',
        relationship: 'Hermano Menor',
        email: 'gonzalo.morales@ejemplo.com',
        token: 'tok_gonzalo_morales_demo_2026',
        accessCode: 'GON-3003',
        hometown: 'Puebla de los Ángeles',
        profession: 'Ingeniero Agrónomo y Productor Sustentable',
        birthYear: 1968,
        relativesContext: 'Hermano menor de Javier y Beatriz; amante de la tierra y los viajes.',
        voiceStyle: 'Espontáneo, alegre, práctico y afectuoso.',
        biographySummary: 'El menor de la casa que aprendió el amor al campo y la unión familiar.',
        customThemes: {
          etapa1Key: 'Travesuras infantiles con Javier',
          etapa2Key: 'Campos agrícolas de Chapingo',
          etapa3Key: 'Ranchos y cooperativas campesinas',
          etapa4Key: 'Reuniones de hermanos los fines de semana',
          etapa5Key: 'Nuestra hermandad es nuestro escudo',
        },
      },
    ];

    const allAnswers: AnswerRecord[] = [];
    const participants: Array<ParticipantRecord & { plainToken: string; accessCode: string }> = [];
    const tokens: PersistedTokenRecord[] = [];

    for (const p of personas) {
      const pAns = generate100AnswersForParticipant(intId, p, createdDate);
      allAnswers.push(...pAns);
      participants.push({
        id: p.partId,
        interviewId: intId,
        name: p.name,
        relationship: p.relationship,
        role: p.role,
        email: p.email,
        joinedAt: createdDate,
        status: 'active',
        plainToken: p.token,
        accessCode: p.accessCode,
      });
      tokens.push({
        id: `tok_${p.partId}`,
        tokenHash: hashToken(p.token),
        plainToken: p.token,
        accessCode: p.accessCode,
        interviewId: intId,
        participantId: p.partId,
        expiresAt,
        revoked: false,
        createdAt: createdDate,
      });
    }

    const interview: InterviewRecord = {
      id: intId,
      title: 'Tres Hermanos, Un Mismo Hogar: Los Morales',
      storyMode: 'compartida',
      storyType: 'familia_multigeneracional',
      status: 'completed',
      questionnaireVersionId: 'v1_standard',
      openedAt: createdDate,
      expiresAt,
      closedAt: closedDate,
      closureReason: 'Entrevista completada con 300 respuestas (100 por hermano) y cerrada para maquetación.',
      participantClosingText: 'Heredamos de nuestros padres el mayor tesoro terrenal: la certeza de que no importa cuán lejos nos lleve el destino, los tres siempre seremos un solo corazón.',
      userDeclaredComplete: true,
      sufficiencyStatus: 'sufficient',
      completedQuestionCount: allAnswers.length,
      sufficiencyThreshold: 100,
      openDaysAtCreation: 30,
      maxFollowUpsAtCreation: 2,
      lastActivityAt: closedDate,
      bookGeneratedCount: 0,
      layoutEditsAllowed: 2,
      layoutEditsUsed: 0,
    };

    stories.push({ interview, participants, answers: allAnswers, tokens });
  }

  // =========================================================================
  // 6. SHARED STORY 3 (4 Participantes - 400 Respuestas totales):
  //    "Cuatro Generaciones de Amor: Familia Domínguez"
  // =========================================================================
  {
    const intId = 'int_test_familia_dominguez';
    const personas: PersonaContext[] = [
      {
        partId: 'part_manuel_dominguez',
        name: 'Don Manuel Domínguez Soto',
        role: 'primary',
        relationship: 'Abuelo / Patriarca',
        email: 'manuel.dominguez@ejemplo.com',
        token: 'tok_manuel_dominguez_demo_2026',
        accessCode: 'MAN-4001',
        hometown: 'Aguascalientes, Ags.',
        profession: 'Jubilado de Ferrocarriles Nacionales',
        birthYear: 1942,
        spouseOrPartner: 'Rosa Elvira Cárdenas',
        relativesContext: 'Abuelo de la familia; esposo de Rosa Elvira, padre de Carlos y abuelo de Mariana.',
        voiceStyle: 'Varonil, pausado, con olor a rieles y dignidad obrera.',
        biographySummary: '42 años sobre las locomotoras conectando a México y formando una familia honrada.',
        customThemes: {
          etapa1Key: 'Patios de maniobras de ferrocarril',
          etapa2Key: 'Fogonero y maquinista joven',
          etapa3Key: 'Amor con Rosa Elvira y crianza de Carlos',
          etapa4Key: 'Jubilación obrera con medalla de oro',
          etapa5Key: 'El orgullo del trabajo limpio',
        },
      },
      {
        partId: 'part_rosa_cardenas',
        name: 'Doña Rosa Elvira Cárdenas',
        role: 'contributor',
        relationship: 'Abuela / Matriarca',
        email: 'rosa.cardenas@ejemplo.com',
        token: 'tok_rosa_cardenas_demo_2026',
        accessCode: 'ROS-4002',
        hometown: 'Aguascalientes, Ags.',
        profession: 'Pilar del Hogar y Repostera Tradicional',
        birthYear: 1945,
        spouseOrPartner: 'Manuel Domínguez Soto',
        relativesContext: 'Abuela de la familia; esposa de Manuel, madre de Carlos y abuela de Mariana.',
        voiceStyle: 'Cariñoso, dulce, protector y hospitalario.',
        biographySummary: 'El corazón que mantuvo unida a toda la casa con atoles, pasteles y oraciones.',
        customThemes: {
          etapa1Key: 'Hornadas de pan con mi madre',
          etapa2Key: 'Esperar a Manuel en la estación',
          etapa3Key: 'La cocina llena de aromas y risas',
          etapa4Key: 'Ver crecer a Mariana entre cuentos',
          etapa5Key: 'La dulzura que une a la familia',
        },
      },
      {
        partId: 'part_carlos_dominguez',
        name: 'C.P. Carlos Domínguez Cárdenas',
        role: 'contributor',
        relationship: 'Hijo / Padre',
        email: 'carlos.dominguez@ejemplo.com',
        token: 'tok_carlos_dominguez_demo_2026',
        accessCode: 'CAR-4003',
        hometown: 'Aguascalientes, Ags.',
        profession: 'Contador Público y Entrenador de Béisbol',
        birthYear: 1972,
        relativesContext: 'Hijo de Manuel y Rosa; padre amoroso de Mariana.',
        voiceStyle: 'Enérgico, responsable, agradecido y disciplinado.',
        biographySummary: 'El puente entre la disciplina de los abuelos y los sueños de la juventud actual.',
        customThemes: {
          etapa1Key: 'Ver a papá llegar con su overol de maquinista',
          etapa2Key: 'Estudios de contaduría y campos de béisbol',
          etapa3Key: 'Nacimiento de Mariana, mi sol',
          etapa4Key: 'El cuidado y orgullo por mis viejos',
          etapa5Key: 'La honestidad de los Domínguez',
        },
      },
      {
        partId: 'part_mariana_dominguez',
        name: 'Mariana Domínguez Alarcón',
        role: 'contributor',
        relationship: 'Nieta',
        email: 'mariana.dominguez@ejemplo.com',
        token: 'tok_mariana_dominguez_demo_2026',
        accessCode: 'MAR-4004',
        hometown: 'Aguascalientes, Ags.',
        profession: 'Estudiante de Arquitectura y Escritora',
        birthYear: 2002,
        relativesContext: 'Nieta de Manuel y Rosa; hija consentida de Carlos.',
        voiceStyle: 'Fresco, emotivo, moderno y profundamente conmovido por sus raíces.',
        biographySummary: 'La joven que hereda la memoria para construir el porvenir.',
        customThemes: {
          etapa1Key: 'Tardes de galletas con la abuela Rosa',
          etapa2Key: 'Historias de trenes con el abuelo Manuel',
          etapa3Key: 'Proyectos universitarios y visión moderna',
          etapa4Key: 'Cuidar con devoción a las raíces',
          etapa5Key: 'Yo llevaré este apellido con honor al futuro',
        },
      },
    ];

    const allAnswers: AnswerRecord[] = [];
    const participants: Array<ParticipantRecord & { plainToken: string; accessCode: string }> = [];
    const tokens: PersistedTokenRecord[] = [];

    for (const p of personas) {
      const pAns = generate100AnswersForParticipant(intId, p, createdDate);
      allAnswers.push(...pAns);
      participants.push({
        id: p.partId,
        interviewId: intId,
        name: p.name,
        relationship: p.relationship,
        role: p.role,
        email: p.email,
        joinedAt: createdDate,
        status: 'active',
        plainToken: p.token,
        accessCode: p.accessCode,
      });
      tokens.push({
        id: `tok_${p.partId}`,
        tokenHash: hashToken(p.token),
        plainToken: p.token,
        accessCode: p.accessCode,
        interviewId: intId,
        participantId: p.partId,
        expiresAt,
        revoked: false,
        createdAt: createdDate,
      });
    }

    const interview: InterviewRecord = {
      id: intId,
      title: 'Cuatro Generaciones de Amor: Familia Domínguez',
      storyMode: 'compartida',
      storyType: 'familia_multigeneracional',
      status: 'completed',
      questionnaireVersionId: 'v1_standard',
      openedAt: createdDate,
      expiresAt,
      closedAt: closedDate,
      closureReason: 'Entrevista completada con 400 respuestas (100 por cada miembro) y cerrada para maquetación.',
      participantClosingText: 'De las vías del tren a las aulas de arquitectura, cuatro generaciones unidas por un mismo latido de amor, honradez y gratitud eterna.',
      userDeclaredComplete: true,
      sufficiencyStatus: 'sufficient',
      completedQuestionCount: allAnswers.length,
      sufficiencyThreshold: 100,
      openDaysAtCreation: 30,
      maxFollowUpsAtCreation: 2,
      lastActivityAt: closedDate,
      bookGeneratedCount: 0,
      layoutEditsAllowed: 2,
      layoutEditsUsed: 0,
    };

    stories.push({ interview, participants, answers: allAnswers, tokens });
  }

  // =========================================================================
  // 7. SHARED STORY 4 (5 Participantes - 500 Respuestas totales):
  //    "El Gran Banquete Familiar: Dinastía Navarro"
  // =========================================================================
  {
    const intId = 'int_test_dinastia_navarro';
    const personas: PersonaContext[] = [
      {
        partId: 'part_ernesto_navarro',
        name: 'Don Ernesto Navarro Gil',
        role: 'primary',
        relationship: 'Abuelo / Patriarca',
        email: 'ernesto.navarro@ejemplo.com',
        token: 'tok_ernesto_navarro_demo_2026',
        accessCode: 'ERN-5001',
        hometown: 'Taxco de Alarcón, Guerrero',
        profession: 'Maestro Orfebre y Platero',
        birthYear: 1939,
        spouseOrPartner: 'Doña Teresa Solís',
        relativesContext: 'Patriarca de los Navarro; esposo de Teresa, padre de Esteban y Lucía, abuelo de Sofía.',
        voiceStyle: 'Sabio, reposado, con el brillo de la plata y el amor a la familia.',
        biographySummary: '60 años forjando joyas de plata y manteniendo unida a toda la dinastía.',
        customThemes: {
          etapa1Key: 'El taller de platería en las cuestas de Taxco',
          etapa2Key: 'Aprender el oficio con cincel y fuego',
          etapa3Key: 'Fundar el taller con Teresa a mi lado',
          etapa4Key: 'Ver a Esteban y Lucía dominar el arte',
          etapa5Key: 'La plata se pule con trabajo, la vida con amor',
        },
      },
      {
        partId: 'part_teresa_solis',
        name: 'Doña Teresa Solís de Navarro',
        role: 'contributor',
        relationship: 'Abuela / Matriarca',
        email: 'teresa.solis@ejemplo.com',
        token: 'tok_teresa_solis_demo_2026',
        accessCode: 'TER-5002',
        hometown: 'Taxco de Alarcón, Guerrero',
        profession: 'Custodia de Tradiciones y Administradora del Hogar',
        birthYear: 1943,
        spouseOrPartner: 'Don Ernesto Navarro',
        relativesContext: 'Matriarca de los Navarro; esposa de Ernesto, madre de Esteban y Lucía, abuela de Sofía.',
        voiceStyle: 'Cálido, alegre, anfitriona generosa de banquetes dominicales.',
        biographySummary: 'La guardiana de las recetas de pozole guerrerense y las reuniones dominicales.',
        customThemes: {
          etapa1Key: 'Calles empedradas y cocina de humo',
          etapa2Key: 'El noviazgo en el kiosco de Santa Prisca',
          etapa3Key: 'La mesa larga para amigos y clientes',
          etapa4Key: 'El nacimiento y caricias a los nietos',
          etapa5Key: 'Mi cocina es el templo de nuestro amor',
        },
      },
      {
        partId: 'part_esteban_navarro',
        name: 'Esteban Navarro Solís',
        role: 'contributor',
        relationship: 'Hijo Mayor',
        email: 'esteban.navarro@ejemplo.com',
        token: 'tok_esteban_navarro_demo_2026',
        accessCode: 'EST-5003',
        hometown: 'Taxco de Alarcón, Guerrero',
        profession: 'Maestro Platero y Director del Taller',
        birthYear: 1969,
        relativesContext: 'Hijo mayor de Ernesto y Teresa; hermano de Lucía y padre de Sofía.',
        voiceStyle: 'Innovador, respetuoso de la tradición, metódico.',
        biographySummary: 'Continuador de la excelencia platera que aprendió de su padre.',
        customThemes: {
          etapa1Key: 'Crecer entre el sonido de los martillos de plata',
          etapa2Key: 'Estudios de diseño industrial en la capital',
          etapa3Key: 'Modernizar el taller sin perder el alma artesanal',
          etapa4Key: 'La satisfacción de ver a Sofía estudiar',
          etapa5Key: 'Honrar el taller de papá con cada pieza',
        },
      },
      {
        partId: 'part_lucia_navarro',
        name: 'Lucía Navarro Solís',
        role: 'contributor',
        relationship: 'Hija',
        email: 'lucia.navarro@ejemplo.com',
        token: 'tok_lucia_navarro_demo_2026',
        accessCode: 'LUC-5004',
        hometown: 'Taxco de Alarcón, Guerrero',
        profession: 'Diseñadora de Joyas y Restauradora',
        birthYear: 1974,
        relativesContext: 'Hija de Ernesto y Teresa; hermana de Esteban y tía querida de Sofía.',
        voiceStyle: 'Creativo, elegante, emotivo y leal.',
        biographySummary: 'Diseñadora que llevó las piezas familiares a galerías internacionales.',
        customThemes: {
          etapa1Key: 'El balcón florido de la casa de mamá',
          etapa2Key: 'Escuela de artes plásticas',
          etapa3Key: 'Diseñar la colección de plata de Taxco',
          etapa4Key: 'Cuidar con esmero a mis padres ancianos',
          etapa5Key: 'La belleza es el lenguaje de nuestra familia',
        },
      },
      {
        partId: 'part_sofia_navarro',
        name: 'Sofía Navarro Prieto',
        role: 'contributor',
        relationship: 'Nieta',
        email: 'sofia.navarro@ejemplo.com',
        token: 'tok_sofia_navarro_demo_2026',
        accessCode: 'SOF-5005',
        hometown: 'Taxco de Alarcón, Guerrero',
        profession: 'Mercadóloga Digital e Historiadora Familiar',
        birthYear: 2004,
        relativesContext: 'Nieta de Ernesto y Teresa; hija de Esteban y sobrina de Lucía.',
        voiceStyle: 'Joven, vibrante, tecnológica y profundamente orgullosa de su linaje.',
        biographySummary: 'La nieta que digitaliza las historias y lleva el legado platero al mundo entero.',
        customThemes: {
          etapa1Key: 'Aprender a pulir plata con el abuelo Ernesto',
          etapa2Key: 'Probar los postres de la abuela Teresa',
          etapa3Key: 'Llevar las joyas familiares al comercio digital',
          etapa4Key: 'Escuchar cada anécdota y grabarla en audio',
          etapa5Key: 'Nosotros nunca olvidaremos de qué madera estamos hechos',
        },
      },
    ];

    const allAnswers: AnswerRecord[] = [];
    const participants: Array<ParticipantRecord & { plainToken: string; accessCode: string }> = [];
    const tokens: PersistedTokenRecord[] = [];

    for (const p of personas) {
      const pAns = generate100AnswersForParticipant(intId, p, createdDate);
      allAnswers.push(...pAns);
      participants.push({
        id: p.partId,
        interviewId: intId,
        name: p.name,
        relationship: p.relationship,
        role: p.role,
        email: p.email,
        joinedAt: createdDate,
        status: 'active',
        plainToken: p.token,
        accessCode: p.accessCode,
      });
      tokens.push({
        id: `tok_${p.partId}`,
        tokenHash: hashToken(p.token),
        plainToken: p.token,
        accessCode: p.accessCode,
        interviewId: intId,
        participantId: p.partId,
        expiresAt,
        revoked: false,
        createdAt: createdDate,
      });
    }

    const interview: InterviewRecord = {
      id: intId,
      title: 'El Gran Banquete Familiar: Dinastía Navarro',
      storyMode: 'compartida',
      storyType: 'familia_multigeneracional',
      status: 'completed',
      questionnaireVersionId: 'v1_standard',
      openedAt: createdDate,
      expiresAt,
      closedAt: closedDate,
      closureReason: 'Entrevista completada con 500 respuestas (100 por cada uno de los 5 miembros) y cerrada para maquetación.',
      participantClosingText: 'Cinco voces, tres generaciones y un solo taller de vida donde la plata se forja con arte y los lazos de sangre se pulen con amor eterno.',
      userDeclaredComplete: true,
      sufficiencyStatus: 'sufficient',
      completedQuestionCount: allAnswers.length,
      sufficiencyThreshold: 100,
      openDaysAtCreation: 30,
      maxFollowUpsAtCreation: 2,
      lastActivityAt: closedDate,
      bookGeneratedCount: 0,
      layoutEditsAllowed: 2,
      layoutEditsUsed: 0,
    };

    stories.push({ interview, participants, answers: allAnswers, tokens });
  }

  return stories;
}
