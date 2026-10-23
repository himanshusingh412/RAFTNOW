import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorBody: { error: { code: string; message: string; details?: Record<string, unknown> } };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'error' in exceptionResponse &&
        typeof (exceptionResponse as { error: unknown }).error === 'object'
      ) {
        // Our ApiException format
        errorBody = exceptionResponse as typeof errorBody;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        // NestJS built-in validation errors
        const msg = (exceptionResponse as { message: string | string[] }).message;
        const details = Array.isArray(msg)
          ? { fields: msg }
          : undefined;
        errorBody = {
          error: {
            code: status === HttpStatus.BAD_REQUEST ? 'VALIDATION_FAILED' : status === HttpStatus.TOO_MANY_REQUESTS ? 'RATE_LIMITED' : `HTTP_${status}`,
            message: Array.isArray(msg) ? 'Validation failed' : msg,
            details,
          },
        };
      } else {
        errorBody = {
          error: {
            code: status === HttpStatus.TOO_MANY_REQUESTS ? 'RATE_LIMITED' : 'HTTP_ERROR',
            message: String(exceptionResponse),
          },
        };
      }
    } else if (
      exception &&
      typeof exception === 'object' &&
      'code' in exception &&
      typeof (exception as any).code === 'string' &&
      (exception as any).code.startsWith('P')
    ) {
      const prismaErr = exception as { code: string; message: string; stack?: string };
      if (prismaErr.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        errorBody = {
          error: {
            code: 'CONFLICT',
            message: 'A record with this data already exists',
          },
        };
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        this.logger.error(`Prisma error ${prismaErr.code}: ${prismaErr.message}`, prismaErr.stack);
        errorBody = {
          error: {
            code: 'DATABASE_ERROR',
            message: 'A database error occurred',
          },
        };
      }
    } else {
      // Unknown error — log and return generic 500
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      errorBody = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
        },
      };
    }

    // Add request ID to error response for traceability
    const requestId = request.headers['x-request-id'] as string | undefined;
    if (requestId) {
      errorBody.error.details = {
        ...errorBody.error.details,
        request_id: requestId,
      };
    }

    response.status(status).json(errorBody);
  }
}
