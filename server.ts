import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import cron from 'node-cron';
import axios from 'axios';
import admin from 'firebase-admin';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Initialize Firebase Admin SDK on the server
let db: any = null;

if (firebaseConfig) {
  try {
    console.log('Initializing Firebase Admin SDK on server...');
    console.log('Project ID:', firebaseConfig.projectId);
    
    let adminApp;
    if (getApps().length === 0) {
      adminApp = initializeApp({
        projectId: firebaseConfig.projectId,
      });
    } else {
      adminApp = getApp();
    }
    
    // Use the named database if provided
    if (firebaseConfig.firestoreDatabaseId) {
      db = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
    } else {
      db = getFirestore(adminApp);
    }
    console.log('Firebase Admin SDK initialized successfully.');
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
  }
} else {
  console.error('Firebase config is missing, cannot initialize Admin SDK.');
}

async function startServer() {
  const expressApp = express();
  // Use the PORT environment variable if provided (required for Cloud Run), 
  // otherwise default to 3000 (required for AI Studio Build environment).
  const PORT = Number(process.env.PORT) || 3000;
  
  console.log(`Starting server on port ${PORT}...`);

  // API Routes
  expressApp.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Manual Trigger for Scoring (for testing)
  expressApp.post('/api/calculate-scores', async (req, res) => {
    try {
      if (!db) {
        const reason = !firebaseConfig ? 'Firebase config missing' : 'Admin SDK failed to initialize';
        throw new Error(`Database not initialized. ${reason}`);
      }
      await recalculateAllLeagues(db);
      res.json({ status: 'success', message: 'Scoring recalculation completed' });
    } catch (error) {
      console.error('Scoring error:', error);
      res.status(500).json({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  });

  // Manual Trigger for NBA Data Sync
  expressApp.post('/api/sync-results', async (req, res) => {
    try {
      if (!db) {
        const reason = !firebaseConfig ? 'Firebase config missing' : 'Admin SDK failed to initialize';
        throw new Error(`Database not initialized. ${reason}`);
      }
      await syncNbaResults(db);
      res.json({ status: 'success', message: 'NBA results sync completed' });
    } catch (error) {
      console.error('Sync error:', error);
      res.status(500).json({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  });

  // Manual Trigger for NBA Standings Sync
  expressApp.post('/api/sync-standings', async (req, res) => {
    try {
      if (!db) {
        const reason = !firebaseConfig ? 'Firebase config missing' : 'Admin SDK failed to initialize';
        throw new Error(`Database not initialized. ${reason}`);
      }
      await syncNbaStandings(db);
      res.json({ status: 'success', message: 'NBA standings sync completed' });
    } catch (error) {
      console.error('Standings Sync error:', error);
      res.status(500).json({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  });

  // Test API Connection
  expressApp.get('/api/admin/test-api-connection', async (req, res) => {
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'RAPIDAPI_KEY is missing from environment secrets.' 
      });
    }

    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0].replace(/-/g, ''); // Format: YYYYMMDD

      console.log(`Testing RapidAPI NBA Scoreboard for date: ${dateStr}`);

      const response = await axios.get('https://nba-api-free-data.p.rapidapi.com/nba-scoreboard-by-date', {
        params: { date: dateStr },
        headers: {
          'x-rapidapi-host': 'nba-api-free-data.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY || ''
        }
      });

      res.json({
        status: 'success',
        message: `Successfully connected to RapidAPI. Found ${response.data?.response?.Events?.length || 0} games for ${dateStr}.`,
        data: response.data
      });
    } catch (error) {
      console.error('API Test Error:', error);
      res.status(500).json({ 
        status: 'error', 
        message: 'Failed to connect to RapidAPI.',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Seed initial data for testing
  expressApp.post('/api/admin/seed-data', async (req, res) => {
    try {
      if (!db) throw new Error('Database not initialized');
      const batch = db.batch();

      // Seed Teams
      const teams = [
        { id: 'bos', teamName: 'Boston Celtics', conference: 'East', seed: 1, apiTeamId: 2 },
        { id: 'mia', teamName: 'Miami Heat', conference: 'East', seed: 8, apiTeamId: 20 },
        { id: 'okc', teamName: 'Oklahoma City Thunder', conference: 'West', seed: 1, apiTeamId: 25 },
        { id: 'nop', teamName: 'New Orleans Pelicans', conference: 'West', seed: 8, apiTeamId: 3 },
      ];

      teams.forEach(team => {
        const ref = db!.collection('teams').doc(team.id);
        batch.set(ref, team);
      });

      // Seed Series Results (Round 1)
      const series = [
        { id: 'R1_E_1', round: 1, team1Id: 'bos', team2Id: 'mia', totalGamesPlayed: 0, lastDataChanged: admin.firestore.FieldValue.serverTimestamp() },
        { id: 'R1_W_1', round: 1, team1Id: 'okc', team2Id: 'nop', totalGamesPlayed: 0, lastDataChanged: admin.firestore.FieldValue.serverTimestamp() },
      ];

      series.forEach(s => {
        const ref = db!.collection('seriesResults').doc(s.id);
        batch.set(ref, s);
      });

      // Seed Global Settings
      const settingsRef = db.collection('globalSettings').doc('config');
      batch.set(settingsRef, {
        picksOpenTime: admin.firestore.Timestamp.fromDate(new Date('2024-04-01')),
        picksLockTime: admin.firestore.Timestamp.fromDate(new Date('2024-04-20')),
        lastDataChanged: admin.firestore.FieldValue.serverTimestamp()
      });

      await batch.commit();
      res.json({ status: 'success', message: 'Initial data seeded successfully.' });
    } catch (error) {
      console.error('Seeding Error:', error);
      res.status(500).json({ status: 'error', message: 'Failed to seed data.', details: error instanceof Error ? error.message : String(error) });
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

  console.log('Server routes initialized. Preparing to listen...');
  
  expressApp.listen(PORT, '0.0.0.0', () => {
    console.log(`SUCCESS: Server is now listening on 0.0.0.0:${PORT}`);
  });
}

// ===============================================================
// API-NBA Sync Job (5:00 AM ET -> 9:00 AM UTC)
// ===============================================================
cron.schedule('0 9 * * *', async () => {
  console.log('Running API-NBA Sync Job...');
  if (db) await syncNbaResults(db);
});

async function syncNbaStandings(db: admin.firestore.Firestore) {
  try {
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      throw new Error('RAPIDAPI_KEY not found in environment secrets. Please add it in the Secrets panel.');
    }

    console.log('Syncing NBA standings from RapidAPI (nba-api-free-data)...');

    const endpoints = [
      'https://nba-api-free-data.p.rapidapi.com/nba-conference-standings?year=2026',
      'https://nba-api-free-data.p.rapidapi.com/nba-conference-standings?year=2025',
      'https://nba-api-free-data.p.rapidapi.com/nba-conference-standings'
    ];

    let response;
    let lastError = null;
    const errorLog: string[] = [];
    for (const url of endpoints) {
      try {
        console.log(`Trying standings endpoint: ${url}`);
        const host = 'nba-api-free-data.p.rapidapi.com';
        
        response = await axios.get(url, {
          headers: {
            'x-rapidapi-host': host,
            'x-rapidapi-key': apiKey
          }
        });
        
        if (response.status === 200 && response.data?.status === 'success') {
          break;
        } else if (response.status === 200) {
          const msg = response.data?.message || 'API returned 200 but status is not success';
          errorLog.push(`${url}: 200 - ${msg}`);
          response = null;
          continue;
        }
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status || 'Unknown';
        const message = err.message || 'No message';
        errorLog.push(`${url}: ${status} - ${message}`);
        console.warn(`Failed endpoint ${url}: ${status} - ${message}`);
        continue;
      }
    }

    if (!response) {
      const summary = errorLog.join(' | ');
      throw new Error(`All standings endpoints failed. Summary: ${summary}`);
    }

    // Handle the specific structure provided by the user
    const normalizedGroups = response.data?.response?.standings || [];
    
    if (normalizedGroups.length === 0) {
      console.log('No standings data found in API response. Full response data:', JSON.stringify(response.data));
      return;
    }

    const updates: { ref: admin.firestore.DocumentReference, data: any }[] = [];

    for (const group of normalizedGroups) {
      const conference = group.name; // "Eastern Conference" or "Western Conference"
      const shortConf = conference.includes('East') ? 'East' : 'West';
      
      const entries = group.standings?.entries || [];
      
      entries.forEach((entry: any, index: number) => {
        const teamData = entry.team;
        
        // Extract seed from stats if available, otherwise use index + 1
        let seed = index + 1;
        if (Array.isArray(entry.stats)) {
          const seedStat = entry.stats.find((s: any) => s.name === 'playoffSeed' || s.type === 'playoffseed');
          if (seedStat && seedStat.value !== undefined) {
            seed = Number(seedStat.value);
          }
        }

        // Only process top 10 for our app's logic (or whatever limit we want)
        if (seed > 10) return;
        
        // Use a consistent ID
        const teamId = teamData.abbreviation?.toLowerCase() || String(teamData.id);
        const ref = db.collection('teams').doc(teamId);
        
        updates.push({
          ref,
          data: {
            teamName: teamData.displayName,
            conference: shortConf,
            seed: seed,
            apiTeamId: Number(teamData.id),
            logoUrl: teamData.logos?.[0]?.href || ''
          }
        });
      });
    }

    // Commit in chunks of 500
    for (let i = 0; i < updates.length; i += 500) {
      const batch = db.batch();
      const chunk = updates.slice(i, i + 500);
      chunk.forEach(u => batch.set(u.ref, u.data, { merge: true }));
      await batch.commit();
    }

    console.log('NBA standings sync completed. Teams updated.');
  } catch (error) {
    console.error('NBA Standings Sync Error:', error);
    throw error;
  }
}

async function syncNbaResults(db: admin.firestore.Firestore) {
  try {
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      throw new Error('RAPIDAPI_KEY not found in environment secrets. Please add it in the Secrets panel.');
    }

    console.log('Syncing NBA results from RapidAPI...');

    let response;
    const endpoints = [
      'https://nba-api-free-data.p.rapidapi.com/nba-game-scores'
    ];

    for (const url of endpoints) {
      try {
        console.log(`Trying results endpoint: ${url}`);
        const host = 'nba-api-free-data.p.rapidapi.com';
        
        response = await axios.get(url, {
          headers: {
            'x-rapidapi-host': host,
            'x-rapidapi-key': apiKey
          }
        });
        if (response.status === 200) break;
      } catch (err: any) {
        console.warn(`Failed results endpoint ${url}: ${err.response?.status || 'Unknown'}`);
        continue;
      }
    }

    if (!response) {
      console.log('All results endpoints failed.');
      return;
    }

    // The nba-api-free-data structure for game scores usually has an 'events' array
    let games = [];
    if (response.data?.events) {
      games = response.data.events;
    } else if (response.data?.response?.events) {
      games = response.data.response.events;
    }

    const completedGames = games.filter((g: any) => g.status?.type?.completed === true);

    if (completedGames.length === 0) {
      console.log('No completed games found in API response.');
      return;
    }

    // Fetch all teams to map apiTeamId to our teamId
    const teamsSnapshot = await db.collection('teams').get();
    const teamsMap: Record<string, string> = {};
    teamsSnapshot.docs.forEach(d => {
      const data = d.data();
      if (data.apiTeamId) {
        teamsMap[String(data.apiTeamId)] = d.id;
      }
    });

    // Fetch all series results
    const seriesSnapshot = await db.collection('seriesResults').get();
    const seriesList = seriesSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    const seriesUpdates: admin.firestore.DocumentReference[] = [];

    for (const game of completedGames) {
      const competitors = game.competitors || [];
      const winner = competitors.find((c: any) => c.winner === true);
      const loser = competitors.find((c: any) => c.winner === false);

      if (!winner || !loser) continue;

      const winningTeamId = teamsMap[String(winner.id)];
      const losingTeamId = teamsMap[String(loser.id)];

      if (!winningTeamId || !losingTeamId) continue;

      // Find the series involving these two teams
      const series = seriesList.find((s: any) => 
        (s.team1Id === winningTeamId && s.team2Id === losingTeamId) ||
        (s.team1Id === losingTeamId && s.team2Id === winningTeamId)
      );

      if (series) {
        console.log(`Updating series: ${series.id} with game result.`);
        seriesUpdates.push(db.collection('seriesResults').doc(series.id));
      }
    }

    if (seriesUpdates.length > 0) {
      for (let i = 0; i < seriesUpdates.length; i += 500) {
        const batch = db.batch();
        const chunk = seriesUpdates.slice(i, i + 500);
        chunk.forEach(ref => batch.update(ref, { lastDataChanged: admin.firestore.FieldValue.serverTimestamp() }));
        await batch.commit();
      }
      
      // Update global settings to trigger scoring engine
      await db.collection('globalSettings').doc('config').update({
        lastDataChanged: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log('NBA results sync completed and triggered scoring engine.');
    } else {
      console.log('NBA results sync completed. No relevant series data changed.');
    }
  } catch (error) {
    console.error('API-NBA Sync Error:', error);
  }
}

// ===============================================================
// Idempotent Multi-Tenant Scoring Engine
// ===============================================================
async function recalculateAllLeagues(db: admin.firestore.Firestore) {
  const globalConfigSnap = await db.collection('globalSettings').doc('config').get();
  const globalConfig = globalConfigSnap.data();
  if (!globalConfig) return;

  const lastDataChanged = globalConfig.lastDataChanged?.toDate() || new Date(0);

  const leaguesSnap = await db.collection('leagues').get();
  
  for (const leagueDoc of leaguesSnap.docs) {
    const leagueData = leagueDoc.data();
    const lastCalculated = leagueData.lastCalculated?.toDate() || new Date(0);

    // Only recalculate if data changed since last calculation
    if (lastDataChanged > lastCalculated) {
      console.log(`Recalculating scores for league: ${leagueData.leagueName}`);
      await calculateLeagueScores(db, leagueDoc.id, leagueData);
    }
  }
}

async function calculateLeagueScores(db: admin.firestore.Firestore, leagueId: string, leagueData: any) {
  const seriesResultsSnap = await db.collection('seriesResults').get();
  const results = seriesResultsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  const bracketsSnap = await db.collection('brackets').where('leagueId', '==', leagueId).get();

  const bracketScores: { id: string, score: number, tiebreakerDiff: number, tiebreakerValue: number }[] = [];

  for (const bracketDoc of bracketsSnap.docs) {
    const bracket = bracketDoc.data();
    let totalScore = 0;

    // 1. Standard Rounds Scoring
    bracket.picks.forEach((pick: any) => {
      const result = results.find(r => r.id === pick.matchupId); // Assuming matchupId mapping
      if (result && result.advancingTeamId === pick.predictedTeamId) {
        const basePoints = leagueData.pointConfig[`round${pick.predictedRound}`] || 0;
        totalScore += basePoints;

        // Bonus for exact games
        if (result.totalGamesPlayed === pick.predictedSeriesLength) {
          totalScore += leagueData.pointConfig.exactGamesBonus;
        }
      }
    });

    // 2. Play-In Scoring
    bracket.playInPicks.forEach((pick: any) => {
      const result = results.find(r => r.id === pick.matchupId);
      if (result && result.advancingTeamId === pick.predictedWinnerId) {
        totalScore += leagueData.pointConfig.playIn;
      }
    });

    // Tiebreaker calculation
    const actualFinalsPoints = results.find(r => r.round === 4)?.actualFinalsTotalPoints || 0;
    const tiebreakerDiff = Math.abs(bracket.tiebreakerPrediction - actualFinalsPoints);

    bracketScores.push({
      id: bracketDoc.id,
      score: totalScore,
      tiebreakerDiff,
      tiebreakerValue: bracket.tiebreakerPrediction
    });
  }

  // 3. Rank Brackets with Tiebreaker Logic
  // Sort by Score (Desc), then Tiebreaker Diff (Asc), then "Price is Right" (Under wins)
  bracketScores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.tiebreakerDiff !== b.tiebreakerDiff) return a.tiebreakerDiff - b.tiebreakerDiff;
    
    // Secondary Tiebreaker: Prediction under the actual total wins
    const actualFinalsPoints = results.find(r => r.round === 4)?.actualFinalsTotalPoints || 0;
    const aIsUnder = a.tiebreakerValue <= actualFinalsPoints;
    const bIsUnder = b.tiebreakerValue <= actualFinalsPoints;
    if (aIsUnder && !bIsUnder) return -1;
    if (!aIsUnder && bIsUnder) return 1;
    
    return 0; // Deadlock
  });

  // Update Brackets in Chunks
  for (let i = 0; i < bracketScores.length; i += 500) {
    const batch = db.batch();
    const chunk = bracketScores.slice(i, i + 500);
    chunk.forEach((item, indexInChunk) => {
      const globalIndex = i + indexInChunk;
      const ref = db.collection('brackets').doc(item.id);
      batch.update(ref, {
        totalScore: item.score,
        rank: globalIndex + 1
      });
    });
    await batch.commit();
  }

  // Update League LastCalculated
  await db.collection('leagues').doc(leagueId).update({
    lastCalculated: admin.firestore.FieldValue.serverTimestamp()
  });
}

console.log('Calling startServer()...');
startServer().catch(err => {
  console.error('FATAL: Failed to start server:', err);
  process.exit(1);
});
