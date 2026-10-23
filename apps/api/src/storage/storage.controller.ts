import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { StorageService } from './storage.service';

/**
 * Local driver only: private documents through expiring signed URLs, and
 * public trip photos (immutable, uuid-named) from a separate directory.
 */
@ApiExcludeController()
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get('files')
  async download(@Query() q: Record<string, string>, @Res() res: Response) {
    const file = await this.storage.readLocalSigned(q);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.body);
  }

  @Get('media/trip-photos/:tripId/:file')
  async media(@Param('tripId') tripId: string, @Param('file') file: string, @Res() res: Response) {
    const body = await this.storage.readPublicLocal(`trip-photos/${tripId}/${file}`);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Photos are public by design; let other origins (CDN, apps) embed them.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(body);
  }
}
