import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

const server = createServer(createApp());
server.listen(config.port, '0.0.0.0', () => {
  console.log(`API escuchando en el puerto ${config.port}.`);
});

let closing = false;

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;

  server.close(async (error) => {
    if (error) console.error('Error al cerrar el servidor HTTP.');
    await pool.end();
    process.exitCode = error ? 1 : 0;
  });
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
