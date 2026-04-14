import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { db } from '../firebase';
import { collection, query, where, orderBy, onSnapshot, getDocs, doc } from 'firebase/firestore';
import { Bracket, User, League, Team, PickStatus } from '../types/database';
import { Trophy, Medal, ChevronRight, Hash, Eye, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface LeaderboardProps {
  leagueId: string;
}

interface LeaderboardEntry extends Bracket {
  userName: string;
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

  useEffect(() => {
    if (isPreview) {
      // Mock data for preview
      const mockTeams: Record<string, Team> = {
        'bos': { id: 'bos', teamName: 'Celtics', conference: 'East' as any, seed: 1, apiTeamId: 1 },
        'den': { id: 'den', teamName: 'Nuggets', conference: 'West' as any, seed: 2, apiTeamId: 2 },
        'mil': { id: 'mil', teamName: 'Bucks', conference: 'East' as any, seed: 3, apiTeamId: 3 },
        'okc': { id: 'okc', teamName: 'Thunder', conference: 'West' as any, seed: 1, apiTeamId: 4 }
      };
      setTeams(mockTeams);
      
      const mockEntries: LeaderboardEntry[] = [
        {
          id: '1', userId: 'u1', leagueId: 'l1', userName: 'Bracket King', totalScore: 120, tiebreakerPrediction: 215,
          picks: [
            { matchupId: 'FINALS', predictedTeamId: 'bos', predictedSeriesLength: 6, predictedRound: 4, status: PickStatus.PENDING },
            { matchupId: 'CF_E', predictedTeamId: 'bos', predictedSeriesLength: 5, predictedRound: 3, status: PickStatus.PENDING },
            { matchupId: 'CF_W', predictedTeamId: 'den', predictedSeriesLength: 7, predictedRound: 3, status: PickStatus.PENDING }
          ],
          playInPicks: []
        },
        {
          id: '2', userId: 'u2', leagueId: 'l1', userName: 'HoopsMaster', totalScore: 120, tiebreakerPrediction: 208,
          picks: [
            { matchupId: 'FINALS', predictedTeamId: 'den', predictedSeriesLength: 7, predictedRound: 4, status: PickStatus.PENDING },
            { matchupId: 'CF_E', predictedTeamId: 'mil', predictedSeriesLength: 6, predictedRound: 3, status: PickStatus.PENDING },
            { matchupId: 'CF_W', predictedTeamId: 'den', predictedSeriesLength: 6, predictedRound: 3, status: PickStatus.PENDING }
          ],
          playInPicks: []
        },
        {
          id: '3', userId: 'u3', leagueId: 'l1', userName: 'UnderdogFan', totalScore: 95, tiebreakerPrediction: 195,
          picks: [
            { matchupId: 'FINALS', predictedTeamId: 'okc', predictedSeriesLength: 7, predictedRound: 4, status: PickStatus.PENDING },
            { matchupId: 'CF_E', predictedTeamId: 'bos', predictedSeriesLength: 4, predictedRound: 3, status: PickStatus.PENDING },
            { matchupId: 'CF_W', predictedTeamId: 'okc', predictedSeriesLength: 7, predictedRound: 3, status: PickStatus.PENDING }
          ],
          playInPicks: []
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

      // Fetch user details for all participants
      const userMap: Record<string, string> = {};
      if (participants.length > 0) {
        // Firestore 'in' query limit is 30, but for simplicity we'll assume small leagues or handle in chunks if needed.
        // For now, let's just fetch them. If participants > 30, we'd need multiple queries.
        const chunks = [];
        for (let i = 0; i < participants.length; i += 30) {
          chunks.push(participants.slice(i, i + 30));
        }

        for (const chunk of chunks) {
          const usersSnap = await getDocs(query(collection(db, 'users'), where('uid', 'in', chunk)));
          usersSnap.forEach(doc => {
            const data = doc.data() as User;
            userMap[data.uid] = data.displayName;
          });
        }
      }

      // Merge participants with their brackets (if any)
      const allEntries: LeaderboardEntry[] = participants.map(uid => {
        const bracket = bracketsMap[uid];
        return {
          id: bracket?.id || `temp_${uid}`,
          userId: uid,
          leagueId: leagueId,
          picks: bracket?.picks || [],
          playInPicks: bracket?.playInPicks || [],
          tiebreakerPrediction: bracket?.tiebreakerPrediction || 0,
          totalScore: bracket?.totalScore || 0,
          userName: userMap[uid] || 'Unknown User'
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
    };
  }, [leagueId]);

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
        <div className="flex items-center gap-12">
          <span className="w-16 text-center">Tiebreaker</span>
          <span className="w-12 text-right">Score</span>
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
              onClick={() => isLocked && navigate(`/league/${leagueId}/user/${entry.userId}`)}
              className={`group relative flex items-center justify-between px-6 py-5 bg-white/60 backdrop-blur-xl border border-black/5 rounded-2xl transition-all duration-500 ${
                isLocked ? 'cursor-pointer hover:border-orange-500/50 hover:bg-black/5' : ''
              } ${
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
                    {isLocked && <ChevronRight className="w-3 h-3 text-orange-500 opacity-0 group-hover:opacity-100 transition-all" />}
                  </div>
                  {isLocked && (
                    <div className="mt-1 flex items-center gap-2">
                      {(() => {
                        const pred = getFinalsPrediction(entry);
                        if (!pred) return <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter">No Finals Pick</span>;
                        return (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-black text-orange-500 uppercase italic">
                              {pred.winnerName}
                            </span>
                            <span className="text-[8px] font-bold text-gray-400 uppercase">over</span>
                            <span className="text-[9px] font-bold text-gray-600 uppercase italic">
                              {pred.loserName}
                            </span>
                            <span className="text-[8px] font-black text-gray-400 bg-black/5 px-1 rounded">
                              IN {pred.games}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-12">
                <div className="w-16 text-center">
                  <span className="text-xs font-mono font-bold text-gray-400">
                    {isLocked ? (
                      <>
                        {entry.tiebreakerPrediction} <span className="text-[8px] text-gray-600 uppercase">PTS</span>
                      </>
                    ) : (
                      <span className="text-[10px] text-gray-600 uppercase italic">Hidden</span>
                    )}
                  </span>
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
    </div>
  );
};
