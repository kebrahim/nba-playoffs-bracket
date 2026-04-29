import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import cron from 'node-cron';
import axios from 'axios';
import admin from 'firebase-admin';
import { initializeApp as initializeAdminApp, getApps as getAdminApps, getApp as getAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===============================================================
// Firestore Error Handling (as per system instructions)
// ===============================================================
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

enum PickStatus {
  PENDING = 'Pending',
  CORRECT = 'Correct',
  INCORRECT = 'Incorrect',
}

function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  const isPermissionDenied = 
    error.code === 7 || 
    error.code === 'permission-denied' || 
    error.message?.includes('permission-denied') || 
    error.message?.includes('Missing or insufficient permissions') ||
    error.message?.includes('PERMISSION_DENIED');

  if (isPermissionDenied) {
    const errInfo = {
      error: error.message || String(error),
      authInfo: {
        userId: 'SERVER_ADMIN_SDK',
        email: 'SERVER_ADMIN_SDK',
        emailVerified: true,
        isAnonymous: false,
        tenantId: undefined,
        providerInfo: []
      },
      operationType,
      path
    };
    console.error('Firestore Permission Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  }
  throw error;
}

// Load Firebase configuration robustly
let firebaseConfig: any = null;
try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log('Firebase config loaded successfully.');
  } else {
    console.warn('firebase-applet-config.json not found at', configPath);
  }
} catch (error) {
  console.error('Error loading firebase-applet-config.json:', error);
}

// Initialize Firebase Admin SDK
let db: admin.firestore.Firestore | null = null;

if (firebaseConfig) {
  try {
    console.log(`Initializing Firebase Admin SDK for project ${firebaseConfig.projectId}...`);
    
    // Initialize App without explicit credential to let it use environment default more cleanly
    const adminApp = getAdminApps().length === 0 
      ? initializeAdminApp({
          projectId: firebaseConfig.projectId,
        })
      : getAdminApp();
    
    // Explicitly pass the databaseId
    db = getAdminFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
    
    console.log(`Firebase Admin SDK initialized for Firestore (Project: ${firebaseConfig.projectId}, DB: ${firebaseConfig.firestoreDatabaseId || '(default)'}).`);
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error);
  }
} else {
  console.error('Firebase config is missing, cannot initialize Admin SDK.');
}

async function startServer() {
  const expressApp = express();
  const PORT = Number(process.env.PORT) || 3000;
  
  console.log(`Starting server on port ${PORT}...`);

  // Debug route
  expressApp.get('/api/admin/debug-db', async (req, res) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const collections = ['leagues', 'teams', 'users', 'globalSettings'];
      const stats: Record<string, number> = {};
      for (const col of collections) {
        const snap = await db.collection(col).get();
        stats[col] = snap.size;
      }
      res.json({ status: 'success', databaseId: firebaseConfig?.firestoreDatabaseId, stats });
    } catch (error) {
      res.status(500).json({ status: 'error', message: String(error) });
    }
  });

  expressApp.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  expressApp.get('/api/admin/test-api-connection', async (req, res) => {
    try {
      const apiKey = process.env.RAPIDAPI_KEY;
      if (!apiKey) throw new Error('RAPIDAPI_KEY not found in environment');
      
      // Attempt to hit a simple endpoint to verify key/connectivity
      const response = await fetchWithRetry({
        url: 'https://nba-api-free-data.p.rapidapi.com/nba-conference-standings',
        method: 'GET',
        headers: {
          'x-rapidapi-host': 'nba-api-free-data.p.rapidapi.com',
          'x-rapidapi-key': apiKey
        },
        timeout: 10000
      });
      
      if (response && response.status === 200) {
        res.json({ status: 'success', message: 'Successfully connected to RapidAPI NBA Service.' });
      } else {
        res.status(response?.status || 500).json({ status: 'error', message: `API responded with status ${response?.status}` });
      }
    } catch (error: any) {
      console.error('API Test Error:', error.message);
      const status = error.response?.status || 500;
      
      if (status === 429) {
        return res.status(429).json({ 
          status: 'error', 
          message: 'NBA API Quota Reached: You have exhausted your daily free requests. Please try again tomorrow or upgrade your plan.' 
        });
      }
      
      if (status === 503) {
        return res.status(503).json({
          status: 'error',
          message: 'NBA Data Service is temporarily unavailable (503). This usually means the provider is experiencing an outage. Try again later.'
        });
      }

      res.status(status).json({ 
        status: 'error', 
        message: error.message, 
        details: typeof error.response?.data === 'string' && error.response.data.includes('<!doctype') 
          ? 'HTML Error Page Received' 
          : error.response?.data 
      });
    }
  });

  expressApp.post('/api/calculate-scores', async (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const force = req.query.force === 'true';
      await recalculateAllLeagues(db, force);
      res.json({ status: 'success', message: 'Scoring recalculation completed' });
    } catch (error: any) {
      res.status(500).json({ status: 'error', message: error.message });
    }
  });

  // RapidAPI Proxy: Results
  // Frontend calls this to get results without having the API key
  expressApp.get('/api/proxy/nba-results', async (req, res) => {
    try {
      const date = req.query.date as string;
      const results = await fetchNbaResultsData(db || undefined, date);
      res.json({ status: 'success', games: results });
    } catch (error: any) {
      console.error('Proxy NBA Results Error:', error.message);
      
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || error.message;

      if (status === 429) {
        return res.status(429).json({ 
          status: 'error', 
          message: 'NBA API Quota Reached: You have reached 100% of your free daily requests. Please wait until your quota resets tomorrow.' 
        });
      }
      
      if (status === 503) {
        return res.status(503).json({
          status: 'error',
          message: 'NBA Data Service is temporarily unavailable (503). This is usually a temporary issue with the external provider. Please try again in a few minutes.'
        });
      }

      res.status(status).json({ status: 'error', message: message });
    }
  });

  expressApp.get('/api/proxy/nba-standings', async (req, res) => {
    try {
      const updates = await fetchNbaStandingsData();
      res.json({ status: 'success', updates });
    } catch (error: any) {
      console.error('Proxy NBA Standings Error:', error.message);
      
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || error.message;

      if (status === 429) {
        return res.status(429).json({ 
          status: 'error', 
          message: 'NBA API Quota Reached: You have reached 100% of your free daily requests. Please wait until your quota resets tomorrow.' 
        });
      }

      if (status === 503) {
        return res.status(503).json({
          status: 'error',
          message: 'NBA Data Service is temporarily unavailable (503). This is usually a temporary issue with the external provider. Please try again in a few minutes.'
        });
      }

      res.status(status).json({ status: 'error', message: message });
    }
  });

  expressApp.post('/api/sync-results', async (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const isMock = req.query.mock === 'true';
      const days = parseInt(req.query.days as string) || 1;
      const { totalUpdated, resultsByDate } = await syncNbaResults(db, isMock, days);
      res.json({ 
        status: 'success', 
        message: `NBA results sync completed. Found updates for ${totalUpdated} total games over the last ${days} days.`,
        totalUpdated,
        details: resultsByDate
      });
    } catch (error: any) {
      res.status(500).json({ status: 'error', message: error.message });
    }
  });

  expressApp.post('/api/sync-standings', async (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const isMock = req.query.mock === 'true';
      await syncNbaStandings(db, isMock);
      res.json({ status: 'success', message: 'NBA standings sync completed' });
    } catch (error: any) {
      res.status(500).json({ status: 'error', message: error.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    expressApp.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    expressApp.use(express.static(distPath));
    expressApp.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  expressApp.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// ===============================================================
// Sync Workers & Helpers
// ===============================================================

async function fetchWithRetry(config: any, retries = 3, delay = 1500) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios(config);
      
      // Check if response is HTML when we expected JSON
      const contentType = response.headers?.['content-type'] || '';
      if (typeof response.data === 'string' && response.data.trim().startsWith('<!doctype') && !contentType.includes('text/html')) {
        console.warn(`Fetch attempt ${i + 1}: Received HTML instead of JSON. Possible service outage page.`);
        throw new Error('NBA Data Service returned an HTML error page instead of JSON data.');
      }
      
      return response;
    } catch (err: any) {
      const status = err.response?.status;
      const isStatusRetryable = status === 503 || status === 502 || status === 504 || err.code === 'ECONNABORTED';
      
      if (isStatusRetryable && i < retries) {
        console.warn(`Fetch attempt ${i + 1} failed with ${status || err.code}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 1.5; // Exponential backoff
        continue;
      }
      
      // If we get here and it's the last retry or not retryable
      if (err.response?.data && typeof err.response.data === 'string' && err.response.data.includes('<!doctype')) {
        err.message = `${err.message} (Note: Service returned an HTML error page)`;
      }
      
      throw err;
    }
  }
}

async function fetchNbaStandingsData() {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY not found');

  const endpoints = [
    'https://nba-api-free-data.p.rapidapi.com/nba-conference-standings?year=2026',
    'https://nba-api-free-data.p.rapidapi.com/nba-conference-standings?year=2025',
    'https://nba-api-free-data.p.rapidapi.com/nba-conference-standings'
  ];

  let response;
  const errors: string[] = [];
  for (const url of endpoints) {
    try {
      response = await fetchWithRetry({
        url,
        method: 'GET',
        headers: {
          'x-rapidapi-host': 'nba-api-free-data.p.rapidapi.com',
          'x-rapidapi-key': apiKey
        },
        timeout: 10000
      });
      if (response && response.status === 200 && response.data?.status === 'success') break;
    } catch (err: any) {
      errors.push(`${url}: ${err.message}`);
      response = null;
    }
  }

  if (!response) throw new Error(`Standings API failed: ${errors.join(' | ')}`);

  const groups = response.data?.response?.standings || [];
  const updates: any[] = [];

  for (const group of groups) {
    const conference = group.name.includes('East') ? 'East' : 'West';
    const entries = group.standings?.entries || [];
    entries.forEach((entry: any, index: number) => {
      const team = entry.team;
      let seed = index + 1;
      if (Array.isArray(entry.stats)) {
        const seedStat = entry.stats.find((s: any) => s.name === 'playoffSeed' || s.type === 'playoffseed');
        if (seedStat?.value !== undefined) seed = Number(seedStat.value);
      }
      if (seed > 10) return;
      const id = team.abbreviation?.toLowerCase() || String(team.id);
      updates.push({
        id,
        data: {
          teamName: team.displayName,
          abbreviation: team.abbreviation || team.shortDisplayName || team.name.substring(0, 3).toUpperCase(),
          conference,
          seed,
          apiTeamId: Number(team.id),
          logoUrl: team.logos?.[0]?.href || ''
        }
      });
    });
  }
  return updates;
}

async function syncNbaStandings(db: admin.firestore.Firestore, isMock: boolean = false) {
  if (isMock) return;
  const updates = await fetchNbaStandingsData();
  const batch = db.batch();
  updates.forEach(u => batch.set(db.collection('teams').doc(u.id), u.data, { merge: true }));
  await batch.commit();
}

async function fetchNbaResultsData(dbInstance?: admin.firestore.Firestore, specificDate?: string) {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY not found');

  let dateStr = specificDate;
  if (!dateStr) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateStr = yesterday.toISOString().split('T')[0].replace(/-/g, '');
  }

  const response = await fetchWithRetry({
    url: 'https://nba-api-free-data.p.rapidapi.com/nba-scoreboard-by-date',
    method: 'GET',
    params: { date: dateStr },
    headers: {
      'x-rapidapi-host': 'nba-api-free-data.p.rapidapi.com',
      'x-rapidapi-key': apiKey
    },
    timeout: 15000
  });

  const rawGames = response?.data?.response?.Events || 
                   response.data?.response?.events || 
                   response.data?.events || 
                   response.data?.scoreboard?.events || [];
  
  if (rawGames.length === 0) {
    console.warn(`No games found in API response for date ${dateStr}. Top-level keys:`, Object.keys(response.data || {}));
  }

  const completed = rawGames.filter((g: any) => {
    // Check nested status.type.completed as per user sample
    const isCompleted = g.status?.type?.completed === true;
    const statusName = g.status?.type?.name || '';
    
    return isCompleted || 
           statusName.includes('FINAL') || 
           statusName.includes('COMPLETED') ||
           g.status?.type?.state === 'post';
  });
  
  if (rawGames.length > 0 && completed.length === 0) {
    console.warn(`Found ${rawGames.length} games for ${dateStr}, but none matched the 'completed' filter. Sample statuses:`, 
      rawGames.slice(0, 3).map((g: any) => g.status?.type?.name));
  }

  if (completed.length === 0) return [];

  // If no DB provided or if DB read fails (common on server IAM), return raw data for frontend to handle
  if (!dbInstance) {
    return completed;
  }

  try {
    const teamsSnap = await dbInstance.collection('teams').get();
    const teamsMap: Record<string, string> = {};
    teamsSnap.docs.forEach(d => {
      if (d.data().apiTeamId) teamsMap[String(d.data().apiTeamId)] = d.id;
    });

    const seriesSnap = await dbInstance.collection('seriesResults').get();
    const seriesList = seriesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    const results: any[] = [];
    for (const game of completed) {
      // Robust competitor discovery (matching frontend logic)
      const findCompetitors = (obj: any): any[] | null => {
        if (!obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj.competitors) && obj.competitors.length > 0) return obj.competitors;
        for (const key in obj) {
          if (obj[key] && typeof obj[key] === 'object' && key !== 'status') {
            const res = findCompetitors(obj[key]);
            if (res) return res;
          }
        }
        return null;
      };

      const comps = findCompetitors(game) || [];
      if (comps.length < 2) {
        console.warn(`  Could not find competitors for game ${game.id || game.uid}`);
        continue;
      }
      
      const winner = comps.find((c: any) => 
        c.winner === true || 
        (c.score !== undefined && Number(c.score) > Number(comps.find((o: any) => String(o.id || o.team?.id) !== String(c.id || c.team?.id))?.score))
      );
      const loser = comps.find((c: any) => 
        c.winner === false || 
        (c.score !== undefined && Number(c.score) < Number(comps.find((o: any) => String(o.id || o.team?.id) !== String(c.id || c.team?.id))?.score))
      );
      
      if (!winner || !loser) {
        console.warn(`  Could not determine winner/loser for game ${game.id || game.uid} among ${comps.length} competitors`);
        continue;
      }

      const winId = teamsMap[String(winner.id || winner.team?.id)];
      const loseId = teamsMap[String(loser.id || loser.team?.id)];
      
      if (!winId || !loseId) {
        console.warn(`  Team mapping failed: WinID=${winner.id || winner.team?.id} -> ${winId}, LoseID=${loser.id || loser.team?.id} -> ${loseId}`);
        continue;
      }

      const series = seriesList.find((s: any) => 
        (s.team1Id === winId && s.team2Id === loseId) || (s.team1Id === loseId && s.team2Id === winId)
      );
      
      if (series) {
        results.push({ 
          seriesId: series.id, 
          winnerId: winId, 
          totalGames: 4, 
          gameId: String(game.id || game.uid || Math.random()) 
        });
      } else {
        console.warn(`  No playoff series mapping found for ${winId} vs ${loseId}`);
      }
    }
    return results;
  } catch (err: any) {
    if (err.code === 7 || err.message?.includes('PERMISSION_DENIED')) {
      console.log('Server Admin SDK has restricted database access (IAM). Handing off game mapping to frontend client.');
    } else {
      console.error('Server-side Firestore mapping error:', err.message);
    }
    return completed;
  }
}

async function syncNbaResults(db: admin.firestore.Firestore, isMock: boolean = false, days: number = 1): Promise<{ totalUpdated: number, resultsByDate: Record<string, number> }> {
  if (isMock) {
    await db.collection('globalSettings').doc('config').update({ lastDataChanged: admin.firestore.FieldValue.serverTimestamp() });
    return { totalUpdated: 0, resultsByDate: {} };
  }
  
  console.log(`Background Sync: Fetching results for last ${days} days...`);
  let totalUpdated = 0;
  const resultsByDate: Record<string, number> = {};
  
  // We'll process each day
  for (let i = 1; i <= days; i++) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - i);
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
    
    console.log(`- Fetching results for: ${dateStr}`);
    const results = await fetchNbaResultsData(db, dateStr);
    
    if (results.length === 0) {
      console.log(`  No results found for ${dateStr}.`);
      resultsByDate[dateStr] = 0;
      continue;
    }

    // Check if mapping worked on server
    if (results[0] && !results[0].seriesId) {
      console.warn(`  Warning: ${results.length} games found for ${dateStr} but they are NOT mapped to series IDs. skipping server sync.`);
      resultsByDate[dateStr] = 0;
      continue;
    }

    const matchedSeriesIds = [...new Set(results.map(r => r.seriesId))];
    const seriesSnap = await Promise.all(matchedSeriesIds.map((id: any) => db.collection('seriesResults').doc(String(id)).get()));
    const currentSeriesMap: Record<string, any> = {};
    seriesSnap.forEach(snap => {
      if (snap.exists) currentSeriesMap[snap.id] = snap.data();
    });

    const batch = db.batch();
    let updatesInBatch = 0;

    results.forEach(res => {
      const s = currentSeriesMap[res.seriesId];
      if (!s) {
        console.warn(`  No series config found for seriesId: ${res.seriesId}`);
        return;
      }

      const playedGameIds = Array.isArray(s.playedGameIds) ? s.playedGameIds : [];
      if (playedGameIds.includes(res.gameId)) {
          // Already handled
          console.log(`  Game ${res.gameId} already in playedGameIds for series ${res.seriesId}`);
          return;
      }

      // Increment Wins
      let t1w = Number(s.team1Wins) || 0;
      let t2w = Number(s.team2Wins) || 0;
      
      if (res.winnerId === s.team1Id) {
          t1w++;
      } else if (res.winnerId === s.team2Id) {
          t2w++;
      } else {
          console.warn(`  Winner ${res.winnerId} does not match series teams ${s.team1Id}/${s.team2Id}`);
          return;
      }

      const newPlayedIds = [...playedGameIds, res.gameId];
      const updates: any = {
        team1Wins: t1w,
        team2Wins: t2w,
        playedGameIds: newPlayedIds,
        lastDataChanged: admin.firestore.FieldValue.serverTimestamp()
      };

      // Check for series completion
      const isPlayIn = res.seriesId.startsWith('PI_');
      const winsNeeded = isPlayIn ? 1 : 4;

      if (t1w >= winsNeeded) {
          updates.advancingTeamId = s.team1Id;
          updates.eliminatedTeamId = s.team2Id;
          updates.totalGamesPlayed = t1w + t2w;
      } else if (t2w >= winsNeeded) {
          updates.advancingTeamId = s.team2Id;
          updates.eliminatedTeamId = s.team1Id;
          updates.totalGamesPlayed = t1w + t2w;
      }

      batch.update(db.collection('seriesResults').doc(res.seriesId), updates);
      currentSeriesMap[res.seriesId] = { ...s, ...updates };
      updatesInBatch++;
    });

    if (updatesInBatch > 0) {
      await batch.commit();
      console.log(`  Successfully Updated ${updatesInBatch} results for ${dateStr}.`);
      totalUpdated += updatesInBatch;
      resultsByDate[dateStr] = updatesInBatch;
    } else {
      resultsByDate[dateStr] = 0;
    }
  }
  
  await db.collection('globalSettings').doc('config').update({ lastDataChanged: admin.firestore.FieldValue.serverTimestamp() });
  return { totalUpdated, resultsByDate };
}

async function recalculateBracketProgression(db: admin.firestore.Firestore) {
  console.log("Server: Recalculating bracket progression...");
  try {
    const seriesSnap = await db.collection('seriesResults').get();
    const allSeries = seriesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    const batch = db.batch();
    let updatesCount = 0;

    const updateSeries = (id: string, t1?: string, t2?: string) => {
      const s = allSeries.find(x => x.id === id);
      if (!s) return;
      const updates: any = {};
      
      // Only update if value is provided AND different
      if (t1 !== undefined && t1 !== '' && s.team1Id !== t1) updates.team1Id = t1;
      if (t2 !== undefined && t2 !== '' && s.team2Id !== t2) updates.team2Id = t2;
      
      if (Object.keys(updates).length > 0) {
        batch.update(db.collection('seriesResults').doc(id), { 
          ...updates, 
          lastDataChanged: admin.firestore.FieldValue.serverTimestamp() 
        });
        updatesCount++;
      }
    };

    const getWinner = (id: string) => allSeries.find(s => s.id === id)?.advancingTeamId || '';
    const getLoser = (id: string) => {
      const s = allSeries.find(s => s.id === id);
      if (!s || !s.advancingTeamId || !s.team1Id || !s.team2Id) return '';
      return s.advancingTeamId === s.team1Id ? s.team2Id : s.team1Id;
    };

    // --- East ---
    updateSeries('R1_E_2v7', undefined, getWinner('PI_E_A'));
    updateSeries('PI_E_C', getLoser('PI_E_A'), getWinner('PI_E_B'));
    updateSeries('R1_E_1v8', undefined, getWinner('PI_E_C'));

    // --- West ---
    updateSeries('R1_W_2v7', undefined, getWinner('PI_W_A'));
    updateSeries('PI_W_C', getLoser('PI_W_A'), getWinner('PI_W_B'));
    updateSeries('R1_W_1v8', undefined, getWinner('PI_W_C'));

    // --- R1 to R2 ---
    updateSeries('R2_E_M1', getWinner('R1_E_1v8'), getWinner('R1_E_4v5'));
    updateSeries('R2_E_M2', getWinner('R1_E_2v7'), getWinner('R1_E_3v6'));
    updateSeries('R2_W_M1', getWinner('R1_W_1v8'), getWinner('R1_W_4v5'));
    updateSeries('R2_W_M2', getWinner('R1_W_2v7'), getWinner('R1_W_3v6'));

    // --- R2 to CF ---
    updateSeries('R3_E_CF', getWinner('R2_E_M1'), getWinner('R2_E_M2'));
    updateSeries('R3_W_CF', getWinner('R2_W_M1'), getWinner('R2_W_M2'));

    // --- Finals ---
    updateSeries('R4_Finals', getWinner('R3_E_CF'), getWinner('R3_W_CF'));

    if (updatesCount > 0) {
      await batch.commit();
      console.log(`Server: Progression recalculated (${updatesCount} series updated).`);
    } else {
      console.log("Server: No progression updates needed.");
    }
  } catch (err) {
    console.error("Server Progression Error:", err);
  }
}

async function recalculateAllLeagues(db: admin.firestore.Firestore, force: boolean = false) {
  const configSnap = await db.collection('globalSettings').doc('config').get();
  const lastDataChanged = configSnap.data()?.lastDataChanged?.toDate() || new Date(0);
  const leaguesSnap = await db.collection('leagues').get();
  for (const leagueDoc of leaguesSnap.docs) {
    const leagueData = leagueDoc.data();
    const lastCalc = leagueData.lastCalculated?.toDate() || new Date(0);
    if (force || lastDataChanged > lastCalc) {
      await calculateLeagueScores(db, leagueDoc.id, leagueData);
    }
  }
}

async function calculateLeagueScores(db: admin.firestore.Firestore, leagueId: string, leagueData: any) {
  const seriesResults = (await db.collection('seriesResults').get()).docs.map(d => ({ id: d.id, ...d.data() } as any));
  const brackets = (await db.collection('brackets').where('leagueId', '==', leagueId).get()).docs;
  
  const legacyMap: Record<string, string> = {
    'R1_E_1': 'R1_E_1v8', 'R1_E_2': 'R1_E_4v5', 'R1_E_3': 'R1_E_3v6', 'R1_E_4': 'R1_E_2v7',
    'R1_W_1': 'R1_W_1v8', 'R1_W_2': 'R1_W_4v5', 'R1_W_3': 'R1_W_3v6', 'R1_W_4': 'R1_W_2v7',
    'R2_E_1': 'R2_E_M1', 'R2_E_2': 'R2_E_M2',
    'R2_W_1': 'R2_W_M1', 'R2_W_2': 'R2_W_M2',
    'CF_E': 'R3_E_CF', 'CF_W': 'R3_W_CF',
    'FINALS': 'R4_Finals'
  };

  const scores: { id: string, score: number, tiebreakerDiff: number, updatedPicks: any[], updatedPlayInPicks: any[], roundScores: any }[] = [];

  for (const doc of brackets) {
    const b = doc.data();
    let s = 0;
    const currentRoundScores = { playIn: 0, r1: 0, r2: 0, cf: 0, finals: 0 };
    const updatedPicks = Array.isArray(b.picks) ? [...b.picks] : [];
    const updatedPlayInPicks = Array.isArray(b.playInPicks) ? [...b.playInPicks] : [];

    if (leagueData.pointConfig) {
      updatedPicks.forEach((p: any) => {
        const actualId = legacyMap[p.matchupId] || p.matchupId;
        const res = seriesResults.find(r => r.id === actualId);
        
        if (res?.advancingTeamId) {
          const round = p.predictedRound || (
            actualId.startsWith('R1') ? 1 : 
            actualId.startsWith('R2') ? 2 : 
            actualId.startsWith('R3') ? 3 : 
            (actualId.startsWith('R4') || actualId === 'FINALS') ? 4 : 
            1
          );

          if (res.advancingTeamId === p.predictedTeamId) {
            p.status = PickStatus.CORRECT;
            const roundKey = round === 4 ? 'finals' : `round${round}`;
            const points = Number(leagueData.pointConfig?.[roundKey]) || 0;
            s += points;
            
            if (round === 1) currentRoundScores.r1 += points;
            else if (round === 2) currentRoundScores.r2 += points;
            else if (round === 3) currentRoundScores.cf += points;
            else if (round === 4) currentRoundScores.finals += points;

            if (res.totalGamesPlayed === p.predictedSeriesLength) {
              const bonus = (Number(leagueData.pointConfig?.exactGamesBonus) || 0);
              s += bonus;
              if (round === 1) currentRoundScores.r1 += bonus;
              else if (round === 2) currentRoundScores.r2 += bonus;
              else if (round === 3) currentRoundScores.cf += bonus;
              else if (round === 4) currentRoundScores.finals += bonus;
            }
          } else {
            p.status = PickStatus.INCORRECT;
          }
        } else {
          p.status = PickStatus.PENDING;
        }
      });

      // Add Play-In scoring
      if (leagueData.pointConfig.playIn) {
        updatedPlayInPicks.forEach((p: any) => {
          const actualId = legacyMap[p.matchupId] || p.matchupId;
          const res = seriesResults.find(r => r.id === actualId);
          if (res?.advancingTeamId) {
            if (res.advancingTeamId === p.predictedWinnerId) {
              p.status = PickStatus.CORRECT;
              const points = Number(leagueData.pointConfig.playIn) || 0;
              s += points;
              currentRoundScores.playIn += points;
            } else {
              p.status = PickStatus.INCORRECT;
            }
          } else {
            p.status = PickStatus.PENDING;
          }
        });
      }
    }

    const actualFinalsRes = seriesResults.find(r => r.id === 'R4_Finals' || r.id === 'FINALS');
    const actualPoints = actualFinalsRes?.actualFinalsTotalPoints || 0;

    scores.push({ 
      id: doc.id, 
      score: s, 
      tiebreakerDiff: Math.abs((b.tiebreakerPrediction || 0) - actualPoints),
      updatedPicks,
      updatedPlayInPicks,
      roundScores: currentRoundScores
    });
  }

  scores.sort((a, b) => (b.score - a.score) || (a.tiebreakerDiff - b.tiebreakerDiff));
  
  for (let i = 0; i < scores.length; i += 500) {
    const batch = db.batch();
    scores.slice(i, i + 500).forEach((item, idx) => {
      batch.update(db.collection('brackets').doc(item.id), { 
        totalScore: item.score, 
        rank: i + idx + 1,
        picks: item.updatedPicks,
        playInPicks: item.updatedPlayInPicks,
        roundScores: item.roundScores
      });
    });
    await batch.commit();
  }
  await db.collection('leagues').doc(leagueId).update({ lastCalculated: admin.firestore.FieldValue.serverTimestamp() });
}

cron.schedule('0 9 * * *', async () => {
  if (db) {
    try {
      // Sync last 3 days by default to capture any missed games if server was down or API failed
      await syncNbaResults(db, false, 3);
      await recalculateBracketProgression(db);
      await recalculateAllLeagues(db, true); // Force recalc after results
      console.log('Daily automated sync (last 3 days) and scoring completed.');
    } catch (err) {
      console.error('Daily automated sync failed:', err);
    }
  }
});

startServer().catch(console.error);
