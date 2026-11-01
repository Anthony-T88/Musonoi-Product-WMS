CREATE INDEX v27_history_bundle_label_revision ON inventory_history((state->>'bundle_no'),revision_id DESC);
CREATE INDEX v27_snapshot_bundle_label ON stocktake_snapshot(stocktake_id,(state->>'bundle_no'));
CREATE INDEX v27_bundle_lifecycle_date ON bundles(physical_status,inbound_date DESC,id);
