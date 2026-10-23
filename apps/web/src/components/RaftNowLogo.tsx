import React from 'react';
import { Waves } from 'lucide-react';

/** RaftNow brand mark: the teal→cyan tile with the waves glyph used in the navbar. Decorative. */
export const RaftNowMark: React.FC<{ className?: string }> = ({ className = 'h-16 w-16' }) => (
  <span
    aria-hidden="true"
    className={`inline-flex shrink-0 items-center justify-center rounded-[28%] bg-gradient-to-tr from-teal-500 to-cyan-400 shadow-lg shadow-teal-500/25 ${className}`}
  >
    <Waves className="h-[56%] w-[56%] text-white" strokeWidth={2.4} />
  </span>
);

/** "RaftNow" wordmark. `tone="light"` is for dark/photo backgrounds. */
export const RaftNowWordmark: React.FC<{ tone?: 'light' | 'dark'; className?: string }> = ({ tone = 'dark', className = '' }) => (
  <span role="img" aria-label="RaftNow" className={`font-display font-extrabold tracking-tight leading-none whitespace-nowrap ${className}`}>
    <span aria-hidden="true" className={tone === 'light' ? 'text-white' : 'text-navy'}>Raft</span>
    <span aria-hidden="true" className={tone === 'light' ? 'text-aqua-light' : 'text-aqua-dark'}>Now</span>
  </span>
);
