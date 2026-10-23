import { IsString, IsUUID, IsEnum, IsInt, IsArray, ValidateNested, Min, Max, IsNotEmpty, IsOptional, IsPhoneNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class BookingGuestDto {
  @ApiProperty({ example: 'Rahul Sharma' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 25 })
  @IsInt()
  @Min(0)
  @Max(120)
  age: number;
}

export class CreateBookingDto {
  @ApiProperty({ example: 'uuid-of-slot' })
  @IsUUID()
  slot_id: string;

  @ApiProperty({ enum: ['SHARED', 'PRIVATE'] })
  @IsEnum(['SHARED', 'PRIVATE'])
  mode: 'SHARED' | 'PRIVATE';

  @ApiProperty({ example: 2, description: 'Number of seats (SHARED) or 1 (PRIVATE)' })
  @IsInt()
  @Min(1)
  @Max(50)
  seat_count: number;

  @ApiProperty({ type: [BookingGuestDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingGuestDto)
  guests: BookingGuestDto[];

  @ApiProperty({ example: '+919876543210' })
  @IsOptional()
  @IsPhoneNumber()
  contact_phone?: string;

  @ApiProperty({ example: 'v1.0' })
  @IsString()
  @IsNotEmpty()
  safety_declaration_version: string;

  @ApiProperty({ example: 'uuid-v4-idempotency-key' })
  @IsUUID()
  idempotency_key: string;
}
