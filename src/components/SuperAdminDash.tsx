import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, doc, getDocs, getDoc, setDoc, updateDoc, query, orderBy, writeBatch, deleteDoc, Timestamp, where, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { Team, Conference, GlobalSettings, SeriesResult, PickStatus } from '../types/database';
import { Shield, Users, Calendar, Trophy, Save, AlertTriangle, Plus, Trash2, Eye, Pencil, History } from 'lucide-react';

export const SuperAdminDash: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<Record<string, any>>({});
  const [selectedLeagueForPlayers, setSelectedLeagueForPlayers] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [confirmRemoveParticipantId, setConfirmRemoveParticipantId] = useState<string | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [openTimeStr, setOpenTimeStr] = useState('');
  const [lockTimeStr, setLockTimeStr] = useState('');
  const [series, setSeries] = useState<SeriesResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncDate, setSyncDate] = useState('');
  const [syncingStandings, setSyncingStandings] = useState(false);
  const [clearingPicks, setClearingPicks] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showInitConfirm, setShowInitConfirm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [removingParticipant, setRemovingParticipant] = useState<string | null>(null);
  const [unmatchedGames, setUnmatchedGames] = useState<string[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning' | 'info', text: string } | null>(null);

  useEffect(() => {
    const formatDateForInput = (date: Date) => {
      const offset = date.getTimezoneOffset() * 60000;
      return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    };

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      const userMap: Record<string, any> = {};
      snap.forEach(doc => {
        userMap[doc.id] = doc.data();
      });
      setAllUsers(userMap);
    });

    const unsubTeams = onSnapshot(query(collection(db, 'teams'), orderBy('seed', 'asc')), (snap) => {
      setTeams(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team)));
    });

    const unsubSeries = onSnapshot(collection(db, 'seriesResults'), (snap) => {
      setSeries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SeriesResult)));
    });

    const fetchData = async () => {
      try {
        const leaguesSnap = await getDocs(collection(db, 'leagues'));
        const settingsRef = doc(db, 'globalSettings', 'config');
        const settingsSnap = await getDoc(settingsRef);

        setLeagues(leaguesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          const openDate = data.picksOpenTime.toDate();
          const lockDate = data.picksLockTime.toDate();
          setSettings({
            picksOpenTime: openDate,
            picksLockTime: lockDate
          });
          setOpenTimeStr(formatDateForInput(openDate));
          setLockTimeStr(formatDateForInput(lockDate));
        } else {
          // Default settings if none exist
          const openDate = new Date();
          const lockDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          setSettings({
            picksOpenTime: openDate,
            picksLockTime: lockDate
          });
          setOpenTimeStr(formatDateForInput(openDate));
          setLockTimeStr(formatDateForInput(lockDate));
        }
      } catch (error) {
        console.error("Error fetching admin data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();

    return () => {
      unsubUsers();
      unsubTeams();
      unsubSeries();
    };
  }, []);

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const openDate = new Date(openTimeStr);
    const lockDate = new Date(lockTimeStr);

    // Validate dates
    if (isNaN(openDate.getTime()) || isNaN(lockDate.getTime())) {
      setMessage({ type: 'error', text: 'Please enter valid dates for all deadlines.' });
      return;
    }

    try {
      const settingsRef = doc(db, 'globalSettings', 'config');
      await setDoc(settingsRef, {
        picksOpenTime: openDate,
        picksLockTime: lockDate,
        lastDataChanged: new Date()
      });
      setSettings({ picksOpenTime: openDate, picksLockTime: lockDate });
      setMessage({ type: 'success', text: 'Global settings updated successfully.' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update settings.' });
    }
  };

  const handleUpdateTeam = async (team: Team) => {
    try {
      await updateDoc(doc(db, 'teams', team.id), { ...team });
      setMessage({ type: 'success', text: `Team ${team.teamName} updated.` });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update team.' });
    }
  };

  const handleManualOverride = async (seriesId: string, winnerId: string) => {
    try {
      await updateDoc(doc(db, 'seriesResults', seriesId), {
        advancingTeamId: winnerId,
        lastDataChanged: serverTimestamp()
      });
      setMessage({ type: 'success', text: 'Series result overridden successfully.' });
      
      // Auto-trigger progression
      setTimeout(() => handleRecalculateProgression(), 500);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to override series.' });
    }
  };

  const handleRecalculateProgression = async () => {
    setSyncing(true);
    try {
      console.log("Admin: Recalculating bracket progression...");
      const seriesSnap = await getDocs(collection(db, 'seriesResults'));
      const allSeries = seriesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const batch = writeBatch(db);
      let updatesCount = 0;

      const updateSeries = (id: string, t1?: string, t2?: string) => {
        const s = allSeries.find(x => x.id === id);
        if (!s) return;
        const updates: any = {};
        if (t1 !== undefined && (!s.team1Id || s.team1Id !== t1)) updates.team1Id = t1;
        if (t2 !== undefined && (!s.team2Id || s.team2Id !== t2)) updates.team2Id = t2;
        
        if (Object.keys(updates).length > 0) {
          batch.update(doc(db, 'seriesResults', id), { ...updates, lastDataChanged: serverTimestamp() });
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
        console.log(`Admin: Progression updated (${updatesCount} matches).`);
      }
    } catch (error) {
      console.error("Progression Error:", error);
    } finally {
      setSyncing(false);
    }
  };

  const recalculateAllScores = async (passedSeries?: SeriesResult[]) => {
    console.log('Admin: Starting client-side score recalculation...');
    const leaguesSnap = await getDocs(collection(db, 'leagues'));
    
    let seriesResults: any[] = [];
    if (passedSeries && passedSeries.length > 0) {
      seriesResults = passedSeries;
    } else {
      const seriesResultsSnap = await getDocs(collection(db, 'seriesResults'));
      seriesResults = seriesResultsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    const legacyMap: Record<string, string> = {
      'R1_E_1': 'R1_E_1v8', 'R1_E_2': 'R1_E_4v5', 'R1_E_3': 'R1_E_3v6', 'R1_E_4': 'R1_E_2v7',
      'R1_W_1': 'R1_W_1v8', 'R1_W_2': 'R1_W_4v5', 'R1_W_3': 'R1_W_3v6', 'R1_W_4': 'R1_W_2v7',
      'R2_E_1': 'R2_E_M1', 'R2_E_2': 'R2_E_M2',
      'R2_W_1': 'R2_W_M1', 'R2_W_2': 'R2_W_M2',
      'CF_E': 'R3_E_CF', 'CF_W': 'R3_W_CF',
      'FINALS': 'R4_Finals'
    };

    for (const leagueDoc of leaguesSnap.docs) {
      const leagueId = leagueDoc.id;
      const leagueData = leagueDoc.data();
      console.log(`- Calculating scores for league: ${leagueData.name || leagueId}`);
      
      const bracketsQuery = query(collection(db, 'brackets'), where('leagueId', '==', leagueId));
      const bracketsSnap = await getDocs(bracketsQuery);
      
      const scores: { id: string, score: number, tiebreakerDiff: number, updatedPicks: any[], updatedPlayInPicks: any[], roundScores: any }[] = [];
      
      for (const bDoc of bracketsSnap.docs) {
        const b = bDoc.data();
        let s = 0;
        const currentRoundScores = { playIn: 0, r1: 0, r2: 0, cf: 0, finals: 0 };
        const updatedPicks = Array.isArray(b.picks) ? [...b.picks] : [];
        const updatedPlayInPicks = Array.isArray(b.playInPicks) ? [...b.playInPicks] : [];

        if (leagueData.pointConfig) {
          updatedPicks.forEach((p: any) => {
            const actualId = legacyMap[p.matchupId] || p.matchupId;
            const res = seriesResults.find((r: any) => r.id === actualId) as any;
            
            if (res?.advancingTeamId) {
              // Infer round if missing
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

                // Track round scores
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

          // Play-In Picks
          if (leagueData.pointConfig?.playIn) {
            updatedPlayInPicks.forEach((p: any) => {
              const actualId = legacyMap[p.matchupId] || p.matchupId;
              const res = seriesResults.find((r: any) => r.id === actualId) as any;
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

        const actualFinalsPoints = (seriesResults.find((r: any) => r.round === 4) as any)?.actualFinalsTotalPoints || 0;
        scores.push({ 
          id: bDoc.id, 
          score: s, 
          tiebreakerDiff: Math.abs((b.tiebreakerPrediction || 0) - actualFinalsPoints),
          updatedPicks,
          updatedPlayInPicks,
          roundScores: currentRoundScores
        });
      }

      // Sort by score then tiebreaker
      scores.sort((a, b) => (b.score - a.score) || (a.tiebreakerDiff - b.tiebreakerDiff));

      // Batch update results in chunks of 50
      for (let i = 0; i < scores.length; i += 50) {
        const scoreBatch = writeBatch(db);
        scores.slice(i, i + 50).forEach((item, idx) => {
          scoreBatch.update(doc(db, 'brackets', item.id), { 
            totalScore: item.score, 
            rank: i + idx + 1,
            picks: item.updatedPicks,
            playInPicks: item.updatedPlayInPicks,
            roundScores: item.roundScores
          });
        });
        await scoreBatch.commit();
      }
    
      await updateDoc(doc(db, 'leagues', leagueId), { 
        lastCalculated: serverTimestamp() 
      });
    }
  };

  const processNbaGamesBatch = async (games: any[], currentSeries: SeriesResult[], currentTeams: Team[]) => {
    if (!games || games.length === 0) return { matchedCount: 0, unmatched: [], updatedSeries: currentSeries };
    
    const batch = writeBatch(db);
    let matchedCount = 0;
    const localUnmatched: string[] = [];
    
    // Use the passed in state to track updates across multiple calls
    const localSeriesState = [...currentSeries];
    const seriesUpdates: Record<string, any> = {};

    console.log(`Processing batch of ${games.length} games...`);

    for (const game of games) {
      let seriesId = game.seriesId;
      let winnerId = game.winnerId;
      const gameApiDate = game.date || "Unknown Date";
      
      // If server already mapped it, we still should double check if winner is logic
      // But if server didn't map it, we try our best here.
      
      // Extract competitors
      let comps: any[] = [];
      if (Array.isArray(game.competitions) && game.competitions[0]?.competitors) {
        comps = game.competitions[0].competitors;
      } else if (game.competitions?.competitors && Array.isArray(game.competitions.competitors)) {
        comps = game.competitions.competitors;
      } else if (Array.isArray(game.competitors)) {
        comps = game.competitors;
      } else {
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
        comps = findCompetitors(game) || [];
      }

      const t1Display = comps[0]?.team?.displayName || comps[0]?.displayName || "Team 1";
      const t2Display = comps[1]?.team?.displayName || comps[1]?.displayName || "Team 2";
      const gameName = game.name || `${t1Display} vs ${t2Display}`;

      // Mapping logic for raw games (or verification)
      if (comps.length >= 2) {
        const win = comps.find((c: any) => 
          c.winner === true || 
          (c.score && Number(c.score) > Number(comps.find((o: any) => String(o.id || o.team?.id) !== String(c.id || c.team?.id))?.score))
        );
        const lose = comps.find((c: any) => 
          c.winner === false || 
          (c.score && Number(c.score) < Number(comps.find((o: any) => String(o.id || o.team?.id) !== String(c.id || c.team?.id))?.score))
        );
        
        if (win && lose) {
          const winApiId = Number(win.id || win.team?.id);
          const loseApiId = Number(lose.id || lose.team?.id);
          const winTeam = currentTeams.find(t => Number(t.apiTeamId) === winApiId);
          const loseTeam = currentTeams.find(t => Number(t.apiTeamId) === loseApiId);
          
          if (winTeam && loseTeam) {
            console.log(`Mapped game: ${winTeam.teamName} beat ${loseTeam.teamName} on ${gameApiDate}`);
            // Overwrite winnerId with mapped local team ID
            winnerId = winTeam.id;
            const loserId = loseTeam.id;

            // Find matching series if seriesId is missing or needs validation
            const match = localSeriesState.find(s => {
              const s1 = String(s.team1Id).toLowerCase();
              const s2 = String(s.team2Id).toLowerCase();
              const w = String(winTeam.id).toLowerCase();
              const l = String(loseTeam.id).toLowerCase();
              return (s1 === w && s2 === l) || (s1 === l && s2 === w);
            });

            if (match) {
              if (!seriesId) seriesId = match.id;
            } else {
              if (!seriesId) {
                localUnmatched.push(`${gameName} - No series contains both ${winTeam.teamName} and ${loseTeam.teamName} (IDs: ${winTeam.id} vs ${loseTeam.id})`);
              }
            }
          } else {
            if (!seriesId) {
              localUnmatched.push(`${gameName} - Could not map API team IDs (${winApiId} vs ${loseApiId}) to any existing teams in database.`);
            }
          }
        }
      }

      if (seriesId) {
        const matchIdx = localSeriesState.findIndex(s => s.id === seriesId);
        if (matchIdx !== -1) {
          const matchData = localSeriesState[matchIdx];
          const gameIdForSync = game.gameId || String(game.id || game.uid || Math.random());
          const playedGameIds = Array.isArray(matchData.playedGameIds) ? matchData.playedGameIds : [];
          
          if (!playedGameIds.includes(gameIdForSync)) {
            // Check if winnerId actually belongs to this series
            if (winnerId !== matchData.team1Id && winnerId !== matchData.team2Id) {
              console.warn(`Game marked winner as ${winnerId} but series ${seriesId} is ${matchData.team1Id} vs ${matchData.team2Id}`);
              localUnmatched.push(`${gameName} - Winner ID ${winnerId} does not match any team in series ${seriesId}`);
              continue;
            }

            matchedCount++;
            let t1w = Number(matchData.team1Wins) || 0;
            let t2w = Number(matchData.team2Wins) || 0;
            
            if (winnerId === matchData.team1Id) t1w++;
            else t2w++;

            const newPlayedIds = [...playedGameIds, gameIdForSync];
            const updates: any = {
              team1Wins: t1w,
              team2Wins: t2w,
              playedGameIds: newPlayedIds,
              lastDataChanged: serverTimestamp()
            };

            const isPlayIn = seriesId.startsWith('PI_');
            const winsNeeded = isPlayIn ? 1 : 4;
            if (t1w >= winsNeeded) {
              updates.advancingTeamId = matchData.team1Id;
              updates.eliminatedTeamId = matchData.team2Id;
              updates.totalGamesPlayed = t1w + t2w;
            } else if (t2w >= winsNeeded) {
              updates.advancingTeamId = matchData.team2Id;
              updates.eliminatedTeamId = matchData.team1Id;
              updates.totalGamesPlayed = t1w + t2w;
            }

            // Update local state for next games in this batch
            localSeriesState[matchIdx] = { ...matchData, ...updates };
            // Collect updates for batch write
            seriesUpdates[seriesId] = { ...(seriesUpdates[seriesId] || {}), ...updates };
          }
        }
      }
    }

    // Apply all collected updates to batch
    Object.entries(seriesUpdates).forEach(([id, updates]) => {
      batch.set(doc(db, 'seriesResults', id), updates, { merge: true });
    });

    if (matchedCount > 0) {
      batch.set(doc(db, 'globalSettings', 'config'), { lastDataChanged: serverTimestamp() }, { merge: true });
      await batch.commit();
    }

    return { matchedCount, unmatched: localUnmatched, updatedSeries: localSeriesState };
  };


  const handleSyncAndCalculate = async () => {
    setSyncing(true);
    setMessage(null);
    setUnmatchedGames([]);
    try {
      const url = syncDate ? `/api/proxy/nba-results?date=${syncDate.replace(/-/g, '')}` : '/api/proxy/nba-results';
      const syncRes = await fetch(url);
      
      const contentType = syncRes.headers.get('content-type');
      let syncData;
      if (contentType && contentType.includes('application/json')) {
        syncData = await syncRes.json();
      } else {
        const text = await syncRes.text();
        throw new Error(`NBA Service Error (${syncRes.status}): Server returned unexpected response format. This usually means the service is down.`);
      }
      
      if (!syncRes.ok) {
        if (syncRes.status === 429) {
          throw new Error(syncData.message || 'NBA API Quota Reached. Please try again tomorrow.');
        }
        if (syncRes.status === 503) {
          throw new Error(syncData.message || 'NBA Data Service is temporarily unavailable. Please try again in 5-10 minutes.');
        }
        throw new Error(syncData.message || `Request failed with status ${syncRes.status}`);
      }
      
      if (syncData.status !== 'success') throw new Error(syncData.message);
      
      const { matchedCount, unmatched, updatedSeries } = await processNbaGamesBatch(syncData.games || [], series, teams);
      setSeries(updatedSeries);
      setUnmatchedGames(unmatched);

      if (matchedCount === 0) {
        setMessage({ type: 'warning', text: `Found ${syncData.games?.length || 0} games, but 0 updates were applied (already synced or no matchup match).` });
      } else {
        // Use the updated records for recalculation
        await recalculateAllScores(updatedSeries);
        await handleRecalculateProgression();
        setMessage({ type: 'success', text: `Successfully synced ${matchedCount} games and updated scores.` });
      }
    } catch (error) {
      console.error("Sync Error:", error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to sync results.' });
    } finally {
      setSyncing(false);
    }
  };


  const handleTestApi = async () => {
    setTestingApi(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/test-api-connection');
      const contentType = res.headers.get('content-type');
      
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server returned non-JSON response (${res.status}): ${text.substring(0, 100)}...`);
      }

      if (data.status === 'success') {
        setMessage({ type: 'success', text: data.message });
      } else {
        setMessage({ type: 'error', text: `API Test Failed: ${data.message} ${data.details || ''}` });
      }
    } catch (error) {
      console.error("API Test Error:", error);
      setMessage({ type: 'error', text: `API Test Error: ${error instanceof Error ? error.message : 'Unknown error'}` });
    } finally {
      setTestingApi(false);
    }
  };

  const handleForceFullSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      // 1. Sync Standings via Proxy
      const standingsRes = await fetch('/api/proxy/nba-standings', { method: 'GET' });
      const standingsData = await standingsRes.json();
      if (standingsData.status !== 'success') throw new Error(standingsData.message);

      const updates = standingsData.updates || [];
      if (updates.length > 0) {
        const batch = writeBatch(db);
        updates.forEach((u: any) => {
          batch.set(doc(db, 'teams', u.id), u.data, { merge: true });
        });
        await batch.commit();
      }

      // 2. Run Results Sync
      await handleSyncAndCalculate();
      
      setMessage({ type: 'success', text: 'Full NBA Sync (Standings + Results) completed successfully!' });
      
      // Refresh teams list
      const teamsSnap = await getDocs(query(collection(db, 'teams'), orderBy('seed', 'asc')));
      setTeams(teamsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team)));
    } catch (error) {
      console.error("Full Sync Error:", error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to perform full sync.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncStandings = async () => {
    setSyncingStandings(true);
    setMessage(null);
    try {
      const res = await fetch('/api/proxy/nba-standings', { method: 'GET' });
      
      const contentType = res.headers.get('content-type');
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`NBA Service Error (${res.status}): Server returned unexpected response format. This usually means the service is down.`);
      }
      
      if (!res.ok) {
        if (res.status === 429) {
          throw new Error(data.message || 'NBA API Quota Reached. Please try again tomorrow.');
        }
        if (res.status === 503) {
          throw new Error(data.message || 'NBA Data Service is temporarily unavailable. Please try again in 5-10 minutes.');
        }
        throw new Error(data.message || `Request failed with status ${res.status}`);
      }

      if (data.status !== 'success') throw new Error(data.message);

      const updates = data.updates || [];
      if (updates.length > 0) {
        const batch = writeBatch(db);
        updates.forEach((u: any) => {
          batch.set(doc(db, 'teams', u.id), u.data, { merge: true });
        });
        await batch.commit();
        setMessage({ type: 'success', text: `NBA standings synced successfully! Refreshing teams...` });
      } else {
        setMessage({ type: 'success', text: 'No changes to standings.' });
      }
      
      // Refresh teams list
      const teamsSnap = await getDocs(query(collection(db, 'teams'), orderBy('seed', 'asc')));
      setTeams(teamsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team)));
    } catch (error) {
      console.error("Standings Sync Error:", error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to sync standings.' });
    } finally {
      setSyncingStandings(false);
    }
  };

  const handleInitializeSeries = async () => {
    setSyncing(true);
    setMessage(null);
    
    try {
      // 1. Always get latest teams first to avoid using stale state
      const teamsSnap = await getDocs(query(collection(db, 'teams'), orderBy('seed', 'asc')));
      const latestTeams = teamsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
      setTeams(latestTeams);

      console.log("--- INIT MATCHUPS DEBUG ---");
      console.log(`Using ${latestTeams.length} teams for initialization.`);

      const batch = writeBatch(db);
      const rounds = [
        // Play-In
        { id: 'PI_E_A', round: 0, conf: 'East', s1: 7, s2: 8 },
        { id: 'PI_E_B', round: 0, conf: 'East', s1: 9, s2: 10 },
        { id: 'PI_E_C', round: 0, conf: 'East' }, 
        { id: 'PI_W_A', round: 0, conf: 'West', s1: 7, s2: 8 },
        { id: 'PI_W_B', round: 0, conf: 'West', s1: 9, s2: 10 },
        { id: 'PI_W_C', round: 0, conf: 'West' },
        // Round 1
        { id: 'R1_E_1v8', round: 1, conf: 'East', s1: 1 },
        { id: 'R1_E_4v5', round: 1, conf: 'East', s1: 4, s2: 5 },
        { id: 'R1_E_3v6', round: 1, conf: 'East', s1: 3, s2: 6 },
        { id: 'R1_E_2v7', round: 1, conf: 'East', s1: 2 },
        { id: 'R1_W_1v8', round: 1, conf: 'West', s1: 1 },
        { id: 'R1_W_4v5', round: 1, conf: 'West', s1: 4, s2: 5 },
        { id: 'R1_W_3v6', round: 1, conf: 'West', s1: 3, s2: 6 },
        { id: 'R1_W_2v7', round: 1, conf: 'West', s1: 2 },
        { id: 'R2_E_M1', round: 2, conf: 'East' },
        { id: 'R2_E_M2', round: 2, conf: 'East' },
        { id: 'R2_W_M1', round: 2, conf: 'West' },
        { id: 'R2_W_M2', round: 2, conf: 'West' },
        { id: 'R3_E_CF', round: 3, conf: 'East' },
        { id: 'R3_W_CF', round: 3, conf: 'West' },
        { id: 'R4_Finals', round: 4, conf: 'All' }
      ];

      for (const r of rounds) {
        const ref = doc(db, 'seriesResults', r.id);
        let t1 = '';
        let t2 = '';
        
        if (r.s1) {
          const t1Obj = latestTeams.find(t => t.conference === r.conf && Number(t.seed) === r.s1);
          t1 = t1Obj?.id || '';
        }
        if (r.s2) {
          const t2Obj = latestTeams.find(t => t.conference === r.conf && Number(t.seed) === r.s2);
          t2 = t2Obj?.id || '';
        }
        
        if (t1 || t2) {
          console.log(`Initializing ${r.id}: ${t1 || 'TBD'} (Seed ${r.s1 || '?'}) vs ${t2 || 'TBD'} (Seed ${r.s2 || '?'})`);
        }

        batch.set(ref, {
          round: r.round,
          team1Id: t1,
          team2Id: t2,
          team1Wins: 0,
          team2Wins: 0,
          playedGameIds: [],
          isFinal: false,
          advancingTeamId: '',
          eliminatedTeamId: '',
          totalGamesPlayed: 0,
          lastDataChanged: serverTimestamp()
        }, { merge: true });
      }

      await batch.commit();
      setMessage({ type: 'success', text: 'Playoff series matchups initialized successfully!' });
    } catch (error) {
      console.error("Init Series Error:", error);
      setMessage({ type: 'error', text: 'Failed to initialize series.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateUser = async (userId: string) => {
    if (!editName.trim()) return;
    try {
      await updateDoc(doc(db, 'users', userId), {
        displayName: editName.trim(),
        email: editEmail.trim() || null
      });
      setEditingUserId(null);
      setMessage({ type: 'success', text: 'User updated successfully.' });
    } catch (error) {
      console.error("Update User Error:", error);
      setMessage({ type: 'error', text: 'Failed to update user.' });
    }
  };

  const handleClearAllPicks = async () => {
    setClearingPicks(true);
    setMessage(null);
    setShowClearConfirm(false);
    try {
      console.log("Admin: Fetching all brackets from client...");
      const bracketsSnap = await getDocs(collection(db, 'brackets'));
      console.log(`Found ${bracketsSnap.size} brackets.`);
      
      if (bracketsSnap.empty) {
        setMessage({ type: 'success', text: 'No picks found to clear.' });
        return;
      }

      // Delete in batches of 500 (Firestore limit)
      const docs = bracketsSnap.docs;
      let deletedCount = 0;
      
      for (let i = 0; i < docs.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + 500);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
        deletedCount += chunk.length;
        console.log(`Deleted ${deletedCount}/${docs.length} brackets...`);
      }

      // Also reset league calculation timestamps
      console.log('Resetting league calculation timestamps...');
      const leaguesSnap = await getDocs(collection(db, 'leagues'));
      const leagueBatch = writeBatch(db);
      leaguesSnap.docs.forEach(leagueDoc => {
        leagueBatch.update(leagueDoc.ref, {
          lastCalculated: new Timestamp(0, 0)
        });
      });
      await leagueBatch.commit();

      setMessage({ type: 'success', text: `Successfully cleared ${deletedCount} brackets.` });
    } catch (error) {
      console.error("Clear Picks Error:", error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to clear picks.' });
    } finally {
      setClearingPicks(false);
    }
  };

  const handleDeleteLeague = async (leagueId: string) => {
    try {
      // 1. Delete all brackets associated with this league
      const bracketsQuery = query(collection(db, 'brackets'), where('leagueId', '==', leagueId));
      const bracketsSnap = await getDocs(bracketsQuery);
      
      const batch = writeBatch(db);
      bracketsSnap.docs.forEach(d => batch.delete(d.ref));
      
      // 2. Delete the league itself
      batch.delete(doc(db, 'leagues', leagueId));
      
      await batch.commit();
      
      setLeagues(leagues.filter(l => l.id !== leagueId));
      setConfirmDeleteId(null);
      setMessage({ type: 'success', text: 'Contest and all associated picks deleted successfully.' });
    } catch (error) {
      console.error("Delete League Error:", error);
      setMessage({ type: 'error', text: 'Failed to delete contest.' });
    }
  };

  const handleRemoveParticipant = async (leagueId: string, userId: string) => {
    setRemovingParticipant(userId);
    try {
      const league = leagues.find(l => l.id === leagueId);
      if (!league) throw new Error("League not found");

      const newParticipants = (league.participants || []).filter((id: string) => id !== userId);
      
      const batch = writeBatch(db);
      
      // 1. Update league participants
      batch.update(doc(db, 'leagues', leagueId), {
        participants: newParticipants
      });

      // 2. Update user's joined leagues
      const userDocRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userDocRef);
      if (userDoc.exists()) {
        const joinedLeagues = (userDoc.data().joinedLeagueIds || []).filter((id: string) => id !== leagueId);
        batch.update(userDocRef, {
          joinedLeagueIds: joinedLeagues
        });
      }

      // 3. Delete their bracket for this league
      const bracketsQuery = query(
        collection(db, 'brackets'), 
        where('leagueId', '==', leagueId),
        where('userId', '==', userId)
      );
      const bracketsSnap = await getDocs(bracketsQuery);
      bracketsSnap.docs.forEach(d => batch.delete(d.ref));

      await batch.commit();

      setLeagues(leagues.map(l => l.id === leagueId ? { ...l, participants: newParticipants } : l));
      setConfirmRemoveParticipantId(null);
      setMessage({ type: 'success', text: 'Participant removed successfully.' });
    } catch (error) {
      console.error("Remove Participant Error:", error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to remove participant.' });
    } finally {
      setRemovingParticipant(null);
    }
  };

  if (loading) return <div className="p-8 text-orange-500 animate-pulse font-bold">Loading Super Admin Controls...</div>;

  return (
    <div className="space-y-12 max-w-5xl mx-auto pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center gap-4 border-b border-black/10 pb-6">
        <div className="bg-red-500/20 p-3 rounded-2xl border border-red-500/50">
          <Shield className="w-8 h-8 text-red-500" />
        </div>
        <div>
          <h1 className="text-4xl font-black uppercase italic tracking-tighter text-gray-900">Super Admin <span className="text-red-500">Command</span></h1>
          <p className="text-gray-500 font-medium uppercase tracking-widest text-xs">Global Tournament Configuration</p>
          <div className="mt-2">
            <a 
              href="/league/preview?preview=true" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[10px] font-black uppercase tracking-widest text-orange-500 hover:underline flex items-center gap-1"
            >
              <Eye className="w-3 h-3" /> Preview Leaderboard UI
            </a>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button 
            onClick={handleTestApi}
            disabled={testingApi || syncing}
            className={`px-4 py-3 rounded-2xl font-black uppercase italic tracking-tighter transition-all flex items-center gap-2 ${testingApi ? 'bg-white/10 text-gray-500 cursor-not-allowed' : 'bg-black/5 hover:bg-black/10 text-gray-600 border border-black/10'}`}
          >
            {testingApi ? (
              <>
                <div className="w-3 h-3 border-2 border-gray-400/30 border-t-gray-400 rounded-full animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                Test API
              </>
            )}
          </button>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-1">Sync Date (Optional)</label>
            <input 
              type="date"
              value={syncDate}
              onChange={(e) => setSyncDate(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs bg-black/5 border border-black/10 outline-none focus:border-orange-500/50"
            />
            <p className="text-[9px] text-gray-400 mt-1 italic px-1">Manual sync defaults to yesterday if date is empty.</p>
          </div>
          <div className="flex flex-col gap-2">
            <button 
              onClick={handleSyncAndCalculate}
              disabled={syncing}
              className={`px-6 py-3 rounded-2xl font-black uppercase italic tracking-tighter transition-all flex items-center gap-3 ${syncing ? 'bg-white/10 text-gray-500 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20'}`}
            >
              {syncing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Trophy className="w-5 h-5" />
                  Sync Results & Score
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 bg-orange-500/5 border border-orange-500/20 p-4 rounded-2xl">
        <div className="bg-orange-500/20 p-2 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900">Utility Actions</p>
          <p className="text-xs text-gray-500 font-medium">Use these during initial setup or to force updates.</p>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={async () => {
              setSyncing(true);
              setMessage({ type: 'info', text: 'Starting full manual recalculation...' });
              try {
                await recalculateAllScores();
                await handleRecalculateProgression();
                setMessage({ type: 'success', text: 'Full recalculation complete. All user brackets and scores are now up to date.' });
              } catch (err: any) {
                console.error("Recalc Error:", err);
                setMessage({ type: 'error', text: 'Recalculation failed: ' + err.message });
              } finally {
                setSyncing(false);
              }
            }}
            disabled={syncing}
            className="px-4 py-2 bg-white/50 hover:bg-white text-blue-600 border border-blue-200 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
          >
            Force Recalculate Scores
          </button>

          {showInitConfirm ? (
            <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
              <p className="text-[10px] font-bold text-orange-600 uppercase tracking-tighter">Reset all series to 0-0?</p>
              <button 
                onClick={() => {
                  handleInitializeSeries();
                  setShowInitConfirm(false);
                }}
                disabled={syncing}
                className="px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-orange-700 transition-all shadow-lg shadow-orange-500/20"
              >
                Confirm
              </button>
              <button 
                onClick={() => setShowInitConfirm(false)}
                className="px-4 py-2 bg-black/5 hover:bg-black/10 text-gray-500 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button 
              onClick={() => setShowInitConfirm(true)}
              disabled={syncing}
              className="px-4 py-2 bg-white/50 hover:bg-white text-orange-600 border border-orange-200 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
            >
              Init Matchups
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={`p-6 rounded-3xl border animate-in zoom-in-95 duration-300 shadow-xl ${
          message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 
          message.type === 'error' ? 'bg-red-500/10 border-red-500/50 text-red-400' :
          message.type === 'warning' ? 'bg-amber-500/10 border-amber-500/50 text-amber-400' :
          'bg-blue-500/10 border-blue-500/50 text-blue-400'
        }`}>
          <div className="flex items-center gap-4 font-bold mb-3">
            <div className={`p-2 rounded-xl ${
              message.type === 'success' ? 'bg-emerald-500/20' : 
              message.type === 'error' ? 'bg-red-500/20' :
              message.type === 'warning' ? 'bg-amber-500/20' :
              'bg-blue-500/20'
            }`}>
              {message.type === 'success' ? <Trophy className="w-5 h-5" /> : 
               message.type === 'error' ? <Shield className="w-5 h-5" /> :
               <AlertTriangle className="w-5 h-5" />}
            </div>
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-[0.2em] opacity-60 leading-none mb-1">{message.type}</span>
              <span className="text-xl leading-none">{message.text}</span>
            </div>
          </div>
          
          {(unmatchedGames.length > 0 && (message.type === 'error' || message.type === 'warning')) && (
            <div className="mt-6 pt-6 border-t border-red-500/20">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] uppercase tracking-widest font-black text-red-500 bg-red-500/10 px-2 py-0.5 rounded">Unmatched API Games</span>
                <span className="text-[10px] font-bold opacity-50 uppercase tracking-widest">{unmatchedGames.length} Identified</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {unmatchedGames.map((g, i) => (
                  <div key={i} className="bg-black/20 border border-white/5 p-3 rounded-xl flex items-center justify-between group hover:border-red-500/30 transition-all">
                    <span className="text-sm font-mono text-gray-400 group-hover:text-red-400 whitespace-nowrap overflow-hidden text-ellipsis mr-2">{g}</span>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-[11px] leading-relaxed text-gray-500 font-medium max-w-lg">
                <strong className="text-red-400 uppercase tracking-wider mr-1">Troubleshooting:</strong> 
                These games exist on the NBA API but aren't mapped to a series in your database. 
                This usually means these are <span className="text-orange-500 underline decoration-orange-500/30 decoration-2 underline-offset-2">Play-In Tournament</span> games which aren't part of the standard 1-8 seed bracket, or your teams have incorrect API IDs.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Global Settings */}
        <section className="bg-white/70 backdrop-blur-xl border border-black/10 rounded-3xl p-8 space-y-6">
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="w-6 h-6 text-orange-500" />
            <h2 className="text-xl font-bold uppercase italic text-gray-900">Global Deadlines</h2>
          </div>
          <form onSubmit={handleUpdateSettings} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Picks Open Time</label>
              <input 
                type="datetime-local" 
                value={openTimeStr}
                onChange={(e) => setOpenTimeStr(e.target.value)}
                className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm focus:border-orange-500/50 outline-none text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Picks Lock Time</label>
              <input 
                type="datetime-local" 
                value={lockTimeStr}
                onChange={(e) => setLockTimeStr(e.target.value)}
                className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm focus:border-orange-500/50 outline-none text-gray-900"
              />
            </div>
            <button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
              <Save className="w-4 h-4" /> Save Deadlines
            </button>
          </form>
        </section>

        {/* Manual Override */}
        <section className="bg-white/70 backdrop-blur-xl border border-black/10 rounded-3xl p-8 space-y-6">
          <div className="flex items-center gap-3 mb-4">
            <Trophy className="w-6 h-6 text-orange-500" />
            <h2 className="text-xl font-bold uppercase italic text-gray-900">Manual Overrides</h2>
          </div>
          <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
            {series.map(s => (
              <div key={s.id} className="p-4 bg-black/5 border border-black/5 rounded-xl flex items-center justify-between gap-4">
                <div className="text-xs font-bold text-gray-400 uppercase">{s.id}</div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleManualOverride(s.id, s.team1Id)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${s.advancingTeamId === s.team1Id ? 'bg-orange-500 text-white' : 'bg-black/5 hover:bg-black/10'}`}
                  >
                    {s.team1Id}
                  </button>
                  <button 
                    onClick={() => handleManualOverride(s.id, s.team2Id)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${s.advancingTeamId === s.team2Id ? 'bg-orange-500 text-white' : 'bg-black/5 hover:bg-black/10'}`}
                  >
                    {s.team2Id}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* User Management */}
      <section className="bg-white/70 backdrop-blur-xl border border-black/10 rounded-3xl p-8 space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <Users className="w-6 h-6 text-orange-500" />
          <h2 className="text-xl font-bold uppercase italic text-gray-900">User Management</h2>
        </div>
        <p className="text-[10px] text-gray-500 italic mb-4">
          Note: Emails are populated automatically when users log in. If a user hasn't logged in since the email tracking update, their email will show as "No Email". You can manually add/edit them by clicking the pencil icon.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar p-1">
          {Object.values(allUsers).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')).map((user: any) => (
            <div key={user.uid} className="p-4 bg-black/5 rounded-2xl border border-black/5 flex items-center justify-between group hover:border-orange-500/30 transition-all">
              <div className="flex flex-col min-w-0">
                {editingUserId === user.uid ? (
                  <div className="flex flex-col gap-2">
                    <input 
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Display Name"
                      className="bg-white border border-black/10 rounded-lg px-2 py-1 text-sm font-bold outline-none focus:border-orange-500 w-full"
                      autoFocus
                    />
                    <input 
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="Email Address"
                      className="bg-white border border-black/10 rounded-lg px-2 py-1 text-[10px] font-mono outline-none focus:border-orange-500 w-full"
                    />
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleUpdateUser(user.uid)}
                        className="flex-1 bg-orange-500 text-white text-[10px] font-black uppercase py-1 rounded-lg hover:bg-orange-600 transition-all"
                      >
                        Save
                      </button>
                      <button 
                        onClick={() => setEditingUserId(null)}
                        className="flex-1 bg-black/5 text-gray-500 text-[10px] font-black uppercase py-1 rounded-lg hover:bg-black/10 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-gray-900 uppercase italic truncate">{user.displayName}</span>
                      <button 
                        onClick={() => {
                          setEditingUserId(user.uid);
                          setEditName(user.displayName);
                          setEditEmail(user.email || '');
                        }}
                        className="p-1 text-gray-400 hover:text-orange-500 transition-all"
                        title="Edit User"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="text-[10px] font-mono text-gray-400 truncate">{user.email || 'No Email'}</span>
                  </>
                )}
              </div>
              <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 bg-black/5 px-2 py-1 rounded shrink-0 ml-2">
                {user.systemRole === 'SuperAdmin' ? 'ADMIN' : 'USER'}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Team Seeding */}
      <section className="bg-white/70 backdrop-blur-xl border border-black/10 rounded-3xl p-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Users className="w-6 h-6 text-orange-500" />
            <h2 className="text-xl font-bold uppercase italic text-gray-900">Team Seeding (1-10)</h2>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleSyncStandings}
              disabled={syncingStandings}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${syncingStandings ? 'bg-white/10 text-gray-500 cursor-not-allowed' : 'bg-orange-500/10 text-orange-500 border border-orange-500/30 hover:bg-orange-500/20'}`}
            >
              {syncingStandings ? (
                <>
                  <div className="w-3 h-3 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" /> Sync Standings
                </>
              )}
            </button>
            <button className="bg-black/5 hover:bg-black/10 border border-black/10 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Team
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {['East', 'West'].map(conf => (
            <div key={conf} className="space-y-4">
              <h3 className={`text-sm font-black uppercase tracking-[0.2em] pb-2 border-b border-white/5 ${conf === 'East' ? 'text-blue-500' : 'text-red-500'}`}>{conf} Conference</h3>
              <div className="space-y-3">
                {teams.filter(t => t.conference === conf).map(team => (
                  <div key={team.id} className="flex items-center gap-3 bg-black/5 p-3 rounded-xl border border-black/5 group">
                    <span className="text-xs font-black text-gray-600 w-4">{team.seed}</span>
                    <input 
                      type="text" 
                      value={team.teamName}
                      onChange={(e) => {
                        const newTeams = teams.map(t => t.id === team.id ? { ...t, teamName: e.target.value } : t);
                        setTeams(newTeams);
                      }}
                      className="flex-1 bg-transparent border-none text-sm font-bold focus:outline-none"
                    />
                    <input 
                      type="text" 
                      value={team.abbreviation || ''}
                      placeholder="ABB"
                      onChange={(e) => {
                        const newTeams = teams.map(t => t.id === team.id ? { ...t, abbreviation: e.target.value.toUpperCase() } : t);
                        setTeams(newTeams);
                      }}
                      className="w-10 bg-white/5 border border-white/10 rounded px-1 py-1 text-[10px] font-mono placeholder:text-gray-600"
                    />
                    <input 
                      type="number" 
                      value={team.apiTeamId}
                      onChange={(e) => {
                        const newTeams = teams.map(t => t.id === team.id ? { ...t, apiTeamId: parseInt(e.target.value) } : t);
                        setTeams(newTeams);
                      }}
                      className="w-12 bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] font-mono"
                    />
                    <button 
                      onClick={() => handleUpdateTeam(team)}
                      className="opacity-0 group-hover:opacity-100 p-2 hover:text-orange-500 transition-all"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Contest Management */}
      <section className="bg-white/70 backdrop-blur-xl border border-black/10 rounded-3xl p-8">
        <div className="flex items-center gap-3 mb-8">
          <Trophy className="w-6 h-6 text-orange-500" />
          <h2 className="text-xl font-bold uppercase italic text-gray-900">Contest Management</h2>
        </div>
        
        <div className="space-y-4">
          {leagues.length === 0 ? (
            <p className="text-gray-500 text-sm italic">No active contests found.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {leagues.map(league => (
                <div key={league.id} className="space-y-2">
                  <div className="p-4 bg-black/5 border border-black/5 rounded-2xl flex items-center justify-between group">
                    <div>
                      <h3 className="text-sm font-black uppercase italic text-gray-900">{league.leagueName}</h3>
                      <div className="flex flex-col">
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                          Comm: {league.commissionerName || 'Unknown'} <span className="text-gray-400">({allUsers[league.commissionerId]?.email || 'No Email'})</span>
                        </p>
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                          Code: {league.inviteCode} • {league.participants?.length || 0} Players
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setSelectedLeagueForPlayers(selectedLeagueForPlayers === league.id ? null : league.id)}
                        className={`p-2 transition-colors ${selectedLeagueForPlayers === league.id ? 'text-orange-500' : 'text-gray-400 hover:text-orange-500'}`}
                        title="Manage Participants"
                      >
                        <Users className="w-5 h-5" />
                      </button>
                      {confirmDeleteId === league.id ? (
                        <div className="flex items-center gap-2 animate-in fade-in zoom-in duration-300">
                          <button 
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[10px] font-bold text-gray-500 hover:text-gray-900"
                          >
                            Cancel
                          </button>
                          <button 
                            onClick={() => handleDeleteLeague(league.id)}
                            className="bg-red-500 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-lg hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
                          >
                            Confirm Delete
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => setConfirmDeleteId(league.id)}
                          className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                          title="Delete Contest"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Participant Management Sub-panel */}
                  {selectedLeagueForPlayers === league.id && (
                    <div className="p-4 bg-white/50 border border-black/5 rounded-2xl animate-in slide-in-from-top-2 duration-300">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">Manage Participants</h4>
                      <div className="space-y-2">
                        {(league.participants || []).length === 0 ? (
                          <p className="text-[10px] text-gray-400 italic">No participants in this league.</p>
                        ) : (
                          league.participants.map((uid: string) => (
                            <div key={uid} className="flex items-center justify-between p-2 bg-black/5 rounded-xl group/player">
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-bold text-gray-900 truncate">{allUsers[uid]?.displayName || 'Unknown User'}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[8px] font-mono text-gray-400 truncate">{allUsers[uid]?.email || 'No Email'}</span>
                                  <span className="text-[7px] font-mono text-gray-300">({uid.slice(0, 6)}...)</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {confirmRemoveParticipantId === `${league.id}_${uid}` ? (
                                  <div className="flex items-center gap-2 animate-in fade-in zoom-in duration-300">
                                    <button 
                                      onClick={() => setConfirmRemoveParticipantId(null)}
                                      className="text-[8px] font-bold text-gray-500 hover:text-gray-900"
                                    >
                                      Cancel
                                    </button>
                                    <button 
                                      onClick={() => handleRemoveParticipant(league.id, uid)}
                                      disabled={removingParticipant === uid}
                                      className="bg-red-500 text-white text-[8px] font-black uppercase px-2 py-1 rounded-md hover:bg-red-600 transition-all disabled:opacity-50 flex items-center gap-1"
                                    >
                                      {removingParticipant === uid ? (
                                        <>
                                          <div className="w-2 h-2 border border-white/30 border-t-white rounded-full animate-spin" />
                                          ...
                                        </>
                                      ) : 'Confirm'}
                                    </button>
                                  </div>
                                ) : (
                                  <button 
                                    onClick={() => setConfirmRemoveParticipantId(`${league.id}_${uid}`)}
                                    className="opacity-0 group-hover/player:opacity-100 p-1.5 text-gray-400 hover:text-red-500 transition-all"
                                    title="Remove Participant"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Danger Zone */}
      <section className="bg-red-500/5 border border-red-500/20 rounded-3xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <AlertTriangle className="w-6 h-6 text-red-500" />
          <h2 className="text-xl font-bold uppercase italic text-red-500">Danger Zone</h2>
        </div>
        
        <div className="bg-black/5 border border-red-500/10 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-gray-900">Reset All Contestant Picks</h3>
            <p className="text-sm text-gray-500 max-w-md">
              Permanently deletes every bracket and pick in the system. Use this to clear test data before the official tournament begins.
            </p>
          </div>
          
          {showClearConfirm ? (
            <div className="flex items-center gap-3 animate-in fade-in zoom-in duration-300">
              <button 
                onClick={() => setShowClearConfirm(false)}
                className="px-6 py-3 rounded-xl text-xs font-bold text-gray-500 hover:text-gray-900 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={handleClearAllPicks}
                disabled={clearingPicks}
                className="px-6 py-3 rounded-xl bg-red-500 text-white text-xs font-black uppercase italic tracking-tighter hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
              >
                {clearingPicks ? 'Clearing...' : 'Yes, Wipe Everything'}
              </button>
            </div>
          ) : (
            <button 
              onClick={() => setShowClearConfirm(true)}
              className="px-8 py-4 rounded-2xl font-black uppercase italic tracking-tighter transition-all flex items-center gap-3 bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white shadow-lg shadow-red-500/5"
            >
              <Trash2 className="w-5 h-5" />
              Wipe All Picks
            </button>
          )}
        </div>
      </section>
    </div>
  );
};
