import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

/** GET / — identifies the service and points at the versioned API. */
@ApiExcludeController()
@SkipThrottle()
@Controller()
export class RootController {
  @Get()
  root() {
    return {
      service: 'raftnow-api',
      api: '/api/v1',
      health: '/api/v1/health',
      docs: process.env.APP_ENV === 'production' ? null : '/api/docs',
    };
  }
}
