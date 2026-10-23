import React from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { Stretch } from '../services/api';
import { useTheme } from './ui';

/** River safety status — derived from live closures stored in the database. */
export const StretchBanner: React.FC<{ stretches: Stretch[] }> = ({ stretches }) => {
  const closed = stretches.filter((s) => s.status === 'CLOSED');
  const light = useTheme() === 'light';
  if (stretches.length === 0) return null;
  return (
    <div className="mb-6">
      {closed.length > 0 ? (
        <div
          className={`rounded-2xl p-4 flex items-start gap-3 border ${light ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-amber-950/40 border-amber-500/30 text-amber-200'}`}
          role="status"
        >
          <ShieldAlert className={`w-5 h-5 shrink-0 mt-0.5 ${light ? 'text-amber-700' : 'text-amber-400'}`} />
          <div className="text-xs sm:text-sm space-y-1">
            <span className={`font-semibold ${light ? 'text-amber-900' : 'text-amber-300'}`}>River safety notice</span>
            {closed.map((s) => (
              <div key={s.id}>
                <strong>{s.name}</strong> is closed{s.closure?.river_wide ? ' (entire river)' : ''}: {s.closure?.reason}
                {s.closure?.until ? ` — until ${new Date(s.closure.until).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` : ' — until further notice'}.
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          className={`rounded-2xl p-3 flex items-center gap-2 text-xs sm:text-sm border ${light ? 'bg-green-50 border-green-200 text-green-900' : 'bg-emerald-950/30 border-emerald-500/20 text-emerald-200'}`}
          role="status"
        >
          <CheckCircle2 className={`w-5 h-5 shrink-0 ${light ? 'text-green-700' : 'text-emerald-400'}`} />
          No river closures are in force right now.
        </div>
      )}
    </div>
  );
};
