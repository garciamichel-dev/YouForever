/**
 * V5.8.3 — The complete book of the participant portal carries its «Índice General» whenever the
 * «Incluir índice» checkbox looks checked (a saved configuration without the value = index ON).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withParticipantBookDefaults } from '../participantBookConfig.ts';
import { composeBookPages, type DemoEditorialConfig } from '../demoStoryRules.ts';
import { CONOCEME_SAMPLE_MANUSCRIPT, CONOCEME_SAMPLE_PHOTOS } from '../conocemeSampleBook.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

// A configuration saved without the value (like the versions that lost the index).
const savedWithoutValue: DemoEditorialConfig = {
  narrativeStyle: 'first_person_literary',
  coverDesignId: 'clasica_eterna',
  coverColorVariantIdx: 0,
  coverVisualType: 'illustration',
  coverIllustrationId: 'arbol_raices',
  interiorStyleId: 'clasico_editorial',
  bookFormatId: '6x9',
  customTitle: 'Entre la casa y el mar',
  customSubtitle: 'Recuerdos',
  customAuthors: 'Michel García García',
  dedication: '',
};

const fullBook = (editorialConfig: DemoEditorialConfig) =>
  composeBookPages({
    manuscript: { ...CONOCEME_SAMPLE_MANUSCRIPT, narrativeStyle: 'first_person_literary' },
    editorialConfig,
    chapterPhotos: CONOCEME_SAMPLE_PHOTOS,
    maxContentPages: 500,
    previewSampleOnly: false,
  });

test('V5.8.3-T1: sin valor guardado, el libro del portal incluye el índice (como muestra la casilla)', () => {
  assert.equal(withParticipantBookDefaults(savedWithoutValue).includeTableOfContents, true);
  const before = fullBook(savedWithoutValue);
  assert.ok(!before.pages.some((p) => p.kind === 'table_of_contents'), 'el error: sin valor no había índice');
  const after = fullBook(withParticipantBookDefaults(savedWithoutValue));
  const toc = after.pages.filter((p) => p.kind === 'table_of_contents');
  assert.equal(toc.length, 1);
  assert.equal(after.pages[2].kind, 'table_of_contents', 'va después de la portadilla');
  assert.equal(toc[0].tocEntries?.length, CONOCEME_SAMPLE_MANUSCRIPT.chapters.length);
  assert.equal(after.pages.length, before.pages.length + 1, 'una página más; el texto no cambia');
});

test('V5.8.3-T2: si la casilla se desmarcó a propósito, el libro sigue sin índice', () => {
  const unchecked = withParticipantBookDefaults({ ...savedWithoutValue, includeTableOfContents: false });
  assert.equal(unchecked.includeTableOfContents, false);
  assert.ok(!fullBook(unchecked).pages.some((p) => p.kind === 'table_of_contents'));
  assert.equal(withParticipantBookDefaults(null), null);
  assert.equal(withParticipantBookDefaults(undefined), undefined);
});

test('V5.8.3-W1: el portal y las descargas de administración usan el mismo valor que la casilla', () => {
  const studio = read('src/components/ParticipantBookStudio.tsx');
  assert.match(studio, /const targetConfig = withParticipantBookDefaults\(/, 'visualizador');
  assert.match(studio, /editorialConfig: withParticipantBookDefaults\(version\.editorialConfig\)/, 'descarga de una versión');
  assert.match(studio, /\.\.\.withParticipantBookDefaults\(editorialConfig\),\s*narrativeStyle: activeStyle/, 'se guarda explícito');
  assert.match(studio, /withParticipantBookDefaults\(savedVersion\.editorialConfig \|\| currentEditorialConfig\)/, 'descarga al guardar');
  assert.match(studio, /setEditorialConfig\(withParticipantBookDefaults\(\{ \.\.\.activeSavedVersion\.editorialConfig \}\)\)/, 'al modificar');
  assert.match(studio, /includeTableOfContents \?\? true/, 'la casilla sigue mostrando el mismo valor');
  for (const admin of ['src/components/InterviewsPanel.tsx', 'src/components/ManuscriptsView.tsx']) {
    assert.match(read(admin), /editorialConfig: withParticipantBookDefaults\(ver\.editorialConfig\)/, admin);
  }
  // The demo (/Free) and «Conóceme» keep their own defaults.
  assert.doesNotMatch(read('src/components/DemoFreeTrialView.tsx'), /withParticipantBookDefaults/);
  assert.doesNotMatch(read('src/components/ConocemeView.tsx'), /withParticipantBookDefaults/);
  assert.match(read('src/logic/demoStoryRules.ts'), /const shouldIncludeToc = Boolean\(\s*includeTableOfContents \?\?\s*editorialConfig\.includeTableOfContents \?\?\s*manuscript\.includeTableOfContents\s*\);/);
});

test('V5.8.3-P1: el PDF respeta el ancho de cada palabra del navegador y las líneas punteadas', () => {
  const exporter = read('src/utils/bookPdfExporter.ts');
  assert.match(exporter, /const perGap = \(browserWidthPx \* ctx\.k - natural\) \/ \(text\.length - 1\);/, 'ajuste de interletrado (kerning)');
  assert.match(exporter, /if \(Math\.abs\(perGap\) < fontMm \* 0\.12\) charSpace = letterSpacingMm \+ perGap;/, 'solo diferencias pequeñas');
  assert.match(exporter, /drawAt\(word, r\.left, baseline, r\.width - /);
  assert.match(exporter, /style === 'dotted' \? \[bwMm, bwMm\] : style === 'dashed' \? \[bwMm \* 3, bwMm \* 3\] : null/);
  assert.match(exporter, /doc\.setLineDashPattern\(\[\], 0\);/, 'el patrón se restablece');
});
