import React from 'react';
import { ShieldCheck, Lock, Award, Compass } from 'lucide-react';
import { useTheme } from './ui';

export const Footer: React.FC = () => {
  const light = useTheme() === 'light';
  // Light: white footer with neutral text; dark: the original console footer.
  const t = (dark: string, lightCls: string) => (light ? lightCls : dark);
  return (
    <footer className={`border-t py-12 mt-20 ${t('border-slate-800 bg-slate-950 text-slate-400', 'border-neutral-200 bg-white text-neutral-600')}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div>
          <div className={`flex items-center gap-2 font-bold text-lg mb-3 ${t('text-white', 'text-neutral-900')}`}>
            <Compass className={`w-5 h-5 ${t('text-teal-400', 'text-[#008cff]')}`} />
            RaftNow Rishikesh
          </div>
          <p className={`text-xs leading-relaxed ${t('text-slate-400', 'text-neutral-600')}`}>
            A digital booking marketplace for white water rafting in Rishikesh, Uttarakhand: licensed operators, live river status and signed QR tickets.
          </p>
        </div>

        <div>
          <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${t('text-slate-200', 'text-neutral-900')}`}>
            Safety & Standards
          </h4>
          <ul className="space-y-2 text-xs">
            <li className={`flex items-center gap-1.5 ${t('text-slate-300', 'text-neutral-700')}`}>
              <ShieldCheck className={`w-4 h-4 ${t('text-emerald-400', 'text-green-700')}`} /> Licensed operators only
            </li>
            <li className={`flex items-center gap-1.5 ${t('text-slate-300', 'text-neutral-700')}`}>
              <Award className={`w-4 h-4 ${t('text-emerald-400', 'text-green-700')}`} /> Certified River Guides
            </li>
            <li className={`flex items-center gap-1.5 ${t('text-slate-300', 'text-neutral-700')}`}>
              <Lock className={`w-4 h-4 ${t('text-emerald-400', 'text-green-700')}`} /> Mandatory Life Jackets & Helmets
            </li>
          </ul>
        </div>

        <div>
          <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${t('text-slate-200', 'text-neutral-900')}`}>
            Rafting Stretches
          </h4>
          <ul className={`space-y-1.5 text-xs ${t('text-slate-400', 'text-neutral-600')}`}>
            <li>Brahmpuri to NIM Beach (9 km)</li>
            <li>Shivpuri to NIM Beach (16 km)</li>
            <li>Marine Drive to Shivpuri (26 km)</li>
            <li>Kaudiyala to Marine Drive (35 km)</li>
          </ul>
        </div>

        <div>
          <h4 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${t('text-slate-200', 'text-neutral-900')}`}>
            Payment & Refund Guarantee
          </h4>
          <p className={`text-xs leading-relaxed mb-3 ${t('text-slate-400', 'text-neutral-600')}`}>
            Operator payouts are released 24 hours after your trip. If a stretch is closed for safety, affected bookings are cancelled and fully refunded.
          </p>
          <div className={`flex items-center gap-2 text-xs font-mono ${t('text-slate-300', 'text-neutral-700')}`}>
            <span className={`px-2 py-1 border rounded ${t('bg-slate-900 border-slate-800', 'bg-neutral-50 border-neutral-200')}`}>Razorpay Route</span>
            <span className={`px-2 py-1 border rounded ${t('bg-slate-900 border-slate-800', 'bg-neutral-50 border-neutral-200')}`}>SSL 256-bit</span>
          </div>
        </div>
      </div>

      <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-6 border-t flex flex-col sm:flex-row items-center justify-between text-xs ${t('border-slate-900 text-slate-500', 'border-neutral-200 text-neutral-500')}`}>
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
