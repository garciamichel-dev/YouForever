/**
 * V5.4.0 — Fotografías en el chat de Mi Esencia.
 *
 * El avatar solo puede mostrar fotografías REALES del testimonio de su persona (las que el
 * entrevistado adjuntó a sus respuestas, con su descripción original). La selección es
 * determinista y se hace en el servidor: el modelo nunca elige ni inventa una imagen; solo recibe
 * una nota para referirse con naturalidad a la fotografía que se mostrará.
 */
import type { MiEsenciaTestimonyBlock } from './miEsenciaRules.ts';

/** Referencia a una fotografía mostrada en un mensaje del avatar. */
export interface MiEsenciaChatPhotoRef {
  photoId: string;
  caption: string;
}

export interface MiEsenciaPhotoCatalogEntry extends MiEsenciaChatPhotoRef {
  testimonyId: string;
  questionLiteral: string;
  answerLiteral: string;
  order: number;
}

/** Máximo de fotografías por respuesta. */
export const MI_ESENCIA_MAX_PHOTOS_PER_REPLY = 3;

const normalize = (text: string): string =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const PHOTO_REQUEST_PATTERN =
  /\b(fotos?|fotograf\w*|imagen(es)?|retratos?|selfies?|album|albumes)\b/;

/** ¿El mensaje pide ver una fotografía? */
export function isPhotoRequest(message: string): boolean {
  return PHOTO_REQUEST_PATTERN.test(normalize(message));
}

const STOPWORDS = new Set(
  `que como cual cuales cuando donde quien quienes para por con sin sobre entre hasta desde hacia
  una uno unos unas los las del al lo le les la el mis mi tus tu sus su nos nuestro nuestra nuestros
  nuestras este esta estos estas ese esa esos esas aquel aquella eso esto ahi alli aqui
  muy mas menos tambien pero porque pues entonces solo algo alguna alguno algunas algunos todo toda
  todos todas cada otro otra otros otras mismo misma
  tienes tiene tengo tenias tenia hay habia puedes puede podrias podria quiero quisiera queria
  me te se nos ver veo mira mirar ensename ensenar muestrame mostrar mostrarme compartir compartes
  comparteme manda mandame dame pasame enviame recuerdas recuerdo acuerdas acuerdo
  favor gracias hola oye dime cuentame sabes ella ellos ellas usted ustedes
  foto fotos fotografia fotografias imagen imagenes retrato retratos selfie selfies album albumes
  guardaste guardas guardado tuya tuyo tuyas tuyos mia mio suya suyo`
    .split(/\s+/)
    .filter(Boolean)
);

/** Palabras con contenido (sin acentos, ≥ 3 letras, sin palabras vacías). */
export function contentWords(text: string): string[] {
  return Array.from(
    new Set(
      normalize(text)
        .split(/[^a-z0-9ñ]+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    )
  );
}

/** Coincidencia tolerante: igual, o mismo prefijo de 5 letras (abuela / abuelita, casa / casas). */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5) return a.slice(0, 5) === b.slice(0, 5);
  // Short words: only small variations (plural, gender): casa / casas, mama / mamas.
  if (a.length >= 4 && b.length >= 4 && Math.min(a.length, b.length) <= 5 && Math.abs(a.length - b.length) <= 2) {
    return a.slice(0, 4) === b.slice(0, 4);
  }
  return false;
}

/** Catálogo de fotografías reales del testimonio (sin duplicados, en el orden del testimonio). */
export function buildPersonPhotoCatalog(testimonies: MiEsenciaTestimonyBlock[]): MiEsenciaPhotoCatalogEntry[] {
  const seen = new Set<string>();
  const catalog: MiEsenciaPhotoCatalogEntry[] = [];
  for (const t of testimonies || []) {
    for (const p of t.photoAttachments || []) {
      const photoId = String(p?.id || '').trim();
      if (!photoId || seen.has(photoId)) continue;
      seen.add(photoId);
      catalog.push({
        photoId,
        caption: String(p.caption || '').trim() || 'Fotografía del testimonio',
        testimonyId: t.testimonyId,
        questionLiteral: t.questionLiteral || '',
        answerLiteral: t.answerLiteral || '',
        order: catalog.length,
      });
    }
  }
  return catalog;
}

export interface MiEsenciaPhotoSelection {
  requested: boolean;
  /** El pedido no menciona ningún tema concreto ("¿tienes fotos?"). */
  generic: boolean;
  photos: MiEsenciaChatPhotoRef[];
  /** Total de fotografías reales disponibles para esta persona. */
  availableCount: number;
}

/**
 * Elige las fotografías que corresponden a lo que se pide. Puntúa las palabras del mensaje contra
 * la descripción de la foto (peso 3), la pregunta (1) y la respuesta (1) del testimonio al que
 * pertenece. Solo devuelve fotos con alguna coincidencia; en un pedido genérico devuelve las
 * primeras del testimonio.
 */
export function selectPhotosForMessage(
  message: string,
  catalog: MiEsenciaPhotoCatalogEntry[],
  maxPhotos: number = MI_ESENCIA_MAX_PHOTOS_PER_REPLY
): MiEsenciaPhotoSelection {
  const requested = isPhotoRequest(message);
  const empty = { requested, generic: false, photos: [], availableCount: catalog.length };
  if (!requested || catalog.length === 0) return empty;

  const query = contentWords(message);
  if (query.length === 0) {
    return {
      requested,
      generic: true,
      photos: catalog.slice(0, maxPhotos).map(({ photoId, caption }) => ({ photoId, caption })),
      availableCount: catalog.length,
    };
  }

  const scored = catalog
    .map((entry) => {
      const fields: Array<[string[], number]> = [
        [contentWords(entry.caption), 3],
        [contentWords(entry.questionLiteral), 1],
        [contentWords(entry.answerLiteral), 1],
      ];
      let score = 0;
      for (const q of query) {
        let best = 0;
        for (const [words, weight] of fields) {
          if (weight > best && words.some((w) => wordsMatch(q, w))) best = weight;
        }
        score += best;
      }
      return { entry, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);

  if (scored.length === 0) return { ...empty, generic: false };
  const top = scored[0].score;
  const photos = scored
    .filter((s) => s.score >= top * 0.6)
    .slice(0, maxPhotos)
    .map(({ entry }) => ({ photoId: entry.photoId, caption: entry.caption }));
  return { requested, generic: false, photos, availableCount: catalog.length };
}

/**
 * Nota para el modelo (se añade al mensaje solo en la llamada al modelo; nunca se guarda en la
 * conversación). Le dice qué foto se mostrará, para que la mencione sin negarla ni inventarla.
 */
export function buildPhotoContextNote(selection: MiEsenciaPhotoSelection): string {
  if (!selection.requested) return '';
  if (selection.photos.length > 0) {
    const list = selection.photos.map((p) => `«${p.caption}»`).join('; ');
    return (
      `[Nota del sistema, no visible para el familiar: junto a tu respuesta se mostrará automáticamente ` +
      `${selection.photos.length === 1 ? 'esta fotografía real' : 'estas fotografías reales'} de tu testimonio: ${list}. ` +
      `Refiérete a ${selection.photos.length === 1 ? 'ella' : 'ellas'} con naturalidad y en primera persona usando solo lo que dice su descripción y tus recuerdos. ` +
      `Esa descripción es la original del entrevistado y puede tener errores o muletillas: nunca la copies literalmente; dilo con tus propias palabras. ` +
      `Nunca digas que no puedes mostrar fotografías.]`
    );
  }
  return (
    `[Nota del sistema, no visible para el familiar: entre las fotografías de tu testimonio no hay ninguna de lo que te piden` +
    `${selection.availableCount > 0 ? '' : ' (no conservas fotografías)'}. Dilo con naturalidad y cariño; nunca describas ni inventes una fotografía.]`
  );
}

const DENIAL_PATTERN =
  /[^.!?\n]*\b(no\s+(puedo|podr[eé]|me\s+es\s+posible)\s+(mostrar|ense[nñ]ar|compartir|enviar|mandar)[^.!?\n]*(fotos?|fotograf\w*|im[aá]gen\w*)|soy\s+(solo|s[oó]lo)\s+(texto|una?\s+conversaci[oó]n\s+escrita))[^.!?\n]*[.!?]?/gi;

/**
 * Asegura que el texto acompañe a las fotos mostradas: quita frases que nieguen poder mostrarlas y,
 * si la respuesta no menciona ninguna fotografía, antepone una presentación breve.
 */
export function finalizeReplyForPhotos(reply: string, photos: MiEsenciaChatPhotoRef[]): string {
  const text = String(reply || '');
  if (photos.length === 0) return text;
  const cleaned = text.replace(DENIAL_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
  const mentionsPhoto = /\b(fotos?|fotograf\w*|im[aá]gen\w*|retrato\w*)\b/i.test(cleaned);
  if (mentionsPhoto && cleaned.length > 0) return cleaned;
  const lead =
    photos.length === 1
      ? 'Aquí te comparto la fotografía que guardé de ese recuerdo.'
      : 'Aquí te comparto las fotografías que guardé de ese recuerdo.';
  return cleaned ? `${lead} ${cleaned}` : lead;
}

// =============================================================================================
// V5.4.2 — Descripción de la fotografía generada por la IA (en lugar de la transcripción literal).
// =============================================================================================
import { cleanSpokenDisfluencies } from './spokenTextCleanup.ts';

/** Instrucción puntual que se añade al prompt del avatar para describir una fotografía. */
export const PHOTO_DESCRIPTION_TASK = `TAREA PUNTUAL (no es un turno de la conversación): escribe el pie de una fotografía tuya que se mostrará en el chat.
- Escribe en tu propia voz y con el estilo de tu prompt, en una o dos oraciones (máximo 45 palabras).
- Básate SOLO en la descripción original y en tu recuerdo; no inventes personas, lugares, fechas ni detalles que no estén ahí.
- Corrige la redacción: sin muletillas, repeticiones ni titubeos del habla.
- Devuelve únicamente el texto del pie de foto, sin comillas, sin títulos y sin saludos.`;

export function buildPhotoDescriptionUserText(entry: Pick<MiEsenciaPhotoCatalogEntry, 'caption' | 'questionLiteral' | 'answerLiteral'>): string {
  const answer = String(entry.answerLiteral || '').trim();
  return [
    `Descripción original que escribiste al subir la fotografía (puede tener errores de redacción o muletillas): «${entry.caption}»`,
    entry.questionLiteral ? `Pregunta de tu testimonio: «${entry.questionLiteral}»` : '',
    answer ? `Tu recuerdo: «${answer.length > 1200 ? `${answer.slice(0, 1200)}…` : answer}»` : '',
    'Escribe ahora el pie de foto.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Limpia lo que devuelve el modelo: un solo párrafo, sin comillas envolventes ni etiquetas. */
export function sanitizeGeneratedPhotoDescription(text: string | null | undefined): string {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(pie de foto|descripci[oó]n)\s*:\s*/i, '');
  t = t.replace(/^["«“']+|["»”']+$/g, '').trim();
  if (t.length > 320) t = `${t.slice(0, 317).replace(/\s+\S*$/, '')}…`;
  return t;
}

/** Respaldo sin IA: la descripción original sin muletillas ni titubeos y con puntuación final. */
export function cleanPhotoCaptionForDisplay(caption: string): string {
  const [clean] = cleanSpokenDisfluencies([String(caption || '').trim()]);
  const t = (clean || '').trim();
  if (!t) return 'Fotografía de mi testimonio.';
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}
