import React from 'react';
import { ShieldCheck, Lock, Award, Compass } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 text-slate-400 py-12 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div>
          <div className="flex items-center gap-2 font-bold text-white text-lg mb-3">
            <Compass className="w-5 h-5 text-teal-400" />
            RaftNow Rishikesh
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            A digital booking marketplace for white water rafting in Rishikesh, Uttarakhand: licensed operators, live river status and signed QR tickets.
          </p>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-3">
            Safety & Standards
          </h4>
          <ul className="space-y-2 text-xs">
            <li className="flex items-center gap-1.5 text-slate-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Licensed operators only
            </li>
            <li className="flex items-center gap-1.5 text-slate-300">
              <Award className="w-4 h-4 text-emerald-400" /> Certified River Guides
            </li>
            <li className="flex items-center gap-1.5 text-slate-300">
              <Lock className="w-4 h-4 text-emerald-400" /> Mandatory Life Jackets & Helmets
            </li>
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-3">
            Rafting Stretches
          </h4>
          <ul className="space-y-1.5 text-xs text-slate-400">
            <li>Brahmpuri to NIM Beach (9 km)</li>
            <li>Shivpuri to NIM Beach (16 km)</li>
            <li>Marine Drive to Shivpuri (26 km)</li>
            <li>Kaudiyala to Marine Drive (35 km)</li>
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-3">
            Payment & Refund Guarantee
          </h4>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Operator payouts are released 24 hours after your trip. If a stretch is closed for safety, affected bookings are cancelled and fully refunded.
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-300 font-mono">
            <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded">Razorpay Route</span>
            <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded">SSL 256-bit</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500">
        <div>© 2026 RaftNow Technologies. All rights reserved. Rishikesh, India.</div>
        <div className="flex gap-4 mt-2 sm:mt-0">
          <span>Terms of Service</span>
          <span>Privacy Policy</span>
          <span>River Safety Code</span>
        </div>
      </div>
    </footer>
  );
};
