/**
 * V5.7.0 — «Proporciones del libro» in Configuración Global: the administrator chooses between
 *   Opción 1 'viewer_proportions'         → the whole book keeps the proportions of the former viewer;
 *   Opción 2 'cover_viewer_interior_12pt' → cover as the former viewer, interior at ~12 pt (default).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOOK_COVER_REFERENCE_WIDTH_PX,
  BOOK_REFERENCE_BODY_TEXT_PX,
  DEFAULT_BOOK_LAYOUT_MODE,
  getActiveBookLayoutMode,
  getBookMmPerReferencePx,
  getBookReferencePageWidthPx,
  normalizeBookLayoutMode,
  setActiveBookLayoutMode,
  subscribeBookLayoutMode,
} from '../bookReferenceLayout.ts';
import { DEMO_BOOK_FORMATS } from '../demoStoryRules.ts';
import { INITIAL_APP_CONFIG } from '../interviewRules.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const INTERIOR_KINDS = ['title_dedication', 'table_of_contents', 'chapter_content', 'editorial_credits', 'closing_mandatory'];
const bodyPt = (f: (typeof DEMO_BOOK_FORMATS)[number], mode: 'viewer_proportions' | 'cover_viewer_interior_12pt') =>
  BOOK_REFERENCE_BODY_TEXT_PX[f.id] * getBookMmPerReferencePx(f, 'chapter_content', mode) * (72 / 25.4);

test('V5.7.0-M1: la Opción 2 (portada anterior + interior a 12 pt) es la predeterminada', () => {
  assert.equal(DEFAULT_BOOK_LAYOUT_MODE, 'cover_viewer_interior_12pt');
  assert.equal(INITIAL_APP_CONFIG.bookLayoutMode, 'cover_viewer_interior_12pt');
  assert.equal(getActiveBookLayoutMode(), 'cover_viewer_interior_12pt');
  assert.equal(normalizeBookLayoutMode(undefined), 'cover_viewer_interior_12pt');
  assert.equal(normalizeBookLayoutMode('otra cosa'), 'cover_viewer_interior_12pt');
  assert.equal(normalizeBookLayoutMode('viewer_proportions'), 'viewer_proportions');
});

test('V5.7.0-M2: Opción 1 — todas las páginas con las proporciones del visualizador anterior (letra grande)', () => {
  const expectedPt: Record<string, [number, number]> = { a5: [16, 18], '6x9': [14.5, 15.5], carta: [18, 20] };
  for (const f of DEMO_BOOK_FORMATS) {
    for (const kind of ['cover', ...INTERIOR_KINDS]) {
      assert.equal(getBookReferencePageWidthPx(f, kind, 'viewer_proportions'), BOOK_COVER_REFERENCE_WIDTH_PX[f.id], `${f.id} ${kind}`);
    }
    const pt = bodyPt(f, 'viewer_proportions');
    assert.ok(pt >= expectedPt[f.id][0] && pt <= expectedPt[f.id][1], `${f.id}: ${pt.toFixed(1)} pt`);
  }
});

test('V5.7.0-M3: Opción 2 — portada como el visualizador anterior e interior a ~12 pt', () => {
  for (const f of DEMO_BOOK_FORMATS) {
    assert.equal(getBookReferencePageWidthPx(f, 'cover', 'cover_viewer_interior_12pt'), BOOK_COVER_REFERENCE_WIDTH_PX[f.id]);
    for (const kind of INTERIOR_KINDS) {
      assert.ok(getBookReferencePageWidthPx(f, kind, 'cover_viewer_interior_12pt') > BOOK_COVER_REFERENCE_WIDTH_PX[f.id]);
    }
    assert.ok(Math.abs(bodyPt(f, 'cover_viewer_interior_12pt') - 12) < 0.1, f.id);
  }
});

test('V5.7.0-M4: cambiar el modo activo avisa al visualizador y cambia las medidas por defecto', () => {
  const seen: string[] = [];
  const off = subscribeBookLayoutMode(() => seen.push(getActiveBookLayoutMode()));
  try {
    const f = DEMO_BOOK_FORMATS.find((x) => x.id === '6x9')!;
    setActiveBookLayoutMode('viewer_proportions');
    assert.equal(getBookReferencePageWidthPx(f, 'chapter_content'), 360);
    setActiveBookLayoutMode('viewer_proportions'); // same value: no extra notification
    setActiveBookLayoutMode('valor-desconocido'); // → default
    assert.equal(getBookReferencePageWidthPx(f, 'chapter_content'), 450);
    assert.deepEqual(seen, ['viewer_proportions', 'cover_viewer_interior_12pt']);
  } finally {
    off();
    setActiveBookLayoutMode(DEFAULT_BOOK_LAYOUT_MODE);
  }
});

test('V5.7.0-S1: el servidor guarda solo valores válidos y publica únicamente este ajuste', () => {
  const storage = read('src/server/storage.ts');
  assert.match(
    storage,
    /newConfig\.bookLayoutMode === 'viewer_proportions' \|\|\s*newConfig\.bookLayoutMode === 'cover_viewer_interior_12pt'\s*\) \{\s*this\.config\.bookLayoutMode = newConfig\.bookLayoutMode;/
  );
  const api = read('src/server/api.ts');
  const route = api.slice(api.indexOf("apiRouter.get('/book-layout'"), api.indexOf("apiRouter.post('/config'"));
  assert.ok(route.length > 0, 'existe GET /api/book-layout');
  assert.doesNotMatch(route, /requireAdmin/, 'el participante puede leerlo');
  assert.match(route, /data: \{ bookLayoutMode:/, 'solo expone el modo, no el resto de la configuración');
  assert.doesNotMatch(route, /data: config|getConfig\(\)\s*\}/);
});

test('V5.7.0-S2: el panel de Configuración Global ofrece y guarda las dos opciones', () => {
  const panel = read('src/components/ConfigPanel.tsx');
  assert.match(panel, /data-testid="book-layout-mode-selector"/);
  assert.match(panel, /id: 'viewer_proportions' as const/);
  assert.match(panel, /id: 'cover_viewer_interior_12pt' as const/);
  assert.match(panel, /bookLayoutMode: layoutModeToSave,/);
  assert.match(panel, /persistGlobalConfiguration\(undefined, undefined, undefined, opt\.id\)/);
  assert.match(panel, /setActiveBookLayoutMode\(savedLayout\)/, 'las descargas del administrador lo aplican al momento');
});

test('V5.7.0-S3: visor, paginación y PDF usan el modo de la configuración (y el mismo para un libro)', () => {
  const pagination = read('src/components/book/measuredBookPagination.tsx');
  assert.match(pagination, /const mode = await loadBookLayoutMode\(\);/);
  assert.match(pagination, /\{ \.\.\.original, referenceLayoutMode: mode \}/);
  assert.match(pagination, /composed\.referenceLayoutMode \?\? getActiveBookLayoutMode\(\)/);
  const viewer = read('src/components/book/ScaledBookPageView.tsx');
  assert.match(viewer, /composed\.referenceLayoutMode \?\? activeMode/);
  assert.match(viewer, /\[composed, mode\]/, 'el visor vuelve a medir si cambia el modo');
  const client = read('src/components/book/bookLayoutModeClient.ts');
  assert.match(client, /fetch\('\/api\/book-layout'/);
  // bookReferenceLayout is imported by the browser bundle: it must not pull server-only modules.
  assert.doesNotMatch(read('src/logic/bookReferenceLayout.ts'), /from '\.\/interviewRules\.ts'/);
});

test('V5.7.0-P1: en el PDF una foto más angosta que su marco conserva las franjas y esquinas rectas', () => {
  const exporter = read('src/utils/bookPdfExporter.ts');
  assert.match(exporter, /const clip = \(frame \? clipRectFor\(ctx, frame\) : null\) \|\| box;/);
  assert.match(exporter, /g\.rect\(left - clip\.left, top - clip\.top, right - left, bottom - top\);/);
  assert.match(exporter, /paintBox\(ctx, el, cs, alpha, \{ borderOnly: true \}\)/, 'el borde del marco queda encima de la foto');
});
