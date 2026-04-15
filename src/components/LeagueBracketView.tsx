import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { TournamentBracket } from './TournamentBracket';
import { useAuth } from '../contexts/AuthContext';
import { League, Team, Pick, SeriesResult } from '../types/database';
import { Settings } from 'lucide-react';

import { db } from '../firebase';
import { onSnapshot, doc, setDoc, getDocs, collection, query, where, getDoc } from 'firebase/firestore';
import { Leaderboard } from './Leaderboard';
import { Bracket, PlayInPick } from '../types/database';
import { ArrowLeft, Clock } from 'lucide-react';
import { auth } from '../firebase';
import { CountdownTimer } from './CountdownTimer';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Real Hook
const useBracketData = (leagueId: string | undefined, userId: string | undefined) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [bracket, setBracket] = useState<Bracket | null>(null);
  const [actualResults, setActualResults] = useState<SeriesResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState<League | null>(null);

  useEffect(() => {
    if (!leagueId || !userId) return;

    let teamsLoaded = false;
    let resultsLoaded = false;
    let leagueLoaded = false;
    let bracketLoaded = false;

    const checkLoading = () => {
      if (teamsLoaded && resultsLoaded && leagueLoaded && bracketLoaded) {
        setLoading(false);
      }
    };

    // Fetch Teams
    const teamsUnsub = onSnapshot(collection(db, 'teams'), (snap) => {
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() } as Team)));
      teamsLoaded = true;
      checkLoading();
    });

    // Fetch Actual Results
    const resultsUnsub = onSnapshot(collection(db, 'seriesResults'), (snap) => {
      setActualResults(snap.docs.map(d => ({ id: d.id, ...d.data() } as SeriesResult)));
      resultsLoaded = true;
      checkLoading();
    });

    // Fetch League
    const leagueUnsub = onSnapshot(doc(db, 'leagues', leagueId), (snap) => {
      if (snap.exists()) setLeague({ id: snap.id, ...snap.data() } as League);
      leagueLoaded = true;
      checkLoading();
    });

    // Fetch User's Bracket
    const bracketQuery = query(
      collection(db, 'brackets'),
      where('leagueId', '==', leagueId),
      where('userId', '==', userId)
    );

    const bracketUnsub = onSnapshot(bracketQuery, (snap) => {
      if (!snap.empty) {
        setBracket({ id: snap.docs[0].id, ...snap.docs[0].data() } as Bracket);
      } else {
        setBracket(null);
      }
      bracketLoaded = true;
      checkLoading();
    });

    return () => {
      teamsUnsub();
      resultsUnsub();
      leagueUnsub();
      bracketUnsub();
    };
  }, [leagueId, userId]);

  return { teams, bracket, actualResults, league, loading };
};

export const LeagueBracketView: React.FC = () => {
  const { leagueId, userId: paramUserId } = useParams<{ leagueId: string, userId?: string }>();
  const navigate = useNavigate();
  const { user, userData } = useAuth();
  
  // If a userId is in the URL, we view that user's bracket. Otherwise, we view our own.
  const targetUserId = paramUserId || user?.uid;
  const isViewingSelf = !paramUserId || paramUserId === user?.uid;

  const { teams, bracket, actualResults, league, loading } = useBracketData(leagueId, targetUserId);
  const [viewedUserName, setViewedUserName] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'bracket' | 'leaderboard'>('leaderboard');

  useEffect(() => {
    if (isViewingSelf) {
      setActiveTab('leaderboard');
    } else {
      setActiveTab('bracket');
    }
  }, [isViewingSelf, leagueId]);
  const [pendingBracket, setPendingBracket] = useState<Bracket | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [lockTime, setLockTime] = useState<Date | null>(null);

  useEffect(() => {
    const settingsRef = doc(db, 'globalSettings', 'config');
    const unsub = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        const time = snap.data().picksLockTime.toDate();
        setLockTime(time);
        setIsLocked(new Date() > time);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!targetUserId) return;
    const fetchViewedUser = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', targetUserId));
        if (userDoc.exists()) {
          const data = userDoc.data();
          let name = data.displayName;
          if (name === 'User' && data.email) {
            name = data.email.split('@')[0];
          }
          setViewedUserName(name);
        }
      } catch (error) {
        console.error("Error fetching viewed user:", error);
      }
    };
    fetchViewedUser();
  }, [targetUserId]);

  useEffect(() => {
    // Reset pending changes when switching leagues or if bracket is externally updated
    // but only if we don't have pending changes we want to keep.
    // For simplicity, we'll just reset when the leagueId changes.
    setPendingBracket(null);
  }, [leagueId]);

  if (loading) {
    return <div className="animate-pulse text-orange-500 font-bold text-xl">Loading...</div>;
  }

  const isCommissioner = league?.commissionerId === user?.uid || userData?.systemRole === 'SuperAdmin';

  const currentBracket = pendingBracket || bracket;

  const handlePick = (matchupId: string, teamId: string, length: number) => {
    if (!user || !leagueId || !isViewingSelf || isLocked) return;

    const isPlayIn = matchupId.startsWith('PI_');
    const newBracket: any = currentBracket ? { ...currentBracket } : {
      userId: user.uid,
      leagueId: leagueId,
      picks: [],
      playInPicks: [],
      tiebreakerPrediction: 0,
      totalScore: 0
    };

    if (isPlayIn) {
      const playInPicks = [...(newBracket.playInPicks || [])];
      const existingIndex = playInPicks.findIndex((p: any) => p.matchupId === matchupId);
      const newPick = { matchupId, predictedWinnerId: teamId, status: 'Pending' };
      
      if (existingIndex >= 0) playInPicks[existingIndex] = newPick;
      else playInPicks.push(newPick);
      
      newBracket.playInPicks = playInPicks;
    } else {
      const picks = [...(newBracket.picks || [])];
      const existingIndex = picks.findIndex((p: any) => p.matchupId === matchupId);
      const newPick = { 
        matchupId, 
        predictedTeamId: teamId, 
        predictedSeriesLength: length,
        predictedRound: matchupId.startsWith('R1') ? 1 : matchupId.startsWith('R2') ? 2 : matchupId.startsWith('CF') ? 3 : 4,
        status: 'Pending'
      };
      
      if (existingIndex >= 0) picks[existingIndex] = newPick;
      else picks.push(newPick);
      
      newBracket.picks = picks;
    }

    setPendingBracket(newBracket);
  };

  const handleTiebreakerChange = (value: number) => {
    if (!user || !leagueId || !isViewingSelf || isLocked) return;
    const newBracket: any = currentBracket ? { ...currentBracket } : {
      userId: user.uid,
      leagueId: leagueId,
      picks: [],
      playInPicks: [],
      tiebreakerPrediction: 0,
      totalScore: 0
    };
    newBracket.tiebreakerPrediction = value;
    setPendingBracket(newBracket);
  };

  const handleSave = async () => {
    if (!user || !leagueId || !pendingBracket || !isViewingSelf || isLocked) return;
    setIsSaving(true);
    try {
      const bracketId = bracket?.id || `${user.uid}_${leagueId}`;
      await setDoc(doc(db, 'brackets', bracketId), pendingBracket, { merge: true });
      setPendingBracket(null);
    } catch (error) {
      console.error("Error saving bracket:", error);
      try {
        const bracketId = bracket?.id || `${user.uid}_${leagueId}`;
        handleFirestoreError(error, OperationType.WRITE, `brackets/${bracketId}`);
      } catch (e) {
        // Error already logged
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setPendingBracket(null);
  };

  return (
    <div className={`space-y-8 transition-all duration-500 ${pendingBracket ? 'pb-48' : ''}`}>
      {pendingBracket && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 bg-white/90 backdrop-blur-2xl border border-black/10 p-4 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4">
          <div className="flex flex-col">
            <span className="text-xs font-black uppercase tracking-widest text-orange-500">Unsaved Changes</span>
            <span className="text-[10px] text-gray-600">You have pending picks in your bracket</span>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button 
              onClick={handleCancel}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-900 transition-colors"
            >
              Discard
            </button>
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest px-6 py-2 rounded-xl transition-all shadow-lg shadow-orange-500/20"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/')}
            className="p-2 bg-black/5 hover:bg-black/10 rounded-xl transition-all text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-3xl font-black uppercase italic text-gray-900 tracking-tight leading-none">
              {league?.leagueName}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              {!isViewingSelf ? (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded">
                    Viewing: {viewedUserName || '...'}
                  </span>
                  <button 
                    onClick={() => {
                      setActiveTab('leaderboard');
                      navigate(`/league/${leagueId}`);
                    }}
                    className="text-[10px] font-black uppercase tracking-widest text-gray-500 bg-black/5 px-2 py-0.5 rounded hover:bg-black/10 transition-all flex items-center gap-1"
                  >
                    <ArrowLeft className="w-2.5 h-2.5" />
                    Back to Leaderboard
                  </button>
                </div>
              ) : (
                <span className="text-[10px] font-black uppercase tracking-widest text-green-500 bg-green-500/10 px-2 py-0.5 rounded">
                  My Bracket
                </span>
              )}
              <span className="text-[10px] font-black uppercase tracking-widest text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded">
                {isLocked ? 'Locked' : 'Live'}
              </span>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Invite Code: {league?.inviteCode}</span>
            </div>
          </div>
        </div>

        <div className="hidden lg:flex items-center justify-center flex-1 px-8">
          <CountdownTimer lockTime={lockTime} />
        </div>

        {isViewingSelf && (
          <div className="flex items-center gap-3 bg-white/60 backdrop-blur-xl p-1.5 rounded-2xl border border-black/5">
            <button 
              onClick={() => setActiveTab('bracket')}
              className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'bracket' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-500 hover:text-gray-900'}`}
            >
              My Bracket
            </button>
            <button 
              onClick={() => setActiveTab('leaderboard')}
              className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'leaderboard' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Leaderboard
            </button>
            {isCommissioner && (
              <Link 
                to={`/league/${leagueId}/settings`}
                className="p-2 text-gray-500 hover:text-orange-500 transition-colors"
              >
                <Settings className="w-5 h-5" />
              </Link>
            )}
          </div>
        )}
      </div>
      
      {activeTab === 'bracket' ? (
        <TournamentBracket 
          teams={teams}
          userPicks={[...(currentBracket?.picks || []), ...(currentBracket?.playInPicks || [])] as any}
          actualResults={actualResults}
          onPick={handlePick}
          isLocked={isLocked || !isViewingSelf}
          tiebreakerPrediction={currentBracket?.tiebreakerPrediction || 0}
          onTiebreakerChange={handleTiebreakerChange}
        />
      ) : (
        <Leaderboard leagueId={leagueId!} />
      )}

      {/* Explicit spacer for fixed overlay */}
      {pendingBracket && <div className="h-24" aria-hidden="true" />}
    </div>
  );
};
