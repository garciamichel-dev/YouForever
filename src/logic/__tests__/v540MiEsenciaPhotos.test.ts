/**
 * V5.4.0 — Selección determinista de fotografías del testimonio para el chat de Mi Esencia.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildPersonPhotoCatalog,
  buildPhotoContextNote,
  finalizeReplyForPhotos,
  isPhotoRequest,
  selectPhotosForMessage,
} from '../miEsenciaPhotos.ts';
import { MiEsenciaChatPhotos } from '../../modules/mi-esencia/MiEsenciaChatPhotos.tsx';

const block = (id: string, q: string, a: string, photos: Array<[string, string]>) =>
  ({
    testimonyId: id,
    questionLiteral: q,
    answerLiteral: a,
    photoAttachments: photos.map(([pid, caption]) => ({ id: pid, caption })),
  }) as any;

const testimonies = [
  block('t1', '¿Cómo era la casa de tu abuela?', 'Tenía un sillón junto a la ventana.', [['p_casa', 'La casa de mi abuelita Irene en Acapulco']]),
  block('t2', '¿Qué jugabas de niño?', 'Volaba culebrinas con mis primos.', [['p_culebrina', 'Volando mi culebrina en la playa']]),
  block('t3', '¿Cómo era tu papá?', 'Mi papá me decía Michael.', [['p_papa', 'Mi papá en su trabajo'], ['p_casa', 'duplicada']]),
  block('t4', '¿Dónde naciste?', 'En Acapulco, Guerrero.', []),
];

test('V5.4.0-U1: solo un pedido de foto activa la selección', () => {
  assert.equal(isPhotoRequest('¿Tienes alguna foto de la casa de tu abuelita?'), true);
  assert.equal(isPhotoRequest('Muéstrame una fotografía de tu papá'), true);
  assert.equal(isPhotoRequest('¿Tienes imágenes de la playa?'), true);
  assert.equal(isPhotoRequest('¿Cómo era tu abuelita?'), false);
  assert.equal(isPhotoRequest('Me gusta la fotosíntesis'), false);
});

test('V5.4.0-U2: elige la fotografía real que corresponde; nunca inventa ni duplica', () => {
  const catalog = buildPersonPhotoCatalog(testimonies);
  assert.deepEqual(catalog.map((c) => c.photoId), ['p_casa', 'p_culebrina', 'p_papa']);
  assert.deepEqual(
    selectPhotosForMessage('¿Tienes alguna foto de la casa de tu abuelita?', catalog).photos.map((p) => p.photoId),
    ['p_casa']
  );
  assert.deepEqual(
    selectPhotosForMessage('Quiero ver una foto de cuando volabas papalote... digo, tu culebrina', catalog).photos.map((p) => p.photoId),
    ['p_culebrina']
  );
  const generic = selectPhotosForMessage('¿Tienes fotos?', catalog);
  assert.equal(generic.generic, true);
  assert.equal(generic.photos.length, 3);
  const none = selectPhotosForMessage('¿Tienes foto de tu boda?', catalog);
  assert.equal(none.photos.length, 0);
  assert.equal(none.requested, true);
  assert.equal(selectPhotosForMessage('¿Cómo era la casa?', catalog).photos.length, 0, 'Sin pedido de foto no se adjunta nada.');
  assert.equal(selectPhotosForMessage('¿Tienes fotos?', []).photos.length, 0);
});

test('V5.4.0-U3: el modelo sabe qué foto se muestra y el texto nunca la niega', () => {
  const catalog = buildPersonPhotoCatalog(testimonies);
  const sel = selectPhotosForMessage('foto de la casa de tu abuelita', catalog);
  const note = buildPhotoContextNote(sel);
  assert.match(note, /La casa de mi abuelita Irene en Acapulco/);
  assert.match(note, /Nunca digas que no puedes mostrar/);
  assert.match(buildPhotoContextNote(selectPhotosForMessage('foto de tu boda', catalog)), /no hay ninguna/);
  assert.equal(buildPhotoContextNote(selectPhotosForMessage('¿cómo estás?', catalog)), '');

  const fixed = finalizeReplyForPhotos('No puedo mostrarte fotografías, pero recuerdo esa casa con cariño.', sel.photos);
  assert.doesNotMatch(fixed, /no puedo mostrar/i);
  assert.match(fixed, /Aquí te comparto la fotografía/);
  assert.equal(finalizeReplyForPhotos('Mira esta fotografía de la casa de mi abuelita.', sel.photos), 'Mira esta fotografía de la casa de mi abuelita.');
  assert.equal(finalizeReplyForPhotos('Hola', []), 'Hola');
});

test('V5.4.0-U4: el chat muestra la fotografía con su descripción y sin poner el código en la URL', () => {
  const html = renderToStaticMarkup(
    React.createElement(MiEsenciaChatPhotos, {
      personalCode: 'ME-SECRETO-123',
      photos: [{ photoId: 'p_casa', caption: 'La casa de mi abuelita Irene en Acapulco' }],
    })
  );
  assert.match(html, /data-testid="mi-esencia-chat-photos"/);
  assert.match(html, /«La casa de mi abuelita Irene en Acapulco»/);
  assert.doesNotMatch(html, /ME-SECRETO-123/);
});
