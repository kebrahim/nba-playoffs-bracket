import React, { useState } from 'react';
import { Plus, Search, Users, Trophy, ChevronRight, Lock } from 'lucide-react';
import { League } from '../types/database';

interface LeagueLobbyProps {
  leagues: League[];
  onJoinLeague: (code: string) => void;
  onCreateLeague: () => void;
  onSelectLeague: (leagueId: string) => void;
  isAdmin?: boolean;
}

export const LeagueLobby: React.FC<LeagueLobbyProps> = ({
  leagues,
  onJoinLeague,
  onCreateLeague,
  onSelectLeague,
  isAdmin = false
}) => {
  const [inviteCode, setInviteCode] = useState('');

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header Actions */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div>
          <h2 className="text-3xl font-black uppercase italic leading-none mb-2 text-gray-900">My Leagues</h2>
          <p className="text-gray-500 text-sm font-medium">Manage your active bracket challenges</p>
        </div>
        
        <div className="flex flex-wrap gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:flex-none">
            <input 
              type="text" 
              placeholder="Enter Invite Code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="w-full md:w-48 bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-all text-gray-900"
            />
            <button 
              onClick={() => onJoinLeague(inviteCode)}
              className="absolute right-2 top-2 p-1.5 bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors"
            >
              <Plus className="w-4 h-4 text-white" />
            </button>
          </div>
          {isAdmin && (
            <button 
              onClick={onCreateLeague}
              className="bg-white text-black font-bold px-6 py-3 rounded-xl text-sm hover:bg-gray-200 transition-all flex items-center gap-2"
            >
              <Trophy className="w-4 h-4" />
              Create League
            </button>
          )}
        </div>
      </div>

      {/* League Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {leagues.length === 0 ? (
          <div className="col-span-full py-20 text-center bg-black/5 border border-dashed border-black/10 rounded-3xl">
            <Search className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 font-medium">No leagues found. Join one to get started!</p>
          </div>
        ) : (
          leagues.map((league) => (
            <div 
              key={league.id}
              onClick={() => onSelectLeague(league.id)}
              className="group relative overflow-hidden bg-white/70 backdrop-blur-xl border border-black/5 rounded-3xl p-6 cursor-pointer hover:border-orange-500/50 transition-all duration-500 shadow-xl"
            >
              <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-orange-500/5 blur-3xl rounded-full group-hover:bg-orange-500/10 transition-all duration-700" />
              
              <div className="flex justify-between items-start mb-6 relative z-10">
                <div className="bg-black/5 p-3 rounded-2xl group-hover:bg-orange-500/20 transition-all duration-500">
                  <Users className="w-6 h-6 text-orange-500" />
                </div>
                <div className="flex items-center gap-1.5 bg-white/60 px-2.5 py-1 rounded-full border border-black/5">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Active</span>
                </div>
              </div>

              <div className="relative z-10">
                <h3 className="text-2xl font-black uppercase italic mb-1 group-hover:text-orange-500 transition-colors tracking-tighter text-gray-900">
                  {league.leagueName}
                </h3>
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em] mb-8">
                  Commish: {league.commissionerName || league.commissionerId.slice(0, 8)}
                </p>

                <div className="flex items-center justify-between pt-5 border-t border-black/5">
                  <div className="flex -space-x-2.5">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white shadow-lg" />
                    ))}
                    <div className="w-8 h-8 rounded-full bg-orange-500/20 border-2 border-white flex items-center justify-center backdrop-blur-sm">
                      <span className="text-[10px] font-black text-orange-500">+{league.participants?.length || 0}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-orange-500 font-black uppercase tracking-widest text-[10px] group-hover:translate-x-1 transition-transform">
                    Enter
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
