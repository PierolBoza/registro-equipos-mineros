import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool, withTransaction } from '../src/db.js';

const app = createApp();

async function createTruck(code = 'CAM-01', hourMeter = 0) {
  return request(app)
    .post('/api/equipment')
    .send({ code, type: 'camion', hour_meter: hourMeter });
}

describe('API de equipos', () => {
  it('responde en health con PostgreSQL disponible', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('lista los tres tipos sembrados en la migración', async () => {
    const response = await request(app).get('/api/equipment-types');
    expect(response.status).toBe(200);
    expect(response.body.map((type: { code: string }) => type.code)).toEqual([
      'camion',
      'excavadora',
      'perforadora',
    ]);
  });

  it('normaliza el código y rechaza duplicados', async () => {
    const created = await createTruck(' cam-01 ');
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('CAM-01');

    const duplicate = await createTruck('cam-01');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_CODE');
  });

  it.each([
    { code: 'CAM-02', type: 'tractor', hour_meter: 0 },
    { code: 'CAM-02', type: 'camion', hour_meter: -1 },
    { code: 'CAM-02', type: 'camion', hour_meter: 'texto' },
    { code: 'CAM-02', type: 'camion', hour_meter: 1.23 },
    { code: 'CAM-02', type: 'camion', hour_meter: 10_000_000 },
  ])('valida el tipo y el horómetro: %j', async (body) => {
    const response = await request(app).post('/api/equipment').send(body);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('calcula mantenimiento en el límite exacto del intervalo', async () => {
    const operational = await createTruck('CAM-249', 249.9);
    const due = await createTruck('CAM-250', 250);
    expect(operational.body.status).toBe('Operativo');
    expect(operational.body.needsMaintenance).toBe(false);
    expect(due.body.status).toBe('Requiere mantenimiento');
    expect(due.body.needsMaintenance).toBe(true);
  });

  it('inicia en cero el ciclo de un equipo creado con horómetro alto', async () => {
    const response = await createTruck('CAM-300', 300);
    expect(response.body.lastMaintenanceHourMeter).toBe(0);
    expect(response.body.needsMaintenance).toBe(true);
  });

  it('rechaza disminuir el horómetro y acepta aumentarlo', async () => {
    const created = await createTruck('CAM-EDIT', 300);
    const decrease = await request(app)
      .patch(`/api/equipment/${created.body.id}`)
      .send({ hour_meter: 299.9 });
    expect(decrease.status).toBe(422);
    expect(decrease.body.error.code).toBe('HOUR_METER_DECREASE');

    const increase = await request(app)
      .patch(`/api/equipment/${created.body.id}`)
      .send({ hour_meter: 301.2 });
    expect(increase.status).toBe(200);
    expect(increase.body.hourMeter).toBe(301.2);
  });

  it('requiere al menos un campo editable en PATCH', async () => {
    const created = await createTruck();
    const response = await request(app)
      .patch(`/api/equipment/${created.body.id}`)
      .send({});
    expect(response.status).toBe(422);
  });

  it('recalcula el estado al cambiar el tipo', async () => {
    const created = await createTruck('CAM-TYPE', 300);
    const changed = await request(app)
      .patch(`/api/equipment/${created.body.id}`)
      .send({ type: 'excavadora' });
    expect(changed.status).toBe(200);
    expect(changed.body.type).toBe('excavadora');
    expect(changed.body.needsMaintenance).toBe(false);
  });

  it('registra mantenimiento con el horómetro actual y limpia las notas vacías', async () => {
    const created = await createTruck('CAM-MAINT', 300);
    const result = await request(app)
      .post(`/api/equipment/${created.body.id}/maintenance`)
      .send({ notes: '  cambio de aceite  ' });

    expect(result.status).toBe(201);
    expect(result.body.log.hourMeterAtService).toBe(300);
    expect(result.body.log.notes).toBe('cambio de aceite');
    expect(result.body.equipment.lastMaintenanceHourMeter).toBe(300);
    expect(result.body.equipment.needsMaintenance).toBe(false);

    const blankNote = await request(app)
      .post(`/api/equipment/${created.body.id}/maintenance`)
      .send({ notes: '   ' });
    expect(blankNote.body.log.notes).toBeNull();

    const history = await request(app).get(
      `/api/equipment/${created.body.id}/maintenance`,
    );
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(2);
  });

  it('serializa solicitudes concurrentes de mantenimiento sin perder registros', async () => {
    const created = await createTruck('CAM-CONCURRENT', 500);
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        request(app)
          .post(`/api/equipment/${created.body.id}/maintenance`)
          .send({ notes: 'servicio concurrente' }),
      ),
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);
    const history = await request(app).get(
      `/api/equipment/${created.body.id}/maintenance`,
    );
    expect(history.body).toHaveLength(50);
  });

  it('atiende 30 lecturas concurrentes con el pool limitado a cinco conexiones', async () => {
    await createTruck('CAM-POOL');
    const responses = await Promise.all(
      Array.from({ length: 30 }, () => request(app).get('/api/equipment')),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(pool.totalCount).toBeLessThanOrEqual(5);
    expect(pool.waitingCount).toBe(0);
  });

  it('devuelve la conexión al pool cuando una transacción falla', async () => {
    await expect(
      withTransaction(async (client) => {
        await client.query('SELECT 1');
        throw new Error('fallo controlado');
      }),
    ).rejects.toThrow('fallo controlado');

    expect(pool.totalCount).toBe(pool.idleCount);
    expect(pool.waitingCount).toBe(0);
  });

  it('no permite que dos PATCH concurrentes reduzcan el valor máximo', async () => {
    const created = await createTruck('CAM-RACE', 300);
    const results = await Promise.all([
      request(app)
        .patch(`/api/equipment/${created.body.id}`)
        .send({ hour_meter: 310 }),
      request(app)
        .patch(`/api/equipment/${created.body.id}`)
        .send({ hour_meter: 320 }),
    ]);
    expect(results.some((response) => response.status === 500)).toBe(false);
    expect(
      results.every((response) => [200, 422].includes(response.status)),
    ).toBe(true);

    const final = await request(app).get(`/api/equipment/${created.body.id}`);
    expect(final.body.hourMeter).toBe(320);
  });

  it('elimina el equipo y su historial en cascada', async () => {
    const created = await createTruck('CAM-DELETE', 20);
    const maintenance = await request(app)
      .post(`/api/equipment/${created.body.id}/maintenance`)
      .send({});
    expect(maintenance.status).toBe(201);
    const deleted = await request(app).delete(
      `/api/equipment/${created.body.id}`,
    );
    expect(deleted.status).toBe(204);
    const logs = await pool.query(
      'SELECT id FROM maintenance_log WHERE equipment_id = $1',
      [created.body.id],
    );
    expect(logs.rowCount).toBe(0);

    const missing = await request(app).delete(
      `/api/equipment/${created.body.id}`,
    );
    expect(missing.status).toBe(404);
  });

  it.each(['abc', '0', '-1'])('rechaza el id inválido %s', async (id) => {
    const response = await request(app).get(`/api/equipment/${id}`);
    expect(response.status).toBe(400);
  });

  it('devuelve errores JSON para cuerpos malformados y rutas inexistentes', async () => {
    const malformed = await request(app)
      .post('/api/equipment')
      .set('Content-Type', 'application/json')
      .send('{"code":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');

    const missing = await request(app).get('/ruta-desconocida');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('no expone archivos de entorno ni configuración', async () => {
    const env = await request(app).get('/.env');
    const config = await request(app).get('/api/config');
    expect(env.status).toBe(404);
    expect(config.status).toBe(404);
    expect(JSON.stringify(env.body) + JSON.stringify(config.body)).not.toMatch(
      /postgres:\/\/|DATABASE_URL/i,
    );
  });

  it('devuelve un número para NUMERIC y no una cadena', async () => {
    const created = await createTruck('CAM-NUMERIC', 123.4);
    expect(typeof created.body.hourMeter).toBe('number');
  });
});
