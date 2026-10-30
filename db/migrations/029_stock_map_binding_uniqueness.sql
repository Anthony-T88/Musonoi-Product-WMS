-- Explicit aliases and exact P-code masters must not resolve to the same map slot twice.
CREATE UNIQUE INDEX one_resolved_location_per_map_slot ON locations(project_id,warehouse_id,(coalesce(map_cell_code,CASE WHEN code ~ '^P[1-5]-[1-9][0-9]?$' THEN code END))) WHERE coalesce(map_cell_code,CASE WHEN code ~ '^P[1-5]-[1-9][0-9]?$' THEN code END) IS NOT NULL;
