import { Router } from 'express';
import { AppError } from '../errors.js';
import {
  createEquipmentSchema,
  maintenanceSchema,
  patchEquipmentSchema,
} from '../schemas/equipment.js';
import {
  createEquipment,
  createMaintenance,
  deleteEquipment,
  getEquipment,
  listEquipment,
  listMaintenance,
  updateEquipment,
} from '../services/equipmentService.js';

export function createEquipmentRouter() {
  const router = Router();

  router.get('/', async (_request, response) => {
    response.json(await listEquipment());
  });

  router.post('/', async (request, response) => {
    const input = createEquipmentSchema.parse(request.body);
    response.status(201).json(await createEquipment(input));
  });

  router.get('/:id/maintenance', async (request, response) => {
    response.json(await listMaintenance(parseId(request.params.id)));
  });

  router.post('/:id/maintenance', async (request, response) => {
    const input = maintenanceSchema.parse(request.body ?? {});
    response
      .status(201)
      .json(await createMaintenance(parseId(request.params.id), input));
  });

  router.get('/:id', async (request, response) => {
    response.json(await getEquipment(parseId(request.params.id)));
  });

  router.patch('/:id', async (request, response) => {
    const input = patchEquipmentSchema.parse(request.body);
    response.json(await updateEquipment(parseId(request.params.id), input));
  });

  router.delete('/:id', async (request, response) => {
    await deleteEquipment(parseId(request.params.id));
    response.status(204).end();
  });

  return router;
}

function parseId(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    throw invalidId();
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw invalidId();
  return id;
}

function invalidId(): AppError {
  return new AppError(400, 'INVALID_ID', 'El id debe ser un entero positivo.');
}
