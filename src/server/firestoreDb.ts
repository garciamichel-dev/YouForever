import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  updateDoc,
  query,
  where,
  getDocFromServer,
  Firestore,
} from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';

let dbInstance: Firestore | null = null;

export function getDb(): Firestore {
  if (dbInstance) return dbInstance;

  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const app = getApps().length > 0 ? getApp() : initializeApp(config);
      dbInstance = getFirestore(app, config.firestoreDatabaseId);

      // Validate connection to Firestore as required by skill
      getDocFromServer(doc(dbInstance, 'test', 'connection')).catch((err) => {
        console.debug('Firestore check notice:', err?.message || err);
      });
      return dbInstance;
    }
  } catch (err) {
    console.error('Failed to initialize Firestore instance from config:', err);
  }

  throw new Error('Firestore configuration not loaded');
}
