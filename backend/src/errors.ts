import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'El JSON de la solicitud no es válido.',
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son válidos.',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  const databaseCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : undefined;

  if (databaseCode === '23505') {
    response.status(409).json({
      error: {
        code: 'DUPLICATE_CODE',
        message: 'Ya existe un equipo con ese código.',
      },
    });
    return;
  }

  if (databaseCode === '23503' || databaseCode === '23514') {
    response.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son válidos.',
      },
    });
    return;
  }

  console.error(
    'Error interno de API',
    error instanceof Error ? error.stack : error,
  );
  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Error interno' },
  });
};
