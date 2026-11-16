/**
 * V5.3.4 — Administrator-only label with the running code version.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminVersionBadge, versionBadgeState } from '../../components/AdminVersionBadge.tsx';
import { APP_VERSION, APP_VERSION_LABEL } from '../../version.ts';

test('V5.3.4-V2: un participante (no administrador) no recibe la etiqueta de versión', () => {
  const html = renderToStaticMarkup(React.createElement(AdminVersionBadge, { isAuthorizedAdmin: false }));
  assert.equal(html, '');
});

test('V5.3.4-V3: el administrador ve la etiqueta con la versión del código', () => {
  const html = renderToStaticMarkup(React.createElement(AdminVersionBadge, { isAuthorizedAdmin: true }));
  assert.match(html, /data-testid="admin-version-badge"/);
  assert.ok(html.includes(`Versión ${APP_VERSION_LABEL}`));
  assert.match(html, /fixed/);
});

test('V5.3.4-V4: la etiqueta avisa si navegador y servidor corren versiones distintas', () => {
  assert.equal(versionBadgeState(APP_VERSION, { version: APP_VERSION, label: APP_VERSION_LABEL }, false).tone, 'ok');
  const mismatch = versionBadgeState(APP_VERSION, { version: '5.2.0', label: 'V5.2.0' }, false);
  assert.equal(mismatch.tone, 'mismatch');
  assert.ok(mismatch.text.includes('V5.2.0') && mismatch.text.includes(APP_VERSION_LABEL));
  assert.equal(versionBadgeState(APP_VERSION, null, true).tone, 'unknown');
});
