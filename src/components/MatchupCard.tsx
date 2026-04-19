import React from 'react';
import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { Team, PickStatus } from '../types/database';

import { getAbbreviation } from '../utils/teamUtils';

interface MatchupCardProps {
  matchupId: string;
  team1: Team | null;
  team2: Team | null;
  userPick?: any; // Flexible for Pick | PlayInPick
  actualResult?: {
    advancingTeamId: string;
    totalGamesPlayed: number;
    team1Wins?: number;
    team2Wins?: number;
  };
  onPick?: (teamId: string, length: number) => void;
  isLocked?: boolean;
}

export const MatchupCard: React.FC<MatchupCardProps> = ({
  matchupId,
  team1,
  team2,
  userPick,
  actualResult,
  onPick,
  isLocked
}) => {
  const getDerivedStatus = () => {
    if (!userPick) return PickStatus.PENDING;
    if (!actualResult?.advancingTeamId) return PickStatus.PENDING;

    const pickedId = userPick.predictedTeamId || userPick.predictedWinnerId;
    if (actualResult.advancingTeamId === pickedId) return PickStatus.CORRECT;
    return PickStatus.INCORRECT;
  };

  const getSeriesProgressLabel = () => {
    const status = getDerivedStatus();
    // If Correct/Incorrect, show that. Otherwise show progress.
    if (status !== PickStatus.PENDING) return status;

    if (!actualResult || (actualResult.team1Wins === undefined && actualResult.team2Wins === undefined)) {
        return PickStatus.PENDING;
    }

    const t1w = actualResult.team1Wins || 0;
    const t2w = actualResult.team2Wins || 0;
    const t1Name = getAbbreviation(team1);
    const t2Name = getAbbreviation(team2);

    if (t1w === t2w) return `Series tied ${t1w}-${t2w}`;
    
    if (t1w > t2w) {
        return `${t1Name} leads ${t1w}-${t2w}`;
    } else {
        return `${t2Name} leads ${t2w}-${t1w}`;
    }
  };

  const getStatusIcon = () => {
    const status = getDerivedStatus();
    if (status === PickStatus.PENDING) return <MinusCircle className="w-4 h-4 text-gray-500" />;
    if (status === PickStatus.CORRECT) return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    return <XCircle className="w-4 h-4 text-red-500" />;
  };

  const isEliminated = (teamId: string) => {
    return actualResult?.advancingTeamId && actualResult.advancingTeamId !== teamId;
  };

  const isWinner = (teamId: string) => {
    return actualResult?.advancingTeamId === teamId;
  };

  const isPicked = (teamId: string) => {
    if (!userPick) return false;
    return userPick.predictedTeamId === teamId || userPick.predictedWinnerId === teamId;
  };

  return (
    <div className="relative group w-48">
      {/* Glassmorphism Container */}
      <div className="w-full bg-white/70 backdrop-blur-xl border border-black/10 rounded-xl overflow-hidden shadow-2xl transition-all hover:border-orange-500/50">
        {/* Team 1 */}
        <div 
          onClick={() => !isLocked && team1 && onPick?.(team1.id, 4)}
          className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
            isPicked(team1?.id || '') ? 'bg-orange-500/20' : 'hover:bg-black/5'
          } ${isLocked ? 'cursor-default' : ''}`}
        >
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            <span className="text-[10px] font-bold text-gray-500 w-3">{team1?.seed}</span>
            <span className={`text-sm font-bold truncate ${isEliminated(team1?.id || '') ? 'line-through opacity-40' : ''} ${isWinner(team1?.id || '') ? 'text-orange-500' : ''}`}>
              {getAbbreviation(team1)}
            </span>
          </div>
          {isPicked(team1?.id || '') && <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(245,132,38,0.8)]" />}
        </div>

        <div className="h-px bg-black/5 mx-2" />

        {/* Team 2 */}
        <div 
          onClick={() => !isLocked && team2 && onPick?.(team2.id, 4)}
          className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
            isPicked(team2?.id || '') ? 'bg-orange-500/20' : 'hover:bg-black/5'
          } ${isLocked ? 'cursor-default' : ''}`}
        >
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            <span className="text-[10px] font-bold text-gray-500 w-3">{team2?.seed}</span>
            <span className={`text-sm font-bold truncate ${isEliminated(team2?.id || '') ? 'line-through opacity-40' : ''} ${isWinner(team2?.id || '') ? 'text-orange-500' : ''}`}>
              {getAbbreviation(team2)}
            </span>
          </div>
          {isPicked(team2?.id || '') && <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(245,132,38,0.8)]" />}
        </div>

        {/* Status Footer */}
        {(userPick || actualResult) && (
          <div className="bg-black/5 px-3 py-1.5 flex items-center justify-between border-t border-black/5">
            <div className="flex items-center gap-1.5">
              {getStatusIcon()}
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {getSeriesProgressLabel()}
              </span>
            </div>
            {userPick && !isLocked && !matchupId.startsWith('PI_') && (
              <div className="flex gap-1">
                {[4, 5, 6, 7].map(len => (
                  <button
                    key={len}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPick?.(userPick.predictedTeamId, len);
                    }}
                    className={`w-4 h-4 flex items-center justify-center rounded-[2px] text-[8px] font-black transition-all ${
                      userPick.predictedSeriesLength === len 
                        ? 'bg-orange-500 text-white' 
                        : 'bg-white/5 text-gray-500 hover:bg-white/10'
                    }`}
                  >
                    {len}
                  </button>
                ))}
              </div>
            )}
            {userPick && isLocked && !matchupId.startsWith('PI_') && (
              <span className="text-[10px] font-black text-orange-500/80 italic">
                IN {userPick.predictedSeriesLength}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
