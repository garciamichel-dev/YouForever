/**
 * V5.8.4 — Manuscripts and book versions are never lost by the Firestore reconciliation added in
 * «feat(backup): implement cloud-synced database backups»:
 *   - manuscripts are written durably (chunked above 800 KB, retried) and reassembled on load;
 *   - a sync only discards records that were CONFIRMED in Firestore before and are gone now;
 *   - a manuscript whose write failed is kept and re-sent;
 *   - restoring a backup keeps the chunk documents of large records.
 *
 * Runs on an isolated StorageManager with an in-memory Firestore double, from a temporary working
 * directory (the local snapshot is written there, never to the repository's data/ folder).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yf-v584-'));
process.chdir(tmp);

const { StorageManager } = await import('../../server/storage.ts');
const { planChunkedDoc, FIRESTORE_SAFE_DOC_BYTES } = await import('../../server/durableDocs.ts');

type Store = Map<string, Map<string, Record<string, unknown>>>;
function memoryFirestore(opts: { failWrites?: () => boolean } = {}) {
  const store: Store = new Map();
  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  return {
    store,
    double: {
      async setDoc(c: string, id: string, data: Record<string, unknown>) {
        if (opts.failWrites?.()) throw new Error('simulated: Quota limit exceeded');
        col(c).set(id, JSON.parse(JSON.stringify(data)));
      },
      async getDoc(c: string, id: string) {
        return col(c).get(id) ?? null;
      },
      async deleteDoc(c: string, id: string) {
        col(c).delete(id);
      },
      async listCollection(c: string) {
        return Array.from(col(c).entries()).map(([id, data]) => ({ id, data }));
      },
    },
  };
}

/** Same shape as the Firestore results applyHeavySnapshots receives. */
const snapOf = (docs: Array<Record<string, unknown>>) => ({ forEach: (fn: (d: any) => void) => docs.forEach((d) => fn({ data: () => d })) });
function heavyResults(manuscriptDocs: Array<Record<string, unknown>> | null) {
  const results: Array<PromiseSettledResult<any>> = Array.from({ length: 10 }, () => ({ status: 'fulfilled', value: null }) as any);
  results[2] = { status: 'fulfilled', value: manuscriptDocs ? snapOf(manuscriptDocs) : null };
  return results;
}

const manuscript = (id: string, content = 'Texto del manuscrito.') => ({
  id,
  interviewId: 'int_demo',
  version: Number(id.split('_v')[1]) || 1,
  title: 'Mi historia',
  content,
  status: 'ready',
  generatedAt: '2026-11-18T12:00:00.000Z',
  generatedBy: 'admin',
});

test('V5.8.4-D1: un manuscrito de más de 800 KB se guarda en piezas y se vuelve a armar al cargar', async () => {
  const fake = memoryFirestore();
  const s: any = new StorageManager({ remoteDocStore: fake.double as any });
  const big = manuscript('manu_int_demo_v1', 'Párrafo largo. '.repeat(70_000)); // ~1 MB
  s.manuscripts.set(big.id, big);
  assert.equal(await s.persistManuscriptDurable(big), true);
  const docs = Array.from(fake.store.get('manuscripts')!.values());
  assert.ok(docs.length >= 3, `manifiesto + piezas (${docs.length})`);
  assert.ok(docs.every((d) => Buffer.byteLength(JSON.stringify(d)) < FIRESTORE_SAFE_DOC_BYTES + 50_000));

  // Another instance loads it: one manuscript, complete, and no chunk document as a "manuscript".
  const other: any = new StorageManager({ remoteDocStore: fake.double as any });
  other.applyHeavySnapshots(heavyResults(docs));
  assert.deepEqual(Array.from(other.manuscripts.keys()), [big.id]);
  assert.equal(other.manuscripts.get(big.id).content, big.content);
});

test('V5.8.4-D2: la sincronización conserva lo que nunca llegó a Firestore y solo descarta lo borrado en otra instancia', async () => {
  const fake = memoryFirestore();
  const s: any = new StorageManager({ remoteDocStore: fake.double as any });
  const confirmed = manuscript('manu_int_demo_v1');
  const notYetSynced = manuscript('manu_int_demo_v2');

  s.applyHeavySnapshots(heavyResults([confirmed])); // v1 read from Firestore → confirmed
  s.manuscripts.set(notYetSynced.id, notYetSynced); // v2 generated here; its write was skipped
  assert.equal(s.manuscripts.size, 2);

  // Next sync: Firestore no longer has v1 (deleted by another instance) and never had v2.
  s.applyHeavySnapshots(heavyResults([]));
  assert.ok(!s.manuscripts.has(confirmed.id), 'v1 borrado en otra instancia → se descarta');
  assert.ok(s.manuscripts.has(notYetSynced.id), 'v2 nunca llegó a Firestore → se conserva');
});

test('V5.8.4-D3: si Firestore rechaza la escritura, el manuscrito se conserva y se reenvía después', async () => {
  let failing = true;
  const fake = memoryFirestore({ failWrites: () => failing });
  const s: any = new StorageManager({ remoteDocStore: fake.double as any });
  const m = manuscript('manu_int_demo_v3');
  s.manuscripts.set(m.id, m);
  assert.equal(await s.persistManuscriptDurable(m), false);
  s.applyHeavySnapshots(heavyResults([]));
  assert.ok(s.manuscripts.has(m.id), 'no se pierde aunque Firestore no lo tenga');

  failing = false;
  await s.resendUnconfirmedManuscripts(3);
  assert.ok(fake.store.get('manuscripts')!.has(m.id), 'se reenvió en la siguiente sincronización');
  assert.ok(s.remoteConfirmedManuscriptIds.has(m.id));

  // A manuscript deleted on purpose is never re-sent.
  const gone = manuscript('manu_int_demo_v4');
  s.manuscripts.set(gone.id, gone);
  s.deletedManuscriptIds.add(gone.id);
  await s.resendUnconfirmedManuscripts(3);
  assert.ok(!fake.store.get('manuscripts')!.has(gone.id));
});

test('V5.8.4-D4: borrar un manuscrito grande elimina también sus piezas en Firestore', async () => {
  const fake = memoryFirestore();
  const s: any = new StorageManager({ remoteDocStore: fake.double as any });
  const big = manuscript('manu_int_demo_v5', 'Otro párrafo largo. '.repeat(60_000));
  await s.persistManuscriptDurable(big);
  assert.ok(fake.store.get('manuscripts')!.size >= 3);
  await s.removeManuscriptRemote(big.id);
  assert.equal(fake.store.get('manuscripts')!.size, 0, 'sin piezas huérfanas');
  assert.ok(!s.remoteConfirmedManuscriptIds.has(big.id));
});

test('V5.8.4-D5: un manifiesto incompleto no borra la copia local', async () => {
  const fake = memoryFirestore();
  const s: any = new StorageManager({ remoteDocStore: fake.double as any });
  const m = manuscript('manu_int_demo_v6', 'x'.repeat(900_000));
  s.applyHeavySnapshots(heavyResults([m])); // confirmed
  const plan = planChunkedDoc(m.id, JSON.stringify(m), { interviewId: m.interviewId });
  s.applyHeavySnapshots(heavyResults([plan.manifest, plan.chunks[0].data])); // a chunk is missing
  assert.ok(s.manuscripts.has(m.id), 'se conserva mientras las piezas no estén completas');
});

test('V5.8.4-W1: cableado — escrituras durables, borrado con piezas, sincronización y restauración', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/server/storage.ts'), 'utf-8');
  assert.doesNotMatch(src, /persistDoc\('manuscripts'/, 'ningún manuscrito se guarda con el escritor «si se puede»');
  assert.doesNotMatch(src, /removeDoc\('manuscripts'/, 'los borrados incluyen las piezas');
  assert.equal((src.match(/this\.ingestRemoteManuscriptDocs\(/g) || []).length, 4, 'carga completa, por lotes, por entrevista e incremental');
  assert.match(src, /remoteManuscriptsCount !== this\.lastRemoteManuscriptDocCount/);
  assert.match(src, /remoteBookVersionsCount !== this\.lastRemoteBookVersionDocCount/);
  assert.match(src, /await this\.resendUnconfirmedManuscripts\(3\)/);
  assert.match(src, /for \(let c = 0; c < chunkCount; c\+\+\) \{\s*keptRemoteDocIds\.add\(chunkDocId\(docId, c\)\);/, 'la restauración conserva las piezas');
  assert.doesNotMatch(
    src,
    /for \(const localId of Array\.from\(this\.manuscripts\.keys\(\)\)\) \{\s*if \(!remote/,
    'ya no se descartan manuscritos solo por no estar en Firestore'
  );
});
