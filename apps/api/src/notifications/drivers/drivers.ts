import * as admin from 'firebase-admin';
import { NotificationDriver, OutboundMessage, Recipient, SendResult, PermanentDeliveryError } from './types';

/**
 * Provider drivers. Each is active only when its credentials exist; otherwise the
 * notification is recorded as SKIPPED (never reported as sent). Credentials are
 * read from the environment only — nothing is hard-coded.
 *
 * NOTE: none of these providers could be exercised end-to-end in development
 * without real credentials; they are implemented against the providers' public
 * HTTP APIs and are covered by unit tests with a stubbed fetch.
 */

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    throw new PermanentDeliveryError(`HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** Firebase Cloud Messaging (push). Uses the already-initialised Firebase Admin app. */
export class FcmPushDriver implements NotificationDriver {
  readonly channel = 'PUSH' as const;
  readonly provider = 'fcm';

  isConfigured(): boolean {
    return admin.apps.length > 0;
  }

  async send(to: Recipient, msg: OutboundMessage): Promise<SendResult> {
    if (!to.pushToken) return { status: 'SKIPPED', reason: 'NO_PUSH_TOKEN' };
    try {
      const id = await admin.messaging().send({
        token: to.pushToken,
        notification: { title: msg.title, body: msg.body },
        data: msg.data,
      });
      return { status: 'SENT', provider: this.provider, providerMessageId: id };
    } catch (err: any) {
      const code: string = err?.code ?? '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        throw new PermanentDeliveryError(code);
      }
      throw new Error(code || 'FCM send failed');
    }
  }
}

/** SendGrid v3 transactional email. Env: SENDGRID_API_KEY, EMAIL_FROM. */
export class SendGridEmailDriver implements NotificationDriver {
  readonly channel = 'EMAIL' as const;
  readonly provider = 'sendgrid';

  isConfigured(): boolean {
    return !!process.env.SENDGRID_API_KEY && !!process.env.EMAIL_FROM;
  }

  async send(to: Recipient, msg: OutboundMessage): Promise<SendResult> {
    if (!to.email) return { status: 'SKIPPED', reason: 'NO_EMAIL' };
    await postJson(
      'https://api.sendgrid.com/v3/mail/send',
      { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
      {
        personalizations: [{ to: [{ email: to.email }] }],
        from: { email: process.env.EMAIL_FROM },
        subject: msg.title,
        content: [{ type: 'text/plain', value: msg.body }],
      },
    );
    return { status: 'SENT', provider: this.provider };
  }
}

/**
 * Fast2SMS (India). Env: FAST2SMS_API_KEY. Uses the "q" (quick) route; for
 * production volumes switch to the DLT route with registered templates.
 */
export class Fast2SmsDriver implements NotificationDriver {
  readonly channel = 'SMS' as const;
  readonly provider = 'fast2sms';

  isConfigured(): boolean {
    return !!process.env.FAST2SMS_API_KEY;
  }

  async send(to: Recipient, msg: OutboundMessage): Promise<SendResult> {
    if (!to.phone || !to.phone.startsWith('+91')) return { status: 'SKIPPED', reason: 'NO_INDIAN_MOBILE' };
    const res = await postJson(
      'https://www.fast2sms.com/dev/bulkV2',
      { authorization: process.env.FAST2SMS_API_KEY as string },
      { route: 'q', message: `${msg.title}: ${msg.body}`, numbers: to.phone.slice(3) },
    );
    if (res?.return === false) throw new Error('Fast2SMS rejected message');
    return { status: 'SENT', provider: this.provider, providerMessageId: res?.request_id };
  }
}

/**
 * WhatsApp Business messages must use pre-approved templates (Gupshup/Interakt).
 * No templates are registered for this project yet, so this driver reports
 * SKIPPED rather than pretending delivery happened.
 */
export class WhatsAppUnavailableDriver implements NotificationDriver {
  readonly channel = 'WHATSAPP' as const;
  readonly provider = 'whatsapp';

  isConfigured(): boolean {
    return false;
  }

  async send(): Promise<SendResult> {
    return { status: 'SKIPPED', reason: 'WHATSAPP_TEMPLATES_NOT_CONFIGURED' };
  }
}
