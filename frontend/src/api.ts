export type EquipmentType = {
  id: number;
  code: string;
  label: string;
  maintenanceIntervalHours: number;
};

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
  createdAt: string;
  updatedAt: string;
};

export type MaintenanceLog = {
  id: number;
  equipmentId: number;
  performedAt: string;
  hourMeterAtService: number;
  notes: string | null;
};

type ApiErrorBody = {
  error?: {
    message?: string;
  };
};

const apiUrl = (
  import.meta.env.VITE_API_URL || 'http://localhost:8080'
).replace(/\/$/, '');

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(
      body.error?.message || 'No se pudo completar la solicitud.',
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  listEquipment(signal?: AbortSignal) {
    return request<Equipment[]>('/api/equipment', { signal });
  },
  listTypes(signal?: AbortSignal) {
    return request<EquipmentType[]>('/api/equipment-types', { signal });
  },
  createEquipment(input: { code: string; type: string; hour_meter: number }) {
    return request<Equipment>('/api/equipment', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updateEquipment(
    id: number,
    input: { code: string; type: string; hour_meter: number },
  ) {
    return request<Equipment>(`/api/equipment/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  deleteEquipment(id: number) {
    return request<void>(`/api/equipment/${id}`, { method: 'DELETE' });
  },
  createMaintenance(id: number, notes: string) {
    return request<{ log: MaintenanceLog; equipment: Equipment }>(
      `/api/equipment/${id}/maintenance`,
      { method: 'POST', body: JSON.stringify({ notes }) },
    );
  },
  listMaintenance(id: number, signal?: AbortSignal) {
    return request<MaintenanceLog[]>(`/api/equipment/${id}/maintenance`, {
      signal,
    });
  },
};
