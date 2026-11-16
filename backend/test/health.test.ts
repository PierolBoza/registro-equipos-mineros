import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/errors.js';

describe('health y CORS', () => {
  it('responde 503 sin exponer el error cuando falla la base', async () => {
    const app = createApp(async () => {
      throw new Error('postgres://secreto@host/db');
    });
    const response = await request(app).get('/health');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'error', db: 'down' });
    expect(JSON.stringify(response.body)).not.toContain('secreto');
  });

  it('permite el preflight del origen configurado', async () => {
    const response = await request(createApp())
      .options('/api/equipment')
      .set('Origin', 'http://localhost:5173');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
  });

  it('no autoriza otro origen', async () => {
    const response = await request(createApp())
      .options('/api/equipment')
      .set('Origin', 'https://sitio-ajeno.example');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('oculta los detalles y la pila ante un error interno', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/error-forzado', (_request, _response, next) => {
      next(new Error('DATABASE_URL=postgres://secreto@host/db'));
    });
    app.use(errorHandler);

    try {
      const response = await request(app).get('/error-forzado');
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Error interno' },
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /DATABASE_URL|postgres:\/\/|stack|secreto/i,
      );
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});
