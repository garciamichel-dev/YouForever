/**
 * V5.3.5 — Floating, non-dismissable progress alert for every book creation step.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BOOK_PROGRESS_STEPS,
  BookProgressOverlay,
  computeBookProgress,
} from '../../components/BookProgressOverlay.tsx';

const PARTICIPANT_FORBIDDEN_WORDS =
  /error|fall[oó]|incomplet|pendiente de revisi|\bronda\b|\breparaci|tiempo de espera|timeout|proveedor|openai|gemini|cobertura|auditor/i;
const noop = () => undefined;
const render = (state: any, job?: any) =>
  renderToStaticMarkup(
    React.createElement(BookProgressOverlay, { state, job, onCancel: noop, onAccept: noop, onContinue: noop })
  );

test('V5.3.5-U1: paso activo y porcentaje según la fase del proceso (muestra, libro completo y PDF)', () => {
  const running = { kind: 'full', stage: 'job', status: 'running' } as const;
  assert.deepEqual(computeBookProgress(running, { phase: 'preparing_sources' }).stepIdx, 0);
  const half = computeBookProgress(running, { phase: 'drafting_batches', completedBatches: 2, totalBatches: 4 });
  assert.equal(half.stepIdx, 1);
  assert.equal(half.percent, 34); // 8 + (60 - 8) * 0.5
  assert.equal(computeBookProgress(running, { phase: 'repairing_chapters' }).stepIdx, 2);
  assert.equal(computeBookProgress({ kind: 'full', stage: 'save', status: 'running' }).stepIdx, 3);
  assert.equal(computeBookProgress({ kind: 'full', stage: 'pdf', status: 'running' }).stepIdx, 4);
  assert.equal(computeBookProgress({ kind: 'preview', stage: 'compose', status: 'running' }).percent, 92);
  assert.equal(computeBookProgress({ kind: 'pdf', stage: 'pdf', status: 'running' }).stepIdx, 2);
  assert.equal(computeBookProgress({ kind: 'preview', stage: 'job', status: 'done' }).percent, 100);
});

test('V5.3.5-U2: mientras se crea el libro la alerta no se puede cerrar: solo «Cancelar»; «Aceptar» está deshabilitado', () => {
  const html = render({ kind: 'full', stage: 'job', status: 'running', cancellable: true }, { phase: 'drafting_batches', completedBatches: 1, totalBatches: 3 });
  assert.match(html, /data-testid="book-progress-overlay"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /data-testid="book-progress-cancel"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="book-progress-accept"/);
  assert.match(html, /Paso 2 de 5: Escribiendo los capítulos de tu libro/);
  assert.match(html, /data-step-state="done"[\s\S]*data-step-state="active"[\s\S]*data-step-state="pending"/);
  assert.match(html, /data-testid="book-progress-percent">\d+%</);
  // While the book is being saved, Cancelar waits.
  const saving = render({ kind: 'full', stage: 'save', status: 'running', cancellable: false });
  assert.match(saving, /<button[^>]*disabled=""[^>]*data-testid="book-progress-cancel"/);
});

test('V5.3.5-U3: al terminar se muestra el mensaje de finalización con «Aceptar» habilitado', () => {
  const html = render({
    kind: 'full',
    stage: 'pdf',
    status: 'done',
    cancellable: false,
    doneTitle: '¡Tu libro está listo!',
    doneMessage: 'La descarga del PDF ya comenzó.',
  });
  assert.match(html, /¡Tu libro está listo!/);
  assert.match(html, /100%/);
  assert.doesNotMatch(html, /book-progress-cancel/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*data-testid="book-progress-accept"/);
  assert.equal(render(null), '');
});

test('V5.3.5-U4: los textos de la alerta nunca hablan de errores, modelos ni revisiones internas', () => {
  const texts = Object.values(BOOK_PROGRESS_STEPS).flatMap((steps) => steps.map((s) => s.label));
  for (const status of ['running', 'paused', 'done'] as const) {
    for (const kind of ['preview', 'full', 'pdf'] as const) {
      texts.push(render({ kind, stage: 'job', status, cancellable: true }).replace(/<[^>]+>/g, ' '));
    }
  }
  for (const t of texts) assert.doesNotMatch(t, PARTICIPANT_FORBIDDEN_WORDS, t);
});
