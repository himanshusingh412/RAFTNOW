import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Bell, Calendar, CheckCircle2, ClipboardList, DollarSign, FileText, ImagePlus, LogOut, Plus, QrCode, ShieldCheck, Ship, Star, Trash2, Upload, UserCheck,
} from 'lucide-react';
import { ApiError, inr, istDateTime, istTime, request, todayIst, publicApi, Stretch } from '../services/api';
import { getToken, signOut } from '../lib/phone-auth';
import { QrScanner } from '../components/QrScanner';
import { Button, ConfirmDialog, ErrorBanner, Field, Notice, Panel, Spinner, StatusPill, inputCls } from '../components/ui';

const vendorToken = () => getToken('vendor');
const api = <T,>(path: string, opts: Parameters<typeof request>[1] = {}) => request<T>(path, { ...opts, token: vendorToken });

interface VendorView {
  id: string;
  status: 'DRAFT' | 'UNDER_REVIEW' | 'LIVE' | 'SUSPENDED';
  legal_name: string;
  display_name: string;
  description: string | null;
  owner_name: string;
  phone: string;
  email: string;
  address: string;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  business_type: string | null;
  licence_number: string | null;
  licence_expiry: string | null;
  licence_verified: boolean;
  pan_masked: string | null;
  gstin: string | null;
  bank_account_masked: string | null;
  bank_account_holder_name: string | null;
  ifsc: string | null;
  rejection_reason: string | null;
  suspension_reason: string | null;
  razorpay: { linked_account_id: string | null; status: string | null };
  documents: Array<{ id: string; type: string; original_name: string; status: string; rejection_reason: string | null; uploaded_at: string }>;
  onboarding_checklist: { items: Record<string, boolean>; ready_to_submit: boolean };
}

type Tab = 'onboarding' | 'manifest' | 'checkin' | 'departures' | 'trips' | 'payouts' | 'notifications';

export const VendorDashboardPage: React.FC = () => {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [signedOut, setSignedOut] = useState<'expired' | 'signed_out' | null>(null);
  const [vendor, setVendor] = useState<VendorView | null>(null);
  const [notMember, setNotMember] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('manifest');

  const load = useCallback(async () => {
    setErr(null);
    try {
      const v = await api<VendorView>('/vendor/me');
      setVendor(v);
      setNotMember(false);
      if (v.status !== 'LIVE') setTab('onboarding');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && /vendor staff/i.test(e.message)) setNotMember(true);
      else if (e instanceof ApiError && e.status === 401) {
        // The sign-in token itself was rejected (expired or revoked) → sign in again.
        await signOut('vendor');
        setSignedOut('expired');
        setSignedIn(false);
      } else setErr(e);
    }
  }, []);

  useEffect(() => {
    vendorToken().then((t) => {
      setSignedIn(!!t);
      if (t) load();
    });
  }, [load]);

  if (signedIn === null) return <div className="max-w-7xl mx-auto p-8"><Spinner /></div>;
  if (!signedIn) return <Navigate to={`/login?next=/vendor${signedOut ? `&reason=${signedOut}` : ''}`} replace />;

  const tabs: Array<[Tab, string, React.ReactNode]> = [
    ['onboarding', 'Company & KYC', <ShieldCheck key="o" className="w-4 h-4" />],
    ['manifest', 'Manifest', <ClipboardList key="m" className="w-4 h-4" />],
    ['checkin', 'QR check-in', <QrCode key="q" className="w-4 h-4" />],
    ['departures', 'Departures', <Calendar key="d" className="w-4 h-4" />],
    ['trips', 'Trips', <Ship key="t" className="w-4 h-4" />],
    ['payouts', 'Payouts', <DollarSign key="p" className="w-4 h-4" />],
    ['notifications', 'Notifications', <Bell key="n" className="w-4 h-4" />],
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-800">
        <div>
          <div className="text-xs font-semibold text-teal-400 flex items-center gap-2 mb-1">
            <UserCheck className="w-4 h-4" /> Operator portal
          </div>
          <h1 className="text-2xl font-extrabold text-white">
            {vendor?.display_name ?? (notMember ? 'Register your rafting company' : '…')}
            {vendor && <span className="ml-3 align-middle"><StatusPill status={vendor.status} /></span>}
          </h1>
          {vendor?.licence_number && (
            <div className="text-xs text-slate-400 mt-1">
              Licence {vendor.licence_number}
              {vendor.licence_expiry && ` · expires ${new Date(vendor.licence_expiry).toLocaleDateString('en-IN')}`}
              {vendor.licence_verified ? ' · verified' : ' · not yet verified'}
            </div>
          )}
        </div>
        <Button tone="ghost" onClick={async () => { await signOut('vendor'); setSignedOut('signed_out'); setSignedIn(false); setVendor(null); }}>
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </Button>
      </div>

      <ErrorBanner error={err} onClose={() => setErr(null)} />

      {notMember && <StartOnboarding onDone={load} />}

      {vendor && (
        <>
          <div className="flex flex-wrap gap-1 bg-slate-900 border border-slate-800 rounded-2xl p-1 mb-6">
            {tabs.map(([k, label, icon]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 ${tab === k ? 'bg-teal-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
              >
                {icon} {label}
              </button>
            ))}
          </div>
          {vendor.status === 'SUSPENDED' && (
            <Notice tone="warn">Your company is suspended{vendor.suspension_reason ? `: ${vendor.suspension_reason}` : ''}. New bookings are paused.</Notice>
          )}
          {vendor.status !== 'LIVE' && tab !== 'onboarding' && (
            <Notice tone="warn">Your company is not LIVE yet — customers cannot book your trips until RaftNow approves your KYC.</Notice>
          )}
          {tab === 'onboarding' && <Onboarding vendor={vendor} reload={load} />}
          {tab === 'manifest' && <Manifest />}
          {tab === 'checkin' && <CheckIn />}
          {tab === 'departures' && <Departures />}
          {tab === 'trips' && <Trips />}
          {tab === 'payouts' && <Payouts />}
          {tab === 'notifications' && <Notifications />}
        </>
      )}
    </div>
  );
};

// ── Onboarding ───────────────────────────────────────────────────────────────

const StartOnboarding: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [f, setF] = useState({ legal_name: '', display_name: '', owner_name: '', email: '', address: '', business_type: 'proprietorship' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Panel title="Register your company" className="max-w-xl">
      <p className="text-xs text-slate-400 mb-3">Your signed-in phone number becomes the company OWNER account.</p>
      <ErrorBanner error={err} />
      <div className="grid sm:grid-cols-2 gap-3">
        {(['legal_name', 'display_name', 'owner_name', 'email', 'address'] as const).map((k) => (
          <Field key={k} label={k.replace(/_/g, ' ')}>
            <input className={inputCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
        <Field label="Business type">
          <select className={inputCls} value={f.business_type} onChange={(e) => setF({ ...f, business_type: e.target.value })}>
            {['proprietorship', 'partnership', 'private_limited', 'public_limited', 'llp', 'individual', 'trust', 'society'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
      </div>
      <Button className="mt-4" busy={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { await api('/vendor/onboarding', { body: f }); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
      }}>Create company (DRAFT)</Button>
    </Panel>
  );
};

const DOC_TYPES = ['LICENCE', 'PAN', 'CANCELLED_CHEQUE', 'GSTIN_CERTIFICATE', 'BANK_STATEMENT', 'OTHER'];

const Onboarding: React.FC<{ vendor: VendorView; reload: () => void }> = ({ vendor, reload }) => {
  const editable = vendor.status === 'DRAFT';
  const [f, setF] = useState<Record<string, string>>({
    display_name: vendor.display_name, description: vendor.description ?? '', address: vendor.address,
    address_city: vendor.address_city ?? '', address_state: vendor.address_state ?? '', address_postal_code: vendor.address_postal_code ?? '',
    licence_number: vendor.licence_number ?? '', licence_expiry: vendor.licence_expiry?.slice(0, 10) ?? '', gstin: vendor.gstin ?? '',
    ifsc: vendor.ifsc ?? '', bank_account_holder_name: vendor.bank_account_holder_name ?? '', pan: '', bank_account_number: '',
  });
  const [docType, setDocType] = useState('LICENCE');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy('save'); setErr(null); setSaved(false);
    try {
      const body: Record<string, string> = {};
      for (const [k, v] of Object.entries(f)) if (v.trim() !== '') body[k] = k === 'licence_expiry' ? `${v}T00:00:00Z` : v.trim();
      if (!editable) for (const k of ['pan', 'bank_account_number', 'ifsc', 'bank_account_holder_name']) delete body[k];
      await api('/vendor/onboarding', { method: 'PATCH', body });
      setF((x) => ({ ...x, pan: '', bank_account_number: '' }));
      setSaved(true);
      reload();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Panel title={<><ShieldCheck className="w-4 h-4 text-teal-400" /> Business, licence &amp; bank details</>}>
        <ErrorBanner error={err} onClose={() => setErr(null)} />
        {saved && <Notice tone="ok">Saved.</Notice>}
        {vendor.rejection_reason && vendor.status === 'DRAFT' && <Notice tone="warn">Previous application rejected: {vendor.rejection_reason}</Notice>}
        {vendor.status === 'UNDER_REVIEW' && <Notice>Your application is under review. Details are locked.</Notice>}
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            ['display_name', 'Display name'], ['address', 'Street address'], ['address_city', 'City'], ['address_state', 'State'],
            ['address_postal_code', 'PIN code'], ['licence_number', 'Rafting licence no.'], ['gstin', 'GSTIN (optional)'],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <input className={inputCls} disabled={vendor.status === 'UNDER_REVIEW'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </Field>
          ))}
          <Field label="Licence expiry">
            <input type="date" className={inputCls} disabled={vendor.status === 'UNDER_REVIEW'} value={f.licence_expiry} onChange={(e) => setF({ ...f, licence_expiry: e.target.value })} />
          </Field>
          <Field label={`PAN ${vendor.pan_masked ? `(on file: ${vendor.pan_masked})` : ''}`} hint="Encrypted at rest. Only the last 4 characters are ever shown.">
            <input className={inputCls} disabled={!editable} placeholder={editable ? 'ABCDE1234F' : 'Contact support to change'} value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={`Bank account ${vendor.bank_account_masked ? `(on file: ${vendor.bank_account_masked})` : ''}`}>
            <input className={inputCls} disabled={!editable} inputMode="numeric" value={f.bank_account_number} onChange={(e) => setF({ ...f, bank_account_number: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="IFSC">
            <input className={inputCls} disabled={!editable} value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Account holder name">
            <input className={inputCls} disabled={!editable} value={f.bank_account_holder_name} onChange={(e) => setF({ ...f, bank_account_holder_name: e.target.value })} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className={`${inputCls} mt-3`} rows={3} disabled={vendor.status === 'UNDER_REVIEW'} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Button className="mt-4" busy={busy === 'save'} disabled={vendor.status === 'UNDER_REVIEW'} onClick={save}>Save details</Button>
      </Panel>

      <div className="space-y-6">
        <Panel title={<><FileText className="w-4 h-4 text-teal-400" /> KYC documents (private)</>}>
          <p className="text-[11px] text-slate-400 mb-3">PDF, JPEG or PNG up to 10 MB. Stored privately; viewable only through short-lived signed links.</p>
          <div className="flex flex-wrap gap-2 items-end mb-3">
            <Field label="Type">
              <select className={inputCls} value={docType} onChange={(e) => setDocType(e.target.value)}>
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="text-xs text-slate-300" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button busy={busy === 'upload'} disabled={!file || vendor.status === 'UNDER_REVIEW'} onClick={async () => {
              if (!file) return;
              setBusy('upload'); setErr(null);
              try {
                const form = new FormData();
                form.append('type', docType);
                form.append('file', file);
                await api('/vendor/documents', { form, method: 'POST' });
                setFile(null);
                reload();
              } catch (e) { setErr(e); } finally { setBusy(null); }
            }}><Upload className="w-3.5 h-3.5" /> Upload</Button>
          </div>
          <div className="space-y-2">
            {vendor.documents.length === 0 && <p className="text-xs text-slate-500">No documents uploaded.</p>}
            {vendor.documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                <div>
                  <div className="font-bold text-white">{d.type}</div>
                  <div className="text-slate-500">{d.original_name}{d.rejection_reason ? ` — ${d.rejection_reason}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={d.status} />
                  <Button tone="ghost" onClick={async () => {
                    try { const r = await api<{ url: string }>(`/vendor/documents/${d.id}/url`); window.open(r.url, '_blank', 'noopener'); } catch (e) { setErr(e); }
                  }}>View</Button>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title={<><CheckCircle2 className="w-4 h-4 text-teal-400" /> Application</>}>
          <ul className="text-xs space-y-1 mb-4">
            {Object.entries(vendor.onboarding_checklist.items).map(([k, ok]) => (
              <li key={k} className={ok ? 'text-emerald-300' : 'text-slate-400'}>{ok ? '✓' : '○'} {k.replace(/_/g, ' ')}</li>
            ))}
          </ul>
          {vendor.status === 'DRAFT' && (
            <Button busy={busy === 'submit'} disabled={!vendor.onboarding_checklist.ready_to_submit} onClick={async () => {
              setBusy('submit'); setErr(null);
              try { await api('/vendor/onboarding/submit', { method: 'POST' }); reload(); } catch (e) { setErr(e); } finally { setBusy(null); }
            }}>Submit for review</Button>
          )}
          <div className="text-[11px] text-slate-400 mt-3">
            Payout account (Razorpay Route): {vendor.razorpay.linked_account_id ? `${vendor.razorpay.linked_account_id} — ${vendor.razorpay.status ?? 'pending'}` : 'not set up yet (RaftNow finance team creates it after approval)'}
          </div>
        </Panel>
      </div>
    </div>
  );
};

// ── Manifest ─────────────────────────────────────────────────────────────────

interface ManifestRow {
  id: string; display_code: string; status: string; mode: string; seat_count: number; contact_name: string; contact_phone: string;
  guests: Array<{ name: string; age: number }>; checked_in_at: string | null; slot: { start_time: string; trip_title: string; stretch_name: string };
}

const Manifest: React.FC = () => {
  const [date, setDate] = useState(todayIst());
  const [rows, setRows] = useState<ManifestRow[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [cancelFor, setCancelFor] = useState<ManifestRow | null>(null);
  const load = useCallback(() => {
    setRows(null);
    api<ManifestRow[]>(`/vendor/bookings?date=${date}`).then(setRows).catch((e) => { setErr(e); setRows([]); });
  }, [date]);
  useEffect(load, [load]);
  const pax = (rows ?? []).filter((r) => ['CONFIRMED', 'CHECKED_IN'].includes(r.status)).reduce((a, r) => a + r.seat_count, 0);
  const inPax = (rows ?? []).filter((r) => r.status === 'CHECKED_IN').reduce((a, r) => a + r.seat_count, 0);
  return (
    <Panel title={<><ClipboardList className="w-4 h-4 text-teal-400" /> Passenger manifest</>} actions={
      <input type="date" className={`${inputCls} w-auto`} value={date} onChange={(e) => setDate(e.target.value)} />
    }>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      <div className="text-xs text-slate-300 mb-3">{pax} passengers confirmed · {inPax} checked in</div>
      {!rows && <Spinner />}
      {rows && rows.length === 0 && <p className="text-xs text-slate-500">No bookings for this date.</p>}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-xs">
          <thead className="text-slate-500 text-left">
            <tr><th className="py-2">Departure</th><th>Booking</th><th>Lead / contact</th><th>Guests</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} className="border-t border-slate-800 align-top">
                <td className="py-2 text-slate-300">{istTime(r.slot.start_time)}<div className="text-slate-500">{r.slot.trip_title}</div></td>
                <td className="font-mono text-teal-300">{r.display_code}<div className="text-slate-500">{r.mode} · {r.seat_count}</div></td>
                <td className="text-slate-300">{r.contact_name}<div className="text-slate-500">{r.contact_phone}</div></td>
                <td className="text-slate-400">{r.guests.map((g) => `${g.name} (${g.age})`).join(', ')}</td>
                <td><StatusPill status={r.status} /></td>
                <td className="text-right space-x-1 whitespace-nowrap">
                  {(r.status === 'CONFIRMED' || r.status === 'PENDING_PAYMENT') && (
                    <Button tone="danger" onClick={() => setCancelFor(r)}>Cancel</Button>
                  )}
                  {r.status === 'CONFIRMED' && new Date(r.slot.start_time) < new Date() && (
                    <Button tone="ghost" onClick={async () => { try { await api(`/vendor/bookings/${r.id}/no-show`, { method: 'POST' }); load(); } catch (e) { setErr(e); } }}>No-show</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cancelFor && (
        <ConfirmDialog
          title={`Cancel ${cancelFor.display_code}?`}
          body="The customer receives a 100% refund and your reliability score is reduced. This cannot be undone."
          confirmLabel="Cancel booking"
          onConfirm={async (reason) => { await api(`/vendor/bookings/${cancelFor.id}/cancel`, { body: { reason } }); load(); }}
          onClose={() => setCancelFor(null)}
        />
      )}
    </Panel>
  );
};

// ── QR check-in ──────────────────────────────────────────────────────────────

const CheckIn: React.FC = () => {
  const [result, setResult] = useState<{ ok: boolean; title: string; detail: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = useCallback(async (body: { qr_token: string } | { booking_code: string }) => {
    setBusy(true);
    try {
      const r = await api<{ booking: { display_code: string; seat_count: number; guests: Array<{ name: string }>; trip_title: string; start_time: string } }>(
        '/bookings/check-in', { body },
      );
      setResult({ ok: true, title: `Checked in ${r.booking.display_code}`, detail: `${r.booking.seat_count} pax — ${r.booking.guests.map((g) => g.name).join(', ')} · ${r.booking.trip_title} ${istTime(r.booking.start_time)}` });
      return true;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'ERROR';
      setResult({ ok: false, title: code.replace(/_/g, ' '), detail: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  const onScan = useCallback(async (token: string) => { await submit({ qr_token: token }); }, [submit]);
  const onCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 6) return;
    if (await submit({ booking_code: code })) setCode('');
  };
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Panel title={<><QrCode className="w-4 h-4 text-teal-400" /> Scan customer ticket</>}>
          <p className="text-xs text-slate-400 mb-3">Point the camera at the customer's RaftNow QR. The server verifies the signature, that the booking is yours, confirmed, within the check-in window, and not already used.</p>
          <QrScanner onScan={onScan} />
        </Panel>
        <Panel title={<><UserCheck className="w-4 h-4 text-teal-400" /> No QR? Enter the booking code</>}>
          <p className="text-xs text-slate-400 mb-3">The code is on the customer's SMS and email, e.g. RF7K2M9P. The same checks apply as for a scan.</p>
          <form onSubmit={onCode} className="flex gap-2">
            <input
              className={`${inputCls} font-mono uppercase tracking-widest`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="RF······"
              maxLength={12}
              autoComplete="off"
              aria-label="Booking code"
            />
            <Button type="submit" busy={busy}>Check in</Button>
          </form>
        </Panel>
      </div>
      <Panel title="Last check-in">
        {!result && <p className="text-xs text-slate-500">No check-ins yet.</p>}
        {result && (
          <div className={`rounded-xl p-4 border ${result.ok ? 'border-emerald-500/40 bg-emerald-950/30' : 'border-rose-500/40 bg-rose-950/30'}`}>
            <div className={`text-base font-extrabold ${result.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{result.title}</div>
            <div className="text-xs text-slate-300 mt-1">{result.detail}</div>
          </div>
        )}
      </Panel>
    </div>
  );
};

// ── Departures (slots) ───────────────────────────────────────────────────────

interface VendorSlot {
  id: string; start_time: string; status: string; blocked_reason: string | null; total_seats: number; seats_booked: number;
  seats_held_active: number; private_rafts_booked: number; raft_capacity: number; passengers: number; checked_in: number;
  trip: { title: string; stretch: { name: string } };
}

const Departures: React.FC = () => {
  const [date, setDate] = useState(todayIst());
  const [rows, setRows] = useState<VendorSlot[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [blockFor, setBlockFor] = useState<VendorSlot | null>(null);
  const load = useCallback(() => { api<VendorSlot[]>(`/vendor/slots?date=${date}`).then(setRows).catch(setErr); }, [date]);
  useEffect(load, [load]);
  return (
    <Panel title={<><Calendar className="w-4 h-4 text-teal-400" /> Departures &amp; capacity</>} actions={
      <input type="date" className={`${inputCls} w-auto`} value={date} onChange={(e) => setDate(e.target.value)} />
    }>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {!rows && <Spinner />}
      {rows?.length === 0 && <p className="text-xs text-slate-500">No departures. Add departure times to a LIVE trip in the Trips tab.</p>}
      <div className="space-y-2">
        {rows?.map((s) => {
          const used = s.seats_booked + s.seats_held_active + s.private_rafts_booked * s.raft_capacity;
          return (
            <div key={s.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-white">{istTime(s.start_time)} · {s.trip.title}</div>
                <div className="text-slate-400">{used}/{s.total_seats} seats used · {s.passengers} pax confirmed · {s.checked_in} checked in{s.blocked_reason ? ` · ${s.blocked_reason}` : ''}</div>
                <div className="h-1.5 bg-slate-800 rounded-full mt-1 w-56"><div className="h-1.5 bg-teal-500 rounded-full" style={{ width: `${Math.min(100, (used / s.total_seats) * 100)}%` }} /></div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={s.status} />
                {s.status === 'OPEN' ? (
                  <Button tone="danger" onClick={() => setBlockFor(s)}>Block</Button>
                ) : (
                  <Button tone="ghost" onClick={async () => { try { await api(`/vendor/slots/${s.id}/unblock`, { method: 'POST' }); load(); } catch (e) { setErr(e); } }}>Unblock</Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {blockFor && (
        <ConfirmDialog
          title="Block this departure?"
          body="Customers will no longer see or book it. Existing bookings are NOT cancelled automatically — cancel them from the manifest if the trip will not run."
          confirmLabel="Block departure"
          onConfirm={async (reason) => { await api(`/vendor/slots/${blockFor.id}/block`, { body: { reason } }); load(); }}
          onClose={() => setBlockFor(null)}
        />
      )}
    </Panel>
  );
};

// ── Trips ────────────────────────────────────────────────────────────────────

interface TripRow {
  id: string; title: string; status: string; raft_capacity: number; per_seat_price_paise: number; private_raft_price_paise: number | null;
  stretch: { name: string }; slot_templates: Array<{ id: string; departure_time: string; days_of_week: number[]; rafts_count: number; active: boolean }>;
  photos: TripPhoto[];
  admin_hidden_at?: string | null; admin_hidden_reason?: string | null;
}

interface TripPhoto { id: string; url: string; caption: string | null }
const MAX_PHOTOS = 8;

/** Trip gallery (V-04): the first photo is the cover customers see in search. */
const TripPhotos: React.FC<{ trip: TripRow; onChange: () => void }> = ({ trip, onChange }) => {
  const [photos, setPhotos] = useState(trip.photos);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => setPhotos(trip.photos), [trip.photos]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    for (const file of Array.from(files).slice(0, MAX_PHOTOS - photos.length)) {
      setBusy(`upload:${file.name}`);
      const form = new FormData();
      form.append('file', file);
      try {
        const p = await api<TripPhoto>(`/vendor/trips/${trip.id}/photos`, { form });
        setPhotos((cur) => [...cur, p]);
      } catch (e) {
        setErr(e);
        break;
      }
    }
    setBusy(null);
    onChange();
  };
  const reorder = async (next: TripPhoto[]) => {
    const prev = photos;
    setPhotos(next);
    setBusy('order');
    try {
      setPhotos(await api<TripPhoto[]>(`/vendor/trips/${trip.id}/photos/order`, { method: 'PUT', body: { photo_ids: next.map((p) => p.id) } }));
    } catch (e) {
      setPhotos(prev);
      setErr(e);
    } finally {
      setBusy(null);
    }
  };
  const move = (i: number, to: number) => {
    const next = [...photos];
    const [p] = next.splice(i, 1);
    next.splice(to, 0, p);
    void reorder(next);
  };
  const remove = async (p: TripPhoto) => {
    setBusy(`del:${p.id}`);
    try {
      await api(`/vendor/trips/${trip.id}/photos/${p.id}`, { method: 'DELETE' });
      setPhotos((cur) => cur.filter((x) => x.id !== p.id));
      onChange();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase font-bold text-slate-500">Photos {photos.length}/{MAX_PHOTOS}</span>
        {photos.length < MAX_PHOTOS && (
          <label className={`inline-flex items-center gap-1 text-[11px] font-bold text-teal-300 cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            <ImagePlus className="w-3.5 h-3.5" /> {busy?.startsWith('upload') ? 'Uploading…' : 'Add photos'}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {photos.length === 0 ? (
        <p className="text-[11px] text-slate-500">No photos yet. Trips with photos get more bookings: add the raft, the rapids and your team (JPEG/PNG/WebP, at least 400 px).</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <figure key={p.id} className="relative group rounded-lg overflow-hidden border border-slate-800 bg-slate-950 aspect-[4/3]">
              <img src={p.url} alt={p.caption ?? `Photo ${i + 1} of ${trip.title}`} className="w-full h-full object-cover" loading="lazy" />
              {i === 0 && <span className="absolute top-1 left-1 text-[9px] font-bold bg-teal-500 text-slate-950 rounded px-1 flex items-center gap-0.5"><Star className="w-2.5 h-2.5" /> Cover</span>}
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-slate-950/80 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                <button type="button" className="p-1 text-slate-200 disabled:opacity-30" disabled={i === 0 || !!busy} onClick={() => move(i, i - 1)} aria-label="Move earlier"><ArrowLeft className="w-3.5 h-3.5" /></button>
                {i !== 0 && <button type="button" className="p-1 text-teal-300 disabled:opacity-30" disabled={!!busy} onClick={() => move(i, 0)} aria-label="Make cover"><Star className="w-3.5 h-3.5" /></button>}
                <button type="button" className="p-1 text-rose-300 disabled:opacity-30" disabled={!!busy} onClick={() => remove(p)} aria-label="Delete photo"><Trash2 className="w-3.5 h-3.5" /></button>
                <button type="button" className="p-1 text-slate-200 disabled:opacity-30" disabled={i === photos.length - 1 || !!busy} onClick={() => move(i, i + 1)} aria-label="Move later"><ArrowRight className="w-3.5 h-3.5" /></button>
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
};

const Trips: React.FC = () => {
  const [trips, setTrips] = useState<TripRow[] | null>(null);
  const [stretches, setStretches] = useState<Stretch[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [form, setForm] = useState({ stretch_id: '', title: '', description: '', duration_minutes: '120', meeting_point: '', raft_capacity: '8', price: '', private_price: '' });
  const [dep, setDep] = useState<Record<string, { time: string; rafts: string }>>({});
  const load = useCallback(() => { api<TripRow[]>('/vendor/trips').then(setTrips).catch(setErr); }, []);
  useEffect(() => { load(); publicApi.stretches().then(setStretches).catch(setErr); }, [load]);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Panel title={<><Ship className="w-4 h-4 text-teal-400" /> My trips</>}>
        <ErrorBanner error={err} onClose={() => setErr(null)} />
        {!trips && <Spinner />}
        <div className="space-y-3">
          {trips?.map((t) => (
            <div key={t.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs">
              <div className="flex items-center justify-between">
                <div className="font-bold text-white">{t.title}</div>
                <StatusPill status={t.status} />
              </div>
              <div className="text-slate-400">{t.stretch.name} · {inr(t.per_seat_price_paise)}/seat{t.private_raft_price_paise ? ` · private ${inr(t.private_raft_price_paise)}` : ''} · {t.raft_capacity}/raft</div>
              <div className="text-slate-400 mt-1">Departures: {t.slot_templates.filter((d) => d.active).map((d) => `${d.departure_time} (${d.rafts_count} rafts)`).join(', ') || 'none'}</div>
              {t.admin_hidden_at && <div className="text-amber-300 mt-1">Taken off sale by RaftNow: {t.admin_hidden_reason}. Contact support to republish.</div>}
              <TripPhotos trip={t} onChange={load} />
              <div className="flex flex-wrap gap-2 mt-2 items-center">
                <input className={`${inputCls} w-24`} placeholder="HH:MM" value={dep[t.id]?.time ?? ''} onChange={(e) => setDep({ ...dep, [t.id]: { time: e.target.value, rafts: dep[t.id]?.rafts ?? '2' } })} />
                <input className={`${inputCls} w-20`} placeholder="rafts" value={dep[t.id]?.rafts ?? '2'} onChange={(e) => setDep({ ...dep, [t.id]: { time: dep[t.id]?.time ?? '', rafts: e.target.value } })} />
                <Button tone="ghost" onClick={async () => {
                  try { await api(`/vendor/trips/${t.id}/departures`, { body: { departure_time: dep[t.id]?.time, days_of_week: [], rafts_count: Number(dep[t.id]?.rafts ?? 2) } }); load(); } catch (e) { setErr(e); }
                }}><Plus className="w-3.5 h-3.5" /> Daily departure</Button>
                {t.status !== 'LIVE' ? (
                  <Button onClick={async () => { try { await api(`/vendor/trips/${t.id}`, { method: 'PATCH', body: { status: 'LIVE' } }); load(); } catch (e) { setErr(e); } }}>Publish</Button>
                ) : (
                  <Button tone="danger" onClick={async () => { try { await api(`/vendor/trips/${t.id}`, { method: 'PATCH', body: { status: 'HIDDEN' } }); load(); } catch (e) { setErr(e); } }}>Hide</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title={<><Plus className="w-4 h-4 text-teal-400" /> New trip</>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Stretch">
            <select className={inputCls} value={form.stretch_id} onChange={(e) => setForm({ ...form, stretch_id: e.target.value })}>
              <option value="">Select…</option>
              {stretches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Title"><input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Meeting point"><input className={inputCls} value={form.meeting_point} onChange={(e) => setForm({ ...form, meeting_point: e.target.value })} /></Field>
          <Field label="Duration (min)"><input className={inputCls} value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></Field>
          <Field label="Seats per raft"><input className={inputCls} value={form.raft_capacity} onChange={(e) => setForm({ ...form, raft_capacity: e.target.value })} /></Field>
          <Field label="Price per seat (₹)"><input className={inputCls} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
          <Field label="Private raft price (₹, optional)"><input className={inputCls} value={form.private_price} onChange={(e) => setForm({ ...form, private_price: e.target.value })} /></Field>
        </div>
        <Field label="Description"><textarea className={`${inputCls} mt-3`} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Button className="mt-3" onClick={async () => {
          try {
            await api('/vendor/trips', { body: {
              stretch_id: form.stretch_id, title: form.title, description: form.description, duration_minutes: Number(form.duration_minutes),
              meeting_point: form.meeting_point, raft_capacity: Number(form.raft_capacity),
              per_seat_price_paise: Math.round(Number(form.price) * 100),
              ...(form.private_price ? { private_raft_price_paise: Math.round(Number(form.private_price) * 100) } : {}),
            } });
            load();
          } catch (e) { setErr(e); }
        }}>Create trip (DRAFT)</Button>
      </Panel>
    </div>
  );
};

// ── Payouts & notifications ─────────────────────────────────────────────────

const Payouts: React.FC = () => {
  const [data, setData] = useState<{ totals: Record<string, { count: number; amount_paise: number }>; transfers: any[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api<typeof data>('/vendor/payouts').then(setData).catch(setErr); }, []);
  return (
    <Panel title={<><DollarSign className="w-4 h-4 text-teal-400" /> Payouts (Razorpay Route)</>}>
      <ErrorBanner error={err} />
      <p className="text-[11px] text-slate-400 mb-3">Your share of each booking is held by RaftNow and transferred to your linked Razorpay account 24 hours after the trip ends. Refunds reduce the payout of the affected booking.</p>
      {!data && !err && <Spinner />}
      {data && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(data.totals).map(([s, t]) => (
              <div key={s} className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs"><StatusPill status={s} /> <span className="ml-1 font-bold text-white">{inr(t.amount_paise)}</span> <span className="text-slate-500">({t.count})</span></div>
            ))}
          </div>
          <table className="w-full text-xs">
            <thead className="text-slate-500 text-left"><tr><th className="py-1">Booking</th><th>Trip date</th><th>Amount</th><th>Status</th><th>Release</th><th>Razorpay</th></tr></thead>
            <tbody>
              {data.transfers.map((t) => (
                <tr key={t.id} className="border-t border-slate-800">
                  <td className="py-1.5 font-mono text-teal-300">RF{t.booking_code}</td>
                  <td>{istDateTime(t.departure)}</td>
                  <td className="font-bold">{inr(t.amount_paise)}</td>
                  <td><StatusPill status={t.status} />{t.hold_reason && <div className="text-amber-300">{t.hold_reason}</div>}</td>
                  <td>{istDateTime(t.release_at)}</td>
                  <td className="font-mono text-slate-500">{t.razorpay_transfer_id ?? '—'}{t.utr ? ` · UTR ${t.utr}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  );
};

const Notifications: React.FC = () => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api<any[]>('/vendor/notifications').then(setRows).catch(setErr); }, []);
  return (
    <Panel title={<><Bell className="w-4 h-4 text-teal-400" /> Notifications</>}>
      <ErrorBanner error={err} />
      {!rows && !err && <Spinner />}
      {rows?.length === 0 && <p className="text-xs text-slate-500">No notifications.</p>}
      <div className="space-y-1">
        {rows?.map((n) => (
          <div key={n.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-white">{n.event.replace(/_/g, ' ')} <span className="text-slate-500">({n.channel})</span></span>
            <span className="flex items-center gap-2"><StatusPill status={n.status} /><span className="text-slate-500">{istDateTime(n.created_at)}</span></span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-2">SKIPPED = recorded but not delivered because no provider is configured for that channel.</p>
    </Panel>
  );
};
