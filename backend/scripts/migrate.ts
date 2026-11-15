import '../src/env.js';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';

export async function runMigrations(
  databaseUrl: string,
  migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url)),
): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
  } catch {
    await client.end().catch(() => undefined);
    throw new Error('No se pudo conectar con PostgreSQL.');
  }

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
      .sort();

    for (const name of files) {
      const sql = await readFile(join(migrationsDir, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [name],
      );

      if (existing.rowCount) {
        if (existing.rows[0]?.checksum !== checksum) {
          throw new Error(`La migración aplicada ${name} cambió su checksum.`);
        }
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum],
        );
        await client.query('COMMIT');
      } catch {
        try {
          await client.query('ROLLBACK');
        } catch {
          console.error('No se pudo revertir la transacción de migración.');
        }
        throw new Error(`Falló la migración ${name}.`);
      }
    }
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const databaseUrl =
    process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Falta MIGRATION_DATABASE_URL o DATABASE_URL.');
    process.exitCode = 1;
  } else {
    runMigrations(databaseUrl).catch((error: unknown) => {
      console.error(
        error instanceof Error
          ? error.message
          : 'Falló el runner de migraciones.',
      );
      process.exitCode = 1;
    });
  }
}
