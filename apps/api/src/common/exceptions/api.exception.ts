import { HttpException, HttpStatus } from '@nestjs/common';

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Standard API exception.
 * All business rule violations should use this.
 * GlobalExceptionHandler renders this as: { error: { code, message, details } }
 */
export class ApiException extends HttpException {
  constructor(
    code: string,
    message: string,
    statusCode: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    details?: Record<string, unknown>,
  ) {
    super({ error: { code, message, details } }, statusCode);
  }
}

// ── Common error codes ─────────────────────────────────────────────────────────

export class NotFoundException extends ApiException {
  constructor(resource: string) {
    super(`${resource.toUpperCase()}_NOT_FOUND`, `${resource} not found`, HttpStatus.NOT_FOUND);
  }
}

export class UnauthorizedException extends ApiException {
  constructor(message = 'Unauthenticated') {
    super('UNAUTHENTICATED', message, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenException extends ApiException {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }
}

export class ConflictException extends ApiException {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, HttpStatus.CONFLICT, details);
  }
}

// ── Booking-specific errors ────────────────────────────────────────────────────

export class SlotFullException extends ApiException {
  constructor(seatsRemaining: number) {
    super(
      'SLOT_FULL',
      seatsRemaining === 0
        ? 'This slot is fully booked'
        : `Only ${seatsRemaining} seat${seatsRemaining === 1 ? '' : 's'} remaining`,
      HttpStatus.CONFLICT,
      { seats_remaining: seatsRemaining },
    );
  }
}

export class NoPrivateRaftAvailableException extends ApiException {
  constructor() {
    super(
      'NO_PRIVATE_RAFT_AVAILABLE',
      'No complete raft available for private booking',
      HttpStatus.CONFLICT,
    );
  }
}

export class SlotNotOpenException extends ApiException {
  constructor(status: string) {
    super('SLOT_NOT_OPEN', `Slot is ${status.toLowerCase()}, not available for booking`, HttpStatus.CONFLICT);
  }
}

export class HoldExpiredException extends ApiException {
  constructor() {
    super('HOLD_EXPIRED', 'Your booking hold has expired. Please start again.', HttpStatus.GONE);
  }
}

export class BookingAlreadyConfirmedException extends ApiException {
  constructor() {
    super('BOOKING_ALREADY_CONFIRMED', 'Booking is already confirmed', HttpStatus.CONFLICT);
  }
}

export class VendorNotLiveException extends ApiException {
  constructor() {
    super('VENDOR_NOT_LIVE', 'This vendor is not currently accepting bookings', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class TripNotLiveException extends ApiException {
  constructor() {
    super('TRIP_NOT_LIVE', 'This trip is not currently available', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class GuestAgeViolationException extends ApiException {
  constructor(guestName: string, age: number, minAge: number) {
    super(
      'GUEST_AGE_VIOLATION',
      `Guest "${guestName}" (age ${age}) does not meet the minimum age requirement of ${minAge}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { guest_name: guestName, age, min_age: minAge },
    );
  }
}

export class StretchClosedException extends ApiException {
  constructor() {
    super('STRETCH_CLOSED', 'This stretch is currently closed due to a river closure', HttpStatus.CONFLICT);
  }
}

export class DuplicateBookingException extends ApiException {
  constructor() {
    super(
      'DUPLICATE_BOOKING',
      'A booking with this idempotency key already exists',
      HttpStatus.CONFLICT,
    );
  }
}

export class PaymentVerificationFailedException extends ApiException {
  constructor() {
    super('PAYMENT_VERIFICATION_FAILED', 'Payment signature verification failed', HttpStatus.BAD_REQUEST);
  }
}

export class InvalidBookingTransitionException extends ApiException {
  constructor(from: string, to: string) {
    super(
      'INVALID_BOOKING_TRANSITION',
      `Cannot transition booking from ${from} to ${to}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { from_status: from, to_status: to },
    );
  }
}
