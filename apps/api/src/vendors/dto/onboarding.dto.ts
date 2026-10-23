import { IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const BUSINESS_TYPES = [
  'proprietorship',
  'partnership',
  'private_limited',
  'public_limited',
  'llp',
  'individual',
  'trust',
  'society',
] as const;

export class StartOnboardingDto {
  @Transform(trim) @IsString() @Length(2, 200) legal_name!: string;
  @Transform(trim) @IsString() @Length(2, 120) display_name!: string;
  @Transform(trim) @IsString() @Length(2, 120) owner_name!: string;
  @Transform(trim) @IsEmail() email!: string;
  @Transform(trim) @IsString() @Length(5, 300) address!: string;
  @IsOptional() @IsIn(BUSINESS_TYPES as unknown as string[]) business_type?: string;
}

export class UpdateOnboardingDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 200) legal_name?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) display_name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) owner_name?: string;
  @IsOptional() @Transform(trim) @IsEmail() email?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(5, 300) address?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 80) address_city?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 80) address_state?: string;
  @IsOptional() @Matches(/^[1-9]\d{5}$/, { message: 'address_postal_code must be a 6-digit PIN code' }) address_postal_code?: string;
  @IsOptional() @IsIn(BUSINESS_TYPES as unknown as string[]) business_type?: string;

  @IsOptional() @Transform(trim) @IsString() @Length(3, 64) licence_number?: string;
  @IsOptional() @IsISO8601({ strict: true }) licence_expiry?: string;

  /** Indian PAN: AAAAA9999A. Encrypted at rest; never returned or logged. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'pan must be a valid PAN (e.g. ABCDE1234F)' }) pan?: string;
  /** GSTIN: 15 chars, state code + PAN + entity + Z + checksum. */
  @IsOptional() @Transform(upper) @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, { message: 'gstin must be a valid 15-character GSTIN' }) gstin?: string;

  /** Encrypted at rest; never returned or logged. */
  @IsOptional() @Matches(/^\d{9,18}$/, { message: 'bank_account_number must be 9-18 digits' }) bank_account_number?: string;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'ifsc must be a valid IFSC (e.g. HDFC0001234)' }) ifsc?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) bank_account_holder_name?: string;
}

export const DOCUMENT_TYPES = ['LICENCE', 'PAN', 'GSTIN_CERTIFICATE', 'CANCELLED_CHEQUE', 'BANK_STATEMENT', 'OTHER'] as const;

export class UploadDocumentDto {
  @IsIn(DOCUMENT_TYPES as unknown as string[]) type!: (typeof DOCUMENT_TYPES)[number];
}

export class ReviewDocumentDto {
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

export class ReasonDto {
  @Transform(trim) @IsString() @Length(5, 500) reason!: string;
}

export class OptionalNotesDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) notes?: string;
}

export class SetCommissionDto {
  /** Platform commission in basis points (1000 = 10%). DB caps at 5000. */
  @IsInt() @Min(0) @Max(5000)
  commission_bps!: number;
}
