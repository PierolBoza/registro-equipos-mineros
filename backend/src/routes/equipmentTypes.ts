import { Router } from 'express';
import { pool } from '../db.js';

type EquipmentType = {
  id: number;
  code: string;
  label: string;
  maintenanceIntervalHours: number;
};

export function createEquipmentTypesRouter() {
  const router = Router();

  router.get('/', async (_request, response) => {
    const result = await pool.query<EquipmentType>(
      `SELECT id,
              code,
              label,
              maintenance_interval_hours AS "maintenanceIntervalHours"
       FROM equipment_types
       ORDER BY id`,
    );
    response.json(result.rows);
  });

  return router;
}
