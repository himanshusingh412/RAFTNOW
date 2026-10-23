import React, { useEffect, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { Smartphone, Wrench } from 'lucide-react';
import { publicApi } from '../lib/api';
import { Audience, firebaseConfigured, sendOtp, setDevToken } from '../lib/phone-auth';
import { Button, ErrorBanner, Field, Notice, Panel, inputCls } from './ui';

/**
 * Real phone OTP (Firebase) when configured. Developer sign-in is offered only
 * when the API itself reports dev-bypass mode — it never appears in production.
 */
export const PhoneSignIn: React.FC<{ audience: Audience; title: string; onSignedIn: () => void }> = ({ audience, title, onSignedIn }) => {
  const [mode, setMode] = useState<'loading' | 'firebase' | 'dev' | 'none'>('loading');
  const [phone, setPhone] = useState('+91');
  const [devUid, setDevUid] = useState(audience === 'vendor' ? 'vendor-owner' : 'customer-1');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    publicApi
      .health()
      .then((h) => setMode(firebaseConfigured && h.integrations.firebase_auth === 'configured' ? 'firebase' : h.integrations.firebase_auth === 'dev_bypass_only' ? 'dev' : 'none'))
      .catch((e) => {
        setErr(e);
        setMode('none');
      });
  }, []);

  const validPhone = /^\+[1-9]\d{7,14}$/.test(phone);

  return (
    <Panel title={<><Smartphone className="w-4 h-4 text-teal-400" /> {title}</>} className="max-w-md mx-auto">
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {mode === 'loading' && <p className="text-xs text-slate-400">Checking sign-in options…</p>}
      {mode === 'none' && (
        <Notice tone="warn">
          Phone sign-in is not available: Firebase is not configured on this deployment (server FIREBASE_* and web VITE_FIREBASE_* settings).
        </Notice>
      )}

      {mode === 'firebase' && (
        <div className="space-y-3">
          <Field label="Mobile number (E.164)">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value.trim())} placeholder="+919876543210" />
          </Field>
          {!confirmation ? (
            <Button
              busy={busy}
              disabled={!validPhone}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  setConfirmation(await sendOtp(phone, 'recaptcha-container'));
                } catch (e) {
                  setErr(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send OTP
            </Button>
          ) : (
            <>
              <Field label="6-digit OTP">
                <input className={inputCls} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Button
                busy={busy}
                disabled={code.length !== 6}
                onClick={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    await confirmation.confirm(code);
                    onSignedIn();
                  } catch (e) {
                    setErr(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Verify &amp; continue
              </Button>
            </>
          )}
          <div id="recaptcha-container" />
        </div>
      )}

      {mode === 'dev' && (
        <div className="space-y-3">
          <Notice tone="warn">
            <span className="font-bold flex items-center gap-1">
              <Wrench className="w-3.5 h-3.5" /> Developer sign-in (local development only)
            </span>
            The API is running with AUTH_DEV_BYPASS and no Firebase project. This creates a dev token; it is refused by a production
            server.
          </Notice>
          <Field label="Dev user id" hint={audience === 'vendor' ? 'Seeded operator owner: vendor-owner / +919876543210' : 'Any id; a customer record is created on first request'}>
            <input className={inputCls} value={devUid} onChange={(e) => setDevUid(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} />
          </Field>
          <Field label="Mobile number (E.164)">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value.trim())} placeholder="+919876543210" />
          </Field>
          <Button
            disabled={!validPhone || devUid.length < 3}
            onClick={() => {
              setDevToken(audience, devUid, phone);
              onSignedIn();
            }}
          >
            Continue as developer
          </Button>
        </div>
      )}
    </Panel>
  );
};
