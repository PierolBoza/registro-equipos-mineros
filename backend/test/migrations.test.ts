import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../scripts/migrate.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error('Falta TEST_DATABASE_URL.');

describe('runner de migraciones', () => {
  it('se puede ejecutar dos veces sin duplicar el seed', async () => {
    await runMigrations(testDatabaseUrl);
    await runMigrations(testDatabaseUrl);
    const client = new pg.Client({ connectionString: testDatabaseUrl });
    await client.connect();
    try {
      const types = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM equipment_types',
      );
      expect(types.rows[0]?.count).toBe('3');
    } finally {
      await client.end();
    }
  });

  it('rechaza modificar una migración ya registrada', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'equipos-migration-'));
    try {
      await writeFile(join(directory, '001_init.sql'), 'SELECT 1;\n');
      await expect(runMigrations(testDatabaseUrl, directory)).rejects.toThrow(
        'La migración aplicada 001_init.sql cambió su checksum.',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('revierte una migración inválida y no la marca como aplicada', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'equipos-migration-'));
    const name = '003_invalid.sql';
    try {
      await writeFile(join(directory, name), 'CREATE TABLE ;\n');
      await expect(runMigrations(testDatabaseUrl, directory)).rejects.toThrow(
        `Falló la migración ${name}.`,
      );

      const client = new pg.Client({ connectionString: testDatabaseUrl });
      await client.connect();
      try {
        const applied = await client.query(
          'SELECT name FROM schema_migrations WHERE name = $1',
          [name],
        );
        expect(applied.rowCount).toBe(0);
      } finally {
        await client.end();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
