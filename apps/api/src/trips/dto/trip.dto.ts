import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';

export class CreateTripDto {
  @IsUUID() stretch_id!: string;
  @IsString() @Length(3, 120) title!: string;
  @IsString() @Length(10, 4000) description!: string;
  @IsInt() @Min(15) @Max(720) duration_minutes!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) inclusions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) exclusions?: string[];
  @IsString() @Length(3, 300) meeting_point!: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) meeting_lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) meeting_lng?: number;
  @IsOptional() @IsInt() @Min(5) @Max(80) min_age?: number;
  @IsOptional() @IsInt() @Min(5) @Max(90) max_age?: number;
  @IsInt() @Min(1) @Max(16) raft_capacity!: number;
  /** Integer paise (₹1 = 100). */
  @IsInt() @Min(100) @Max(100_000_000) per_seat_price_paise!: number;
  @IsOptional() @IsInt() @Min(100) @Max(100_000_000) private_raft_price_paise?: number | null;
}

export class UpdateTripDto {
  @IsOptional() @IsString() @Length(3, 120) title?: string;
  @IsOptional() @IsString() @Length(10, 4000) description?: string;
  @IsOptional() @IsInt() @Min(15) @Max(720) duration_minutes?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) inclusions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) exclusions?: string[];
  @IsOptional() @IsString() @Length(3, 300) meeting_point?: string;
  @IsOptional() @IsInt() @Min(5) @Max(80) min_age?: number;
  @IsOptional() @IsInt() @Min(5) @Max(90) max_age?: number;
  @IsOptional() @IsInt() @Min(100) @Max(100_000_000) per_seat_price_paise?: number;
  @IsOptional() @IsInt() @Min(100) @Max(100_000_000) private_raft_price_paise?: number | null;
  @IsOptional() @IsIn(['DRAFT', 'LIVE', 'HIDDEN']) status?: 'DRAFT' | 'LIVE' | 'HIDDEN';
}

export class SlotTemplateDto {
  /** HH:MM, IST */
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) departure_time!: string;
  /** 0 = Sunday … 6 = Saturday. Empty = every day. */
  @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) days_of_week!: number[];
  @IsInt() @Min(1) @Max(50) rafts_count!: number;
}

export class UpdateSlotTemplateDto {
  @IsOptional() @IsInt() @Min(1) @Max(50) rafts_count?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class BlockSlotDto {
  @IsString() @Length(3, 300) reason!: string;
}

export class VendorSlotsQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @IsUUID() trip_id?: string;
}

export class VendorBookingsQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsUUID() slot_id?: string;
  @IsOptional() @IsIn(['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED_CUSTOMER', 'CANCELLED_VENDOR', 'CANCELLED_ADMIN', 'EXPIRED', 'DISPUTED'])
  status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}
