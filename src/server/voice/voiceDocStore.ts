/**
 * V5.9.0 — Almacén de documentos de la función de voz, con actualizaciones ATÓMICAS.
 *
 * Producción: Cloud Firestore, cada `atomicUpdate` es una transacción (`runTransaction`), así dos
 * familiares en servidores distintos nunca toman el mismo último cupo, ni dos clics crean dos clones.
 * Pruebas: memoria, con una cola por documento que reproduce la misma garantía.
 *
 * Las colecciones son nuevas (voice_*); no se toca ningún registro existente.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getServerFirestore,
  query,
  runTransaction,
  setDoc,
  where,
} from '../firestoreAdmin.ts';

export const VOICE_COLLECTIONS = {
  settings: 'voice_settings',
  profiles: 'voice_profiles',
  quotaDays: 'voice_quota_days',
  quotaOverrides: 'voice_quota_overrides',
  extraSamples: 'voice_extra_samples',
  adminTestRuns: 'voice_admin_test_runs',
} as const;

export interface VoiceDocStore {
  get<T>(collectionName: string, id: string): Promise<T | null>;
  set<T>(collectionName: string, id: string, data: T): Promise<void>;
  listWhere<T>(collectionName: string, field: string, value: string): Promise<T[]>;
  listAll<T>(collectionName: string): Promise<T[]>;
  /**
   * Lee el documento, calcula el siguiente estado y lo escribe de forma atómica. Si `mutate`
   * devuelve `next: undefined`, no escribe nada (sólo lee de forma consistente).
   */
  atomicUpdate<T, R>(
    collectionName: string,
    id: string,
    mutate: (current: T | null) => { next: T | undefined; result: R }
  ): Promise<R>;
}

/** Firestore drops `undefined`; keep documents plain JSON. */
const plain = <T>(data: T): T => JSON.parse(JSON.stringify(data));

export function createFirestoreVoiceDocStore(): VoiceDocStore {
  const db = getServerFirestore();
  return {
    async get<T>(col: string, id: string) {
      const snap = await getDoc(doc(db, col, id));
      return snap.exists() ? (snap.data() as T) : null;
    },
    async set<T>(col: string, id: string, data: T) {
      await setDoc(doc(db, col, id), plain(data));
    },
    async listWhere<T>(col: string, field: string, value: string) {
      const snap = await getDocs(query(collection(db, col), where(field, '==', value)));
      return snap.docs.map((d) => d.data() as T);
    },
    async listAll<T>(col: string) {
      const snap = await getDocs(collection(db, col));
      return snap.docs.map((d) => d.data() as T);
    },
    async atomicUpdate<T, R>(col: string, id: string, mutate: (current: T | null) => { next: T | undefined; result: R }) {
      const ref = doc(db, col, id);
      return runTransaction<R>(db, async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists() ? (snap.data() as T) : null;
        const { next, result } = mutate(current);
        if (next !== undefined) tx.set(ref, plain(next));
        return result;
      });
    },
  };
}

/** Almacén en memoria para pruebas (mismo contrato; serializa las actualizaciones por documento). */
export function createMemoryVoiceDocStore(): VoiceDocStore & { dump(): Record<string, Record<string, unknown>> } {
  const data = new Map<string, Map<string, unknown>>();
  const chains = new Map<string, Promise<unknown>>();
  const col = (name: string) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name)!;
  };
  return {
    async get<T>(c: string, id: string) {
      const v = col(c).get(id);
      return v === undefined ? null : (plain(v) as T);
    },
    async set<T>(c: string, id: string, value: T) {
      col(c).set(id, plain(value));
    },
    async listWhere<T>(c: string, field: string, value: string) {
      return Array.from(col(c).values()).filter((v: any) => v?.[field] === value).map((v) => plain(v) as T);
    },
    async listAll<T>(c: string) {
      return Array.from(col(c).values()).map((v) => plain(v) as T);
    },
    async atomicUpdate<T, R>(c: string, id: string, mutate: (current: T | null) => { next: T | undefined; result: R }) {
      const key = `${c}/${id}`;
      const prev = chains.get(key) || Promise.resolve();
      const run = prev.then(async () => {
        // A yield between read and write, as a real network round trip would have.
        const current = col(c).has(id) ? (plain(col(c).get(id)) as T) : null;
        await new Promise((r) => setTimeout(r, 0));
        const { next, result } = mutate(current);
        if (next !== undefined) col(c).set(id, plain(next));
        return result;
      });
      chains.set(key, run.catch(() => undefined));
      return run;
    },
    dump() {
      const out: Record<string, Record<string, unknown>> = {};
      for (const [c, m] of data) out[c] = Object.fromEntries(m);
      return out;
    },
  };
}
