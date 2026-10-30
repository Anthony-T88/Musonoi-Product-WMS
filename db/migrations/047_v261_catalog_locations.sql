-- The existing PDF catalogue has 165 real P-slot codes but this local baseline only
-- had six legacy A/B locations. Materialize the catalogue for the Musonoi primary yard.
-- Never remap old A/B stock, invent capacities or bind another warehouse layout.
INSERT INTO locations(project_id,warehouse_id,code,map_cell_code,map_order,map_note)
SELECT p.id,w.id,c.code,c.code,c.display_order,'V2.6.1采用既有165格图纸编码；容量与现场位置仍待校核，未移动任何库存'
FROM projects p JOIN LATERAL(SELECT * FROM warehouses WHERE project_id=p.id AND active ORDER BY code LIMIT 1)w ON true CROSS JOIN stock_map_cells c
WHERE p.code='MSN' AND NOT EXISTS(SELECT 1 FROM locations l WHERE l.project_id=p.id AND (l.code=c.code OR l.warehouse_id=w.id AND coalesce(l.map_cell_code,l.code)=c.code));
