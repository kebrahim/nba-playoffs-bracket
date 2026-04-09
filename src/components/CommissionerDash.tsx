import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { League, PointConfig } from '../types/database';
import { useAuth } from '../contexts/AuthContext';
import { Settings, Share2, Save, ArrowLeft, Trophy, Zap, Star } from 'lucide-react';
import { auth } from '../firebase';

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

export const CommissionerDash: React.FC = () => {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const { userData } = useAuth();
  const [league, setLeague] = useState<League | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const fetchLeague = async () => {
      if (!leagueId) return;
      try {
        const docSnap = await getDoc(doc(db, 'leagues', leagueId));
        if (docSnap.exists()) {
          const data = docSnap.data() as League;
          // Security check: only commissioner can access
          if (data.commissionerId !== userData?.uid && userData?.systemRole !== 'SuperAdmin') {
            navigate('/');
            return;
          }
          setLeague(data);
        }
      } catch (error) {
        console.error("Error fetching league:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchLeague();
  }, [leagueId, userData, navigate]);

  const handleUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!league || !leagueId) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'leagues', leagueId), {
        leagueName: league.leagueName,
        inviteCode: league.inviteCode.toUpperCase().trim(),
        pointConfig: league.pointConfig
      });
      setMessage({ type: 'success', text: 'League settings updated successfully.' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update settings.' });
      try {
        handleFirestoreError(error, OperationType.UPDATE, `leagues/${leagueId}`);
      } catch (e) {
        // Error already logged
      }
    } finally {
      setSaving(false);
    }
  };

  const updatePoint = (key: keyof PointConfig, value: number) => {
    if (!league) return;
    setLeague({
      ...league,
      pointConfig: { ...league.pointConfig, [key]: value }
    });
  };

  const updateLeagueName = (name: string) => {
    if (!league) return;
    setLeague({
      ...league,
      leagueName: name
    });
  };

  const updateInviteCode = (code: string) => {
    if (!league) return;
    setLeague({
      ...league,
      inviteCode: code.toUpperCase().replace(/\s/g, '')
    });
  };

  if (loading) return <div className="p-8 text-orange-500 animate-pulse font-bold">Loading Commissioner Controls...</div>;
  if (!league) return <div className="p-8 text-red-500 font-bold">League not found.</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between border-b border-white/10 pb-6">
        <div className="flex items-center gap-4">
          <div className="bg-orange-500/20 p-3 rounded-2xl border border-orange-500/50">
            <Settings className="w-8 h-8 text-orange-500" />
          </div>
          <div>
            <h1 className="text-4xl font-black uppercase italic tracking-tighter text-gray-900">League <span className="text-orange-500">Settings</span></h1>
            <p className="text-gray-500 font-medium uppercase tracking-widest text-xs">Commissioner Dashboard</p>
          </div>
        </div>
        <button 
          onClick={() => navigate(`/league/${leagueId}`)}
          className="text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors uppercase tracking-widest flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Bracket
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-xl border ${message.type === 'success' ? 'bg-green-500/10 border-green-500/50 text-green-400' : 'bg-red-500/10 border-red-500/50 text-red-400'} flex items-center gap-3`}>
          <Zap className="w-5 h-5" />
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Invite Section */}
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white/70 backdrop-blur-xl border border-black/10 rounded-3xl p-8 text-center space-y-4">
            <Share2 className="w-10 h-10 text-orange-500 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest">Invite Friends</h3>
            <div className="bg-black/5 border border-black/10 rounded-xl p-4 font-mono text-2xl font-black tracking-widest text-orange-500">
              {league.inviteCode}
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Share this unique link with your friends to let them join your private league automatically.
            </p>
            <div className="flex flex-col gap-2">
              <button 
                onClick={() => {
                  const url = `${window.location.origin}/join/${league.inviteCode}`;
                  navigator.clipboard.writeText(url);
                  setMessage({ type: 'success', text: 'Invite link copied to clipboard!' });
                }}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <Share2 className="w-4 h-4" /> Copy Invite Link
              </button>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(league.inviteCode);
                  setMessage({ type: 'success', text: 'Invite code copied to clipboard!' });
                }}
                className="w-full bg-black/5 hover:bg-black/10 border border-black/10 text-xs font-bold py-2 rounded-lg transition-all text-gray-900"
              >
                Copy Code Only
              </button>
            </div>
          </div>
        </div>

        {/* Settings Form */}
        <div className="md:col-span-2">
          <form onSubmit={handleUpdateConfig} className="bg-white/70 backdrop-blur-xl border border-black/10 rounded-3xl p-8 space-y-10">
            {/* General Settings */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <Settings className="w-6 h-6 text-orange-500" />
                <h2 className="text-xl font-bold uppercase italic text-gray-900">General Settings</h2>
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  League Name
                </label>
                <input 
                  type="text" 
                  value={league.leagueName}
                  onChange={(e) => updateLeagueName(e.target.value)}
                  className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm font-bold focus:border-orange-500/50 outline-none text-gray-900"
                  placeholder="Enter league name"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Custom Invite Code
                </label>
                <input 
                  type="text" 
                  value={league.inviteCode}
                  onChange={(e) => updateInviteCode(e.target.value)}
                  className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm font-mono font-bold focus:border-orange-500/50 outline-none uppercase text-gray-900"
                  placeholder="E.G. MYLEAGUE2024"
                  maxLength={12}
                />
                <p className="text-[10px] text-gray-500 font-medium">Max 12 characters. No spaces. This will update your invite link immediately.</p>
              </div>
            </div>

            {/* Point Config Section */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <Trophy className="w-6 h-6 text-orange-500" />
                <h2 className="text-xl font-bold uppercase italic text-gray-900">Scoring Configuration</h2>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {[
                  { label: 'Round 1 Points', key: 'round1', icon: <Star className="w-4 h-4" /> },
                  { label: 'Round 2 Points', key: 'round2', icon: <Star className="w-4 h-4" /> },
                  { label: 'Round 3 Points', key: 'round3', icon: <Star className="w-4 h-4" /> },
                  { label: 'Finals Points', key: 'finals', icon: <Star className="w-4 h-4" /> },
                  { label: 'Play-In Points', key: 'playIn', icon: <Zap className="w-4 h-4" /> },
                  { label: 'Exact Games Bonus', key: 'exactGamesBonus', icon: <Zap className="w-4 h-4" /> },
                ].map((field) => (
                  <div key={field.key} className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                      {field.icon} {field.label}
                    </label>
                    <input 
                      type="number" 
                      value={league.pointConfig[field.key as keyof PointConfig]}
                      onChange={(e) => updatePoint(field.key as keyof PointConfig, parseInt(e.target.value))}
                      className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm font-bold focus:border-orange-500/50 outline-none text-gray-900"
                    />
                  </div>
                ))}
              </div>
            </div>

            <button 
              type="submit" 
              disabled={saving}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-4 rounded-xl transition-all shadow-xl shadow-orange-500/20 flex items-center justify-center gap-2 uppercase italic"
            >
              {saving ? 'Saving...' : <><Save className="w-5 h-5" /> Save All Settings</>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
