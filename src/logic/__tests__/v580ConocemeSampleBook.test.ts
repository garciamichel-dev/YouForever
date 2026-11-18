/**
 * V5.8.0 — «Conóceme» › «Vista Previa Interactiva del Legado»: a complete third-person biography laid
 * out like the books of the participant portal, and «Crear mi historia gratis» → /free.
 *
 * The fill of every page was measured in a real browser during development (Option 2, 6×9: every
 * chapter page between 93 % and 97 %); these tests guard the content and the wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONOCEME_SAMPLE_EDITORIAL_CONFIG,
  CONOCEME_SAMPLE_MANUSCRIPT,
  CONOCEME_SAMPLE_PHOTOS,
} from '../conocemeSampleBook.ts';
import { composeBookPages } from '../demoStoryRules.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

test('V5.8.0-C1: el libro de muestra es una biografía en tercera persona (estilo C)', () => {
  assert.equal(CONOCEME_SAMPLE_MANUSCRIPT.narrativeStyle, 'third_person_biography');
  assert.equal(CONOCEME_SAMPLE_EDITORIAL_CONFIG.narrativeStyle, 'third_person_biography');
  const firstPerson = /\b(yo|me|mi|mis|mí|conmigo|nos|nosotros|nuestra|nuestro|nuestras|nuestros)\b/i;
  const narrative = [
    CONOCEME_SAMPLE_MANUSCRIPT.introduction,
    ...CONOCEME_SAMPLE_MANUSCRIPT.chapters.flatMap((c) => [c.title, ...c.paragraphs, c.pullQuote || '']),
  ];
  for (const text of narrative) {
    assert.doesNotMatch(text, firstPerson, `primera persona en: «${text.slice(0, 80)}…»`);
  }
  for (const c of CONOCEME_SAMPLE_MANUSCRIPT.chapters) {
    assert.doesNotMatch(c.pullQuote || '', /^[«"]|[»"]$/, 'el diseño ya pone las comillas de la cita');
  }
});

test('V5.8.0-C2: cada capítulo trae texto suficiente para llenar sus páginas, con foto y cita', () => {
  assert.equal(CONOCEME_SAMPLE_MANUSCRIPT.chapters.length, 4);
  for (const c of CONOCEME_SAMPLE_MANUSCRIPT.chapters) {
    const total = words(c.paragraphs.join(' '));
    assert.ok(total >= 450 && total <= 600, `${c.id}: ${total} palabras (calibrado para 2 páginas llenas en 6×9)`);
    assert.ok(CONOCEME_SAMPLE_PHOTOS[c.id]?.dataUrl.startsWith('data:image/svg+xml'), `${c.id}: foto`);
    assert.ok(c.pullQuote && c.pullQuote.length > 40, `${c.id}: cita destacada`);
  }
});

test('V5.8.0-C3: el texto se conserva tal cual (no lo «repara» el compositor)', () => {
  assert.equal(CONOCEME_SAMPLE_MANUSCRIPT.aiGenerated, true);
  const composed = composeBookPages({
    manuscript: CONOCEME_SAMPLE_MANUSCRIPT,
    editorialConfig: CONOCEME_SAMPLE_EDITORIAL_CONFIG,
    chapterPhotos: CONOCEME_SAMPLE_PHOTOS,
    customClosingPageText: 'Esta historia continuará...',
    maxContentPages: 500,
  });
  const intro = composed.pages.find((p) => p.introduction)?.introduction || '';
  assert.ok(intro.startsWith('Este libro reúne'), intro.slice(0, 40));
  const text = composed.pages.flatMap((p) => (p.sections || []).flatMap((s) => s.paragraphs)).join(' ');
  for (const c of CONOCEME_SAMPLE_MANUSCRIPT.chapters) {
    for (const para of c.paragraphs) assert.ok(text.replace(/\s+/g, ' ').includes(para.slice(0, 60)), para.slice(0, 60));
  }
  const quotes = composed.pages.flatMap((p) => (p.sections || []).map((s) => s.pullQuote).filter(Boolean));
  assert.deepEqual(quotes, CONOCEME_SAMPLE_MANUSCRIPT.chapters.map((c) => c.pullQuote));
});

test('V5.8.0-C4: Conóceme muestra el libro con la misma maquetación que el portal del participante', () => {
  const view = read('src/components/ConocemeView.tsx');
  assert.match(view, /useMeasuredBook\(composedSampleSource\)/);
  assert.match(view, /<ScaledBookPageView composed=\{composedSampleBook\} page=\{activeComposedPage\} \/>/);
  assert.doesNotMatch(view, /<DemoComposedPageView/);
  assert.match(view, /maxContentPages: 500/);
  assert.doesNotMatch(view, /FIXED_REGISTERED_SAMPLE/, 'el libro corto anterior ya no existe');
});

test('V5.8.0-L1: «Crear mi historia gratis» lleva al registro gratuito /free', () => {
  const view = read('src/components/ConocemeView.tsx');
  const button = view.slice(view.lastIndexOf('<a', view.indexOf('<span>Crear mi historia gratis</span>')));
  assert.match(button.slice(0, 700), /href="\/free"/);
  assert.match(button.slice(0, 700), /onNavigateToFree\(\)/);
  assert.doesNotMatch(button.slice(0, 700), /href="\/demo"/);
  assert.match(read('src/App.tsx'), /onNavigateToFree=\{\(\) => handleSelectView\('free'\)\}/);
});

test('V5.8.1-L2: «Prueba gratuita» del encabezado lleva al registro gratuito /free', () => {
  const view = read('src/components/ConocemeView.tsx');
  const end = view.indexOf('<span>Prueba gratuita</span>');
  const link = view.slice(view.lastIndexOf('<a', end), end);
  assert.match(link, /href="\/free"/);
  assert.match(link, /onNavigateToFree\(\)/);
});

test('V5.8.2-R1: el encabezado de la vista previa se apila en toda pantalla (las pestañas no aplastan el texto)', () => {
  const view = read('src/components/ConocemeView.tsx');
  assert.match(view, /data-testid="legacy-preview-header" className="flex flex-col gap-5"/);
  assert.match(view, /data-testid="legacy-preview-page-tabs" className="flex flex-wrap items-center gap-1\.5 min-w-0 w-full"/);
  const header = view.slice(view.indexOf('data-testid="legacy-preview-header"'), view.indexOf('data-testid="legacy-book-card"'));
  assert.doesNotMatch(header, /lg:flex-row/);
});
