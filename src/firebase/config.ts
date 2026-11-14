import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, enableNetwork, setLogLevel } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

try {
  setLogLevel('error');
} catch {}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Clean up stale or corrupted auth sessions that cannot refresh against securetoken API
if (typeof window !== 'undefined') {
  auth.onAuthStateChanged(
    async (user) => {
      if (user) {
        try {
          await user.getIdToken();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('token-service-api') || msg.includes('securetoken')) {
            console.warn('Clearing stale user session with unrefreshable token');
            await signOut(auth).catch(() => {});
            await enableNetwork(db).catch(() => {});
          }
        }
      }
    },
    (err) => {
      console.warn('Auth state observation error:', err);
    }
  );
}

// Test connection to Firestore on initial boot as required by skill
async function testConnection() {
  try {
    if (auth.currentUser) {
      try {
        await auth.currentUser.getIdToken();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('token-service-api') || msg.includes('securetoken')) {
          await signOut(auth).catch(() => {});
          await enableNetwork(db).catch(() => {});
        }
      }
    }
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      try {
        await signOut(auth).catch(() => {});
        await enableNetwork(db).catch(() => {});
        await getDocFromServer(doc(db, 'test', 'connection'));
        return;
      } catch (retryError) {
        if (retryError instanceof Error && retryError.message.includes('the client is offline')) {
          console.error('Please check your Firebase configuration.');
        }
      }
    }
  }
}
testConnection();



