export type Channel = 'PUSH' | 'SMS' | 'EMAIL' | 'WHATSAPP';

export interface Recipient {
  phone?: string | null;   // E.164
  email?: string | null;
  pushToken?: string | null;
}

export interface OutboundMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export type SendResult =
  | { status: 'SENT'; provider: string; providerMessageId?: string }
  | { status: 'SKIPPED'; reason: string };

export interface NotificationDriver {
  readonly channel: Channel;
  readonly provider: string;
  /** True when credentials for this provider are present. */
  isConfigured(): boolean;
  /** Throws on a retryable delivery failure. */
  send(to: Recipient, msg: OutboundMessage): Promise<SendResult>;
}

export class PermanentDeliveryError extends Error {}
