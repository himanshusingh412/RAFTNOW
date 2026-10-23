import React from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { Stretch } from '../services/api';

/** River safety status — derived from live closures stored in the database. */
export const StretchBanner: React.FC<{ stretches: Stretch[] }> = ({ stretches }) => {
  const closed = stretches.filter((s) => s.status === 'CLOSED');
  if (stretches.length === 0) return null;
  return (
    <div className="mb-6">
      {closed.length > 0 ? (
        <div className="bg-amber-950/40 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3 text-amber-200" role="status">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm space-y-1">
            <span className="font-semibold text-amber-300">River safety notice</span>
            {closed.map((s) => (
              <div key={s.id}>
                <strong>{s.name}</strong> is closed{s.closure?.river_wide ? ' (entire river)' : ''}: {s.closure?.reason}
                {s.closure?.until ? ` — until ${new Date(s.closure.until).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` : ' — until further notice'}.
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-emerald-950/30 border border-emerald-500/20 rounded-2xl p-3 flex items-center gap-2 text-emerald-200 text-xs sm:text-sm" role="status">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          No river closures are in force right now.
        </div>
      )}
    </div>
  );
};
