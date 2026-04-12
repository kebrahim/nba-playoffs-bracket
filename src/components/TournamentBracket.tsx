import React from 'react';
import { MatchupCard } from './MatchupCard';
import { Team, Pick, SeriesResult } from '../types/database';
import { ArrowRight, CornerDownRight, CornerUpRight } from 'lucide-react';

interface TournamentBracketProps {
  teams: Team[];
  userPicks: Pick[];
  actualResults: SeriesResult[];
  onPick: (matchupId: string, teamId: string, length: number) => void;
  isLocked: boolean;
  tiebreakerPrediction: number;
  onTiebreakerChange: (value: number) => void;
}

export const TournamentBracket: React.FC<TournamentBracketProps> = ({
  teams,
  userPicks,
  actualResults,
  onPick,
  isLocked,
  tiebreakerPrediction,
  onTiebreakerChange
}) => {
  const [activeConf, setActiveConf] = React.useState<'East' | 'West' | 'Finals'>('East');
  const getPick = (matchupId: string) => userPicks.find((p: any) => p.matchupId === matchupId);
  const getResult = (matchupId: string) => actualResults.find(r => r.id === matchupId);

  const getTeamBySeed = (conf: 'East' | 'West', seed: number) => 
    teams.find(t => t.conference === (conf as any) && t.seed === seed);

  const getTeamById = (id: string) => teams.find(t => t.id === id);

  // Helper to get the winner of a matchup (either actual or user pick)
  const getWinner = (matchupId: string) => {
    const result = getResult(matchupId);
    if (result?.advancingTeamId) return getTeamById(result.advancingTeamId);
    
    const pick = getPick(matchupId);
    if (pick) {
      const winnerId = (pick as any).predictedTeamId || (pick as any).predictedWinnerId;
      if (winnerId) return getTeamById(winnerId);
    }
    
    return null;
  };

  // Helper to get the loser of a matchup
  const getLoser = (matchupId: string, t1: Team | null, t2: Team | null) => {
    const result = getResult(matchupId);
    if (result?.eliminatedTeamId) return getTeamById(result.eliminatedTeamId);
    
    const pick = getPick(matchupId);
    if (pick && t1 && t2) {
      const winnerId = (pick as any).predictedTeamId || (pick as any).predictedWinnerId;
      if (winnerId === t1.id) return t2;
      if (winnerId === t2.id) return t1;
    }
    
    return null;
  };

  // Helper to render a bracket section (East/West)
  const renderConference = (conf: 'East' | 'West') => {
    const c = conf.charAt(0);
    
    // Play-In Teams
    const piA_t1 = getTeamBySeed(conf, 7);
    const piA_t2 = getTeamBySeed(conf, 8);
    const piB_t1 = getTeamBySeed(conf, 9);
    const piB_t2 = getTeamBySeed(conf, 10);

    // Play-In Winners/Losers
    const piWinner7 = getWinner(`PI_${c}_A`); // Winner of 7v8
    const piLoserA = getLoser(`PI_${c}_A`, piA_t1 || null, piA_t2 || null);
    const piWinnerB = getWinner(`PI_${c}_B`); // Winner of 9v10
    const piWinner8 = getWinner(`PI_${c}_C`); // Winner of Loser A v Winner B

    // Round 1 Matchups
    const r1_1v8 = { t1: getTeamBySeed(conf, 1), t2: piWinner8 };
    const r1_4v5 = { t1: getTeamBySeed(conf, 4), t2: getTeamBySeed(conf, 5) };
    const r1_2v7 = { t1: getTeamBySeed(conf, 2), t2: piWinner7 };
    const r1_3v6 = { t1: getTeamBySeed(conf, 3), t2: getTeamBySeed(conf, 6) };

    const r1Matchups = [r1_1v8, r1_4v5, r1_2v7, r1_3v6];

    // Round 2 Matchups
    const r2_1 = { t1: getWinner(`R1_${c}_1`), t2: getWinner(`R1_${c}_2`) };
    const r2_2 = { t1: getWinner(`R1_${c}_3`), t2: getWinner(`R1_${c}_4`) };
    const r2Matchups = [r2_1, r2_2];

    // Conf Finals
    const cf = { t1: getWinner(`R2_${c}_1`), t2: getWinner(`R2_${c}_2`) };

    return (
      <div className="flex flex-col lg:flex-row gap-12 items-center justify-center py-8">
        {/* Play-In Section */}
        <div className="bg-white/70 backdrop-blur-xl p-8 rounded-[2.5rem] border border-black/10 w-full lg:w-auto shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-orange-500/20 to-transparent" />
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-8 text-center lg:text-left">Play-In Tournament</h3>
          
          <div className="flex flex-col sm:flex-row items-center gap-12 relative">
            {/* Game 1 & 2 Column */}
            <div className="flex flex-col gap-12 relative">
              {/* Game 1 */}
              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[8px] font-black uppercase tracking-widest text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded">Game 1</span>
                  <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">7 vs 8</span>
                </div>
                <MatchupCard 
                  matchupId={`PI_${c}_A`}
                  team1={piA_t1 || null}
                  team2={piA_t2 || null}
                  userPick={getPick(`PI_${c}_A`) as any}
                  actualResult={getResult(`PI_${c}_A`)}
                  onPick={(teamId, len) => onPick(`PI_${c}_A`, teamId, len)}
                  isLocked={isLocked}
                />
                
                {/* Winner to 7th Indicator */}
                <div className="absolute -right-8 top-1/2 -translate-y-1/2 flex items-center gap-1 text-orange-500">
                  <ArrowRight className="w-4 h-4 animate-pulse" />
                  <div className="hidden lg:block absolute left-6 whitespace-nowrap">
                    <span className="text-[7px] font-black uppercase tracking-tighter bg-orange-500 text-white px-1.5 py-0.5 rounded shadow-sm">Winner to 7th Seed</span>
                  </div>
                </div>

                {/* Loser to Game 3 Connector */}
                <div className="absolute left-1/2 -bottom-8 -translate-x-1/2 flex flex-col items-center gap-1">
                  <div className="w-px h-6 bg-gradient-to-b from-black/20 to-transparent" />
                  <span className="text-[7px] font-bold text-gray-400 uppercase tracking-tighter">Loser to Game 3</span>
                </div>
              </div>

              {/* Game 2 */}
              <div className="relative mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[8px] font-black uppercase tracking-widest text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded">Game 2</span>
                  <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">9 vs 10</span>
                </div>
                <MatchupCard 
                  matchupId={`PI_${c}_B`}
                  team1={piB_t1 || null}
                  team2={piB_t2 || null}
                  userPick={getPick(`PI_${c}_B`) as any}
                  actualResult={getResult(`PI_${c}_B`)}
                  onPick={(teamId, len) => onPick(`PI_${c}_B`, teamId, len)}
                  isLocked={isLocked}
                />
                
                {/* Winner to Game 3 Connector */}
                <div className="absolute -right-8 top-1/2 -translate-y-1/2 flex items-center text-orange-500/40">
                  <CornerUpRight className="w-6 h-6" />
                  <span className="text-[7px] font-bold uppercase tracking-tighter ml-1">Winner</span>
                </div>
              </div>
            </div>

            {/* Game 3 Column */}
            <div className="flex flex-col justify-center pt-8">
              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[8px] font-black uppercase tracking-widest text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded">Game 3</span>
                  <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Final Spot</span>
                </div>
                <MatchupCard 
                  matchupId={`PI_${c}_C`}
                  team1={piLoserA || null}
                  team2={piWinnerB || null}
                  userPick={getPick(`PI_${c}_C`) as any}
                  actualResult={getResult(`PI_${c}_C`)}
                  onPick={(teamId, len) => onPick(`PI_${c}_C`, teamId, len)}
                  isLocked={isLocked}
                />
                
                {/* Winner to 8th Indicator */}
                <div className="absolute -right-8 top-1/2 -translate-y-1/2 flex items-center gap-1 text-orange-500">
                  <ArrowRight className="w-4 h-4 animate-pulse" />
                  <div className="hidden lg:block absolute left-6 whitespace-nowrap">
                    <span className="text-[7px] font-black uppercase tracking-tighter bg-orange-500 text-white px-1.5 py-0.5 rounded shadow-sm">Winner to 8th Seed</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Round 1 */}
        <div className="space-y-6 flex flex-col items-center lg:items-start">
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-4 px-2">Round 1</h3>
          {r1Matchups.map((m, i) => {
            const matchupId = `R1_${c}_${i + 1}`;
            return (
              <MatchupCard 
                key={matchupId}
                matchupId={matchupId}
                team1={m.t1 || null}
                team2={m.t2 || null}
                userPick={getPick(matchupId) as any}
                actualResult={getResult(matchupId)}
                onPick={(teamId, len) => onPick(matchupId, teamId, len)}
                isLocked={isLocked}
              />
            );
          })}
        </div>

        {/* Round 2 */}
        <div className="space-y-12 flex flex-col items-center lg:items-start">
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-4 px-2">Semifinals</h3>
          {r2Matchups.map((m, i) => {
            const matchupId = `R2_${c}_${i + 1}`;
            return (
              <MatchupCard 
                key={matchupId}
                matchupId={matchupId}
                team1={m.t1 || null}
                team2={m.t2 || null}
                userPick={getPick(matchupId) as any}
                actualResult={getResult(matchupId)}
                onPick={(teamId, len) => onPick(matchupId, teamId, len)}
                isLocked={isLocked}
              />
            );
          })}
        </div>

        {/* Conf Finals */}
        <div className="space-y-4 flex flex-col items-center lg:items-start">
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-4 px-2 text-center lg:text-left">Conf. Finals</h3>
          <MatchupCard 
            matchupId={`CF_${c}`}
            team1={cf.t1 || null}
            team2={cf.t2 || null}
            userPick={getPick(`CF_${c}`) as any}
            actualResult={getResult(`CF_${c}`)}
            onPick={(teamId, len) => onPick(`CF_${c}`, teamId, len)}
            isLocked={isLocked}
          />
        </div>
      </div>
    );
  };

  const finalsMatchup = {
    t1: getWinner('CF_E'),
    t2: getWinner('CF_W')
  };

  const getMissingCount = (conf: 'East' | 'West' | 'Finals') => {
    if (conf === 'Finals') {
      let missing = 0;
      if (!getPick('FINALS')) missing++;
      if (!tiebreakerPrediction || tiebreakerPrediction <= 0) missing++;
      return missing;
    }

    const c = conf.charAt(0);
    const requiredIds = [
      `PI_${c}_A`, `PI_${c}_B`, `PI_${c}_C`,
      `R1_${c}_1`, `R1_${c}_2`, `R1_${c}_3`, `R1_${c}_4`,
      `R2_${c}_1`, `R2_${c}_2`,
      `CF_${c}`
    ];
    
    return requiredIds.filter(id => !getPick(id)).length;
  };

  const eastMissing = getMissingCount('East');
  const westMissing = getMissingCount('West');
  const finalsMissing = getMissingCount('Finals');

  return (
    <div className="space-y-8">
      {/* Conference Tabs */}
      <div className="flex items-center justify-center gap-1 sm:gap-2 bg-black/5 p-1 sm:p-1.5 rounded-xl sm:rounded-2xl border border-black/10 w-full sm:w-fit max-w-[calc(100vw-2rem)] mx-auto overflow-x-auto no-scrollbar">
        <button 
          onClick={() => setActiveConf('East')}
          className={`flex-1 sm:flex-none px-3 sm:px-8 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeConf === 'East' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-500 hover:text-gray-900'}`}
        >
          <span className="hidden sm:inline">Eastern Conference</span>
          <span className="sm:hidden">East</span>
          {eastMissing > 0 && (
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
          )}
        </button>
        <button 
          onClick={() => setActiveConf('West')}
          className={`flex-1 sm:flex-none px-3 sm:px-8 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeConf === 'West' ? 'bg-red-600 text-white shadow-lg shadow-red-600/20' : 'text-gray-500 hover:text-gray-900'}`}
        >
          <span className="hidden sm:inline">Western Conference</span>
          <span className="sm:hidden">West</span>
          {westMissing > 0 && (
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
          )}
        </button>
        <button 
          onClick={() => setActiveConf('Finals')}
          className={`flex-1 sm:flex-none px-3 sm:px-8 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeConf === 'Finals' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-500 hover:text-gray-900'}`}
        >
          <span className="hidden sm:inline">The Finals</span>
          <span className="sm:hidden">Finals</span>
          {finalsMissing > 0 && (
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
          )}
        </button>
      </div>

      <div className="min-h-[600px]">
        {activeConf === 'East' && renderConference('East')}
        {activeConf === 'West' && renderConference('West')}
        {activeConf === 'Finals' && (
          <div className="flex flex-col items-center justify-center py-12 gap-12">
            <div className="text-center">
              <h2 className="text-5xl font-black italic uppercase text-orange-500 tracking-tighter mb-2">The Finals</h2>
              <p className="text-sm text-gray-500 font-bold uppercase tracking-[0.3em]">Larry O'Brien Trophy</p>
            </div>
            
            <div className="relative">
              {/* Decorative background for Finals */}
              <div className="absolute inset-0 bg-orange-500/10 blur-3xl rounded-full -z-10" />
              <MatchupCard 
                matchupId="FINALS"
                team1={finalsMatchup.t1 || null}
                team2={finalsMatchup.t2 || null}
                userPick={getPick('FINALS') as any}
                actualResult={getResult('FINALS')}
                onPick={(teamId, len) => onPick('FINALS', teamId, len)}
                isLocked={isLocked}
              />
            </div>

            {/* Tiebreaker Input */}
            <div className="w-64 bg-white/70 backdrop-blur-xl border border-black/10 rounded-2xl p-6 space-y-4 shadow-2xl">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 block mb-2">
                  Finals Tiebreaker
                </label>
                <div className="relative">
                  <input 
                    type="number"
                    disabled={isLocked}
                    value={tiebreakerPrediction || ''}
                    onChange={(e) => onTiebreakerChange(parseInt(e.target.value) || 0)}
                    placeholder="Total Points"
                    className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-lg font-black focus:border-orange-500/50 outline-none transition-all placeholder:text-gray-400 text-gray-900"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-gray-600 uppercase">PTS</span>
                </div>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed font-medium">
                Predict the total combined points scored by both teams in the final game of the series.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
