/**
 * V5.3.2 — SERVER ACCESS TO CLOUD FIRESTORE THROUGH THE FIREBASE ADMIN SDK.
 *
 * Until V5.3.1 the Node.js server used the *browser* Firebase SDK without any identity, which is
 * why `firestore.rules` had to allow public reads and writes. The server now authenticates with
 * Application Default Credentials (on Cloud Run: the service account attached to the service),
 * which is authorized by IAM and is NOT subject to security rules. The rules can therefore deny
 * every client.
 *
 * This module exposes the same modular functions the server code already used (`doc`, `collection`,
 * `query`, `where`, `getDocs`, `getDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `getCountFromServer`,
 * `increment`, …) implemented on the Admin SDK, so the existing call sites keep working unchanged.
 * Snapshots keep the browser-SDK shape (`exists()` is a method) and Admin errors are normalized to the
 * browser-SDK codes (`resource-exhausted`, `permission-denied`, …) that the existing checks expect.
 *
 * No key files: credentials come from the environment (metadata server on Cloud Run, or
 * `gcloud auth application-default login` on a workstation). `FIRESTORE_EMULATOR_HOST` points it to an
 * emulator for tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { applicationDefault, getApps as getAdminApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import {
  getFirestore as getAdminFirestore,
  CollectionReference as AdminCollectionReference,
  DocumentReference as AdminDocumentReference,
  FieldValue,
  Firestore as AdminFirestore,
  type Query as AdminQuery,
  type Transaction as AdminTransaction,
} from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export type Firestore = AdminFirestore;
// Loose aliases: the server code only relies on the members shared by both SDKs.
export type DocumentReference<T = any> = AdminDocumentReference<T> & any;
export type CollectionReference<T = any> = AdminCollectionReference<T> & any;
export type Query<T = any> = AdminQuery<T> & any;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type QuerySnapshot<_T = any> = FirebaseFirestore.QuerySnapshot<any>;
export type DocumentSnapshot<T = any> = any;
export type Transaction = AdminTransaction;

const ADMIN_APP_NAME = 'youforever-server';

export interface ServerFirestoreTarget {
  projectId: string;
  databaseId: string;
  emulatorHost: string | null;
}

/**
 * The Firebase project and NAMED database really configured for the app
 * (`firebase-applet-config.json`), overridable by environment variables for staging environments.
 */
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

let serverDb: AdminFirestore | null = null;

/** Single Admin Firestore instance for the whole server process (storage, telemetry, Mi Esencia). */
export function getServerFirestore(): AdminFirestore {
  if (serverDb) return serverDb;
  const target = resolveServerFirestoreTarget();
  const existing = getAdminApps().find((a) => a.name === ADMIN_APP_NAME);
  const app =
    existing ||
    initializeAdminApp(
      target.emulatorHost
        ? { projectId: target.projectId }
        : { projectId: target.projectId, credential: applicationDefault() },
      ADMIN_APP_NAME
    );
  serverDb = getAdminFirestore(app, target.databaseId);
  try {
    serverDb.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() can only be called once; ignore if already applied
  }
  return serverDb;
}

// ------------------------------------------------------------------------------------------------
// Error normalization (Admin/gRPC → browser-SDK codes)
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
      // read-only error object: leave as is
    }
  }
  return err;
}

async function normalized<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    throw normalizeFirestoreError(err);
  }
}

// ------------------------------------------------------------------------------------------------
// Browser-SDK-compatible modular API
// ------------------------------------------------------------------------------------------------
const joinPath = (segments: string[]) => segments.filter((s) => s !== undefined && s !== null).join('/');

export function collection(parent: AdminFirestore | AdminDocumentReference, ...pathSegments: string[]): any {
  return (parent as any).collection(joinPath(pathSegments));
}

export function doc(parent: AdminFirestore | AdminCollectionReference | AdminDocumentReference, ...pathSegments: string[]): any {
  if (parent instanceof AdminCollectionReference) {
    return pathSegments.length > 0 ? parent.doc(joinPath(pathSegments)) : parent.doc();
  }
  if (parent instanceof AdminDocumentReference) {
    return parent.collection(pathSegments[0]).doc(joinPath(pathSegments.slice(1)));
  }
  return (parent as AdminFirestore).doc(joinPath(pathSegments));
}

type QueryConstraint = (q: AdminQuery) => AdminQuery;
export const where = (field: string, op: FirebaseFirestore.WhereFilterOp, value: unknown): QueryConstraint => (q) =>
  q.where(field, op, value);
export const orderBy = (field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint => (q) => q.orderBy(field, direction);
export const limit = (n: number): QueryConstraint => (q) => q.limit(n);

export function query(base: AdminQuery | AdminCollectionReference, ...constraints: QueryConstraint[]): any {
  return constraints.reduce((q, c) => c(q), base as AdminQuery);
}

/** Snapshot with the browser-SDK shape: `exists()` is a method. */
function wrapDocumentSnapshot(snap: FirebaseFirestore.DocumentSnapshot) {
  return {
    id: snap.id,
    ref: snap.ref,
    exists: () => snap.exists,
    data: () => snap.data(),
    get: (field: string) => snap.get(field),
  };
}

export const getDoc = (ref: AdminDocumentReference) => normalized(async () => wrapDocumentSnapshot(await ref.get()));
export const getDocFromServer = getDoc;
export const getDocs = (q: AdminQuery | AdminCollectionReference) => normalized(() => (q as AdminQuery).get());
export const setDoc = (ref: AdminDocumentReference, data: any, options?: { merge?: boolean }) =>
  normalized(() => (options ? ref.set(data, options) : ref.set(data)));
export const updateDoc = (ref: AdminDocumentReference, data: any) => normalized(() => ref.update(data));
export const deleteDoc = (ref: AdminDocumentReference) => normalized(() => ref.delete());
export const getCountFromServer = (q: AdminQuery | AdminCollectionReference) =>
  normalized(() => (q as AdminQuery).count().get());
export const increment = (n: number) => FieldValue.increment(n);
export const enableNetwork = async (_db?: unknown) => undefined;
export const setLogLevel = (_level?: string) => undefined;

/** Atomic multi-document transaction (Admin SDK). */
export function runTransaction<T>(db: AdminFirestore, fn: (tx: AdminTransaction) => Promise<T>, maxAttempts = 5) {
  return normalized(() => db.runTransaction(fn, { maxAttempts }));
}
