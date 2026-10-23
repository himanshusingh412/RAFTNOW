import React, { useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { ApiError } from '../lib/api';

export const Panel: React.FC<{ title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  title,
  actions,
  children,
  className = '',
}) => (
  <section className={`glass-panel rounded-2xl p-5 ${className}`}>
    {(title || actions) && (
      <div className="flex items-center justify-between gap-3 mb-4">
        {title && <h3 className="text-sm font-bold text-white flex items-center gap-2">{title}</h3>}
        {actions}
      </div>
    )}
    {children}
  </section>
);

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return `${err.message} (${err.code})`;
  if (err instanceof Error) return err.message;
  return String(err);
}

export const ErrorBanner: React.FC<{ error: unknown; onClose?: () => void }> = ({ error, onClose }) =>
  error ? (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-950/40 p-3 text-xs text-rose-200 mb-3">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
      <span className="flex-1 break-words">{errorText(error)}</span>
      {onClose && (
        <button onClick={onClose} aria-label="Dismiss" className="text-rose-300 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  ) : null;

export const Notice: React.FC<{ tone?: 'info' | 'warn' | 'ok'; children: React.ReactNode }> = ({ tone = 'info', children }) => {
  const cls =
    tone === 'warn'
      ? 'border-amber-500/30 bg-amber-950/40 text-amber-200'
      : tone === 'ok'
        ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
        : 'border-sky-500/30 bg-sky-950/30 text-sky-200';
  return <div className={`rounded-xl border p-3 text-xs mb-3 ${cls}`}>{children}</div>;
};

export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
    <Loader2 className="w-4 h-4 animate-spin" /> {label ?? 'Loading…'}
  </div>
);

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'danger' | 'ghost'; busy?: boolean }> = ({
  tone = 'primary',
  busy,
  children,
  className = '',
  disabled,
  ...rest
}) => {
  const base = 'px-3.5 py-2 rounded-xl text-xs font-bold transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed';
  const tones = {
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

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block">
    <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[10px] text-slate-500 mt-1">{hint}</span>}
  </label>
);

export const inputCls =
  'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500 placeholder:text-slate-600';

export const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const s = status.toUpperCase();
  const cls = /CONFIRMED|LIVE|OPEN|APPROVED|SENT|PROCESSED|RELEASED|SETTLED|CHECKED_IN|COMPLETED/.test(s)
    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
    : /PENDING|UNDER_REVIEW|ON_HOLD|PROCESSING|DRAFT|HOLD|SCHEDULED/.test(s)
      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
      : /CANCELLED|CLOSED|REJECTED|FAILED|SUSPENDED|EXPIRED|REVERSED|NO_SHOW|BLOCKED|IN_FORCE/.test(s)
        ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
        : 'bg-slate-700/40 text-slate-300 border-slate-600';
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
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="glass-panel rounded-2xl p-6 max-w-md w-full">
        <h3 className="text-base font-extrabold text-white mb-2">{title}</h3>
        <div className="text-xs text-slate-300 mb-4">{body}</div>
        <ErrorBanner error={err} />
        {requireReason && (
          <Field label="Reason (recorded in the audit log)">
            <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button tone="ghost" onClick={onClose} disabled={busy}>
            Cancel
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
