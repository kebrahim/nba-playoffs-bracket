import admin from 'firebase-admin';
import { initializeApp as initializeAdminApp, getApps as getAdminApps } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

async function debug() {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));
  console.log('Project ID:', config.projectId);
  console.log('Target DB:', config.firestoreDatabaseId);

  // Initialize Admin SDK with config
  if (getAdminApps().length === 0) {
    initializeAdminApp({
      credential: admin.credential.applicationDefault(),
      projectId: config.projectId
    });
  }

  const db = getAdminFirestore(admin.app(), config.firestoreDatabaseId);

  try {
    console.log(`Attempting to read 'teams' from ${config.firestoreDatabaseId}...`);
    const snap = await db.collection('teams').limit(1).get();
    console.log('SUCCESS Reading teams. Size:', snap.size);
  } catch (err: any) {
    console.error('FAILED Reading teams with Config Project ID.');
    console.error('Error:', err.message);
  }

  // Try without project ID (auto-detect)
  try {
     const dbAuto = getAdminFirestore(admin.app(), config.firestoreDatabaseId);
     console.log(`Attempting to read 'teams' with auto-project detection...`);
     const snap = await dbAuto.collection('teams').limit(1).get();
     console.log('SUCCESS Reading teams (auto). Size:', snap.size);
  } catch (err: any) {
    console.error('FAILED Reading teams (auto).');
    console.error('Error:', err.message);
  }
  
  // Try default database
  try {
     const dbDefault = getAdminFirestore(admin.app(), '(default)');
     console.log(`Attempting to read 'teams' from (default)...`);
     const snap = await dbDefault.collection('teams').limit(1).get();
     console.log('SUCCESS Reading teams (default). Size:', snap.size);
  } catch (err: any) {
    console.error('FAILED Reading teams (default).');
    console.error('Error:', err.message);
  }
}

debug();
