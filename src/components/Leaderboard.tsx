import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { collection, query, where, orderBy, onSnapshot, getDocs, doc } from 'firebase/firestore';
import { Bracket, User } from '../types/database';
import { Trophy, Medal, ChevronRight, Hash } from 'lucide-react';

interface LeaderboardProps {
  leagueId: string;
}

interface LeaderboardEntry extends Bracket {
  userName: string;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ leagueId }) => {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (!leagueId) return;

    // First check if picks are locked globally
    const settingsRef = doc(db, 'globalSettings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        const lockTime = snap.data().picksLockTime.toDate();
        setIsLocked(new Date() > lockTime);
      }
    });

    const bracketsQuery = query(
      collection(db, 'brackets'),
      where('leagueId', '==', leagueId),
      orderBy('totalScore', 'desc')
    );

    const unsubscribe = onSnapshot(bracketsQuery, async (snapshot) => {
      const bracketData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bracket));
      
      // Fetch user names for these brackets
      const userIds = [...new Set(bracketData.map(b => b.userId))];
      const userMap: Record<string, string> = {};
      
      if (userIds.length > 0) {
        const usersSnap = await getDocs(query(collection(db, 'users'), where('uid', 'in', userIds)));
        usersSnap.forEach(doc => {
          const data = doc.data() as User;
          userMap[data.uid] = data.displayName;
        });
      }

      const entriesWithNames = bracketData.map(b => ({
        ...b,
        userName: userMap[b.userId] || 'Unknown User'
      }));

      setEntries(entriesWithNames);
      setLoading(false);
    }, (error) => {
      console.error("Leaderboard error:", error);
      // If we get a permission error, it's likely because picks are not locked yet.
      // We'll just show an empty state or handle it gracefully.
      if (error.code === 'permission-denied') {
        setEntries([]);
      }
      setLoading(false);
    });

    return () => {
      unsubSettings();
      unsubscribe();
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

  return (
    <div className="space-y-3">
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
        entries.map((entry, index) => (
          <div 
            key={entry.id}
            onClick={() => isLocked && navigate(`/league/${leagueId}/user/${entry.userId}`)}
            className={`group relative flex items-center justify-between px-6 py-5 bg-white/60 backdrop-blur-xl border border-black/5 rounded-2xl transition-all duration-500 ${
              isLocked ? 'cursor-pointer hover:border-orange-500/50 hover:bg-black/5' : ''
            } ${
              index === 0 ? 'bg-gradient-to-r from-orange-500/10 to-transparent border-orange-500/20' : ''
            }`}
          >
            <div className="flex items-center gap-8">
              <div className="w-8 flex items-center justify-center">
                {index === 0 ? (
                  <Trophy className="w-5 h-5 text-orange-500" />
                ) : index === 1 ? (
                  <Medal className="w-5 h-5 text-gray-400" />
                ) : index === 2 ? (
                  <Medal className="w-5 h-5 text-orange-800" />
                ) : (
                  <span className="text-sm font-black text-gray-600 italic">#{index + 1}</span>
                )}
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-bold uppercase italic tracking-tight group-hover:text-orange-500 transition-colors">
                    {entry.userName}
                  </span>
                  {isLocked && <ChevronRight className="w-3 h-3 text-orange-500 opacity-0 group-hover:opacity-100 transition-all" />}
                </div>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
                  {entry.userId.slice(0, 8)}...
                </span>
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
        ))
      )}
    </div>
  );
};
