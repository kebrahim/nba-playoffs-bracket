import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface CountdownTimerProps {
  lockTime: Date | null;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({ lockTime }) => {
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!lockTime) return;

    const calculateTimeLeft = () => {
      const now = new Date();
      const difference = lockTime.getTime() - now.getTime();

      if (difference <= 0) {
        setTimeLeft('LOCKED');
        setIsExpired(true);
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((difference / 1000 / 60) % 60);
      const seconds = Math.floor((difference / 1000) % 60);

      const parts = [];
      if (days > 0) parts.push(`${days}d`);
      if (hours > 0 || days > 0) parts.push(`${hours}h`);
      parts.push(`${minutes}m`);
      if (days === 0) parts.push(`${seconds}s`);

      setTimeLeft(parts.join(' '));
      setIsExpired(false);
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [lockTime]);

  if (!lockTime) return null;

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all duration-500 ${
      isExpired 
        ? 'bg-red-500/10 border-red-500/20 text-red-500' 
        : 'bg-orange-500/10 border-orange-500/20 text-orange-600 animate-pulse'
    }`}>
      <Clock className={`w-3.5 h-3.5 ${isExpired ? '' : 'animate-spin-slow'}`} />
      <div className="flex flex-col">
        <span className="text-[8px] font-black uppercase tracking-[0.2em] leading-none mb-0.5">
          {isExpired ? 'Picks Status' : 'Locking In'}
        </span>
        <span className="text-xs font-black tabular-nums leading-none">
          {timeLeft}
        </span>
      </div>
    </div>
  );
};
