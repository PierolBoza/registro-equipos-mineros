import express, { type RequestHandler } from 'express';
import { config } from './config.js';
import { checkDatabase } from './db.js';
import { AppError, errorHandler } from './errors.js';
import { createHealthRouter } from './routes/health.js';

export function createApp(healthCheck: () => Promise<void> = checkDatabase) {
  const app = express();
  const allowedOrigins = new Set([config.frontendUrl]);
  if (config.nodeEnv !== 'production')
    allowedOrigins.add('http://localhost:5173');

  app.disable('x-powered-by');
  app.use(corsMiddleware(allowedOrigins));
  app.use(express.json({ limit: '10kb' }));

  app.use(createHealthRouter(healthCheck));

  app.use((_request, _response, next) => {
    next(new AppError(404, 'NOT_FOUND', 'La ruta solicitada no existe.'));
  });

  app.use(errorHandler);
  return app;
}

function corsMiddleware(allowedOrigins: Set<string>): RequestHandler {
  return (request, response, next) => {
    const origin = request.get('Origin');

    if (origin && allowedOrigins.has(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    if (request.method === 'OPTIONS') {
      response.setHeader(
        'Access-Control-Allow-Methods',
        'GET,POST,PATCH,DELETE,OPTIONS',
      );
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.status(204).end();
      return;
    }

    next();
  };
}
