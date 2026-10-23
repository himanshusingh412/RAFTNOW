import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiException } from '../common/exceptions/api.exception';
import { hmacSha256Hex, safeEqual } from '../common/crypto/field-encryption';

/**
 * Private document storage for vendor KYC.
 *
 *  STORAGE_DRIVER=s3     Private S3 bucket (S3_BUCKET_PRIVATE), SSE-AES256,
 *                        access only through short-lived presigned GET URLs.
 *  STORAGE_DRIVER=local  Files on the API host under STORAGE_LOCAL_DIR (0600),
 *                        never served statically; downloads go through
 *                        GET /api/v1/storage/files with an HMAC-signed, expiring
 *                        URL. Intended for development.
 *
 * Object keys never contain the original filename or any PII.
 */
export const ALLOWED_DOCUMENT_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: 'pdf', magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
};
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Public images (trip photos): uploads up to 15 MB, stored as ≤1600 px JPEG. */
export const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;
const IMAGE_MAX_EDGE = 1600;
const IMAGE_MIN_EDGE = 400;
const ACCEPTED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);
/** Public media keys: `<prefix>/<uuid>.jpg` with a fixed, path-safe prefix. */
export const PUBLIC_IMAGE_KEY = /^trip-photos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;

export interface StoredObject {
  key: string;
  driver: 's3' | 'local';
  sha256: string;
  size: number;
  contentType: string;
}

/** Permanent URL of a public image. Relative (/api/v1/…) for the local driver unless API_PUBLIC_URL is set. */
export function publicMediaUrl(key: string): string {
  if (process.env.STORAGE_DRIVER === 's3') return `${(process.env.PUBLIC_MEDIA_BASE_URL ?? '').replace(/\/$/, '')}/${key}`;
  return `${(process.env.API_PUBLIC_URL ?? '').replace(/\/$/, '')}/api/v1/storage/media/${key}`;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3: S3Client | null = null;

  get driver(): 's3' | 'local' {
    return process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local';
  }

  private get localDir() {
    return path.resolve(process.env.STORAGE_LOCAL_DIR ?? path.join(process.cwd(), 'data', 'private-uploads'));
  }

  private s3Client(): S3Client {
    if (!this.s3) {
      this.s3 = new S3Client({
        region: process.env.S3_REGION,
        ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
      });
    }
    return this.s3;
  }

  /** Validates type + magic bytes + size, then stores privately. */
  async putPrivateDocument(prefix: string, body: Buffer, declaredType: string): Promise<StoredObject> {
    const type = ALLOWED_DOCUMENT_TYPES[declaredType];
    if (!type) {
      throw new ApiException('UNSUPPORTED_FILE_TYPE', 'Only PDF, JPEG or PNG files are accepted', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    if (body.length === 0 || body.length > MAX_DOCUMENT_BYTES) {
      throw new ApiException('FILE_TOO_LARGE', 'Documents must be between 1 byte and 10 MB', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    if (!type.magic(body)) {
      throw new ApiException('FILE_CONTENT_MISMATCH', 'File content does not match its declared type', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    if (!/^[a-z0-9/_-]+$/i.test(prefix)) throw new Error('Invalid storage prefix');

    const key = `${prefix}/${randomUUID()}.${type.ext}`;
    const sha256 = createHash('sha256').update(body).digest('hex');

    if (this.driver === 's3') {
      if (!process.env.S3_BUCKET_PRIVATE) {
        throw new ApiException('STORAGE_NOT_CONFIGURED', 'Document storage is not configured', HttpStatus.SERVICE_UNAVAILABLE);
      }
      await this.s3Client().send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET_PRIVATE,
          Key: key,
          Body: body,
          ContentType: declaredType,
          ServerSideEncryption: 'AES256',
          ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
        }),
      );
    } else {
      if (!this.localSigningSecret()) {
        throw new ApiException('STORAGE_NOT_CONFIGURED', 'Document storage is not configured', HttpStatus.SERVICE_UNAVAILABLE);
      }
      const file = this.localPath(key);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.writeFile(file, body, { mode: 0o600, flag: 'wx' });
    }
    return { key, driver: this.driver, sha256, size: body.length, contentType: declaredType };
  }

  // ── Public images ──────────────────────────────────────────────────────
  //
  //  s3     S3_BUCKET_PUBLIC (served by a CDN / public bucket policy) at
  //         PUBLIC_MEDIA_BASE_URL/<key>.
  //  local  STORAGE_PUBLIC_DIR (default ./data/public-media), served by
  //         GET /api/v1/storage/media/<key>. Never mixed with private documents.
  //
  // Every image is decoded and re-encoded, so only real images are stored, EXIF
  // (including phone GPS) is dropped, orientation is applied, and size is capped.

  private get publicDir() {
    return path.resolve(process.env.STORAGE_PUBLIC_DIR ?? path.join(process.cwd(), 'data', 'public-media'));
  }

  async putPublicImage(prefix: string, body: Buffer): Promise<{ key: string; width: number; height: number; size: number }> {
    if (body.length === 0 || body.length > MAX_IMAGE_UPLOAD_BYTES) {
      throw new ApiException('FILE_TOO_LARGE', 'Photos must be under 15 MB', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    let meta: sharp.Metadata;
    try {
      meta = await sharp(body, { limitInputPixels: 50_000_000 }).metadata();
    } catch {
      throw new ApiException('UNSUPPORTED_FILE_TYPE', 'This file is not a readable image', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    if (!meta.format || !ACCEPTED_IMAGE_FORMATS.has(meta.format)) {
      throw new ApiException('UNSUPPORTED_FILE_TYPE', 'Photos must be JPEG, PNG or WebP', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    // Orientation 5–8 means the stored pixels are rotated 90°.
    const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height ?? 0, meta.width ?? 0] : [meta.width ?? 0, meta.height ?? 0];
    if (Math.min(w, h) < IMAGE_MIN_EDGE) {
      throw new ApiException('IMAGE_TOO_SMALL', `Photos must be at least ${IMAGE_MIN_EDGE} px on the short side`, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const { data, info } = await sharp(body, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    const key = `${prefix}/${randomUUID()}.jpg`;
    if (!PUBLIC_IMAGE_KEY.test(key)) throw new Error('Invalid public image prefix');
    if (this.driver === 's3') {
      if (!process.env.S3_BUCKET_PUBLIC || !process.env.PUBLIC_MEDIA_BASE_URL) {
        throw new ApiException('STORAGE_NOT_CONFIGURED', 'Photo storage is not configured', HttpStatus.SERVICE_UNAVAILABLE);
      }
      await this.s3Client().send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET_PUBLIC,
          Key: key,
          Body: data,
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } else {
      const file = this.publicPath(key);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
      await fs.writeFile(file, data, { mode: 0o644, flag: 'wx' });
    }
    return { key, width: info.width, height: info.height, size: data.length };
  }

  publicUrl(key: string): string {
    return publicMediaUrl(key);
  }

  async readPublicLocal(key: string): Promise<Buffer> {
    if (this.driver !== 'local' || !PUBLIC_IMAGE_KEY.test(key)) throw new ApiException('NOT_FOUND', 'Not found', HttpStatus.NOT_FOUND);
    return fs.readFile(this.publicPath(key)).catch(() => {
      throw new ApiException('NOT_FOUND', 'Not found', HttpStatus.NOT_FOUND);
    });
  }

  /** Best effort: a leftover file is harmless, a failed delete must not fail the request. */
  async deletePublicImage(key: string): Promise<void> {
    if (!PUBLIC_IMAGE_KEY.test(key)) return;
    try {
      if (this.driver === 's3') await this.s3Client().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_PUBLIC, Key: key }));
      else await fs.unlink(this.publicPath(key));
    } catch (e) {
      this.logger.warn(`Could not delete public image ${key}: ${(e as Error).message}`);
    }
  }

  private publicPath(key: string): string {
    const full = path.resolve(this.publicDir, key);
    if (!PUBLIC_IMAGE_KEY.test(key) || !full.startsWith(this.publicDir + path.sep)) throw this.forbidden();
    return full;
  }

  /** Short-lived download URL. Never returns a permanent/public link. */
  async signedDownloadUrl(key: string, driver: string, filename: string, contentType: string, ttlSeconds = 300): Promise<{ url: string; expires_at: string }> {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const safeName = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'document';
    if (driver === 's3') {
      const url = await getSignedUrl(
        this.s3Client(),
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET_PRIVATE,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${safeName}"`,
          ResponseContentType: contentType,
        }),
        { expiresIn: ttlSeconds },
      );
      return { url, expires_at: new Date(expires * 1000).toISOString() };
    }
    const secret = this.localSigningSecret();
    if (!secret) throw new ApiException('STORAGE_NOT_CONFIGURED', 'Document storage is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    const sig = hmacSha256Hex(secret, `${key}|${expires}|${safeName}|${contentType}`);
    const qs = new URLSearchParams({ key, exp: String(expires), name: safeName, ct: contentType, sig });
    const base = (process.env.API_PUBLIC_URL ?? '').replace(/\/$/, '');
    return { url: `${base}/api/v1/storage/files?${qs.toString()}`, expires_at: new Date(expires * 1000).toISOString() };
  }

  /** Verifies a local signed URL and returns the file bytes. */
  async readLocalSigned(params: { key?: string; exp?: string; name?: string; ct?: string; sig?: string }) {
    const secret = this.localSigningSecret();
    const { key, exp, name, ct, sig } = params;
    if (!secret || !key || !exp || !name || !ct || !sig) throw this.forbidden();
    if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) throw this.forbidden('URL_EXPIRED');
    if (!safeEqual(sig, hmacSha256Hex(secret, `${key}|${exp}|${name}|${ct}`))) throw this.forbidden();
    if (!ALLOWED_DOCUMENT_TYPES[ct]) throw this.forbidden();
    const body = await fs.readFile(this.localPath(key)).catch(() => {
      throw new ApiException('NOT_FOUND', 'File not found', HttpStatus.NOT_FOUND);
    });
    return { body, filename: name, contentType: ct };
  }

  private localSigningSecret(): string | null {
    const s = process.env.STORAGE_SIGNING_SECRET;
    return s && s.length >= 32 ? s : null;
  }

  private localPath(key: string): string {
    if (key.includes('..') || path.isAbsolute(key) || !/^[a-z0-9/_.-]+$/i.test(key)) throw this.forbidden();
    const full = path.resolve(this.localDir, key);
    if (!full.startsWith(this.localDir + path.sep)) throw this.forbidden();
    return full;
  }

  private forbidden(code = 'INVALID_SIGNATURE') {
    return new ApiException(code, 'This download link is invalid or has expired', HttpStatus.FORBIDDEN);
  }
}
