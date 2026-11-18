/**
 * V5.6.0 — The downloaded PDF must be the same book the viewer shows.
 *
 * The visual comparison (viewer screenshot vs. rendered PDF, page by page) needs a real browser and
 * was run with Chrome during development; these tests guard the pieces that make it possible:
 * reference layout, self-hosted fonts, measured pagination and the wiring of every download.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOOK_TARGET_BODY_TEXT_PT,
  BOOK_REFERENCE_BODY_TEXT_PX,
  BOOK_COVER_REFERENCE_WIDTH_PX,
  getBookMmPerReferencePx,
  getBookReferencePageWidthPx,
  resolveDesktopClasses,
} from '../bookReferenceLayout.ts';
import { BOOK_FONT_FACES } from '../bookFonts.ts';
import {
  DEMO_BOOK_FORMATS,
  DEMO_COVER_DESIGNS,
  DEMO_INTERIOR_STYLES,
  type ComposedBookPage,
  type ComposedChapterSectionBlock,
  type DemoInMemoryPhoto,
} from '../demoStoryRules.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

test('V5.6.0-L1: el diseño de referencia no depende del tamaño de pantalla (solo valores de escritorio)', () => {
  assert.equal(resolveDesktopClasses('p-5 sm:p-7'), 'p-7');
  assert.equal(
    resolveDesktopClasses('absolute top-3.5 bottom-3.5 left-6 right-3.5 sm:top-4 sm:bottom-4 sm:left-7 sm:right-4 pointer-events-none'),
    'absolute pointer-events-none top-4 bottom-4 left-7 right-4'
  );
  // Text size and text colour are different utilities.
  assert.equal(resolveDesktopClasses('text-stone-500 text-xs sm:text-[13.5px] italic'), 'text-stone-500 italic text-[13.5px]');
  assert.equal(resolveDesktopClasses('h-28 sm:h-32 max-h-full'), 'max-h-full h-32');
});

test('V5.6.0-L2: Tailwind genera todas las clases de escritorio que usa el diseño de referencia', () => {
  const renderer = read('src/components/DemoBookPageRenderer.tsx');
  const pageView = renderer.slice(renderer.indexOf('export const DemoComposedPageView'));
  const needed = new Set(Array.from(pageView.matchAll(/\bsm:([^\s"'`)]+)/g), (m) => m[1]));
  const css = read('src/index.css');
  const inline = css.match(/@source inline\("([^"]+)"\)/);
  assert.ok(inline, 'src/index.css declara las clases de escritorio');
  const listed = new Set(inline![1].split(/\s+/));
  for (const cls of needed) assert.ok(listed.has(cls), `falta «${cls}» en @source inline de src/index.css`);
});

test('V5.6.0-L3: el texto del libro impreso mide ~12 pt en los tres formatos', () => {
  assert.equal(BOOK_TARGET_BODY_TEXT_PT, 12);
  for (const f of DEMO_BOOK_FORMATS) {
    const pt = BOOK_REFERENCE_BODY_TEXT_PX[f.id] * getBookMmPerReferencePx(f) * (72 / 25.4);
    assert.ok(Math.abs(pt - 12) < 0.1, `${f.id}: ${pt.toFixed(2)} pt`);
    assert.ok(getBookReferencePageWidthPx(f) >= 400, `${f.id}: ancho de referencia legible`);
  }
});

test('V5.6.0-L4: la portada conserva la distribución del visualizador anterior; el interior sigue a 12 pt', () => {
  const previousViewerWidth: Record<string, number> = { a5: 300, '6x9': 360, carta: 440 };
  for (const f of DEMO_BOOK_FORMATS) {
    assert.equal(BOOK_COVER_REFERENCE_WIDTH_PX[f.id], previousViewerWidth[f.id], f.id);
    assert.equal(getBookReferencePageWidthPx(f, 'cover'), previousViewerWidth[f.id], `${f.id}: portada`);
    for (const kind of ['title_dedication', 'table_of_contents', 'chapter_content', 'editorial_credits', 'closing_mandatory']) {
      assert.equal(getBookReferencePageWidthPx(f, kind), getBookReferencePageWidthPx(f), `${f.id}: ${kind} a 12 pt`);
    }
    // The cover fills the same paper: only the scale changes.
    assert.ok(Math.abs(getBookMmPerReferencePx(f, 'cover') * previousViewerWidth[f.id] - f.widthMm) < 1e-9);
  }
  const stage = read('src/components/book/measuredBookPagination.tsx');
  // V5.7.0: + the proportions mode chosen in Configuración Global.
  assert.match(stage, /host\.style\.width = `\$\{getBookReferencePageWidthPx\(composed\.format, page\.kind, mode\)\}px`/);
  assert.match(read('src/components/book/ScaledBookPageView.tsx'), /getBookReferencePageSizePx\(\s*composed\.format,\s*page\.kind,/);
  assert.match(read('src/utils/bookPdfExporter.ts'), /k: format\.widthMm \/ rr\.width/, 'la escala del PDF sale del ancho real de cada página');
});

test('V5.6.0-L5: el logo oficial de YouForever aparece en la portada de los libros guardados', () => {
  assert.match(read('src/components/ParticipantBookStudio.tsx'), /useOfficialForeverYouLogo: true/);
  const renderer = read('src/components/DemoBookPageRenderer.tsx');
  const footer = renderer.slice(renderer.indexOf('data-testid="cover-footer-imprint"'));
  assert.match(footer.slice(0, 600), /composed\.useOfficialForeverYouLogo && \(\s*<ForeverYouInfinitySymbol/);
});

test('V5.6.0-F1: cada diseño usa tipografías propias que existen en public/book-fonts (las mismas del PDF)', () => {
  for (const face of BOOK_FONT_FACES) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/book-fonts', face.file)), face.file);
  }
  const families = new Set(BOOK_FONT_FACES.map((f) => f.cssFamily));
  const specs = [...DEMO_COVER_DESIGNS, ...DEMO_INTERIOR_STYLES] as Array<Record<string, any>>;
  for (const spec of specs) {
    for (const key of ['titleFontFamily', 'bodyFontFamily', 'accentFontFamily']) {
      if (!spec[key]) continue;
      const primary = String(spec[key]).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      assert.ok(families.has(primary), `${spec.id}.${key} = ${spec[key]}`);
      for (const w of [400, 700]) {
        assert.ok(BOOK_FONT_FACES.some((f) => f.cssFamily === primary && f.weight === w && f.style === 'normal'), `${primary} ${w}`);
      }
    }
  }
  const css = read('src/bookFonts.css');
  for (const face of BOOK_FONT_FACES) assert.ok(css.includes(`/book-fonts/${face.file}`), `@font-face de ${face.file}`);
});

test('V5.6.0-F2: licencia OFL: las versiones modificadas no usan los nombres reservados', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'public/book-fonts/OFL.txt')));
  for (const face of BOOK_FONT_FACES) {
    for (const reserved of ['Lora', 'Playfair', 'Source']) {
      assert.ok(!face.cssFamily.includes(reserved) && !face.file.includes(reserved), `${face.file} / ${face.cssFamily}`);
    }
  }
});

test('V5.6.0-F3: el PDF elige el mismo grosor de letra que el navegador (reglas de CSS)', async () => {
  const { matchBookFontFace } = await import('../../utils/bookPdfExporter.ts');
  assert.equal(matchBookFontFace('YFBook PD', 700, false)?.file, 'YFBook-PD-700.ttf');
  assert.equal(matchBookFontFace('YFBook PD', 600, true)?.file, 'YFBook-PD-600i.ttf');
  assert.equal(matchBookFontFace('YFBook PD', 500, true)?.file, 'YFBook-PD-400i.ttf', 'cursiva 500 → 400 (no hay 500 cursiva)');
  assert.equal(matchBookFontFace('YFBook EBG', 800, false)?.file, 'YFBook-EBG-700.ttf');
  assert.equal(matchBookFontFace('YFBook MR', 400, true)?.file, 'YFBook-MR-400.ttf', 'sin cursiva: se usa la recta');
  assert.equal(matchBookFontFace('Desconocida', 400, false), undefined);
});

// ---------------------------------------------------------------------------------------------
// Measured pagination: pure parts
// ---------------------------------------------------------------------------------------------

const photo = (id: string): DemoInMemoryPhoto => ({
  id, objectUrl: '', dataUrl: '', fileName: `${id}.jpg`, mimeType: 'image/jpeg', width: 800, height: 600, focusY: 'center', zoom: 1,
});
const words = (secs: ComposedChapterSectionBlock[]) => secs.flatMap((s) => s.paragraphs.join(' ').split(/\s+/).filter(Boolean));
const strip = (w: string[]) => w.join(' ').replace(/\*+/g, '').split(/\s+/).filter(Boolean);

test('V5.6.0-P1: partir una página nunca pierde ni duplica palabras, y equilibra negritas y cursivas', async () => {
  const { tokenizeChapterSections, buildChapterPrefix, buildChapterRemainder } = await import(
    '../../components/book/measuredBookPagination.tsx'
  );
  const sec: ComposedChapterSectionBlock = {
    chapterId: 'ch1',
    partNumber: 1,
    title: 'La casa frente al mar',
    paragraphs: ['Uno dos **tres cuatro cinco** seis.', 'Siete *ocho nueve* diez once.'],
    paragraphIds: ['ch1_p_1', 'ch1_p_2'],
    pullQuote: 'La memoria guarda lo que el corazón decide.',
    paragraphPhotos: { 1: [photo('ph1')] },
  };
  const tokens = tokenizeChapterSections([sec]);
  for (let k = 1; k < tokens.length; k++) {
    const a = buildChapterPrefix([sec], tokens, k);
    const b = buildChapterRemainder([sec], tokens, k);
    assert.deepEqual(strip([...words(a), ...words(b)]), strip(words([sec])), `corte en ${k}`);
    for (const s of [...a, ...b]) {
      for (const p of s.paragraphs) {
        assert.equal((p.match(/\*\*/g) || []).length % 2, 0, `negritas equilibradas: «${p}»`);
      }
    }
    const photosA = a.flatMap((s) => Object.values(s.paragraphPhotos || {}).flat());
    const photosB = b.flatMap((s) => Object.values(s.paragraphPhotos || {}).flat());
    assert.equal(photosA.length + photosB.length, 1, `la foto aparece una sola vez (corte ${k})`);
    assert.equal(Number(Boolean(a.at(-1)?.pullQuote)) + Number(Boolean(b.at(-1)?.pullQuote)), 1, 'la cita, una vez');
    if (b.length) assert.equal(b[0].isContinuation, true, 'lo que sigue es «continuación»');
  }
  // Cut in the middle of the first paragraph: the page keeps its last line justified.
  const midCut = buildChapterPrefix([sec], tokens, 4); // title + 3 words
  assert.equal(midCut[0].lastParagraphContinues, true);
  assert.equal(midCut[0].paragraphs[0], 'Uno dos **tres**');
});

test('V5.6.0-P2: los cortes del compositor anterior se deshacen y cada capítulo vuelve a fluir completo', async () => {
  const { mergeChapterContinuationRuns, renumberComposedPages } = await import(
    '../../components/book/measuredBookPagination.tsx'
  );
  const page = (n: number, sections: ComposedChapterSectionBlock[]): ComposedBookPage => ({
    pageNumber: n, totalPages: 9, kind: 'chapter_content', sections, showPageNumber: true,
  });
  const base = { partNumber: 1, title: 'Capítulo uno' };
  const pages: ComposedBookPage[] = [
    { pageNumber: 1, totalPages: 9, kind: 'cover', showPageNumber: false },
    page(2, [{ ...base, chapterId: 'c1', paragraphs: ['A1 a1.', 'A2 corta'], paragraphIds: ['c1_p_1', 'c1_p_2'] }]),
    page(3, [{ ...base, chapterId: 'c1', isContinuation: true, paragraphs: ['aquí sigue.', 'A3.'], paragraphIds: ['c1_p_2_cont_1', 'c1_p_3'], paragraphPhotos: { 1: [photo('p3')] } }]),
    page(4, [{ ...base, chapterId: 'c2', partNumber: 2, title: 'Capítulo dos', paragraphs: ['B1.'], paragraphIds: ['c2_p_1'] }]),
  ];
  const merged = mergeChapterContinuationRuns(pages);
  assert.equal(merged.length, 3, 'el capítulo 1 se unió; el capítulo 2 sigue empezando en su propia página');
  const s = merged[1].sections![0];
  assert.deepEqual(s.paragraphs, ['A1 a1.', 'A2 corta aquí sigue.', 'A3.'], 'el párrafo cortado se vuelve a unir');
  assert.deepEqual(s.paragraphIds, ['c1_p_1', 'c1_p_2', 'c1_p_3']);
  assert.deepEqual(Object.keys(s.paragraphPhotos || {}), ['2'], 'la foto sigue anclada a su párrafo');
  const doc = renumberComposedPages(
    { pages: [], tocEntries: [{ chapterId: 'c2', partNumber: 2, title: 'Capítulo dos', startPageNumber: 99 }] } as any,
    merged
  );
  assert.deepEqual(doc.pages.map((p) => [p.pageNumber, p.totalPages]), [[1, 3], [2, 3], [3, 3]]);
  assert.equal(doc.tocEntries![0].startPageNumber, 3, 'el índice apunta a la página real');
});

test('V5.6.0-W1: el visualizador y todas las descargas del libro usan el mismo diseño y el mismo PDF', () => {
  const studio = read('src/components/ParticipantBookStudio.tsx');
  assert.match(studio, /<ScaledBookPageView/);
  assert.doesNotMatch(studio, /<DemoComposedPageView/, 'el visualizador ya no dibuja páginas a tamaño de pantalla');
  assert.doesNotMatch(studio, /generateRealDemoBookPdf\(/);
  assert.equal((studio.match(/await generateBookPdfMatchingViewer\(/g) || []).length, 2, 'muestra y libro completo');
  assert.match(studio, /pageCount: fullMeasuredBookPageCount/);
  for (const admin of ['src/components/InterviewsPanel.tsx', 'src/components/ManuscriptsView.tsx']) {
    const src = read(admin);
    assert.match(src, /await generateBookPdfMatchingViewer\(/, admin);
    assert.doesNotMatch(src, /generateRealDemoBookPdf\(/, admin);
    assert.match(src, /lockedLeadingContentGroups: ver\.manuscript\?\.lockedPreviewGroups/, admin);
  }
  const renderer = read('src/components/DemoBookPageRenderer.tsx');
  assert.match(renderer, /referenceLayout\s*\?\s*'relative z-10 flex-1 min-h-0 overflow-hidden py-2 space-y-4'/, 'sin scroll dentro de la página');
});
