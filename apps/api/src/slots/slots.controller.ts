import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { SlotsService } from './slots.service';

class SlotsQueryDto {
  /** Omit to search every active stretch ("any stretch"). */
  @IsOptional()
  @IsUUID()
  stretch_id?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

@ApiTags('Slots (public)')
@Controller('slots')
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Get()
  @ApiOperation({ summary: 'Departures and indicative availability for a stretch (or all stretches) on an IST date' })
  @ApiQuery({ name: 'stretch_id', required: false })
  @ApiQuery({ name: 'date', required: true, example: '2026-10-20' })
  list(@Query() q: SlotsQueryDto) {
    return this.slots.listAvailability(q.stretch_id, q.date);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One departure with indicative availability' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.slots.getSlot(id);
  }
}
