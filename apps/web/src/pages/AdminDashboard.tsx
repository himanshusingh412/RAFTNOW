import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  BarChart3, Building, CalendarOff, DollarSign, Download, EyeOff, FileSearch, LogOut, Pencil, Plus, Power, RotateCcw, ScrollText, Search, ShieldAlert, Ship, Users,
} from 'lucide-react';
import { API_BASE, ApiError, inr, istDateTime, request, todayIst } from '../services/api';
import { Button, ConfirmDialog, ErrorBanner, Field, Notice, Panel, Spinner, StatusPill, inputCls } from '../components/ui';
import { AdminMe, fetchAdminMe, readAdminToken as readToken, writeAdminToken as writeToken } from '../lib/admin-session';

// Admin session token: sessionStorage only (cleared when the tab closes). Sign-in happens on /login.
const adminApi = <T,>(path: string, opts: Parameters<typeof request>[1] = {}) => request<T>(path, { ...opts, token: readToken });

/**
 * Admin console. Every action here is authorised by the API (AdminAuthGuard +
 * role permissions); the UI only hides controls the role cannot use.
 */
export const AdminDashboardPage: React.FC = () => {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [checking, setChecking] = useState(true);
  const [signedOut, setSignedOut] = useState<'expired' | 'signed_out' | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [tab, setTab] = useState('river');

  const loadMe = useCallback(async () => {
    if (!readToken()) { setChecking(false); return; }
    setLoadErr(null);
    try { setMe(await fetchAdminMe()); }
    catch (e) {
      // 401 = expired or revoked session → back to sign-in. Anything else (API down) is shown, the session is kept.
      if (e instanceof ApiError && e.status === 401) { writeToken(null); setMe(null); setSignedOut('expired'); }
      else setLoadErr(e);
    } finally { setChecking(false); }
  }, []);
  useEffect(() => { loadMe(); }, [loadMe]);

  if (checking) return <div className="max-w-7xl mx-auto p-8"><Spinner /></div>;
  if (loadErr) return <div className="max-w-7xl mx-auto px-4 py-10"><ErrorBanner error={loadErr} /><Button tone="ghost" onClick={() => { setChecking(true); loadMe(); }}>Retry</Button></div>;
  if (!me) return <Navigate to={`/login?mode=password&next=/admin${signedOut ? `&reason=${signedOut}` : ''}`} replace />;

  const can = (p: string) => me.permissions.includes(p);
  const tabs: Array<[string, string, React.ReactNode, boolean]> = [
    ['river', 'River control', <Power key="r" className="w-4 h-4" />, can('closures:read')],
    ['vendors', 'Vendors & KYC', <Building key="v" className="w-4 h-4" />, can('vendors:read')],
    ['trips', 'Trips', <Ship key="t" className="w-4 h-4" />, can('vendors:read')],
    ['finance', 'Finance', <DollarSign key="f" className="w-4 h-4" />, can('finance:read')],
    ['bookings', 'Bookings', <Search key="b" className="w-4 h-4" />, can('bookings:read')],
    ['audit', 'Audit log', <ScrollText key="a" className="w-4 h-4" />, can('audit:read')],
    ['admins', 'Admins', <Users key="u" className="w-4 h-4" />, can('admins:manage')],
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-800">
        <div>
          <div className="text-xs font-semibold text-amber-400 flex items-center gap-2 mb-1"><ShieldAlert className="w-4 h-4" /> RaftNow operations console</div>
          <h1 className="text-2xl font-extrabold text-white">{me.email} <span className="ml-2 align-middle"><StatusPill status={me.role} /></span></h1>
        </div>
        <Button tone="ghost" onClick={async () => { try { await adminApi('/admin/auth/logout', { method: 'POST' }); } catch { /* token is dropped locally either way */ } finally { writeToken(null); setSignedOut('signed_out'); setMe(null); } }}>
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </Button>
      </div>
      <div className="flex flex-wrap gap-1 bg-slate-900 border border-slate-800 rounded-2xl p-1 mb-6">
        {tabs.filter((t) => t[3]).map(([k, label, icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 ${tab === k ? 'bg-teal-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>
            {icon} {label}
          </button>
        ))}
      </div>
      {tab === 'river' && <RiverControl canWrite={can('closures:write')} />}
      {tab === 'vendors' && <Vendors can={can} />}
      {tab === 'trips' && <Trips canHide={can('vendors:review')} />}
      {tab === 'finance' && <Finance canWrite={can('finance:write')} />}
      {tab === 'bookings' && <Bookings canCancel={can('bookings:cancel')} />}
      {tab === 'audit' && <Audit />}
      {tab === 'admins' && <Admins selfId={me.id} />}
    </div>
  );
};

// ── River control ────────────────────────────────────────────────────────────

interface AdminStretch {
  id: string; name: string; grade: string; distance_km: number; duration_minutes: number; put_in_point: string; take_out_point: string;
  min_age: number; max_age: number | null; active: boolean; status: 'OPEN' | 'CLOSED';
  closure: { id: string; kind: 'EMERGENCY' | 'SEASON'; reason: string; starts_at: string; ends_at: string | null; stretch_id: string | null } | null;
}

const RiverControl: React.FC<{ canWrite: boolean }> = ({ canWrite }) => {
  const [data, setData] = useState<{ river_wide_closure: any; stretches: AdminStretch[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [dialog, setDialog] = useState<{ kind: 'close' | 'open'; stretch: AdminStretch | null } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminStretch | 'new' | null>(null);
  const load = useCallback(() => { adminApi<typeof data>('/admin/stretches').then(setData).catch(setErr); }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-6">
    <Panel title={<><Power className="w-4 h-4 text-teal-400" /> River stretch lockout</>} actions={
      canWrite && data && (
        <div className="flex gap-2">
          <Button tone="ghost" onClick={() => setEditing('new')}><Plus className="w-3.5 h-3.5" /> Add stretch</Button>
          {data.river_wide_closure
            ? <Button tone="ghost" onClick={() => setDialog({ kind: 'open', stretch: null })}>Reopen entire river</Button>
            : <Button tone="danger" onClick={() => setDialog({ kind: 'close', stretch: null })}>Close ENTIRE river</Button>}
        </div>
      )
    }>
      <p className="text-xs text-slate-400 mb-4">Closing a stretch is stored in the database and takes effect immediately: new bookings are blocked and every affected future booking is cancelled with a 100% refund and customer notification.</p>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {result && <Notice tone="ok">{result}</Notice>}
      {!data && !err && <Spinner />}
      <div className="space-y-3">
        {data?.stretches.map((s) => (
          <div key={s.id} className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl">
            <div>
              <div className="font-bold text-white text-sm">{s.name} {!s.active && <span className="text-slate-500">(inactive — hidden from customers)</span>}</div>
              <div className="text-xs text-slate-400">
                {s.distance_km} km · Grade {s.grade.replace(/^Grade\s*/i, '')} · {Math.round(s.duration_minutes / 6) / 10} h · ages {s.min_age}{s.max_age ? `–${s.max_age}` : '+'}
              </div>
              <div className="text-[11px] text-slate-500">{s.put_in_point} → {s.take_out_point}</div>
              {s.closure && (
                <div className="text-[11px] text-amber-300 mt-1">
                  {s.closure.kind === 'SEASON' ? 'Off-season: ' : s.closure.stretch_id === null ? 'River-wide closure: ' : 'Closed: '}{s.closure.reason} · since {istDateTime(s.closure.starts_at)}
                  {s.closure.ends_at ? ` until ${istDateTime(s.closure.ends_at)}` : ' · until reopened'}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={s.status} />
              {canWrite && <Button tone="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}><Pencil className="w-3.5 h-3.5" /></Button>}
              {canWrite && (s.status === 'OPEN'
                ? <Button tone="danger" onClick={() => setDialog({ kind: 'close', stretch: s })}>Close</Button>
                : s.closure?.stretch_id === s.id && <Button tone="ghost" onClick={() => setDialog({ kind: 'open', stretch: s })}>Reopen</Button>)}
            </div>
          </div>
        ))}
      </div>
      {dialog && (
        <ConfirmDialog
          title={dialog.kind === 'close' ? `Close ${dialog.stretch?.name ?? 'the ENTIRE river'}?` : `Reopen ${dialog.stretch?.name ?? 'the river'}?`}
          body={dialog.kind === 'close'
            ? 'All future bookings on this stretch will be cancelled and fully refunded, and customers notified. This cannot be undone by reopening.'
            : 'Bookings become possible again. Bookings cancelled by the closure stay cancelled.'}
          confirmLabel={dialog.kind === 'close' ? 'Close now' : 'Reopen'}
          onConfirm={async (reason) => {
            const base = dialog.stretch ? `/admin/stretches/${dialog.stretch.id}` : '/admin/river';
            const r = await adminApi<any>(`${base}/${dialog.kind}`, { body: { reason } });
            setResult(dialog.kind === 'close'
              ? `Closed. ${r.processing?.cancelled ?? 0} booking(s) cancelled and refunded${r.processing?.failed ? `, ${r.processing.failed} failed (the closures job retries them)` : ''}.`
              : 'Reopened.');
            load();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {editing && (
        <StretchForm
          stretch={editing === 'new' ? null : editing}
          onSaved={(msg) => { setEditing(null); setResult(msg); load(); }}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
    <Seasons stretches={data?.stretches ?? []} canWrite={canWrite} />
    </div>
  );
};

// ── Stretch master data & season calendar (A-05) ─────────────────────────────

const StretchForm: React.FC<{ stretch: AdminStretch | null; onSaved: (msg: string) => void; onClose: () => void }> = ({ stretch, onSaved, onClose }) => {
  const [f, setF] = useState({
    name: stretch?.name ?? '',
    distance_km: stretch ? String(stretch.distance_km) : '',
    grade: stretch?.grade ?? '',
    duration_minutes: stretch ? String(stretch.duration_minutes) : '120',
    put_in_point: stretch?.put_in_point ?? '',
    take_out_point: stretch?.take_out_point ?? '',
    min_age: stretch ? String(stretch.min_age) : '14',
    max_age: stretch?.max_age != null ? String(stretch.max_age) : '',
    active: stretch?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = {
      name: f.name.trim(), distance_km: Number(f.distance_km), grade: f.grade.trim(), duration_minutes: Number(f.duration_minutes),
      put_in_point: f.put_in_point.trim(), take_out_point: f.take_out_point.trim(), min_age: Number(f.min_age),
      max_age: f.max_age.trim() === '' ? null : Number(f.max_age), active: f.active,
    };
    try {
      const r = await adminApi<{ upcoming_bookings_still_valid?: number }>(stretch ? `/admin/stretches/${stretch.id}` : '/admin/stretches', { method: stretch ? 'PATCH' : 'POST', body });
      onSaved(stretch
        ? `Saved ${body.name}.${r.upcoming_bookings_still_valid ? ` It is inactive; ${r.upcoming_bookings_still_valid} upcoming booking(s) already sold remain valid.` : ''}`
        : `Added ${body.name}. Operators can now list trips on it.`);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={stretch ? `Edit ${stretch.name}` : 'Add stretch'}>
      <form onSubmit={save} className="glass-panel rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-extrabold text-white mb-4">{stretch ? `Edit ${stretch.name}` : 'Add a river stretch'}</h3>
        <ErrorBanner error={err} onClose={() => setErr(null)} />
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Field label="Name"><input className={inputCls} required value={f.name} onChange={set('name')} placeholder="Shivpuri → Rishikesh" /></Field></div>
          <Field label="Distance (km)"><input className={inputCls} required type="number" step="0.1" min="0.1" value={f.distance_km} onChange={set('distance_km')} /></Field>
          <Field label="Rapid grade" hint="e.g. II–III"><input className={inputCls} required value={f.grade} onChange={set('grade')} /></Field>
          <Field label="Usual duration (min)"><input className={inputCls} required type="number" min="15" max="720" value={f.duration_minutes} onChange={set('duration_minutes')} /></Field>
          <div />
          <Field label="Put-in point"><input className={inputCls} required value={f.put_in_point} onChange={set('put_in_point')} /></Field>
          <Field label="Take-out point"><input className={inputCls} required value={f.take_out_point} onChange={set('take_out_point')} /></Field>
          <Field label="Minimum age"><input className={inputCls} required type="number" min="5" max="80" value={f.min_age} onChange={set('min_age')} /></Field>
          <Field label="Maximum age" hint="Leave empty for no limit"><input className={inputCls} type="number" min="5" max="100" value={f.max_age} onChange={set('max_age')} /></Field>
          <label className="col-span-2 flex items-start gap-2 text-xs text-slate-300 mt-1">
            <input type="checkbox" className="mt-0.5" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            <span>Active. Unticking hides the stretch from customers and stops new bookings on it; bookings already sold stay valid.</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button tone="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" busy={busy}>{stretch ? 'Save changes' : 'Add stretch'}</Button>
        </div>
      </form>
    </div>
  );
};

interface Season {
  id: string; stretch: { id: string; name: string } | null; river_wide: boolean; starts_on: string; ends_on: string;
  reason: string; state: 'SCHEDULED' | 'IN_FORCE' | 'ENDED' | 'CANCELLED'; refunded_bookings: number;
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const Seasons: React.FC<{ stretches: AdminStretch[]; canWrite: boolean }> = ({ stretches, canWrite }) => {
  const [rows, setRows] = useState<Season[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ stretch_id: '', starts_on: '', ends_on: '', reason: 'Monsoon off-season' });
  const [confirmNew, setConfirmNew] = useState(false);
  const [cancelFor, setCancelFor] = useState<Season | null>(null);
  const load = useCallback(() => { adminApi<Season[]>('/admin/seasons').then(setRows).catch(setErr); }, []);
  useEffect(load, [load]);
  const scope = form.stretch_id ? stretches.find((s) => s.id === form.stretch_id)?.name ?? 'this stretch' : 'the whole river';
  const ready = form.starts_on && form.ends_on && form.ends_on >= form.starts_on && form.reason.trim().length >= 5;
  const cls = inputCls.replace('w-full', 'block w-full mt-1');

  return (
    <Panel title={<><CalendarOff className="w-4 h-4 text-teal-400" /> Season calendar</>}>
      <p className="text-xs text-slate-400 mb-4">
        Plan off-season closures (e.g. the monsoon, roughly 1 July to mid-September) ahead of time. Customers see the dates before they pick a day,
        departures inside a season cannot be booked, and anything already sold for those days is cancelled with a full refund.
      </p>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {notice && <Notice tone="ok">{notice}</Notice>}
      {canWrite && (
        <div className="grid sm:grid-cols-5 gap-3 items-end mb-5 p-4 rounded-xl bg-slate-900 border border-slate-800">
          <label className="text-[10px] uppercase font-bold text-slate-500 sm:col-span-1">Applies to
            <select className={cls} value={form.stretch_id} onChange={(e) => setForm({ ...form, stretch_id: e.target.value })}>
              <option value="">Whole river</option>
              {stretches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-[10px] uppercase font-bold text-slate-500">First closed day
            <input type="date" className={cls} value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
          </label>
          <label className="text-[10px] uppercase font-bold text-slate-500">Last closed day
            <input type="date" className={cls} value={form.ends_on} min={form.starts_on || undefined} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
          </label>
          <label className="text-[10px] uppercase font-bold text-slate-500">Reason (shown to customers)
            <input className={cls} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
          <Button disabled={!ready} onClick={() => setConfirmNew(true)}><Plus className="w-3.5 h-3.5" /> Schedule</Button>
        </div>
      )}
      {!rows && !err && <Spinner />}
      {rows?.length === 0 && <p className="text-xs text-slate-500">No seasons planned.</p>}
      <div className="space-y-2">
        {rows?.map((r) => (
          <div key={r.id} className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${r.state === 'CANCELLED' || r.state === 'ENDED' ? 'bg-slate-950 border-slate-900 opacity-60' : 'bg-slate-900 border-slate-800'}`}>
            <div>
              <div className="font-bold text-white">{fmtDay(r.starts_on)} – {fmtDay(r.ends_on)} · {r.river_wide ? 'Whole river' : r.stretch?.name}</div>
              <div className="text-slate-400">{r.reason}{r.refunded_bookings ? ` · ${r.refunded_bookings} booking(s) refunded` : ''}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusPill status={r.state} />
              {canWrite && (r.state === 'SCHEDULED' || r.state === 'IN_FORCE') && (
                <Button tone="ghost" onClick={() => setCancelFor(r)}>{r.state === 'IN_FORCE' ? 'End early' : 'Cancel'}</Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {confirmNew && (
        <ConfirmDialog
          title={`Close ${scope} from ${fmtDay(form.starts_on)} to ${fmtDay(form.ends_on)}?`}
          body="Departures in these days stop being bookable now. Any booking already sold for these days is cancelled with a 100% refund and the customer is notified."
          confirmLabel="Schedule season"
          requireReason={false}
          onConfirm={async () => {
            const r = await adminApi<{ processing: { cancelled: number } }>('/admin/seasons', {
              body: { stretch_id: form.stretch_id || null, starts_on: form.starts_on, ends_on: form.ends_on, reason: form.reason.trim() },
            });
            setNotice(`Season scheduled.${r.processing.cancelled ? ` ${r.processing.cancelled} booking(s) cancelled and refunded.` : ''}`);
            setForm({ ...form, starts_on: '', ends_on: '' });
            load();
          }}
          onClose={() => setConfirmNew(false)}
        />
      )}
      {cancelFor && (
        <ConfirmDialog
          title={cancelFor.state === 'IN_FORCE' ? 'End this season early?' : 'Cancel this season?'}
          body="Departures in these days become bookable again. Bookings that were refunded stay cancelled."
          confirmLabel={cancelFor.state === 'IN_FORCE' ? 'End season' : 'Cancel season'}
          onConfirm={async (reason) => { await adminApi(`/admin/seasons/${cancelFor.id}/cancel`, { body: { reason } }); setNotice('Season updated.'); load(); }}
          onClose={() => setCancelFor(null)}
        />
      )}
    </Panel>
  );
};

// ── Vendors & KYC ────────────────────────────────────────────────────────────

const Vendors: React.FC<{ can: (p: string) => boolean }> = ({ can }) => {
  const [status, setStatus] = useState('UNDER_REVIEW');
  const [list, setList] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [dialog, setDialog] = useState<{ action: string; title: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { adminApi<any[]>(`/admin/vendors${status ? `?status=${status}` : ''}`).then(setList).catch(setErr); }, [status]);
  useEffect(load, [load]);
  const open = async (id: string) => { try { setSel(await adminApi(`/admin/vendors/${id}`)); } catch (e) { setErr(e); } };
  const act = async (fn: () => Promise<unknown>, key: string) => { setBusy(key); setErr(null); try { await fn(); await open(sel.id); load(); } catch (e) { setErr(e); } finally { setBusy(null); } };

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <Panel title={<><Building className="w-4 h-4 text-teal-400" /> Vendors</>} className="lg:col-span-2" actions={
        <select className={`${inputCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          {['UNDER_REVIEW', 'DRAFT', 'LIVE', 'SUSPENDED', ''].map((s) => <option key={s} value={s}>{s || 'ALL'}</option>)}
        </select>
      }>
        {!list && <Spinner />}
        {list?.length === 0 && <p className="text-xs text-slate-500">None.</p>}
        <div className="space-y-2">
          {list?.map((v) => (
            <button key={v.id} onClick={() => open(v.id)} className={`w-full text-left p-3 rounded-xl border text-xs ${sel?.id === v.id ? 'border-teal-500 bg-teal-500/10' : 'border-slate-800 bg-slate-900'}`}>
              <div className="flex justify-between"><span className="font-bold text-white">{v.display_name}</span><StatusPill status={v.status} /></div>
              <div className="text-slate-400">{v.legal_name} · {v.trip_count} trips</div>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Vendor detail" className="lg:col-span-3">
        <ErrorBanner error={err} onClose={() => setErr(null)} />
        {!sel && <p className="text-xs text-slate-500">Select a vendor.</p>}
        {sel && (
          <div className="text-xs space-y-3">
            <div className="flex justify-between items-center">
              <div><div className="text-base font-bold text-white">{sel.display_name}</div><div className="text-slate-400">{sel.legal_name} · {sel.business_type ?? 'business type missing'}</div></div>
              <StatusPill status={sel.status} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-slate-300">
              <div>Owner: {sel.owner_name}</div><div>Phone: {sel.phone}</div>
              <div>Email: {sel.email}</div><div>Address: {sel.address}, {sel.address_city} {sel.address_postal_code}</div>
              <div>Licence: {sel.licence_number ?? '—'} {sel.licence_expiry ? `(exp ${new Date(sel.licence_expiry).toLocaleDateString('en-IN')})` : ''}</div>
              <div>PAN: {sel.pan_masked ?? '—'} · GSTIN: {sel.gstin ?? '—'}</div>
              <div>Bank: {sel.bank_account_masked ?? '—'} · {sel.ifsc ?? ''}</div>
              <div>Route: {sel.razorpay.linked_account_id ?? 'not created'} {sel.razorpay.status ? `(${sel.razorpay.status})` : ''}</div>
              <div>Reliability: {sel.reliability_score}</div>
              <div>Commission: {sel.commissions?.[0] ? `${sel.commissions[0].commission_bps / 100}%` : 'default'}</div>
            </div>
            <div>
              <div className="font-bold text-white mb-1">Documents</div>
              {sel.documents.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between p-2 mb-1 rounded-lg bg-slate-900 border border-slate-800">
                  <span>{d.type} · {d.original_name}</span>
                  <span className="flex items-center gap-1">
                    <StatusPill status={d.status} />
                    {can('vendors:kyc_documents') && <Button tone="ghost" onClick={async () => { try { const r = await adminApi<{ url: string }>(`/admin/vendors/${sel.id}/documents/${d.id}/url`); window.open(r.url, '_blank', 'noopener'); } catch (e) { setErr(e); } }}>View</Button>}
                    {can('vendors:review') && d.status !== 'APPROVED' && <Button busy={busy === `a${d.id}`} onClick={() => act(() => adminApi(`/admin/vendors/${sel.id}/documents/${d.id}/review`, { body: { decision: 'APPROVED' } }), `a${d.id}`)}>Approve</Button>}
                    {can('vendors:review') && d.status !== 'REJECTED' && <Button tone="danger" onClick={() => setDialog({ action: `doc:${d.id}`, title: `Reject ${d.type}?` })}>Reject</Button>}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
              {can('vendors:review') && sel.status === 'UNDER_REVIEW' && <>
                <Button busy={busy === 'approve'} onClick={() => act(() => adminApi(`/admin/vendors/${sel.id}/approve`, { body: {} }), 'approve')}>Approve vendor (LIVE)</Button>
                <Button tone="danger" onClick={() => setDialog({ action: 'reject', title: 'Reject application?' })}>Reject</Button>
              </>}
              {can('vendors:review') && sel.status === 'LIVE' && <Button tone="danger" onClick={() => setDialog({ action: 'suspend', title: 'Suspend vendor?' })}>Suspend</Button>}
              {can('vendors:review') && sel.status === 'SUSPENDED' && <Button onClick={() => setDialog({ action: 'reinstate', title: 'Reinstate vendor?' })}>Reinstate</Button>}
              {can('vendors:route') && sel.status === 'LIVE' && <Button tone="ghost" busy={busy === 'route'} onClick={() => act(() => adminApi(`/admin/vendors/${sel.id}/route/onboard`, { method: 'POST' }), 'route')}>{sel.razorpay.linked_account_id ? 'Continue Route onboarding' : 'Create Route linked account'}</Button>}
              {can('vendors:route') && sel.razorpay.linked_account_id && <Button tone="ghost" busy={busy === 'sync'} onClick={() => act(() => adminApi(`/admin/vendors/${sel.id}/route/sync`, { method: 'POST' }), 'sync')}>Sync Route status</Button>}
            </div>
          </div>
        )}
      </Panel>
      {dialog && sel && (
        <ConfirmDialog
          title={dialog.title}
          body="This decision is recorded in the audit log with your account and the reason."
          confirmLabel="Confirm"
          onConfirm={async (reason) => {
            if (dialog.action.startsWith('doc:')) await adminApi(`/admin/vendors/${sel.id}/documents/${dialog.action.slice(4)}/review`, { body: { decision: 'REJECTED', reason } });
            else await adminApi(`/admin/vendors/${sel.id}/${dialog.action}`, { body: { reason } });
            await open(sel.id); load();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};

// ── Finance ──────────────────────────────────────────────────────────────────

const Finance: React.FC<{ canWrite: boolean }> = ({ canWrite }) => {
  const [summary, setSummary] = useState<any | null>(null);
  const [refunds, setRefunds] = useState<any[] | null>(null);
  const [transfers, setTransfers] = useState<any[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [holdFor, setHoldFor] = useState<any | null>(null);
  const load = useCallback(() => {
    adminApi('/admin/finance/summary').then(setSummary).catch(setErr);
    adminApi<any[]>('/admin/refunds').then(setRefunds).catch(setErr);
    adminApi<any[]>('/admin/transfers').then(setTransfers).catch(setErr);
  }, []);
  useEffect(load, [load]);
  const tile = (label: string, value: string) => (
    <div className="p-3 bg-slate-900 rounded-xl border border-slate-800"><div className="text-[10px] uppercase text-slate-500 font-bold">{label}</div><div className="text-lg font-extrabold text-white">{value}</div></div>
  );
  return (
    <div className="space-y-6">
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      <Reports />
      <Panel title={<><DollarSign className="w-4 h-4 text-teal-400" /> Ledger summary (live)</>}>
        {!summary && <Spinner />}
        {summary && (
          <div className="grid sm:grid-cols-3 gap-3">
            {tile('Captured payments', `${inr(summary.captured_payments.amount_paise)} (${summary.captured_payments.count})`)}
            {tile('Active bookings value', inr(summary.active_bookings_value_paise))}
            {tile('Platform commission (active)', inr(summary.platform_commission_on_active_bookings_paise))}
            {Object.entries(summary.refunds_by_status).map(([s, v]: any) => tile(`Refunds ${s}`, `${inr(v.amount_paise)} (${v.count})`))}
            {Object.entries(summary.vendor_transfers_by_status).map(([s, v]: any) => tile(`Payouts ${s}`, `${inr(v.amount_paise)} (${v.count})`))}
          </div>
        )}
      </Panel>
      <Panel title={<><RotateCcw className="w-4 h-4 text-teal-400" /> Refunds</>}>
        {!refunds && <Spinner />}
        {refunds?.length === 0 && <p className="text-xs text-slate-500">No refunds.</p>}
        <table className="w-full text-xs">
          <tbody>
            {refunds?.map((r) => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="py-1.5 font-mono text-teal-300">RF{r.booking.booking_code}</td>
                <td className="font-bold">{inr(r.amount_paise)}</td>
                <td>{r.reason}</td>
                <td><StatusPill status={r.status} /></td>
                <td className="text-slate-500 max-w-xs truncate" title={r.failure_reason ?? ''}>{r.razorpay_refund_id ?? r.failure_reason ?? ''}</td>
                <td>{istDateTime(r.created_at)}</td>
                <td>{canWrite && r.status === 'FAILED' && !r.razorpay_refund_id && <Button tone="ghost" onClick={async () => { try { await adminApi(`/admin/refunds/${r.id}/retry`, { method: 'POST' }); load(); } catch (e) { setErr(e); } }}>Retry</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title={<><DollarSign className="w-4 h-4 text-teal-400" /> Vendor payouts</>}>
        {!transfers && <Spinner />}
        {transfers?.length === 0 && <p className="text-xs text-slate-500">No payouts.</p>}
        <table className="w-full text-xs">
          <tbody>
            {transfers?.map((t) => (
              <tr key={t.id} className="border-t border-slate-800">
                <td className="py-1.5">{t.vendor.display_name}</td>
                <td className="font-mono text-teal-300">RF{t.booking.booking_code}</td>
                <td className="font-bold">{inr(t.amount_paise)}</td>
                <td><StatusPill status={t.status} />{t.hold_reason && <div className="text-amber-300">{t.hold_reason}</div>}</td>
                <td>{istDateTime(t.release_at)}</td>
                <td className="text-slate-500">{t.razorpay_transfer_id ?? t.last_error ?? ''}</td>
                <td>{canWrite && t.status === 'ON_HOLD' && (t.hold_reason
                  ? <Button tone="ghost" onClick={async () => { try { await adminApi(`/admin/transfers/${t.id}/unhold`, { method: 'POST' }); load(); } catch (e) { setErr(e); } }}>Lift hold</Button>
                  : <Button tone="danger" onClick={() => setHoldFor(t)}>Hold</Button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {holdFor && (
        <ConfirmDialog title="Hold this payout?" body="The payout will not be released until the hold is lifted." confirmLabel="Hold payout"
          onConfirm={async (reason) => { await adminApi(`/admin/transfers/${holdFor.id}/hold`, { body: { reason } }); load(); }} onClose={() => setHoldFor(null)} />
      )}
    </div>
  );
};

// ── Bookings ─────────────────────────────────────────────────────────────────

const Bookings: React.FC<{ canCancel: boolean }> = ({ canCancel }) => {
  const [code, setCode] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [cancelFor, setCancelFor] = useState<any | null>(null);
  const [disputeFor, setDisputeFor] = useState<{ booking: any; kind: 'flag' | 'resolve' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const search = useCallback(() => {
    setErr(null);
    adminApi<any[]>(`/admin/bookings${code ? `?code=${encodeURIComponent(code.toUpperCase())}` : ''}`).then(setRows).catch((e) => { setErr(e); setRows([]); });
  }, [code]);
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Panel title={<><FileSearch className="w-4 h-4 text-teal-400" /> Bookings</>} actions={
      <div className="flex gap-2"><input className={`${inputCls} w-40`} placeholder="RFXXXXXX" value={code} onChange={(e) => setCode(e.target.value)} /><Button onClick={search}>Search</Button></div>
    }>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {notice && <Notice tone="ok">{notice}</Notice>}
      {!rows && <Spinner />}
      <div className="space-y-2">
        {rows?.map((b) => (
          <div key={b.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs">
            <div className="flex justify-between"><span className="font-mono font-bold text-teal-300">RF{b.booking_code}</span><StatusPill status={b.status} /></div>
            <div className="text-slate-400">{b.contact_name} · {b.slot?.trip?.title} · {b.slot ? istDateTime(b.slot.start_time) : ''} · {inr(b.amount_paise)}</div>
            {b.events && <div className="text-slate-500 mt-1">{b.events.map((e: any) => e.event_type.replace('BOOKING_', '')).join(' → ')}</div>}
            {b.refunds?.length > 0 && <div className="text-slate-400 mt-1">Refunds: {b.refunds.map((r: any) => `${inr(r.amount_paise)} ${r.status}`).join(', ')}</div>}
            {b.status === 'DISPUTED' && b.dispute_reason && <div className="text-amber-300 mt-1">Dispute: {b.dispute_reason}{b.disputed_at ? ` · ${istDateTime(b.disputed_at)}` : ''}</div>}
            <div className="flex flex-wrap gap-2 mt-2">
              {canCancel && ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'DISPUTED'].includes(b.status) && (
                <Button tone="danger" onClick={() => setCancelFor(b)}>Force-cancel (100% refund)</Button>
              )}
              {canCancel && ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'].includes(b.status) && (
                <Button tone="ghost" onClick={() => setDisputeFor({ booking: b, kind: 'flag' })}>Mark disputed</Button>
              )}
              {canCancel && b.status === 'DISPUTED' && (
                <Button tone="ghost" onClick={() => setDisputeFor({ booking: b, kind: 'resolve' })}>Resolve (no refund)</Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {cancelFor && (
        <ConfirmDialog title={`Force-cancel RF${cancelFor.booking_code}?`} body="Cancels the booking with a full refund and notifies the customer and operator." confirmLabel="Cancel booking"
          onConfirm={async (reason) => { await adminApi(`/admin/bookings/${cancelFor.id}/cancel`, { body: { reason } }); search(); }} onClose={() => setCancelFor(null)} />
      )}
      {disputeFor && (
        <ConfirmDialog
          title={disputeFor.kind === 'flag' ? `Mark RF${disputeFor.booking.booking_code} as disputed?` : `Resolve the dispute on RF${disputeFor.booking.booking_code}?`}
          body={disputeFor.kind === 'flag'
            ? "The operator's payout stays on hold until the dispute is resolved. To refund the customer, force-cancel the booking afterwards."
            : 'The booking returns to its previous status and the payout is released on the normal schedule. No refund is made.'}
          confirmLabel={disputeFor.kind === 'flag' ? 'Mark disputed' : 'Resolve'}
          onConfirm={async (reason) => {
            const id = disputeFor.booking.id;
            if (disputeFor.kind === 'flag') {
              const r = await adminApi<{ payout_held: boolean; transfer_status: string | null }>(`/admin/bookings/${id}/dispute`, { body: { reason } });
              setNotice(r.payout_held ? 'Marked disputed. The payout is on hold.' : `Marked disputed, but the payout has already left the hold (${r.transfer_status}). Recover it from the operator if needed.`);
            } else {
              await adminApi(`/admin/bookings/${id}/dispute/resolve`, { body: { note: reason } });
              setNotice('Dispute resolved.');
            }
            search();
          }}
          onClose={() => setDisputeFor(null)}
        />
      )}
    </Panel>
  );
};

// ── Trips (A-10) ─────────────────────────────────────────────────────────────

interface AdminTrip {
  id: string; title: string; status: string; per_seat_price_paise: number; hidden_by_admin: boolean;
  admin_hidden_at: string | null; admin_hidden_reason: string | null; stretch_name: string;
  vendor: { id: string; display_name: string; status: string };
}

const Trips: React.FC<{ canHide: boolean }> = ({ canHide }) => {
  const [rows, setRows] = useState<AdminTrip[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [hideFor, setHideFor] = useState<AdminTrip | null>(null);
  const [filter, setFilter] = useState('');
  const load = useCallback(() => { adminApi<AdminTrip[]>('/admin/trips').then(setRows).catch(setErr); }, []);
  useEffect(load, [load]);
  const q = filter.trim().toLowerCase();
  const shown = rows?.filter((t) => !q || `${t.title} ${t.vendor.display_name} ${t.stretch_name}`.toLowerCase().includes(q));
  return (
    <Panel title={<><Ship className="w-4 h-4 text-teal-400" /> Trips</>} actions={
      <input className={`${inputCls} w-56`} placeholder="Filter by trip, operator, stretch" value={filter} onChange={(e) => setFilter(e.target.value)} />
    }>
      <p className="text-xs text-slate-400 mb-4">Hiding a trip takes it off sale at once. Existing bookings stay valid, and the operator cannot republish it until you unhide it.</p>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {!rows && !err && <Spinner />}
      {shown?.length === 0 && <p className="text-xs text-slate-500">No trips.</p>}
      <div className="space-y-2">
        {shown?.map((t) => (
          <div key={t.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-white truncate">{t.title}</div>
              <div className="text-slate-400">{t.vendor.display_name} · {t.stretch_name} · {inr(t.per_seat_price_paise)}/seat</div>
              {t.hidden_by_admin && <div className="text-amber-300 mt-1">Hidden by RaftNow: {t.admin_hidden_reason}{t.admin_hidden_at ? ` · ${istDateTime(t.admin_hidden_at)}` : ''}</div>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusPill status={t.status} />
              {canHide && (t.hidden_by_admin
                ? <Button tone="ghost" onClick={async () => { try { await adminApi(`/admin/trips/${t.id}/unhide`, { method: 'POST' }); load(); } catch (e) { setErr(e); } }}>Unhide</Button>
                : <Button tone="danger" onClick={() => setHideFor(t)}><EyeOff className="w-3.5 h-3.5" /> Hide</Button>)}
            </div>
          </div>
        ))}
      </div>
      {hideFor && (
        <ConfirmDialog title={`Hide "${hideFor.title}"?`} body={`${hideFor.vendor.display_name} will see your reason and cannot republish the trip.`} confirmLabel="Hide trip"
          onConfirm={async (reason) => { await adminApi(`/admin/trips/${hideFor.id}/hide`, { body: { reason } }); load(); }} onClose={() => setHideFor(null)} />
      )}
    </Panel>
  );
};

// ── Reports (A-11) ───────────────────────────────────────────────────────────

interface ReportRow { key: string; label: string; bookings: number; gmv_paise: number; commission_paise: number; vendor_payout_paise: number; refunds_paise: number }

function daysAgo(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const Reports: React.FC = () => {
  const [to, setTo] = useState(todayIst());
  const [from, setFrom] = useState(daysAgo(todayIst(), 29));
  const [groupBy, setGroupBy] = useState<'day' | 'vendor'>('day');
  const [data, setData] = useState<{ rows: ReportRow[]; totals: Omit<ReportRow, 'key' | 'label'> } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);
  const qs = `from=${from}&to=${to}`;
  useEffect(() => {
    setData(null);
    adminApi<typeof data>(`/admin/reports/summary?${qs}&group_by=${groupBy}`).then(setData).catch(setErr);
  }, [qs, groupBy]);

  // The CSV needs the admin bearer token, so it is fetched and saved as a blob rather than linked.
  const download = async () => {
    setDownloading(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/admin/reports/bookings.csv?${qs}`, { headers: { Authorization: `Bearer ${readToken() ?? ''}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body?.error?.code ?? `HTTP_${res.status}`, body?.error?.message ?? 'Export failed');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `raftnow-bookings-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e);
    } finally {
      setDownloading(false);
    }
  };

  const cell = 'py-1.5 pr-3 text-right tabular-nums';
  return (
    <Panel title={<><BarChart3 className="w-4 h-4 text-teal-400" /> Reports</>} actions={
      <Button tone="ghost" busy={downloading} onClick={download}><Download className="w-3.5 h-3.5" /> Download CSV</Button>
    }>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-[10px] uppercase font-bold text-slate-500">From
          <input type="date" className={inputCls.replace('w-full', 'block w-40 mt-1')} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-[10px] uppercase font-bold text-slate-500">To
          <input type="date" className={inputCls.replace('w-full', 'block w-40 mt-1')} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="text-[10px] uppercase font-bold text-slate-500">Group by
          <select className={inputCls.replace('w-full', 'block w-40 mt-1')} value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'day' | 'vendor')}>
            <option value="day">Day</option>
            <option value="vendor">Operator</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-400 mb-3">Paid bookings by IST payment date. GMV is what customers paid. Payouts and commission reflect refunds: commission earned = GMV − refunds − operator payouts.</p>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {!data && !err && <Spinner />}
      {data && data.rows.length === 0 && <p className="text-xs text-slate-500">No paid bookings in this range.</p>}
      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500 text-[10px] uppercase">
              <tr>
                <th className="text-left py-1.5">{groupBy === 'day' ? 'Day' : 'Operator'}</th>
                <th className={cell}>Bookings</th><th className={cell}>GMV</th><th className={cell}>Refunds</th><th className={cell}>Operator payouts</th><th className={cell}>Commission earned</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} className="border-t border-slate-800">
                  <td className="py-1.5 text-white">{r.label}</td>
                  <td className={cell}>{r.bookings}</td><td className={cell}>{inr(r.gmv_paise)}</td><td className={cell}>{inr(r.refunds_paise)}</td>
                  <td className={cell}>{inr(r.vendor_payout_paise)}</td><td className={cell}>{inr(r.commission_paise)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-700 font-bold text-white">
                <td className="py-1.5">Total</td>
                <td className={cell}>{data.totals.bookings}</td><td className={cell}>{inr(data.totals.gmv_paise)}</td><td className={cell}>{inr(data.totals.refunds_paise)}</td>
                <td className={cell}>{inr(data.totals.vendor_payout_paise)}</td><td className={cell}>{inr(data.totals.commission_paise)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
};

// ── Audit & admins ───────────────────────────────────────────────────────────

const Audit: React.FC = () => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { adminApi<any[]>('/admin/audit-logs?limit=200').then(setRows).catch(setErr); }, []);
  return (
    <Panel title={<><ScrollText className="w-4 h-4 text-teal-400" /> Audit log (append-only)</>}>
      <ErrorBanner error={err} />
      {!rows && !err && <Spinner />}
      <div className="space-y-1 max-h-[600px] overflow-y-auto custom-scrollbar">
        {rows?.map((r) => (
          <div key={r.id} className="text-xs p-2 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-500">{istDateTime(r.created_at)}</span> · <span className="font-bold text-white">{r.action}</span> · {r.entity_type}
            <span className="text-slate-500"> · {r.admin?.email ?? r.actor_type}{r.ip_address ? ` · ${r.ip_address}` : ''}</span>
            {r.data && Object.keys(r.data).length > 0 && <div className="text-slate-400 font-mono text-[10px] break-all">{JSON.stringify(r.data)}</div>}
          </div>
        ))}
      </div>
    </Panel>
  );
};

const Admins: React.FC<{ selfId: string }> = ({ selfId }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('OPS');
  const [created, setCreated] = useState<{ email: string; temporary_password: string } | null>(null);
  const load = useCallback(() => { adminApi<any[]>('/admin/admins').then(setRows).catch(setErr); }, []);
  useEffect(load, [load]);
  return (
    <Panel title={<><Users className="w-4 h-4 text-teal-400" /> Admin accounts</>}>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {created && <Notice tone="warn">Temporary password for {created.email} (shown once — share it securely): <span className="font-mono font-bold">{created.temporary_password}</span>. 2FA enrolment is forced at first login.</Notice>}
      <div className="flex flex-wrap gap-2 mb-4">
        <input className={`${inputCls} w-64`} placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className={`${inputCls} w-40`} value={role} onChange={(e) => setRole(e.target.value)}>{['OPS', 'FINANCE', 'SUPER_ADMIN'].map((r) => <option key={r}>{r}</option>)}</select>
        <Button onClick={async () => { try { const r = await adminApi<any>('/admin/admins', { body: { email, role } }); setCreated({ email, temporary_password: r.temporary_password }); setEmail(''); load(); } catch (e) { setErr(e); } }}>Create admin</Button>
      </div>
      <div className="space-y-1">
        {rows?.map((a) => (
          <div key={a.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-white">{a.email} <StatusPill status={a.role} /> {!a.active && <StatusPill status="SUSPENDED" />} {a.totp_enabled ? '· 2FA on' : '· 2FA not enrolled'}</span>
            {a.id !== selfId && (
              <span className="flex gap-1">
                <Button tone="ghost" onClick={async () => { try { await adminApi(`/admin/admins/${a.id}`, { method: 'PATCH', body: { active: !a.active } }); load(); } catch (e) { setErr(e); } }}>{a.active ? 'Deactivate' : 'Activate'}</Button>
                <Button tone="ghost" onClick={async () => { try { await adminApi(`/admin/admins/${a.id}/reset-2fa`, { method: 'POST' }); load(); } catch (e) { setErr(e); } }}>Reset 2FA</Button>
              </span>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
};

