import React, { createContext, useContext, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { ApiError } from '../lib/api';

/**
 * Two looks share these components: the dark console used by the operator
 * portal and admin console (default), and the light travel-booking look of the
 * customer site. Wrap a subtree in <ThemeProvider value="light"> to switch it.
 */
export type Theme = 'dark' | 'light';
const ThemeContext = createContext<Theme>('dark');
export const ThemeProvider = ThemeContext.Provider;
export const useTheme = () => useContext(ThemeContext);
const pick = <T,>(theme: Theme, dark: T, light: T) => (theme === 'light' ? light : dark);

export const Panel: React.FC<{ title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  title,
  actions,
  children,
  className = '',
}) => {
  const t = useTheme();
  return (
    <section className={`${pick(t, 'glass-panel rounded-2xl', 'bg-white rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)]')} p-5 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          {title && <h3 className={`flex items-center gap-2 ${pick(t, 'text-sm font-bold text-white', 'text-base font-extrabold text-neutral-900')}`}>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
};

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return `${err.message} (${err.code})`;
  if (err instanceof Error) return err.message;
  return String(err);
}

export const ErrorBanner: React.FC<{ error: unknown; onClose?: () => void }> = ({ error, onClose }) => {
  const t = useTheme();
  if (!error) return null;
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-xl p-3 text-xs mb-3 ${pick(
        t,
        'border border-rose-500/30 bg-rose-950/40 text-rose-200',
        'border border-red-200 bg-red-50 text-red-800 rounded-lg text-sm',
      )}`}
    >
      <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${pick(t, 'text-rose-400', 'text-red-600')}`} />
      <span className="flex-1 break-words">{errorText(error)}</span>
      {onClose && (
        <button onClick={onClose} aria-label="Dismiss" className={pick(t, 'text-rose-300 hover:text-white', 'text-red-700 hover:text-red-900')}>
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

export const Notice: React.FC<{ tone?: 'info' | 'warn' | 'ok'; children: React.ReactNode }> = ({ tone = 'info', children }) => {
  const t = useTheme();
  const cls =
    t === 'light'
      ? tone === 'warn'
        ? 'border border-amber-200 bg-amber-50 text-amber-900'
        : tone === 'ok'
          ? 'border border-green-200 bg-green-50 text-green-900'
          : 'border border-blue-200 bg-blue-50 text-blue-900'
      : tone === 'warn'
        ? 'border border-amber-500/30 bg-amber-950/40 text-amber-200'
        : tone === 'ok'
          ? 'border border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
          : 'border border-sky-500/30 bg-sky-950/30 text-sky-200';
  return <div className={`${pick(t, 'rounded-xl text-xs', 'rounded-lg text-sm')} p-3 mb-3 ${cls}`}>{children}</div>;
};

export const Spinner: React.FC<{ label?: string }> = ({ label }) => {
  const t = useTheme();
  return (
    <div className={`flex items-center gap-2 py-3 ${pick(t, 'text-xs text-slate-400', 'text-sm text-neutral-500')}`}>
      <Loader2 className={`w-4 h-4 animate-spin ${pick(t, '', 'text-[#008cff]')}`} /> {label ?? 'Loading…'}
    </div>
  );
};

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'danger' | 'ghost'; busy?: boolean }> = ({
  tone = 'primary',
  busy,
  children,
  className = '',
  disabled,
  ...rest
}) => {
  const t = useTheme();
  const base =
    t === 'light'
      ? 'px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#008cff]'
      : 'px-3.5 py-2 rounded-xl text-xs font-bold transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed';
  const tones =
    t === 'light'
      ? {
          primary: 'bg-gradient-to-r from-[#53b2fe] to-[#065af3] text-white uppercase tracking-wide shadow-md shadow-blue-500/25 hover:brightness-105',
          danger: 'bg-white text-red-700 border-2 border-red-600 hover:bg-red-50',
          ghost: 'bg-white text-[#008cff] border-2 border-[#008cff] hover:bg-blue-50',
        }
      : {
          primary: 'bg-teal-500 hover:bg-teal-400 text-slate-950',
          danger: 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30',
          ghost: 'bg-slate-800/70 hover:bg-slate-700 text-slate-200 border border-slate-700',
        };
  return (
    <button className={`${base} ${tones[tone]} ${className}`} disabled={disabled || busy} {...rest}>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
};

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => {
  const t = useTheme();
  return (
    <label className="block">
      <span className={`block text-[11px] font-bold uppercase tracking-wide mb-1 ${pick(t, 'text-slate-400', 'text-neutral-500')}`}>{label}</span>
      {children}
      {hint && <span className={`block mt-1 ${pick(t, 'text-[10px] text-slate-500', 'text-xs text-neutral-500')}`}>{hint}</span>}
    </label>
  );
};

/** Dark console input. In themed components prefer useInputCls(). */
export const inputCls =
  'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500 placeholder:text-slate-600';
export const inputClsLight =
  'w-full bg-white border border-neutral-300 rounded-lg px-3 py-2.5 text-base text-neutral-900 focus:outline-none focus:border-[#008cff] focus:ring-2 focus:ring-[#008cff]/25 placeholder:text-neutral-400';
export const useInputCls = () => pick(useTheme(), inputCls, inputClsLight);

export const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const t = useTheme();
  const s = status.toUpperCase();
  const kind = /CONFIRMED|LIVE|OPEN|APPROVED|SENT|PROCESSED|RELEASED|SETTLED|CHECKED_IN|COMPLETED/.test(s)
    ? 'ok'
    : /PENDING|UNDER_REVIEW|ON_HOLD|PROCESSING|DRAFT|HOLD|SCHEDULED/.test(s)
      ? 'warn'
      : /CANCELLED|CLOSED|REJECTED|FAILED|SUSPENDED|EXPIRED|REVERSED|NO_SHOW|BLOCKED|IN_FORCE/.test(s)
        ? 'bad'
        : 'neutral';
  const cls =
    t === 'light'
      ? { ok: 'bg-green-50 text-green-800 border-green-200', warn: 'bg-amber-50 text-amber-800 border-amber-200', bad: 'bg-red-50 text-red-700 border-red-200', neutral: 'bg-neutral-100 text-neutral-700 border-neutral-200' }[kind]
      : {
          ok: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
          warn: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
          bad: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
          neutral: 'bg-slate-700/40 text-slate-300 border-slate-600',
        }[kind];
  return <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{s.replace(/_/g, ' ')}</span>;
};

/** Confirmation dialog requiring a typed reason for destructive/privileged actions. */
export const ConfirmDialog: React.FC<{
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  requireReason?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}> = ({ title, body, confirmLabel, requireReason = true, onConfirm, onClose }) => {
  const t = useTheme();
  const input = useInputCls();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className={`fixed inset-0 z-50 backdrop-blur-sm flex items-center justify-center p-4 ${pick(t, 'bg-slate-950/80', 'bg-neutral-900/50')}`} role="dialog" aria-modal="true">
      <div className={`${pick(t, 'glass-panel rounded-2xl', 'bg-white rounded-xl shadow-2xl')} p-6 max-w-md w-full`}>
        <h3 className={`text-base font-extrabold mb-2 ${pick(t, 'text-white', 'text-neutral-900 text-lg')}`}>{title}</h3>
        <div className={`mb-4 ${pick(t, 'text-xs text-slate-300', 'text-sm text-neutral-600')}`}>{body}</div>
        <ErrorBanner error={err} />
        {requireReason && (
          <Field label="Reason (recorded in the audit log)">
            <textarea className={input} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button tone="ghost" onClick={onClose} disabled={busy}>
            {t === 'light' ? 'Keep it' : 'Cancel'}
          </Button>
          <Button
            tone="danger"
            busy={busy}
            disabled={requireReason && reason.trim().length < 5}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await onConfirm(reason.trim());
                onClose();
              } catch (e) {
                setErr(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
