import './env.js';
import { z } from 'zod';

const environment = process.env.NODE_ENV ?? 'development';
const databaseUrl =
  environment === 'test'
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;
const frontendUrl =
  process.env.FRONTEND_URL ??
  (environment === 'production' ? undefined : 'http://localhost:5173');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'Debe ser una URL de PostgreSQL.',
    ),
  FRONTEND_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        environment !== 'production' || new URL(value).protocol === 'https:',
      'En producción debe usar HTTPS.',
    ),
});

const result = configSchema.safeParse({
  NODE_ENV: environment,
  PORT: process.env.PORT ?? '8080',
  DATABASE_URL: databaseUrl,
  FRONTEND_URL: frontendUrl,
});

if (!result.success) {
  const missing = result.error.issues
    .map((issue) => issue.path.join('.'))
    .join(', ');
  throw new Error(`Configuración inválida. Revisa estas variables: ${missing}`);
}

if (environment === 'test' && databaseUrl === process.env.DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL debe apuntar a una base separada de DATABASE_URL.',
  );
}

export const config = {
  nodeEnv: result.data.NODE_ENV,
  port: result.data.PORT,
  databaseUrl: result.data.DATABASE_URL,
  frontendUrl: new URL(result.data.FRONTEND_URL).origin,
};
