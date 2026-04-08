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
          <h2 className="text-3xl font-black uppercase italic leading-none mb-2">My Leagues</h2>
          <p className="text-gray-500 text-sm font-medium">Manage your active bracket challenges</p>
        </div>
        
        <div className="flex flex-wrap gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:flex-none">
            <input 
              type="text" 
              placeholder="Enter Invite Code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="w-full md:w-48 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 transition-all"
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
          <div className="col-span-full py-20 text-center bg-white/5 border border-dashed border-white/10 rounded-3xl">
            <Search className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 font-medium">No leagues found. Join one to get started!</p>
          </div>
        ) : (
          leagues.map((league) => (
            <div 
              key={league.id}
              onClick={() => onSelectLeague(league.id)}
              className="group relative overflow-hidden bg-gradient-to-br from-gray-900 to-black border border-white/5 rounded-3xl p-6 cursor-pointer hover:border-orange-500/50 transition-all"
            >
              <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-orange-500/5 blur-2xl rounded-full group-hover:bg-orange-500/10 transition-all" />
              
              <div className="flex justify-between items-start mb-6">
                <div className="bg-white/5 p-3 rounded-2xl group-hover:bg-orange-500/20 transition-all">
                  <Users className="w-6 h-6 text-orange-500" />
                </div>
                <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded-lg border border-white/5">
                  <Lock className="w-3 h-3 text-gray-500" />
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">Locked</span>
                </div>
              </div>

              <h3 className="text-xl font-black uppercase italic mb-1 group-hover:text-orange-500 transition-colors">
                {league.leagueName}
              </h3>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-6">
                Commissioner: {league.commissionerId.slice(0, 8)}...
              </p>

              <div className="flex items-center justify-between pt-4 border-t border-white/5">
                <div className="flex -space-x-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-6 h-6 rounded-full bg-gray-800 border-2 border-black" />
                  ))}
                  <div className="w-6 h-6 rounded-full bg-orange-500/20 border-2 border-black flex items-center justify-center">
                    <span className="text-[8px] font-bold text-orange-500">+12</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-orange-500 font-bold text-sm">
                  View Bracket
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
