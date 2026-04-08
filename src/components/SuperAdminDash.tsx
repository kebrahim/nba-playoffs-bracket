import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, doc, getDocs, getDoc, setDoc, updateDoc, query, orderBy, writeBatch, deleteDoc, Timestamp } from 'firebase/firestore';
import { Team, Conference, GlobalSettings, SeriesResult } from '../types/database';
import { Shield, Users, Calendar, Trophy, Save, AlertTriangle, Plus, Trash2 } from 'lucide-react';

export const SuperAdminDash: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [openTimeStr, setOpenTimeStr] = useState('');
  const [lockTimeStr, setLockTimeStr] = useState('');
  const [series, setSeries] = useState<SeriesResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingStandings, setSyncingStandings] = useState(false);
  const [clearingPicks, setClearingPicks] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const teamsSnap = await getDocs(query(collection(db, 'teams'), orderBy('seed', 'asc')));
        const settingsRef = doc(db, 'globalSettings', 'config');
        const settingsSnap = await getDoc(settingsRef);
        const seriesSnap = await getDocs(collection(db, 'seriesResults'));

        setTeams(teamsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team)));
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          const openDate = data.picksOpenTime.toDate();
          const lockDate = data.picksLockTime.toDate();
          setSettings({
            picksOpenTime: openDate,
            picksLockTime: lockDate
          });
          setOpenTimeStr(openDate.toISOString().slice(0, 16));
          setLockTimeStr(lockDate.toISOString().slice(0, 16));
        } else {
          // Default settings if none exist
          const openDate = new Date();
          const lockDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          setSettings({
            picksOpenTime: openDate,
            picksLockTime: lockDate
          });
          setOpenTimeStr(openDate.toISOString().slice(0, 16));
          setLockTimeStr(lockDate.toISOString().slice(0, 16));
        }
        setSeries(seriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SeriesResult)));
      } catch (error) {
        console.error("Error fetching admin data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
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
        lastDataChanged: new Date()
      });
      setMessage({ type: 'success', text: 'Series result overridden successfully.' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to override series.' });
    }
  };

  const handleSyncAndCalculate = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      // 1. Sync Results
      const syncRes = await fetch('/api/sync-results', { method: 'POST' });
      const syncData = await syncRes.json();
      if (syncData.status !== 'success') throw new Error(syncData.message);

      // 2. Calculate Scores
      const calcRes = await fetch('/api/calculate-scores', { method: 'POST' });
      const calcData = await calcRes.json();
      if (calcData.status !== 'success') throw new Error(calcData.message);

      setMessage({ type: 'success', text: 'NBA results synced and scores recalculated successfully!' });
    } catch (error) {
      console.error("Sync/Calc Error:", error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to sync and calculate scores.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncStandings = async () => {
    setSyncingStandings(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync-standings', { method: 'POST' });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.message);

      setMessage({ type: 'success', text: 'NBA standings synced successfully! Refreshing teams...' });
      
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

  if (loading) return <div className="p-8 text-orange-500 animate-pulse font-bold">Loading Super Admin Controls...</div>;

  return (
    <div className="space-y-12 max-w-5xl mx-auto pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center gap-4 border-b border-white/10 pb-6">
        <div className="bg-red-500/20 p-3 rounded-2xl border border-red-500/50">
          <Shield className="w-8 h-8 text-red-500" />
        </div>
        <div>
          <h1 className="text-4xl font-black uppercase italic tracking-tighter">Super Admin <span className="text-red-500">Command</span></h1>
          <p className="text-gray-500 font-medium uppercase tracking-widest text-xs">Global Tournament Configuration</p>
        </div>
        <div className="ml-auto">
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
                Sync Data & Calculate Scores
              </>
            )}
          </button>
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-xl border ${message.type === 'success' ? 'bg-green-500/10 border-green-500/50 text-green-400' : 'bg-red-500/10 border-red-500/50 text-red-400'} flex items-center gap-3`}>
          <AlertTriangle className="w-5 h-5" />
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Global Settings */}
        <section className="bg-white/5 border border-white/10 rounded-3xl p-8 space-y-6">
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="w-6 h-6 text-orange-500" />
            <h2 className="text-xl font-bold uppercase italic">Global Deadlines</h2>
          </div>
          <form onSubmit={handleUpdateSettings} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Picks Open Time</label>
              <input 
                type="datetime-local" 
                value={openTimeStr}
                onChange={(e) => setOpenTimeStr(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-orange-500/50 outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Picks Lock Time</label>
              <input 
                type="datetime-local" 
                value={lockTimeStr}
                onChange={(e) => setLockTimeStr(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-orange-500/50 outline-none"
              />
            </div>
            <button type="submit" className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
              <Save className="w-4 h-4" /> Save Deadlines
            </button>
          </form>
        </section>

        {/* Manual Override */}
        <section className="bg-white/5 border border-white/10 rounded-3xl p-8 space-y-6">
          <div className="flex items-center gap-3 mb-4">
            <Trophy className="w-6 h-6 text-orange-500" />
            <h2 className="text-xl font-bold uppercase italic">Manual Overrides</h2>
          </div>
          <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
            {series.map(s => (
              <div key={s.id} className="p-4 bg-black/40 border border-white/5 rounded-xl flex items-center justify-between gap-4">
                <div className="text-xs font-bold text-gray-400 uppercase">{s.id}</div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleManualOverride(s.id, s.team1Id)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${s.advancingTeamId === s.team1Id ? 'bg-orange-500 text-white' : 'bg-white/5 hover:bg-white/10'}`}
                  >
                    {s.team1Id}
                  </button>
                  <button 
                    onClick={() => handleManualOverride(s.id, s.team2Id)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${s.advancingTeamId === s.team2Id ? 'bg-orange-500 text-white' : 'bg-white/5 hover:bg-white/10'}`}
                  >
                    {s.team2Id}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Team Seeding */}
      <section className="bg-white/5 border border-white/10 rounded-3xl p-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Users className="w-6 h-6 text-orange-500" />
            <h2 className="text-xl font-bold uppercase italic">Team Seeding (1-10)</h2>
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
            <button className="bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2">
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
                  <div key={team.id} className="flex items-center gap-3 bg-black/40 p-3 rounded-xl border border-white/5 group">
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

      {/* Danger Zone */}
      <section className="bg-red-500/5 border border-red-500/20 rounded-3xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <AlertTriangle className="w-6 h-6 text-red-500" />
          <h2 className="text-xl font-bold uppercase italic text-red-500">Danger Zone</h2>
        </div>
        
        <div className="bg-black/40 border border-red-500/10 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-1">
            <h3 className="text-lg font-bold">Reset All Contestant Picks</h3>
            <p className="text-sm text-gray-500 max-w-md">
              Permanently deletes every bracket and pick in the system. Use this to clear test data before the official tournament begins.
            </p>
          </div>
          
          {showClearConfirm ? (
            <div className="flex items-center gap-3 animate-in fade-in zoom-in duration-300">
              <button 
                onClick={() => setShowClearConfirm(false)}
                className="px-6 py-3 rounded-xl text-xs font-bold text-gray-400 hover:text-white transition-all"
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
