import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Waves, Ticket, UserCheck, Settings } from 'lucide-react';
import { useTheme } from './ui';

export const Navbar: React.FC = () => {
  const location = useLocation();
  if (useTheme() === 'light') return <LightNavbar pathname={location.pathname} />;

  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-cyan-400 p-0.5 shadow-lg shadow-teal-500/20 group-hover:scale-105 transition-transform">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Waves className="w-5 h-5 text-teal-400" />
            </div>
          </div>
          <div>
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              Raft<span className="text-teal-400">Now</span>
            </span>
            <span className="hidden sm:inline-block ml-2 text-[10px] font-semibold tracking-wider text-teal-400 uppercase bg-teal-950/80 border border-teal-500/30 px-2 py-0.5 rounded-full">
              Licensed operators
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            to="/"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
              location.pathname === '/'
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Ticket className="w-4 h-4" />
            <span>Book Raft</span>
          </Link>

          <Link
            to="/vendor"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
              location.pathname.startsWith('/vendor')
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Operator Portal</span>
          </Link>

          <Link
            to="/admin"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
              location.pathname.startsWith('/admin')
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Admin Control</span>
          </Link>
        </nav>
      </div>
    </header>
  );
};

/** Customer site: white bar, blue wordmark, links to the business portals on the right. */
const LightNavbar: React.FC<{ pathname: string }> = ({ pathname }) => {
  const link = (to: string, active: boolean) =>
    `px-3 py-2 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5 ${
      active ? 'bg-blue-50 text-[#008cff]' : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
    }`;
  return (
    <header className="sticky top-0 z-50 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5" aria-label="RaftNow home">
          <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#53b2fe] to-[#065af3] flex items-center justify-center shadow-md shadow-blue-500/20">
            <Waves className="w-5 h-5 text-white" />
          </span>
          <span className="font-extrabold text-xl tracking-tight text-neutral-900">
            Raft<span className="text-[#008cff]">Now</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link to="/" className={link('/', pathname === '/')} aria-current={pathname === '/' ? 'page' : undefined} aria-label="Book rafting">
            <Ticket className="w-4 h-4" aria-hidden />
            <span className="hidden sm:inline">Book rafting</span>
          </Link>
          <Link to="/vendor" className={link('/vendor', false)} aria-label="For operators">
            <UserCheck className="w-4 h-4" />
            <span className="hidden sm:inline">For operators</span>
          </Link>
          <Link to="/admin" className={link('/admin', false)} aria-label="RaftNow team console">
            <Settings className="w-4 h-4" />
          </Link>
        </nav>
      </div>
    </header>
  );
};
