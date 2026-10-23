import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TripsService } from './trips.service';

@ApiTags('Trips (public)')
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Trip detail: inclusions, meeting point, age rules, operator and cancellation policy' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.trips.getPublicTrip(id);
  }
}
