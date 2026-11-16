import pg, { type Pool as PgPool } from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// pg devuelve NUMERIC como string; el horómetro cabe con seguridad en number.
types.setTypeParser(1700, (value) => Number.parseFloat(value));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

pool.on('error', () => {
  console.error('Error en una conexión PostgreSQL inactiva.');
});

export async function withTransaction<T>(
  operation: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discardClient = false;

  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discardClient = true;
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function checkDatabase(
  databasePool: Pick<PgPool, 'query'> = pool,
): Promise<void> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      databasePool.query('SELECT 1').then(() => undefined),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('Tiempo de espera agotado.')),
          2_000,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
