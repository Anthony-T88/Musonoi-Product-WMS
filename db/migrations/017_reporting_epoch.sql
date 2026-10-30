CREATE TABLE inventory_reporting_epoch(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),revision_id bigint NOT NULL REFERENCES inventory_revisions(id),started_at timestamptz NOT NULL);
INSERT INTO inventory_reporting_epoch SELECT true,r.id,r.posted_at FROM inventory_revisions r WHERE r.id=coalesce((SELECT min(revision_id) FROM inventory_history),v24_revision());
CREATE TRIGGER reporting_epoch_immutable BEFORE UPDATE OR DELETE ON inventory_reporting_epoch FOR EACH ROW EXECUTE FUNCTION v23_immutable();
GRANT SELECT ON inventory_reporting_epoch TO musonoi_app;
