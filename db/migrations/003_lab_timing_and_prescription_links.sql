ALTER TABLE prescriptions ADD COLUMN consultation_id TEXT REFERENCES consultations(id);
ALTER TABLE lab_order_items ADD COLUMN sample_collected_at TEXT;
ALTER TABLE lab_order_items ADD COLUMN processing_started_at TEXT;
CREATE INDEX IF NOT EXISTS lab_items_sample_time_idx ON lab_order_items(sample_collected_at);
