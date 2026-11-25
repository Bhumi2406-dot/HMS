ALTER TABLE vitals ADD COLUMN respiratory_rate REAL;
ALTER TABLE vitals ADD COLUMN source TEXT NOT NULL DEFAULT 'Nursing entry';
ALTER TABLE lab_results ADD COLUMN recorded_by_id TEXT REFERENCES users(id);
ALTER TABLE lab_results ADD COLUMN source TEXT NOT NULL DEFAULT 'Laboratory entry';

CREATE TABLE IF NOT EXISTS patient_immunizations (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  vaccine_name TEXT NOT NULL,
  dose TEXT,
  administered_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Clinical record',
  recorded_by_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS patient_immunizations_patient_date_idx ON patient_immunizations(patient_id, administered_at);

CREATE TABLE IF NOT EXISTS patient_procedures (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  procedure_name TEXT NOT NULL,
  details TEXT,
  performed_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Clinical record',
  recorded_by_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS patient_procedures_patient_date_idx ON patient_procedures(patient_id, performed_at);
ALTER TABLE lab_results ADD COLUMN method TEXT;
