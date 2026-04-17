import admin from 'firebase-admin';
import { initializeApp as initializeAdminApp, getApps as getAdminApps } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

async function debug() {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));
  console.log('Target DB:', config.firestoreDatabaseId);

  // Initialize Admin SDK with NO ARGUMENTS (Auto-detect environment)
  if (getAdminApps().length === 0) {
    initializeAdminApp();
  }

  const db = getAdminFirestore(admin.app(), config.firestoreDatabaseId);

  try {
    console.log(`Attempting to read 'teams' using AUTO-INITIALIZED Admin SDK...`);
    const snap = await db.collection('teams').limit(1).get();
    console.log('SUCCESS Reading teams (auto). Size:', snap.size);
  } catch (err: any) {
    console.error('FAILED Reading teams (auto).');
    console.error('Error:', err.message);
  }
}

debug();
