/**
 * V5.3.2 — SERVER ACCESS TO CLOUD FIRESTORE (Admin SDK first, safe fallback for Google AI Studio).
 *
 * Target mode — `admin`: the Firebase Admin SDK with Application Default Credentials (on Cloud Run:
 * the service account of the service). It is authorized by IAM and NOT subject to security rules,
 * which is what allows `firestore.rules` to deny every client.
 *
 * Fallback mode — `client`: the browser Firebase SDK the server used until V5.3.1. It only works
 * while the rules are still public. It exists because an app hosted by Google AI Studio may run
 * with a service identity that has no IAM access to the Firebase project; in that case the app
 * keeps working exactly as before instead of losing access to its data. The private rules must
 * NOT be deployed while the server runs in this mode (see `getFirestoreModeStatus()` and the admin
 * route `GET /api/admin/firestore-status`).
 *
 * Mode selection (`FIRESTORE_SERVER_MODE`):
 *   - `admin`  → always the Admin SDK.
 *   - `client` → always the legacy SDK.
 *   - `auto` (default) → probe the Admin SDK once (one document read); if it fails because of
 *     missing credentials or permissions, fall back to `client`. Other errors (quota, transient
 *     outage) keep `admin`, which is authorized.
 *
 * The functions below keep the modular API the server code already used (`doc`, `collection`,
 * `query`, `where`, `getDocs`, `getDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `getCountFromServer`,
 * `increment`, `runTransaction`). References are SDK-independent path descriptors resolved at call
 * time against the active SDK; snapshots have one shape (`exists()` is a method); errors carry the
 * browser-SDK codes (`resource-exhausted`, `permission-denied`, …). No key files are used.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applicationDefault, getApps as getAdminApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, FieldValue, type Firestore as AdminFirestoreType } from 'firebase-admin/firestore';
import { getApps as getClientApps, initializeApp as initializeClientApp } from 'firebase/app';
import * as clientSdk from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export type FirestoreServerMode = 'admin' | 'client';

export interface ServerFirestoreTarget {
  projectId: string;
  databaseId: string;
  emulatorHost: string | null;
}

export interface FirestoreModeStatus {
  mode: FirestoreServerMode;
  /** Why this mode is active (forced by configuration, probe succeeded, probe denied, …). */
  reason: string;
  requested: 'admin' | 'client' | 'auto';
  projectId: string;
  databaseId: string;
  resolvedAt: string;
  /** True only in admin mode: the private rules can be deployed without breaking the server. */
  privateRulesSafeToDeploy: boolean;
}

// Loose aliases kept for the existing type annotations in the server code.
export type Firestore = ServerDbHandle;
export type DocumentReference<T = any> = DocRef & { __t?: T };
export type CollectionReference<T = any> = CollectionQuery & { __t?: T };
export type Query<T = any> = CollectionQuery & { __t?: T };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type QuerySnapshot<_T = any> = NormalizedQuerySnapshot;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type DocumentSnapshot<_T = any> = NormalizedDocSnapshot;

// ------------------------------------------------------------------------------------------------
// Target and mode
// ------------------------------------------------------------------------------------------------
export function resolveServerFirestoreTarget(env: NodeJS.ProcessEnv = process.env): ServerFirestoreTarget {
  let fileConfig: { projectId?: string; firestoreDatabaseId?: string } = firebaseConfig as any;
  try {
    const cwdConfig = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fileConfig?.projectId && fs.existsSync(cwdConfig)) fileConfig = JSON.parse(fs.readFileSync(cwdConfig, 'utf-8'));
  } catch {
    // keep the bundled configuration
  }
  const projectId = (env.FIREBASE_PROJECT_ID || '').trim() || String(fileConfig.projectId || '');
  const databaseId =
    (env.FIRESTORE_DATABASE_ID || '').trim() || String(fileConfig.firestoreDatabaseId || '').trim() || '(default)';
  return { projectId, databaseId, emulatorHost: (env.FIRESTORE_EMULATOR_HOST || '').trim() || null };
}

function requestedMode(): 'admin' | 'client' | 'auto' {
  const raw = String(process.env.FIRESTORE_SERVER_MODE || 'auto').trim().toLowerCase();
  return raw === 'admin' || raw === 'client' ? raw : 'auto';
}

/** Errors that mean "this identity is not authorized", as opposed to quota or outages. */
export function isFirestoreAuthorizationError(err: any): boolean {
  const code = err?.code;
  if (code === 7 || code === 16 || code === 'permission-denied' || code === 'unauthenticated') return true;
  const msg = String(err?.message || err || '');
  return /default credentials|could not load the default|invalid_grant|unauthenticated|permission[_ ]denied|missing or insufficient permissions|insufficient permission|metadata server|getaddrinfo .*metadata/i.test(
    msg
  );
}

let modeStatus: FirestoreModeStatus | null = null;
let modeResolution: Promise<FirestoreModeStatus> | null = null;
const PROBE_TIMEOUT_MS = 10_000;

export function getFirestoreModeStatus(): FirestoreModeStatus | null {
  return modeStatus ? { ...modeStatus } : null;
}

function setMode(mode: FirestoreServerMode, reason: string, requested: 'admin' | 'client' | 'auto'): FirestoreModeStatus {
  const target = resolveServerFirestoreTarget();
  modeStatus = {
    mode,
    reason,
    requested,
    projectId: target.projectId,
    databaseId: target.databaseId,
    resolvedAt: new Date().toISOString(),
    privateRulesSafeToDeploy: mode === 'admin',
  };
  const line = `[Firestore] Modo de acceso del servidor: ${mode.toUpperCase()} (${reason}).`;
  if (mode === 'client') console.warn(`${line} Las reglas privadas NO deben publicarse en este modo.`);
  else console.log(line);
  return modeStatus;
}

/** Resolves (once per process) which SDK the server uses. Every operation awaits it. */
export function ensureFirestoreMode(): Promise<FirestoreModeStatus> {
  if (modeStatus) return Promise.resolve(modeStatus);
  if (modeResolution) return modeResolution;
  modeResolution = (async () => {
    const requested = requestedMode();
    if (requested === 'admin') return setMode('admin', 'forzado por FIRESTORE_SERVER_MODE=admin', requested);
    if (requested === 'client') return setMode('client', 'forzado por FIRESTORE_SERVER_MODE=client', requested);
    // Without credentials the Admin SDK's gRPC layer emits internal unhandled rejections that would
    // crash the process (Node 22). Check the credentials first, in a way that can be caught.
    if (!resolveServerFirestoreTarget().emulatorHost) {
      try {
        await Promise.race([
          applicationDefault().getAccessToken(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('credential probe timeout')), PROBE_TIMEOUT_MS)),
        ]);
      } catch (err: any) {
        return setMode(
          'client',
          `no hay credenciales de servicio disponibles (${String(err?.message || err).slice(0, 120)})`,
          requested
        );
      }
    }
    try {
      await Promise.race([
        adminDb().collection('settings').doc('appConfig').get(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS)),
      ]);
      return setMode('admin', 'la identidad de servicio tiene acceso (sonda correcta)', requested);
    } catch (err: any) {
      if (isFirestoreAuthorizationError(err)) {
        return setMode(
          'client',
          `la identidad de servicio no está autorizada (${String(err?.message || err).slice(0, 160)})`,
          requested
        );
      }
      return setMode('admin', `sonda no concluyente (${String(err?.message || err).slice(0, 120)}); se mantiene el Admin SDK`, requested);
    }
  })().finally(() => {
    modeResolution = null;
  });
  return modeResolution;
}

/** Tests only: force or reset the mode. */
export function configureFirestoreModeForTests(mode: FirestoreServerMode | null): void {
  if (process.env.YOUFOREVER_ALLOW_TEST_DOUBLES !== '1') throw new Error('Solo en pruebas.');
  modeStatus = null;
  modeResolution = null;
  if (mode) setMode(mode, 'configurado por la prueba', mode);
}

// ------------------------------------------------------------------------------------------------
// SDK instances (lazy)
// ------------------------------------------------------------------------------------------------
const ADMIN_APP_NAME = 'youforever-server';
const CLIENT_APP_NAME = 'youforever-server-legacy';
let adminInstance: AdminFirestoreType | null = null;
let clientInstance: clientSdk.Firestore | null = null;

let credentialRejectionGuardInstalled = false;
/**
 * The Admin SDK can surface a missing-credentials error as an internal unhandled rejection (in
 * addition to rejecting the call). Log THAT error instead of crashing the server; every other
 * unhandled rejection is re-thrown, preserving Node's default behaviour.
 */
function installCredentialRejectionGuard() {
  if (credentialRejectionGuardInstalled) return;
  credentialRejectionGuardInstalled = true;
  process.on('unhandledRejection', (reason: any) => {
    if (/could not load the default credentials/i.test(String(reason?.message || reason))) {
      console.error('[Firestore] Admin SDK sin credenciales de servicio:', String(reason?.message || reason).slice(0, 160));
      return;
    }
    throw reason;
  });
}

function adminDb(): AdminFirestoreType {
  if (adminInstance) return adminInstance;
  installCredentialRejectionGuard();
  const target = resolveServerFirestoreTarget();
  const existing = getAdminApps().find((a) => a.name === ADMIN_APP_NAME);
  const app =
    existing ||
    initializeAdminApp(
      target.emulatorHost ? { projectId: target.projectId } : { projectId: target.projectId, credential: applicationDefault() },
      ADMIN_APP_NAME
    );
  adminInstance = getAdminFirestore(app, target.databaseId);
  try {
    adminInstance.settings({ ignoreUndefinedProperties: true });
  } catch {
    // already configured
  }
  return adminInstance;
}

function clientDb(): clientSdk.Firestore {
  if (clientInstance) return clientInstance;
  const target = resolveServerFirestoreTarget();
  try {
    clientSdk.setLogLevel('error');
  } catch {
    // ignore
  }
  const existing = getClientApps().find((a) => a.name === CLIENT_APP_NAME);
  const app = existing || initializeClientApp({ ...(firebaseConfig as any), projectId: target.projectId }, CLIENT_APP_NAME);
  clientInstance = clientSdk.getFirestore(app, target.databaseId);
  if (target.emulatorHost) {
    const [host, port] = target.emulatorHost.split(':');
    try {
      clientSdk.connectFirestoreEmulator(clientInstance, host, Number(port));
    } catch {
      // already connected
    }
  }
  return clientInstance;
}

// ------------------------------------------------------------------------------------------------
// SDK-independent references
// ------------------------------------------------------------------------------------------------
export class ServerDbHandle {
  readonly kind = 'youforever-server-db';
}
const SERVER_DB = new ServerDbHandle();

/** Single handle for the whole server process (storage, telemetry, Mi Esencia). */
export function getServerFirestore(): ServerDbHandle {
  return SERVER_DB;
}

type Constraint =
  | { type: 'where'; field: string; op: string; value: unknown }
  | { type: 'orderBy'; field: string; direction: 'asc' | 'desc' }
  | { type: 'limit'; n: number };

export class CollectionQuery {
  constructor(readonly path: string, readonly constraints: Constraint[] = []) {}
  get id(): string {
    return this.path.split('/').pop() || '';
  }
}

export class DocRef {
  constructor(readonly path: string) {}
  get id(): string {
    return this.path.split('/').pop() || '';
  }
}

const joinPath = (segments: string[]) => segments.filter((s) => s !== undefined && s !== null && s !== '').join('/');
const autoId = () => crypto.randomBytes(15).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);

export function collection(parent: ServerDbHandle | DocRef, ...pathSegments: string[]): CollectionQuery {
  const prefix = parent instanceof DocRef ? `${parent.path}/` : '';
  return new CollectionQuery(prefix + joinPath(pathSegments));
}

export function doc(parent: ServerDbHandle | CollectionQuery | DocRef, ...pathSegments: string[]): DocRef {
  if (parent instanceof CollectionQuery) {
    return new DocRef(`${parent.path}/${pathSegments.length ? joinPath(pathSegments) : autoId()}`);
  }
  if (parent instanceof DocRef) return new DocRef(`${parent.path}/${joinPath(pathSegments)}`);
  return new DocRef(joinPath(pathSegments));
}

export const where = (field: string, op: string, value: unknown): Constraint => ({ type: 'where', field, op, value });
export const orderBy = (field: string, direction: 'asc' | 'desc' = 'asc'): Constraint => ({ type: 'orderBy', field, direction });
export const limit = (n: number): Constraint => ({ type: 'limit', n });

export function query(base: CollectionQuery, ...constraints: Constraint[]): CollectionQuery {
  return new CollectionQuery(base.path, [...base.constraints, ...constraints]);
}

function resolveDocRef(mode: FirestoreServerMode, ref: DocRef): any {
  return mode === 'admin' ? adminDb().doc(ref.path) : clientSdk.doc(clientDb(), ref.path);
}

function resolveQuery(mode: FirestoreServerMode, q: CollectionQuery): any {
  if (mode === 'admin') {
    let out: any = adminDb().collection(q.path);
    for (const c of q.constraints) {
      if (c.type === 'where') out = out.where(c.field, c.op, c.value);
      else if (c.type === 'orderBy') out = out.orderBy(c.field, c.direction);
      else out = out.limit(c.n);
    }
    return out;
  }
  const base = clientSdk.collection(clientDb(), q.path);
  const mapped = q.constraints.map((c) =>
    c.type === 'where'
      ? clientSdk.where(c.field, c.op as clientSdk.WhereFilterOp, c.value)
      : c.type === 'orderBy'
      ? clientSdk.orderBy(c.field, c.direction)
      : clientSdk.limit(c.n)
  );
  return mapped.length ? clientSdk.query(base, ...mapped) : base;
}

// ------------------------------------------------------------------------------------------------
// Values and snapshots
// ------------------------------------------------------------------------------------------------
class IncrementMarker {
  constructor(readonly n: number) {}
}
export const increment = (n: number) => new IncrementMarker(n) as any;

function toSdkValues(mode: FirestoreServerMode, value: any): any {
  if (value instanceof IncrementMarker) {
    return mode === 'admin' ? FieldValue.increment(value.n) : clientSdk.increment(value.n);
  }
  if (Array.isArray(value)) return value.map((v) => toSdkValues(mode, v));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = toSdkValues(mode, v);
    }
    return out;
  }
  return value;
}

export interface NormalizedDocSnapshot {
  id: string;
  ref: DocRef;
  exists: () => boolean;
  data: () => any;
  get: (field: string) => any;
}

export interface NormalizedQuerySnapshot {
  docs: NormalizedDocSnapshot[];
  size: number;
  empty: boolean;
  forEach: (cb: (d: NormalizedDocSnapshot) => void) => void;
}

function normalizeDocSnapshot(snap: any): NormalizedDocSnapshot {
  const exists = typeof snap.exists === 'function' ? Boolean(snap.exists()) : Boolean(snap.exists);
  return {
    id: snap.id,
    ref: new DocRef(snap.ref.path),
    exists: () => exists,
    data: () => (exists ? snap.data() : undefined),
    get: (field: string) => (exists ? snap.get(field) : undefined),
  };
}

function normalizeQuerySnapshot(snap: any): NormalizedQuerySnapshot {
  const docs: NormalizedDocSnapshot[] = snap.docs.map(normalizeDocSnapshot);
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (cb) => docs.forEach(cb) };
}

// ------------------------------------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------------------------------------
const GRPC_CODE_NAMES: Record<number, string> = {
  1: 'cancelled',
  2: 'unknown',
  3: 'invalid-argument',
  4: 'deadline-exceeded',
  5: 'not-found',
  6: 'already-exists',
  7: 'permission-denied',
  8: 'resource-exhausted',
  9: 'failed-precondition',
  10: 'aborted',
  11: 'out-of-range',
  12: 'unimplemented',
  13: 'internal',
  14: 'unavailable',
  15: 'data-loss',
  16: 'unauthenticated',
};

export function normalizeFirestoreError(err: any): any {
  if (!err || typeof err !== 'object') return err;
  if (typeof err.code === 'number' && GRPC_CODE_NAMES[err.code]) {
    try {
      err.grpcCode = err.code;
      err.code = GRPC_CODE_NAMES[err.code];
    } catch {
      // read-only error object
    }
  }
  return err;
}

async function withMode<T>(op: (mode: FirestoreServerMode) => Promise<T>): Promise<T> {
  const { mode } = await ensureFirestoreMode();
  try {
    return await op(mode);
  } catch (err) {
    throw normalizeFirestoreError(err);
  }
}

// ------------------------------------------------------------------------------------------------
// Operations (same names as the modular SDK)
// ------------------------------------------------------------------------------------------------
export const getDoc = (ref: DocRef) =>
  withMode(async (mode) =>
    normalizeDocSnapshot(mode === 'admin' ? await resolveDocRef(mode, ref).get() : await clientSdk.getDoc(resolveDocRef(mode, ref)))
  );
export const getDocFromServer = (ref: DocRef) =>
  withMode(async (mode) =>
    normalizeDocSnapshot(
      mode === 'admin' ? await resolveDocRef(mode, ref).get() : await clientSdk.getDocFromServer(resolveDocRef(mode, ref))
    )
  );
export const getDocs = (q: CollectionQuery) =>
  withMode(async (mode) =>
    normalizeQuerySnapshot(mode === 'admin' ? await resolveQuery(mode, q).get() : await clientSdk.getDocs(resolveQuery(mode, q)))
  );
export const setDoc = (ref: DocRef, data: any, options?: { merge?: boolean }) =>
  withMode(async (mode) => {
    const values = toSdkValues(mode, data);
    if (mode === 'admin') await (options ? resolveDocRef(mode, ref).set(values, options) : resolveDocRef(mode, ref).set(values));
    else await (options ? clientSdk.setDoc(resolveDocRef(mode, ref), values, options) : clientSdk.setDoc(resolveDocRef(mode, ref), values));
  });
export const updateDoc = (ref: DocRef, data: any) =>
  withMode(async (mode) => {
    const values = toSdkValues(mode, data);
    if (mode === 'admin') await resolveDocRef(mode, ref).update(values);
    else await clientSdk.updateDoc(resolveDocRef(mode, ref), values);
  });
export const deleteDoc = (ref: DocRef) =>
  withMode(async (mode) => {
    if (mode === 'admin') await resolveDocRef(mode, ref).delete();
    else await clientSdk.deleteDoc(resolveDocRef(mode, ref));
  });
export const getCountFromServer = (q: CollectionQuery) =>
  withMode(async (mode) => {
    const snap = mode === 'admin' ? await resolveQuery(mode, q).count().get() : await clientSdk.getCountFromServer(resolveQuery(mode, q));
    const count = Number(snap.data().count) || 0;
    return { data: () => ({ count }) };
  });
export const enableNetwork = async (_db?: unknown) => undefined;
export const setLogLevel = (_level?: string) => undefined;

export interface ServerTransaction {
  get(ref: DocRef): Promise<NormalizedDocSnapshot>;
  set(ref: DocRef, data: any, options?: { merge?: boolean }): ServerTransaction;
  update(ref: DocRef, data: any): ServerTransaction;
  delete(ref: DocRef): ServerTransaction;
}

/** Atomic multi-document transaction on the active SDK (both SDKs retry on contention). */
export function runTransaction<T>(_db: ServerDbHandle, fn: (tx: ServerTransaction) => Promise<T>, maxAttempts = 5): Promise<T> {
  return withMode(async (mode) => {
    const wrap = (t: any): ServerTransaction => {
      const wrapper: ServerTransaction = {
        get: async (ref) => normalizeDocSnapshot(await t.get(resolveDocRef(mode, ref))),
        set: (ref, data, options) => {
          t.set(resolveDocRef(mode, ref), toSdkValues(mode, data), options || {});
          return wrapper;
        },
        update: (ref, data) => {
          t.update(resolveDocRef(mode, ref), toSdkValues(mode, data));
          return wrapper;
        },
        delete: (ref) => {
          t.delete(resolveDocRef(mode, ref));
          return wrapper;
        },
      };
      return wrapper;
    };
    if (mode === 'admin') return adminDb().runTransaction((t) => fn(wrap(t)), { maxAttempts });
    return clientSdk.runTransaction(clientDb(), (t) => fn(wrap(t)), { maxAttempts });
  });
}
