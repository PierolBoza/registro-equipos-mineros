import { z } from 'zod';

const equipmentType = z.enum(['camion', 'excavadora', 'perforadora']);

const hourMeter = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999.9)
  .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-8, {
    message: 'El horómetro admite como máximo un decimal.',
  });

const equipmentCode = z
  .string()
  .trim()
  .min(1, 'El código es obligatorio.')
  .max(50, 'El código no puede superar 50 caracteres.')
  .transform((value) => value.toUpperCase());

export const createEquipmentSchema = z.object({
  code: equipmentCode,
  type: equipmentType,
  hour_meter: hourMeter.optional().default(0),
});

export const patchEquipmentSchema = z
  .object({
    code: equipmentCode.optional(),
    type: equipmentType.optional(),
    hour_meter: hourMeter.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Envía al menos un campo editable.',
  });

export const maintenanceSchema = z.object({
  notes: z
    .string()
    .trim()
    .max(1000, 'Las notas no pueden superar 1000 caracteres.')
    .optional(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type PatchEquipmentInput = z.infer<typeof patchEquipmentSchema>;
export type MaintenanceInput = z.infer<typeof maintenanceSchema>;
