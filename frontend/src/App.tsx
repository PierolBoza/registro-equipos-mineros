import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  type Equipment,
  type EquipmentType,
  type MaintenanceLog,
} from './api.js';

type FormState = {
  code: string;
  type: string;
  hourMeter: string;
};

const emptyForm: FormState = { code: '', type: '', hourMeter: '0' };

export default function App() {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [maintenanceId, setMaintenanceId] = useState<number | null>(null);
  const [maintenanceNotes, setMaintenanceNotes] = useState('');
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [history, setHistory] = useState<MaintenanceLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const equipmentController = useRef<AbortController | null>(null);
  const historyController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    equipmentController.current = controller;
    Promise.all([
      api.listEquipment(controller.signal),
      api.listTypes(controller.signal),
    ])
      .then(([equipmentRows, typeRows]) => {
        setEquipment(equipmentRows);
        setTypes(typeRows);
        setForm((current) => ({
          ...current,
          type: current.type || typeRows[0]?.code || '',
        }));
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name !== 'AbortError') {
          setError(cause.message);
        }
      })
      .finally(() => setLoading(false));
    return () => {
      controller.abort();
      if (equipmentController.current === controller) {
        equipmentController.current = null;
      }
      historyController.current?.abort();
    };
  }, []);

  async function refreshEquipment() {
    equipmentController.current?.abort();
    const controller = new AbortController();
    equipmentController.current = controller;
    try {
      const rows = await api.listEquipment(controller.signal);
      if (!controller.signal.aborted) setEquipment(rows);
    } finally {
      if (equipmentController.current === controller) {
        equipmentController.current = null;
      }
    }
  }

  function resetForm() {
    setForm({ ...emptyForm, type: types[0]?.code || '' });
    setEditingId(null);
  }

  async function submitEquipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const input = {
        code: form.code,
        type: form.type,
        hour_meter: Number(form.hourMeter),
      };
      if (!Number.isFinite(input.hour_meter)) {
        throw new Error('El horómetro debe ser un número válido.');
      }
      if (editingId === null) await api.createEquipment(input);
      else await api.updateEquipment(editingId, input);
      setNotice(
        editingId === null ? 'Equipo registrado.' : 'Equipo actualizado.',
      );
      resetForm();
      await refreshEquipment();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(row: Equipment) {
    setForm({
      code: row.code,
      type: row.type,
      hourMeter: String(row.hourMeter),
    });
    setEditingId(row.id);
    setError('');
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function removeEquipment(row: Equipment) {
    if (!window.confirm(`¿Eliminar el equipo ${row.code} y su historial?`))
      return;
    setBusyId(row.id);
    setError('');
    setNotice('');
    try {
      await api.deleteEquipment(row.id);
      setNotice(`Se eliminó ${row.code}.`);
      if (editingId === row.id) resetForm();
      if (historyId === row.id) {
        setHistoryId(null);
        setHistory([]);
      }
      await refreshEquipment();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function submitMaintenance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (maintenanceId === null || busyId !== null) return;
    const id = maintenanceId;
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await api.createMaintenance(id, maintenanceNotes);
      setNotice('Mantenimiento registrado.');
      setMaintenanceId(null);
      setMaintenanceNotes('');
      await refreshEquipment();
      if (historyId === id) await loadHistory(id);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function loadHistory(id: number) {
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    setHistoryId(id);
    setHistory([]);
    setHistoryLoading(true);
    setError('');
    try {
      const rows = await api.listMaintenance(id, controller.signal);
      if (!controller.signal.aborted) setHistory(rows);
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) {
        setError(errorMessage(cause));
      }
    } finally {
      if (historyController.current === controller) {
        historyController.current = null;
        setHistoryLoading(false);
      }
    }
  }

  function toggleHistory(id: number) {
    if (historyId === id) {
      historyController.current?.abort();
      historyController.current = null;
      setHistoryId(null);
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    void loadHistory(id);
  }

  return (
    <main className="page-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">CONTROL DE FLOTA</p>
          <h1>Registro de equipos</h1>
          <p className="hero-description">
            Registra horómetros y mantén visible el estado de cada equipo.
          </p>
        </div>
        <div className="summary-card" aria-live="polite">
          <span>Equipos registrados</span>
          <strong>{equipment.length}</strong>
          <span className="summary-alert">
            {equipment.filter((row) => row.needsMaintenance).length} requieren
            mantenimiento
          </span>
        </div>
      </header>

      {(error || notice) && (
        <div
          className={`message ${error ? 'message-error' : 'message-success'}`}
          role="status"
        >
          <span>{error || notice}</span>
          <button
            type="button"
            className="message-close"
            aria-label="Cerrar aviso"
            onClick={() => {
              setError('');
              setNotice('');
            }}
          >
            ×
          </button>
        </div>
      )}

      <section className="panel form-panel" aria-labelledby="form-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">REGISTRO</p>
            <h2 id="form-title">
              {editingId === null ? 'Nuevo equipo' : 'Editar equipo'}
            </h2>
          </div>
          {editingId !== null && (
            <button
              className="button button-quiet"
              type="button"
              onClick={resetForm}
            >
              Cancelar edición
            </button>
          )}
        </div>

        <form className="equipment-form" onSubmit={submitEquipment}>
          <label>
            Código
            <input
              required
              maxLength={50}
              autoComplete="off"
              value={form.code}
              onChange={(event) =>
                setForm({ ...form, code: event.target.value })
              }
              placeholder="CAM-001"
            />
          </label>
          <label>
            Tipo de equipo
            <select
              required
              value={form.type}
              onChange={(event) =>
                setForm({ ...form, type: event.target.value })
              }
            >
              {types.map((type) => (
                <option key={type.id} value={type.code}>
                  {type.label} · cada {type.maintenanceIntervalHours} h
                </option>
              ))}
            </select>
          </label>
          <label>
            Horómetro actual
            <input
              required
              type="number"
              inputMode="decimal"
              min="0"
              max="9999999.9"
              step="0.1"
              value={form.hourMeter}
              onChange={(event) =>
                setForm({ ...form, hourMeter: event.target.value })
              }
            />
          </label>
          <button
            className="button button-primary form-submit"
            type="submit"
            disabled={saving || loading || types.length === 0}
          >
            {saving
              ? 'Guardando…'
              : editingId === null
                ? 'Registrar equipo'
                : 'Guardar cambios'}
          </button>
        </form>
      </section>

      <section className="panel list-panel" aria-labelledby="list-title">
        <div className="section-heading list-heading">
          <div>
            <p className="eyebrow">SEGUIMIENTO</p>
            <h2 id="list-title">Inventario</h2>
          </div>
          <span className="record-count">{equipment.length} equipos</span>
        </div>

        {loading ? (
          <p className="empty-state">Cargando equipos…</p>
        ) : equipment.length === 0 ? (
          <p className="empty-state">
            Todavía no hay equipos. Registra el primero arriba.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Equipo</th>
                  <th scope="col">Horómetro</th>
                  <th scope="col">Desde servicio</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Equipo">
                      <strong className="equipment-code">{row.code}</strong>
                      <span className="equipment-type">{row.typeLabel}</span>
                    </td>
                    <td data-label="Horómetro">
                      {formatHours(row.hourMeter)} h
                    </td>
                    <td data-label="Desde servicio">
                      {formatHours(row.hoursSinceMaintenance)} /{' '}
                      {row.intervalHours} h
                    </td>
                    <td data-label="Estado">
                      <span
                        className={`status ${row.needsMaintenance ? 'status-due' : 'status-ok'}`}
                      >
                        <span className="status-dot" aria-hidden="true" />
                        {row.status}
                      </span>
                    </td>
                    <td data-label="Acciones">
                      <div className="action-row">
                        <button
                          className="button button-small"
                          type="button"
                          onClick={() => beginEdit(row)}
                          disabled={busyId !== null}
                        >
                          Editar
                        </button>
                        <button
                          className="button button-small"
                          type="button"
                          onClick={() => {
                            setMaintenanceId(
                              maintenanceId === row.id ? null : row.id,
                            );
                            setMaintenanceNotes('');
                          }}
                          disabled={busyId !== null}
                        >
                          Servicio
                        </button>
                        <button
                          className="button button-small button-quiet"
                          type="button"
                          onClick={() => toggleHistory(row.id)}
                          disabled={historyLoading || busyId !== null}
                        >
                          {historyId === row.id
                            ? 'Ocultar historial'
                            : 'Historial'}
                        </button>
                        <button
                          className="button button-small button-danger"
                          type="button"
                          onClick={() => void removeEquipment(row)}
                          disabled={busyId !== null}
                        >
                          Eliminar
                        </button>
                      </div>
                      {maintenanceId === row.id && (
                        <form
                          className="inline-form"
                          onSubmit={submitMaintenance}
                        >
                          <label>
                            Nota de servicio (opcional)
                            <input
                              maxLength={1000}
                              value={maintenanceNotes}
                              onChange={(event) =>
                                setMaintenanceNotes(event.target.value)
                              }
                              placeholder="Trabajo realizado"
                            />
                          </label>
                          <button
                            className="button button-primary button-small"
                            type="submit"
                            disabled={busyId !== null}
                          >
                            {busyId !== null
                              ? 'Guardando…'
                              : 'Confirmar servicio'}
                          </button>
                        </form>
                      )}
                      {historyId === row.id && (
                        <div className="history-box">
                          {historyLoading ? (
                            <p>Cargando historial…</p>
                          ) : history.length === 0 ? (
                            <p>Sin mantenimientos registrados.</p>
                          ) : (
                            <ul>
                              {history.map((entry) => (
                                <li key={entry.id}>
                                  <strong>
                                    {new Date(entry.performedAt).toLocaleString(
                                      'es-PE',
                                    )}
                                  </strong>
                                  <span>
                                    {formatHours(entry.hourMeterAtService)} h
                                  </span>
                                  {entry.notes && <span>{entry.notes}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="page-footer">
        <span>
          Intervalos iniciales: camión 250 h · excavadora 500 h · perforadora
          300 h.
        </span>
        <span>Registro de equipos mineros · {new Date().getFullYear()}</span>
      </footer>
    </main>
  );
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('es-PE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : 'Ocurrió un error inesperado.';
}
