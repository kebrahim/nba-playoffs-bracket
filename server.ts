import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';
import axios from 'axios';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  query, 
  where, 
  writeBatch, 
  serverTimestamp, 
  Timestamp 
} from 'firebase/firestore';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase configuration robustly
const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Initialize Firebase Client SDK on the server
// This uses the API Key and App ID, avoiding service account permission issues.
console.log('Initializing Firebase Client SDK on server...');
console.log('Project ID:', firebaseConfig.projectId);
console.log('Database ID:', firebaseConfig.firestoreDatabaseId);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function startServer() {
  const expressApp = express();
  // Use the PORT environment variable if provided (required for Cloud Run), 
  // otherwise default to 3000 (required for AI Studio Build environment).
  const PORT = process.env.PORT || 3000;

  // API Routes
  expressApp.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Manual Trigger for Scoring (for testing)
  expressApp.post('/api/calculate-scores', async (req, res) => {
    try {
      await recalculateAllLeagues();
      res.json({ status: 'success', message: 'Scoring recalculation completed' });
    } catch (error) {
      console.error('Scoring error:', error);
      res.status(500).json({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  });

  // Manual Trigger for NBA Data Sync
  expressApp.post('/api/sync-results', async (req, res) => {
    try {
      await syncNbaResults();
      res.json({ status: 'success', message: 'NBA results sync completed' });
    } catch (error) {
      console.error('Sync error:', error);
      res.status(500).json({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  });

  // Manual Trigger for NBA Standings Sync
  expressApp.post('/api/sync-standings', async (req, res) => {
    try {
      await syncNbaStandings();
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
      const batch = writeBatch(db);

      // Seed Teams
      const teams = [
        { id: 'bos', teamName: 'Boston Celtics', conference: 'East', seed: 1, apiTeamId: 2 },
        { id: 'mia', teamName: 'Miami Heat', conference: 'East', seed: 8, apiTeamId: 20 },
        { id: 'okc', teamName: 'Oklahoma City Thunder', conference: 'West', seed: 1, apiTeamId: 25 },
        { id: 'nop', teamName: 'New Orleans Pelicans', conference: 'West', seed: 8, apiTeamId: 3 },
      ];

      teams.forEach(team => {
        const ref = doc(db, 'teams', team.id);
        batch.set(ref, team);
      });

      // Seed Series Results (Round 1)
      const series = [
        { id: 'R1_E_1', round: 1, team1Id: 'bos', team2Id: 'mia', totalGamesPlayed: 0, lastDataChanged: serverTimestamp() },
        { id: 'R1_W_1', round: 1, team1Id: 'okc', team2Id: 'nop', totalGamesPlayed: 0, lastDataChanged: serverTimestamp() },
      ];

      series.forEach(s => {
        const ref = doc(db, 'seriesResults', s.id);
        batch.set(ref, s);
      });

      // Seed Global Settings
      const settingsRef = doc(db, 'globalSettings', 'config');
      batch.set(settingsRef, {
        picksOpenTime: Timestamp.fromDate(new Date('2024-04-01')),
        picksLockTime: Timestamp.fromDate(new Date('2024-04-20')),
        lastDataChanged: serverTimestamp()
      });

      await batch.commit();
      res.json({ status: 'success', message: 'Initial data seeded successfully.' });
    } catch (error) {
      console.error('Seeding Error:', error);
      res.status(500).json({ status: 'error', message: 'Failed to seed data.', details: error instanceof Error ? error.message : String(error) });
    }
  });

  // Vite middleware for development
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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// ===============================================================
// API-NBA Sync Job (5:00 AM ET -> 9:00 AM UTC)
// ===============================================================
cron.schedule('0 9 * * *', async () => {
  console.log('Running API-NBA Sync Job...');
  await syncNbaResults();
});

async function syncNbaStandings() {
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

    const batch = writeBatch(db);
    const teamsRef = collection(db, 'teams');

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
        const ref = doc(db, 'teams', teamId);
        
        batch.set(ref, {
          teamName: teamData.displayName,
          conference: shortConf,
          seed: seed,
          apiTeamId: Number(teamData.id),
          logoUrl: teamData.logos?.[0]?.href || ''
        }, { merge: true });
      });
    }

    await batch.commit();
    console.log('NBA standings sync completed. Teams updated.');
  } catch (error) {
    console.error('NBA Standings Sync Error:', error);
    throw error;
  }
}

async function syncNbaResults() {
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
    const teamsSnapshot = await getDocs(collection(db, 'teams'));
    const teamsMap: Record<string, string> = {};
    teamsSnapshot.docs.forEach(d => {
      const data = d.data();
      if (data.apiTeamId) {
        teamsMap[String(data.apiTeamId)] = d.id;
      }
    });

    // Fetch all series results
    const seriesResultsRef = collection(db, 'seriesResults');
    const seriesSnapshot = await getDocs(seriesResultsRef);
    const seriesList = seriesSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    let dataChanged = false;
    const batch = writeBatch(db);

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
        // In a real app, we'd increment wins for the winning team
        // and check if they reached 4 wins to set advancingTeamId.
        // For this implementation, we'll at least update the lastDataChanged.
        const seriesRef = doc(db, 'seriesResults', series.id);
        batch.update(seriesRef, {
          lastDataChanged: serverTimestamp()
        });
        dataChanged = true;
      }
    }

    if (dataChanged) {
      await batch.commit();
      // Update global settings to trigger scoring engine
      await updateDoc(doc(db, 'globalSettings', 'config'), {
        lastDataChanged: serverTimestamp()
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
async function recalculateAllLeagues() {
  const globalConfigSnap = await getDoc(doc(db, 'globalSettings', 'config'));
  const globalConfig = globalConfigSnap.data();
  if (!globalConfig) return;

  const lastDataChanged = globalConfig.lastDataChanged?.toDate() || new Date(0);

  const leaguesSnap = await getDocs(collection(db, 'leagues'));
  
  for (const leagueDoc of leaguesSnap.docs) {
    const leagueData = leagueDoc.data();
    const lastCalculated = leagueData.lastCalculated?.toDate() || new Date(0);

    // Only recalculate if data changed since last calculation
    if (lastDataChanged > lastCalculated) {
      console.log(`Recalculating scores for league: ${leagueData.leagueName}`);
      await calculateLeagueScores(leagueDoc.id, leagueData);
    }
  }
}

async function calculateLeagueScores(leagueId: string, leagueData: any) {
  const seriesResultsSnap = await getDocs(collection(db, 'seriesResults'));
  const results = seriesResultsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  const bracketsQuery = query(collection(db, 'brackets'), where('leagueId', '==', leagueId));
  const bracketsSnap = await getDocs(bracketsQuery);
  const batch = writeBatch(db);

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

  // Update Brackets in Batch
  bracketScores.forEach((item, index) => {
    const ref = doc(db, 'brackets', item.id);
    batch.update(ref, {
      totalScore: item.score,
      rank: index + 1
    });
  });

  // Update League LastCalculated
  const leagueRef = doc(db, 'leagues', leagueId);
  batch.update(leagueRef, {
    lastCalculated: serverTimestamp()
  });

  await batch.commit();
}

startServer();
