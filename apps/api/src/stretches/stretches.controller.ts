import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StretchesService } from './stretches.service';

@ApiTags('Stretches (public)')
@Controller('stretches')
export class StretchesController {
  constructor(private readonly stretches: StretchesService) {}

  @Get()
  @ApiOperation({ summary: 'Active river stretches with live OPEN/CLOSED state' })
  list() {
    return this.stretches.listPublic();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One active stretch' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.stretches.getPublic(id);
  }
}
