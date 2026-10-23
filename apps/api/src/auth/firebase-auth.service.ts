import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { ApiException } from '../common/exceptions/api.exception';
import { HttpStatus } from '@nestjs/common';

@Injectable()
export class FirebaseAuthService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAuthService.name);
  private app: admin.app.App | null = null;

  onModuleInit() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase credentials not configured — phone OTP auth will not work. ' +
        'Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.',
      );
      return;
    }

    // Avoid re-initialization if already done (e.g. in tests)
    if (admin.apps.length > 0) {
      this.app = admin.apps[0]!;
      return;
    }

    this.app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });

    this.logger.log(`Firebase Admin SDK initialized for project: ${projectId}`);
  }

  /**
   * Verifies a Firebase ID token from the client.
   * Returns the decoded token with UID and phone number.
   *
   * Used for:
   * - Customer authentication (phone OTP)
   * - Vendor staff authentication (phone OTP)
   */
  /** True when AUTH_DEV_BYPASS developer tokens are accepted (never in production). */
  get devBypassEnabled(): boolean {
    return process.env.AUTH_DEV_BYPASS === 'true' && process.env.APP_ENV !== 'production';
  }

  get isConfigured(): boolean {
    return this.app !== null;
  }

  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    // ── Local development only ─────────────────────────────────────────────
    // "dev:<uid>:<+E164 phone>" tokens let the full stack be exercised without a
    // Firebase project. checkEnvironment() refuses to boot with AUTH_DEV_BYPASS
    // in production, and this branch re-checks APP_ENV defensively.
    if (idToken.startsWith('dev:')) {
      if (!this.devBypassEnabled) {
        throw new ApiException('INVALID_FIREBASE_TOKEN', 'Invalid or expired authentication token', HttpStatus.UNAUTHORIZED);
      }
      const [, uid, phone] = idToken.split(':');
      if (!uid || !/^[A-Za-z0-9_-]{3,64}$/.test(uid) || (phone && !/^\+[1-9]\d{7,14}$/.test(phone))) {
        throw new ApiException('INVALID_DEV_TOKEN', 'Dev token must be dev:<uid>:<+E164 phone>', HttpStatus.UNAUTHORIZED);
      }
      return { uid: `dev_${uid}`, phone_number: phone || undefined } as unknown as admin.auth.DecodedIdToken;
    }

    if (!this.app) {
      throw new ApiException(
        'FIREBASE_NOT_CONFIGURED',
        'Authentication service not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const decoded = await this.app.auth().verifyIdToken(idToken, true);
      return decoded;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Firebase token verification failed: ${message}`);
      throw new ApiException(
        'INVALID_FIREBASE_TOKEN',
        'Invalid or expired authentication token',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
