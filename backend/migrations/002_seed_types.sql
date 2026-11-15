INSERT INTO equipment_types (code, label, maintenance_interval_hours) VALUES
  ('camion', 'Camión', 250),
  ('excavadora', 'Excavadora', 500),
  ('perforadora', 'Perforadora', 300)
ON CONFLICT (code) DO NOTHING;
