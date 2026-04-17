import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, limit } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

async function debug() {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));
  console.log('Target DB:', config.firestoreDatabaseId);

  const app = initializeApp(config);
  const db = getFirestore(app, config.firestoreDatabaseId);

  try {
    console.log(`Attempting to read 'teams' using CLIENT SDK on Server...`);
    const snap = await getDocs(query(collection(db, 'teams'), limit(1)));
    console.log('SUCCESS Reading teams. Size:', snap.docs.length);
  } catch (err: any) {
    console.error('FAILED Reading teams using CLIENT SDK.');
    console.error('Error:', err.message);
  }
}

debug();
