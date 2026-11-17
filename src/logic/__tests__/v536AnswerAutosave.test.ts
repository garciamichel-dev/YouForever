/**
 * V5.3.6 — Participant portal: every answer is editable and saved automatically.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutoSaveAnswerEditor, AutosaveStatusLabel, shouldAutosave } from '../../components/AutoSaveAnswerEditor.tsx';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('V5.3.6-U1: solo se autoguarda texto nuevo y no vacío, y nunca si está deshabilitado', () => {
  assert.equal(shouldAutosave({ value: 'Hola', lastSavedValue: '', enabled: true }), true);
  assert.equal(shouldAutosave({ value: '  Hola ', lastSavedValue: 'Hola', enabled: true }), false);
  assert.equal(shouldAutosave({ value: '   ', lastSavedValue: 'Hola', enabled: true }), false);
  assert.equal(shouldAutosave({ value: 'Hola mundo', lastSavedValue: 'Hola', enabled: false }), false);
});

test('V5.3.6-U2: el editor muestra el texto editable y el estado del guardado automático', () => {
  const html = renderToStaticMarkup(
    React.createElement(AutoSaveAnswerEditor, {
      answerId: 'ans_1',
      initialText: 'Mi abuelita se llama Irene.',
      onSave: async () => true,
    })
  );
  assert.match(html, /<textarea[^>]*data-testid="autosave-editor-ans_1"/);
  assert.match(html, /Mi abuelita se llama Irene\./);
  const saved = renderToStaticMarkup(
    React.createElement(AutosaveStatusLabel, { state: 'saved', savedAt: new Date(2026, 10, 16, 10, 5) })
  );
  assert.match(saved, /Guardado automáticamente/);
  assert.match(renderToStaticMarkup(React.createElement(AutosaveStatusLabel, { state: 'saving', savedAt: null })), /Guardando/);
});

test('V5.3.6-U3: en el portal todas las respuestas (principal, profundizaciones, historial) usan el guardado automático', () => {
  const portal = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ParticipantPortal.tsx'), 'utf-8');
  assert.match(portal, /const mainAutosave = useDebouncedAutosave/);
  assert.match(portal, /const adaptiveAutosave = useDebouncedAutosave/);
  assert.ok((portal.match(/<AutoSaveAnswerEditor/g) || []).length >= 2, 'Profundizaciones e historial editables.');
  assert.match(portal, /autosave: true/);
  // The explicit save waits for the autosave and confirms the same answer.
  assert.match(portal, /mainAutosave\.cancel\(\);\s*await mainAutosave\.waitIdle\(\);/);
});
