import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as QRCode from 'qrcode';

export interface QrTokenPayload {
  bid: string;  // booking ID
  bcd: string;  // booking code
  iat: number;  // issued at (standard JWT claim)
}

@Injectable()
export class QrService {
  private readonly logger = new Logger(QrService.name);

  /**
   * Generates a signed JWT token for a booking QR code.
   *
   * The token contains the booking ID and code, signed with QR_SIGNING_SECRET.
   * Vendors verify this signature server-side before accepting check-in.
   * The client CANNOT forge a valid QR token.
   */
  isConfigured(): boolean {
    const secret = process.env.QR_SIGNING_SECRET;
    return !!secret && secret.length >= 32 && !secret.startsWith('change-me');
  }

  generateQrToken(bookingId: string, bookingCode: string): string {
    const secret = process.env.QR_SIGNING_SECRET;
    if (!secret || secret.startsWith('change-me')) {
      throw new Error('QR_SIGNING_SECRET must be set to a secure random value');
    }

    const payload: QrTokenPayload = {
      bid: bookingId,
      bcd: bookingCode,
      iat: Math.floor(Date.now() / 1000),
    };

    return jwt.sign(payload, secret, {
      algorithm: 'HS256',
      // No expiry — QR is valid until the booking is consumed
      // Vendors check booking status on the server anyway
    });
  }

  /**
   * Verifies and decodes a QR token.
   * Throws if token is invalid, tampered, or signed with wrong key.
   */
  verifyQrToken(token: string): QrTokenPayload {
    const secret = process.env.QR_SIGNING_SECRET;
    if (!secret || secret.startsWith('change-me')) {
      throw new Error('QR_SIGNING_SECRET not configured');
    }

    try {
      const payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
      }) as QrTokenPayload;

      if (!payload.bid || !payload.bcd) {
        throw new Error('Invalid QR token payload');
      }

      return payload;
    } catch (err) {
      this.logger.warn(`QR token verification failed: ${err instanceof Error ? err.message : err}`);
      throw new Error('Invalid or tampered QR token');
    }
  }

  /**
   * Generates a QR code image as a base64 data URL.
   * The QR encodes the signed token — not the raw booking ID.
   */
  async generateQrCodeDataUrl(token: string): Promise<string> {
    return QRCode.toDataURL(token, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
      color: {
        dark: '#1a1a2e',
        light: '#ffffff',
      },
    });
  }

  /**
   * Generates a QR code as a Buffer (PNG).
   */
  async generateQrCodeBuffer(token: string): Promise<Buffer> {
    return QRCode.toBuffer(token, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
    });
  }
}
