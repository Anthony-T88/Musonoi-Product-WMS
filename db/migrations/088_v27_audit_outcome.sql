ALTER TABLE audit_logs ADD COLUMN outcome text NOT NULL DEFAULT 'COMMITTED' CHECK(outcome IN('COMMITTED','FAILED'));
CREATE INDEX v27_audit_entity_time ON audit_logs(entity_type,entity_id,id DESC);
