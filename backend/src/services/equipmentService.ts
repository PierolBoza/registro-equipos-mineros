import { pool, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import type { PoolClient } from 'pg';
import type {
  CreateEquipmentInput,
  MaintenanceInput,
  PatchEquipmentInput,
} from '../schemas/equipment.js';

const equipmentSelect = `
  SELECT e.id,
         e.code,
         t.code AS type,
         t.label AS "typeLabel",
         t.maintenance_interval_hours AS "intervalHours",
         e.hour_meter AS "hourMeter",
         e.last_maintenance_hour_meter AS "lastMaintenanceHourMeter",
         (e.hour_meter - e.last_maintenance_hour_meter) AS "hoursSinceMaintenance",
         (e.hour_meter - e.last_maintenance_hour_meter) >= t.maintenance_interval_hours AS "needsMaintenance",
         CASE
           WHEN (e.hour_meter - e.last_maintenance_hour_meter) >= t.maintenance_interval_hours
             THEN 'Requiere mantenimiento'
           ELSE 'Operativo'
         END AS status,
         e.created_at AS "createdAt",
         e.updated_at AS "updatedAt"
  FROM equipment e
  JOIN equipment_types t ON t.id = e.type_id
`;

export type Equipment = {
  id: number;
  code: string;
  type: string;
  typeLabel: string;
  intervalHours: number;
  hourMeter: number;
  lastMaintenanceHourMeter: number;
  hoursSinceMaintenance: number;
  needsMaintenance: boolean;
  status: 'Operativo' | 'Requiere mantenimiento';
  createdAt: Date;
  updatedAt: Date;
};

export async function listEquipment(): Promise<Equipment[]> {
  const result = await pool.query<Equipment>(
    `${equipmentSelect} ORDER BY e.id`,
  );
  return result.rows;
}

export async function getEquipment(id: number): Promise<Equipment> {
  const result = await pool.query<Equipment>(
    `${equipmentSelect} WHERE e.id = $1`,
    [id],
  );
  const equipment = result.rows[0];
  if (!equipment) throw equipmentNotFound();
  return equipment;
}

async function getTypeId(type: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    'SELECT id FROM equipment_types WHERE code = $1',
    [type],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(422, 'VALIDATION_ERROR', 'El tipo de equipo no existe.');
  }
  return row.id;
}

export async function createEquipment(
  input: CreateEquipmentInput,
): Promise<Equipment> {
  const typeId = await getTypeId(input.type);
  const result = await pool.query<{ id: number }>(
    `INSERT INTO equipment (code, type_id, hour_meter, last_maintenance_hour_meter)
     VALUES ($1, $2, $3, 0)
     RETURNING id`,
    [input.code, typeId, input.hour_meter],
  );
  const row = result.rows[0];
  if (!row) throw new Error('No se pudo crear el equipo.');
  return getEquipment(row.id);
}

export async function updateEquipment(
  id: number,
  input: PatchEquipmentInput,
): Promise<Equipment> {
  await withTransaction(async (client) => {
    const currentResult = await client.query<{
      hour_meter: number;
    }>('SELECT hour_meter FROM equipment WHERE id = $1 FOR UPDATE', [id]);
    const current = currentResult.rows[0];
    if (!current) throw equipmentNotFound();

    if (
      input.hour_meter !== undefined &&
      input.hour_meter < current.hour_meter
    ) {
      throw new AppError(
        422,
        'HOUR_METER_DECREASE',
        'El horómetro no puede disminuir.',
      );
    }

    const typeId =
      input.type === undefined
        ? null
        : await getTypeIdInTransaction(client, input.type);
    await client.query(
      `UPDATE equipment
       SET code = COALESCE($2, code),
           type_id = COALESCE($3, type_id),
           hour_meter = COALESCE($4, hour_meter),
           updated_at = now()
       WHERE id = $1`,
      [id, input.code ?? null, typeId, input.hour_meter ?? null],
    );
  });

  return getEquipment(id);
}

async function getTypeIdInTransaction(
  client: PoolClient,
  type: string,
): Promise<number> {
  const result = await client.query<{ id: number }>(
    'SELECT id FROM equipment_types WHERE code = $1',
    [type],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(422, 'VALIDATION_ERROR', 'El tipo de equipo no existe.');
  }
  return row.id;
}

export async function deleteEquipment(id: number): Promise<void> {
  const result = await pool.query('DELETE FROM equipment WHERE id = $1', [id]);
  if (result.rowCount === 0) throw equipmentNotFound();
}

export type MaintenanceLog = {
  id: number;
  equipmentId: number;
  performedAt: Date;
  hourMeterAtService: number;
  notes: string | null;
};

export async function listMaintenance(id: number): Promise<MaintenanceLog[]> {
  await getEquipment(id);
  const result = await pool.query<MaintenanceLog>(
    `SELECT id,
            equipment_id AS "equipmentId",
            performed_at AS "performedAt",
            hour_meter_at_service AS "hourMeterAtService",
            notes
     FROM maintenance_log
     WHERE equipment_id = $1
     ORDER BY performed_at DESC, id DESC`,
    [id],
  );
  return result.rows;
}

export async function createMaintenance(
  id: number,
  input: MaintenanceInput,
): Promise<{ log: MaintenanceLog; equipment: Equipment }> {
  const log = await withTransaction(async (client) => {
    const currentResult = await client.query<{ hour_meter: number }>(
      'SELECT hour_meter FROM equipment WHERE id = $1 FOR UPDATE',
      [id],
    );
    const current = currentResult.rows[0];
    if (!current) throw equipmentNotFound();

    const notes = input.notes?.trim() || null;
    const logResult = await client.query<MaintenanceLog>(
      `INSERT INTO maintenance_log (equipment_id, hour_meter_at_service, notes)
       VALUES ($1, $2, $3)
       RETURNING id,
                 equipment_id AS "equipmentId",
                 performed_at AS "performedAt",
                 hour_meter_at_service AS "hourMeterAtService",
                 notes`,
      [id, current.hour_meter, notes],
    );
    const inserted = logResult.rows[0];
    if (!inserted) throw new Error('No se pudo registrar el mantenimiento.');

    await client.query(
      `UPDATE equipment
       SET last_maintenance_hour_meter = hour_meter, updated_at = now()
       WHERE id = $1`,
      [id],
    );
    return inserted;
  });

  return { log, equipment: await getEquipment(id) };
}

function equipmentNotFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'No se encontró el equipo.');
}
