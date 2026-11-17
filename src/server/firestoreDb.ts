/**
 * V5.3.2 — Legacy helper kept for compatibility. The server reaches Firestore only through the
 * Firebase Admin SDK with its service identity (see ./firestoreAdmin.ts); the browser SDK is no
 * longer used on the server.
 */
export {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  updateDoc,
  query,
  where,
  getDocFromServer,
  type Firestore,
} from './firestoreAdmin.ts';
import { getServerFirestore, type Firestore } from './firestoreAdmin.ts';

export function getDb(): Firestore {
  return getServerFirestore();
}
