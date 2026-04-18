import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { db } from '../firebase';
import { collection, query, where, orderBy, onSnapshot, getDocs, doc } from 'firebase/firestore';
import { Bracket, User, League, Team, PickStatus, SeriesResult, Conference } from '../types/database';
import { Trophy, Medal, ChevronRight, Hash, Eye, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface LeaderboardProps {
  leagueId: string;
}

interface LeaderboardEntry extends Bracket {
  userName: string;
  roundScores: {
    playIn: number;
    r1: number;
    r2: number;
    cf: number;
    finals: number;
  };
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ leagueId }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const isPreview = new URLSearchParams(location.search).get('preview') === 'true';
  
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [teams, setTeams] = useState<Record<string, Team>>({});
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [seriesResults, setSeriesResults] = useState<Record<string, SeriesResult>>({});
  const [leagueConfig, setLeagueConfig] = useState<League | null>(null);

  const calculateEntryRoundScores = (bracket: Bracket, results: Record<string, SeriesResult>, config: League | null) => {
    const scores = { playIn: 0, r1: 0, r2: 0, cf: 0, finals: 0 };
    if (!config || !config.pointConfig) return scores;

    // Play-In
    bracket.playInPicks?.forEach(p => {
      const res = results[p.matchupId];
      if (res?.advancingTeamId === p.predictedWinnerId) {
        scores.playIn += config.pointConfig.playIn || 0;
      }
    });

    // Rounds 1-Finals
    bracket.picks?.forEach(p => {
      const res = results[p.matchupId];
      if (res?.advancingTeamId === p.predictedTeamId) {
        let pts = 0;
        if (p.predictedRound === 1) {
          pts = config.pointConfig.round1;
          scores.r1 += pts;
        } else if (p.predictedRound === 2) {
          pts = config.pointConfig.round2;
          scores.r2 += pts;
        } else if (p.predictedRound === 3) {
          pts = config.pointConfig.round3;
          scores.cf += pts;
        } else if (p.predictedRound === 4) {
          pts = config.pointConfig.finals;
          scores.finals += pts;
        }

        // Exact games bonus
        if (res.totalGamesPlayed === p.predictedSeriesLength) {
          const bonus = config.pointConfig.exactGamesBonus || 0;
          if (p.predictedRound === 1) scores.r1 += bonus;
          else if (p.predictedRound === 2) scores.r2 += bonus;
          else if (p.predictedRound === 3) scores.cf += bonus;
          else if (p.predictedRound === 4) scores.finals += bonus;
        }
      }
    });

    return scores;
  };

  useEffect(() => {
    if (isPreview) {
      // Mock data for preview
      const mockTeams: Record<string, Team> = {
        'bos': { id: 'bos', teamName: 'Celtics', conference: Conference.EAST, seed: 1, apiTeamId: 1 },
        'den': { id: 'den', teamName: 'Nuggets', conference: Conference.WEST, seed: 1, apiTeamId: 2 },
        'mil': { id: 'mil', teamName: 'Bucks', conference: Conference.EAST, seed: 3, apiTeamId: 3 },
        'okc': { id: 'okc', teamName: 'Thunder', conference: Conference.WEST, seed: 1, apiTeamId: 4 }
      };
      setTeams(mockTeams);
      
      const mockEntries: LeaderboardEntry[] = [
        {
          id: '1', userId: 'u1', leagueId: 'l1', userName: 'Bracket King', totalScore: 120, tiebreakerPrediction: 215,
          picks: [
            { matchupId: 'R4_Finals', predictedTeamId: 'bos', predictedSeriesLength: 6, predictedRound: 4, status: PickStatus.PENDING },
            { matchupId: 'R3_E_CF', predictedTeamId: 'bos', predictedSeriesLength: 5, predictedRound: 3, status: PickStatus.PENDING },
            { matchupId: 'R3_W_CF', predictedTeamId: 'den', predictedSeriesLength: 7, predictedRound: 3, status: PickStatus.PENDING }
          ],
          playInPicks: [],
          roundScores: { playIn: 10, r1: 40, r2: 30, cf: 20, finals: 20 }
        },
        {
          id: '2', userId: 'u2', leagueId: 'l1', userName: 'HoopsMaster', totalScore: 120, tiebreakerPrediction: 208,
          picks: [
            { matchupId: 'R4_Finals', predictedTeamId: 'den', predictedSeriesLength: 7, predictedRound: 4, status: PickStatus.PENDING },
            { matchupId: 'R3_E_CF', predictedTeamId: 'mil', predictedSeriesLength: 6, predictedRound: 3, status: PickStatus.PENDING },
            { matchupId: 'R3_W_CF', predictedTeamId: 'den', predictedSeriesLength: 6, predictedRound: 3, status: PickStatus.PENDING }
          ],
          playInPicks: [],
          roundScores: { playIn: 15, r1: 35, r2: 30, cf: 20, finals: 20 }
        },
        {
          id: '3', userId: 'u3', leagueId: 'l1', userName: 'UnderdogFan', totalScore: 95, tiebreakerPrediction: 195,
          picks: [
            { matchupId: 'R4_Finals', predictedTeamId: 'okc', predictedSeriesLength: 7, predictedRound: 4, status: PickStatus.PENDING },
            { matchupId: 'R3_E_CF', predictedTeamId: 'bos', predictedSeriesLength: 4, predictedRound: 3, status: PickStatus.PENDING },
            { matchupId: 'R3_W_CF', predictedTeamId: 'okc', predictedSeriesLength: 7, predictedRound: 3, status: PickStatus.PENDING }
          ],
          playInPicks: [],
          roundScores: { playIn: 5, r1: 30, r2: 20, cf: 40, finals: 0 }
        }
      ];
      setEntries(mockEntries);
      setIsLocked(true);
      setLoading(false);
      return;
    }

    if (!leagueId) return;

    // First check if picks are locked globally
    const settingsRef = doc(db, 'globalSettings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        const lockTime = snap.data().picksLockTime.toDate();
        setIsLocked(new Date() > lockTime);
      }
    });

    // Catch results for scoring
    const unsubResults = onSnapshot(collection(db, 'seriesResults'), (snap) => {
      const resMap: Record<string, SeriesResult> = {};
      snap.forEach(d => {
        resMap[d.id] = { id: d.id, ...d.data() } as SeriesResult;
      });
      setSeriesResults(resMap);
    });

    // Fetch teams for lookup
    const fetchTeams = async () => {
      const teamsSnap = await getDocs(collection(db, 'teams'));
      const teamMap: Record<string, Team> = {};
      teamsSnap.forEach(doc => {
        teamMap[doc.id] = { id: doc.id, ...doc.data() } as Team;
      });
      setTeams(teamMap);
    };
    fetchTeams();

    // Listen to the league to get the current participants list
    const leagueRef = doc(db, 'leagues', leagueId);
    const unsubLeague = onSnapshot(leagueRef, async (leagueSnap) => {
      if (!leagueSnap.exists()) return;
      const leagueData = leagueSnap.data() as League;
      setLeagueConfig(leagueData);
      
      if (leagueData.lastCalculated) {
        setLastUpdated((leagueData.lastCalculated as any).toDate());
      }
      const participants = leagueData.participants || [];

      // Fetch all brackets for this league
      const bracketsQuery = query(
        collection(db, 'brackets'),
        where('leagueId', '==', leagueId)
      );
      
      const bracketsSnap = await getDocs(bracketsQuery);
      const bracketsMap: Record<string, Bracket> = {};
      bracketsSnap.forEach(doc => {
        bracketsMap[doc.data().userId] = { id: doc.id, ...doc.data() } as Bracket;
      });

      // Fetch user details for all participants reactively
      const userMap: Record<string, string> = {};
      let unsubUsers: (() => void) | null = null;
      if (participants.length > 0) {
        const chunks = [];
        for (let i = 0; i < participants.length; i += 30) {
          chunks.push(participants.slice(i, i + 30));
        }

        const usersQuery = query(collection(db, 'users'), where('uid', 'in', chunks[0]));
        unsubUsers = onSnapshot(usersQuery, (usersSnap) => {
          usersSnap.forEach(doc => {
            const data = doc.data() as User;
            let name = data.displayName;
            if (name === 'User' && data.email) {
              name = data.email.split('@')[0];
            }
            userMap[data.uid] = name;
          });

          // Fetch results from ref if not ready yet
          const resultsToUse = seriesResults;

          // Merge participants with their brackets (if any)
          const allEntries: LeaderboardEntry[] = participants.map(uid => {
            const bracket = bracketsMap[uid];
            const roundScores = bracket ? calculateEntryRoundScores(bracket, resultsToUse, leagueData) : { playIn: 0, r1: 0, r2: 0, cf: 0, finals: 0 };
            
            // Calculate total score client-side for "Live" experience
            const totalScore = roundScores.playIn + roundScores.r1 + roundScores.r2 + roundScores.cf + roundScores.finals;

            return {
              id: bracket?.id || `temp_${uid}`,
              userId: uid,
              leagueId: leagueId,
              picks: bracket?.picks || [],
              playInPicks: bracket?.playInPicks || [],
              tiebreakerPrediction: bracket?.tiebreakerPrediction || 0,
              totalScore,
              userName: userMap[uid] || 'Unknown User',
              roundScores
            };
          });

          // Sort by score desc, then by name
          allEntries.sort((a, b) => {
            if ((b.totalScore || 0) !== (a.totalScore || 0)) {
              return (b.totalScore || 0) - (a.totalScore || 0);
            }
            return a.userName.localeCompare(b.userName);
          });

          setEntries(allEntries);
          setLoading(false);
        });
      } else {
        setEntries([]);
        setLoading(false);
      }

      return () => {
        if (unsubUsers) unsubUsers();
      };
    }, (error) => {
      console.error("Leaderboard error:", error);
      if (error.code === 'permission-denied') {
        setEntries([]);
      }
      setLoading(false);
    });

    return () => {
      unsubSettings();
      unsubLeague();
      unsubResults();
    };
  }, [leagueId, seriesResults]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-16 bg-white/5 rounded-2xl border border-white/10" />
        ))}
      </div>
    );
  }

  const getRank = (index: number) => {
    const currentScore = entries[index].totalScore || 0;
    const firstIndexWithScore = entries.findIndex(e => (e.totalScore || 0) === currentScore);
    return firstIndexWithScore + 1;
  };

  const checkCompletion = (entry: LeaderboardEntry) => {
    const totalPicks = (entry.picks?.length || 0) + (entry.playInPicks?.length || 0);
    const hasTiebreaker = (entry.tiebreakerPrediction || 0) > 0;
    const isComplete = totalPicks >= 21 && hasTiebreaker;
    return { isComplete, count: totalPicks, hasTiebreaker };
  };

  const getFinalsPrediction = (entry: LeaderboardEntry) => {
    const finalsPick = entry.picks.find(p => p.matchupId === 'FINALS');
    if (!finalsPick) return null;

    const winner = teams[finalsPick.predictedTeamId];
    if (!winner) return null;

    // To find the loser, we need to know who was in the Finals.
    // In our system, the Finals matchup is CF_E winner vs CF_W winner.
    const cfEPick = entry.picks.find(p => p.matchupId === 'CF_E');
    const cfWPick = entry.picks.find(p => p.matchupId === 'CF_W');

    if (!cfEPick || !cfWPick) return null;

    const teamE = teams[cfEPick.predictedTeamId];
    const teamW = teams[cfWPick.predictedTeamId];

    if (!teamE || !teamW) return null;

    const loser = finalsPick.predictedTeamId === teamE.id ? teamW : teamE;

    return {
      winnerName: winner.teamName,
      loserName: loser.teamName,
      games: finalsPick.predictedSeriesLength
    };
  };

  return (
    <div className="space-y-3">
      {isPreview && (
        <div className="bg-orange-500/10 border border-orange-500/30 p-3 rounded-xl flex items-center justify-center gap-2 mb-4">
          <Eye className="w-4 h-4 text-orange-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-orange-500">UI Preview Mode (Mock Data)</span>
        </div>
      )}
      <div className="flex items-center justify-between px-6 py-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
        <div className="flex items-center gap-8">
          <span className="w-8">Rank</span>
          <span>Participant</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="grid grid-cols-5 gap-4 w-60 text-center">
            <span>PI</span>
            <span>R1</span>
            <span>R2</span>
            <span>CF</span>
            <span>FIN</span>
          </div>
          <span className="w-12 text-right">Total</span>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="py-12 text-center bg-black/5 border border-dashed border-black/10 rounded-3xl">
          <p className="text-gray-500 font-medium">
            No brackets submitted yet.
          </p>
        </div>
      ) : (
        entries.map((entry, index) => {
          const rank = getRank(index);
          return (
            <div 
              key={entry.id}
              onClick={() => navigate(`/league/${leagueId}/user/${entry.userId}`)}
              className={`group relative flex items-center justify-between px-6 py-4 bg-white/60 backdrop-blur-xl border border-black/5 rounded-2xl transition-all duration-500 cursor-pointer hover:border-orange-500/50 hover:bg-black/5 ${
                rank === 1 ? 'bg-gradient-to-r from-orange-500/10 to-transparent border-orange-500/20' : ''
              }`}
            >
              <div className="flex items-center gap-8">
                <div className="w-8 flex items-center justify-center">
                  {rank === 1 ? (
                    <Trophy className="w-5 h-5 text-orange-500" />
                  ) : rank === 2 ? (
                    <Medal className="w-5 h-5 text-gray-400" />
                  ) : rank === 3 ? (
                    <Medal className="w-5 h-5 text-orange-800" />
                  ) : (
                    <span className="text-sm font-black text-gray-600 italic">#{rank}</span>
                  )}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-bold uppercase italic tracking-tight group-hover:text-orange-500 transition-colors">
                      {entry.userName}
                    </span>
                    {isAdmin && (
                      <div className="flex items-center gap-1.5 ml-2">
                        {(() => {
                          const { isComplete, count, hasTiebreaker } = checkCompletion(entry);
                          if (isComplete) {
                            return (
                              <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                Picks In
                              </div>
                            );
                          }
                          return (
                            <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
                              <AlertCircle className="w-2.5 h-2.5" />
                              {count}/21 {!hasTiebreaker && '+ TB'}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    <ChevronRight className="w-3 h-3 text-orange-500 opacity-0 group-hover:opacity-100 transition-all" />
                  </div>
                  {isLocked && (
                    <div className="mt-1 flex items-center gap-3">
                      {(() => {
                        const pred = getFinalsPrediction(entry);
                        if (!pred) return <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter">No Finals Pick</span>;
                        return (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-black text-orange-500 uppercase italic">
                                {pred.winnerName}
                              </span>
                              <span className="text-[8px] font-bold text-gray-400 uppercase">over</span>
                              <span className="text-[9px] font-bold text-gray-600 uppercase italic">
                                {pred.loserName}
                              </span>
                              <span className="text-[8px] font-black text-gray-100 bg-gray-900 px-1 rounded">
                                IN {pred.games}
                              </span>
                            </div>
                            <div className="h-2 w-px bg-gray-300" />
                            <div className="flex items-center gap-1 text-[9px] font-mono font-bold text-gray-400">
                              <span>{entry.tiebreakerPrediction}</span>
                              <span className="text-[8px] text-gray-500 font-sans uppercase">PTS</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="grid grid-cols-5 gap-4 w-60 text-center text-[11px] font-bold font-mono">
                  <span className={entry.roundScores.playIn > 0 ? 'text-gray-900' : 'text-gray-300'}>{entry.roundScores.playIn}</span>
                  <span className={entry.roundScores.r1 > 0 ? 'text-gray-900' : 'text-gray-300'}>{entry.roundScores.r1}</span>
                  <span className={entry.roundScores.r2 > 0 ? 'text-gray-900' : 'text-gray-300'}>{entry.roundScores.r2}</span>
                  <span className={entry.roundScores.cf > 0 ? 'text-gray-900' : 'text-gray-300'}>{entry.roundScores.cf}</span>
                  <span className={entry.roundScores.finals > 0 ? 'text-gray-900' : 'text-gray-300'}>{entry.roundScores.finals}</span>
                </div>
                <div className="w-12 text-right">
                  <span className="text-xl font-black italic text-orange-500">
                    {entry.totalScore || 0}
                  </span>
                </div>
              </div>
            </div>
          );
        })
      )}
      
      {lastUpdated && (
        <div className="pt-8 pb-4 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 flex items-center justify-center gap-2">
            <Clock className="w-3 h-3" />
            Scores Last Updated: {lastUpdated.toLocaleString([], { 
              month: 'short', 
              day: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit',
              timeZoneName: 'short'
            })}
          </p>
        </div>
      )}
    </div>
  );
};
