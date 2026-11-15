CREATE TABLE equipment_types (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  maintenance_interval_hours integer NOT NULL CHECK (maintenance_interval_hours > 0)
);

CREATE TABLE equipment (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  type_id integer NOT NULL REFERENCES equipment_types(id),
  hour_meter numeric(10, 1) NOT NULL DEFAULT 0 CHECK (hour_meter >= 0),
  last_maintenance_hour_meter numeric(10, 1) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE maintenance_log (
  id serial PRIMARY KEY,
  equipment_id integer NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  performed_at timestamptz NOT NULL DEFAULT now(),
  hour_meter_at_service numeric(10, 1) NOT NULL,
  notes text
);
