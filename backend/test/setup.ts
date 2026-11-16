import '../src/env.js';
import { afterAll, beforeAll, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error('Define TEST_DATABASE_URL para ejecutar las pruebas.');
}

const [{ pool }, { runMigrations }] = await Promise.all([
  import('../src/db.js'),
  import('../scripts/migrate.js'),
]);

beforeAll(async () => {
  await runMigrations(testDatabaseUrl);
});

beforeEach(async () => {
  await pool.query('TRUNCATE equipment RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});
