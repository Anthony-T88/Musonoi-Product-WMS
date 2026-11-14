-- Keep all existing Lot numbers and widen only the positive sequence suffix.
DO $$
DECLARE item record; old_pattern constant text:='(0[1-9]|[1-9][0-9])';
 new_pattern constant text:='(0[1-9]|[1-9][0-9]{1,35})'; definition text;
BEGIN
 FOR item IN SELECT conrelid::regclass relation,conname,pg_get_constraintdef(oid) AS body
  FROM pg_constraint WHERE contype='c' AND conrelid IN('allocations'::regclass,'preparation_plans'::regclass)
   AND strpos(pg_get_constraintdef(oid),'^RMM-CU-')>0
 LOOP
  IF strpos(item.body,old_pattern)=0 THEN RAISE EXCEPTION 'Unexpected copper lot constraint %',item.conname; END IF;
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.relation,item.conname);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',item.relation,item.conname,replace(item.body,old_pattern,new_pattern));
 END LOOP;
 FOREACH definition IN ARRAY ARRAY['v262_prior_create(uuid,uuid,text,uuid,jsonb)','v26_submit(uuid,uuid,text,jsonb)']
 LOOP
  SELECT pg_get_functiondef(definition::regprocedure) INTO item;
  IF strpos(item.pg_get_functiondef,old_pattern)=0 THEN RAISE EXCEPTION 'Unexpected copper lot function %',definition; END IF;
  EXECUTE replace(item.pg_get_functiondef,old_pattern,new_pattern);
 END LOOP;
END $$;

DO $$
DECLARE definition text; updated text;
BEGIN
 SELECT pg_get_functiondef('v261_create(uuid,uuid,text,uuid,jsonb)'::regprocedure) INTO definition;
 updated:=replace(definition,'WHERE l.id=planned AND l.active',
  'WHERE l.id=planned AND l.active AND l.map_parent_id IS NULL AND EXISTS(SELECT 1 FROM warehouses w WHERE w.id=l.warehouse_id AND w.active)');
 IF updated=definition THEN RAISE EXCEPTION 'Unexpected formal location guard'; END IF;
 EXECUTE updated;
END $$;

-- Bind the existing PDF-derived formal slots for the named Musonoi warehouse
-- when it has the shared copper areas but no formal slots. Preserve existing bindings.
WITH target AS (
 SELECT p.id project_id,w.id warehouse_id,w.code warehouse_code
 FROM projects p JOIN warehouses w ON w.project_id=p.id AND w.active
 WHERE (p.code,w.code) IN (('WMS-TEST','MUS'),('AUDIT','MUSONOI'))
  AND (w.code='MUSONOI' OR (
   EXISTS(SELECT 1 FROM locations l WHERE l.warehouse_id=w.id AND l.map_usage='TEMPORARY' AND l.active AND l.map_cell_code='P5')
   AND EXISTS(SELECT 1 FROM locations l WHERE l.warehouse_id=w.id AND l.map_usage='LEFTOVER' AND l.active AND l.map_cell_code='P3')
  ))
  AND EXISTS(SELECT 1 FROM system_info WHERE environment='test')
  AND NOT EXISTS(SELECT 1 FROM locations l WHERE l.warehouse_id=w.id AND l.map_usage='FORMAL')
), inserted AS (
 INSERT INTO locations(project_id,warehouse_id,code,map_cell_code,map_usage,map_order,map_review_note)
 SELECT t.project_id,t.warehouse_id,
  CASE WHEN t.warehouse_code='MUSONOI' AND EXISTS(SELECT 1 FROM locations l WHERE l.project_id=t.project_id AND l.code=c.code)
       THEN t.warehouse_code||'-'||c.code ELSE c.code END,
  c.code,'FORMAL',c.display_order,'Bound to existing copper map slot'
 FROM target t CROSS JOIN stock_map_cells c
 WHERE c.region_code IN('P1','P2','P4') AND c.x IS NOT NULL AND c.y IS NOT NULL AND c.width>0 AND c.height>0
  AND NOT EXISTS(SELECT 1 FROM locations l WHERE l.warehouse_id=t.warehouse_id AND coalesce(l.map_cell_code,l.code)=c.code)
 ON CONFLICT(project_id,code) DO NOTHING
 RETURNING *
)
INSERT INTO location_map_policy_history(location_id,before_data,after_data,reason)
 SELECT id,'{}'::jsonb,to_jsonb(inserted),'V4.8.1 bind existing copper slots to the Musonoi warehouse' FROM inserted;
