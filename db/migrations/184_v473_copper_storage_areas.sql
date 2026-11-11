-- Use the union of the existing P3 cells and preserve all historical locations.
INSERT INTO stock_map_cells(code,region_code,display_order,x,y,width,height)
SELECT 'P3','P3',300,min(x),min(y),max(x+width)-min(x),max(y+height)-min(y)
FROM stock_map_cells WHERE region_code='P3' AND x IS NOT NULL;
UPDATE stock_map_regions SET slot_count=1 WHERE code='P3';

ALTER TABLE locations DROP CONSTRAINT locations_map_usage_check;
ALTER TABLE locations ADD CONSTRAINT locations_map_usage_check CHECK(map_usage IN('FORMAL','TEMPORARY','TEMPORARY_LEGACY','REVIEW','LEFTOVER'));
CREATE UNIQUE INDEX v473_copper_p3_warehouse ON locations(project_id,warehouse_id) WHERE map_usage='LEFTOVER';
CREATE TABLE copper_leftover_custody (
 bundle_id uuid PRIMARY KEY REFERENCES bundles(id),
 customer_id uuid NOT NULL REFERENCES customers(id),
 allocation_id uuid NOT NULL REFERENCES allocations(id),
 loading_id uuid NOT NULL REFERENCES loading_orders(id),
 assigned_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION v473_p3_destination(pid uuid,wid uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid;BEGIN
 INSERT INTO locations(project_id,warehouse_id,code,map_cell_code,map_usage,map_note)
 VALUES(pid,wid,'P3-LEFTOVER','P3','LEFTOVER','剩余捆包堆存区 / Left Over Bundles Stock Area')
 ON CONFLICT(project_id,warehouse_id) WHERE map_usage='LEFTOVER' DO NOTHING;
 SELECT id INTO STRICT result FROM locations WHERE project_id=pid AND warehouse_id=wid AND map_usage='LEFTOVER' AND active;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION v473_p3_destination(uuid,uuid) FROM PUBLIC,musonoi_app;

SELECT v473_p3_destination(l.project_id,l.warehouse_id)
FROM (SELECT DISTINCT p.project_id,p.warehouse_id FROM locations p
 LEFT JOIN stock_map_cells c ON c.code=coalesce(p.map_cell_code,p.code)
 WHERE c.region_code='P3' OR p.map_usage='TEMPORARY' OR p.code='临时堆存区') l;

WITH existing AS MATERIALIZED (
 SELECT l.id,p.id parent,to_jsonb(l) previous FROM locations l
 JOIN stock_map_cells c ON c.code=coalesce(l.map_cell_code,l.code) AND c.region_code='P3' AND l.map_usage<>'LEFTOVER'
 JOIN locations p ON p.project_id=l.project_id AND p.warehouse_id=l.warehouse_id AND p.map_usage='LEFTOVER'
 WHERE l.map_parent_id IS NULL
), mapped AS (
 UPDATE locations l SET map_parent_id=e.parent FROM existing e WHERE e.id=l.id RETURNING l.*
)
INSERT INTO location_map_policy_history(location_id,before_data,after_data,reason)
SELECT m.id,e.previous,to_jsonb(m),'V4.7.3 P3 area grouping. Existing locations and stock positions retained.' FROM mapped m JOIN existing e USING(id);

-- The original production context used REVIEW as the default for a newly created P5.
WITH existing AS MATERIALIZED (
 SELECT l.id,to_jsonb(l) previous FROM locations l WHERE l.code='临时堆存区' AND l.map_usage='REVIEW' AND l.active
 AND NOT EXISTS(SELECT 1 FROM locations p WHERE p.project_id=l.project_id AND p.warehouse_id=l.warehouse_id AND p.map_usage='TEMPORARY' AND p.active)
), mapped AS (
 UPDATE locations l SET map_usage='TEMPORARY',map_cell_code='P5' FROM existing e WHERE e.id=l.id RETURNING l.*
)
INSERT INTO location_map_policy_history(location_id,before_data,after_data,reason)
SELECT m.id,e.previous,to_jsonb(m),'V4.7.3 restore map projection for existing production receipt area.' FROM mapped m JOIN existing e USING(id);

DO $$ DECLARE source text;updated text; routine regprocedure;BEGIN
 SELECT pg_get_functiondef('v26_production_context(uuid,uuid)'::regprocedure) INTO source;
 updated:=replace(source,'WHERE project_id=pid AND code=''临时堆存区''','WHERE project_id=pid AND warehouse_id=wh.id AND code=''临时堆存区''');
 updated:=replace(updated,'INSERT INTO locations(project_id,warehouse_id,code,map_note) VALUES(pid,wh.id,''临时堆存区'',''V2.6 未检斤生产入库区，非现场地图正式货位'')','INSERT INTO locations(project_id,warehouse_id,code,map_note,map_usage,map_cell_code) VALUES(pid,wh.id,''临时堆存区'',''新生产捆包堆存区'',''TEMPORARY'',''P5'')');
 IF updated=source OR strpos(updated,'''TEMPORARY'',''P5''')=0 THEN RAISE EXCEPTION 'Unexpected production area function';END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('v33_prior_storage_assert(uuid,boolean)'::regprocedure) INTO source;
 updated:=replace(source,'''TEMPORARY'',''TEMPORARY_LEGACY''','''TEMPORARY'',''TEMPORARY_LEGACY'',''LEFTOVER''');
 IF updated=source THEN RAISE EXCEPTION 'Unexpected mixed-storage function';END IF;
 EXECUTE updated;

 SELECT pg_get_functiondef('v261_create(uuid,uuid,text,uuid,jsonb)'::regprocedure) INTO source;
 updated:=replace(source,'''P1'',''P2'',''P3'',''P4''','''P1'',''P2'',''P4''');
 IF updated=source THEN RAISE EXCEPTION 'Unexpected formal location function';END IF;
 EXECUTE updated;

 FOREACH routine IN ARRAY ARRAY['v31_return_remaining(uuid,uuid,uuid)'::regprocedure,'v32_release_remaining(uuid,uuid,uuid)'::regprocedure] LOOP
  SELECT pg_get_functiondef(routine) INTO source;
  updated:=regexp_replace(source,'SELECT min\(l.id::text\)::uuid,count\(\*\) INTO destination,destinations[^;]+;\s*IF destinations<>1 THEN[^;]+;END IF;','destination:=v473_p3_destination(r.project_id,r.warehouse_id);');
  IF updated=source OR strpos(updated,'SET location_id=destination,version=version+1')=0 THEN RAISE EXCEPTION 'Unexpected remainder function %',routine;END IF;
  updated:=replace(updated,'IF r.location_id<>destination THEN',$custody$
  INSERT INTO copper_leftover_custody(bundle_id,customer_id,allocation_id,loading_id) VALUES(r.id,d.customer_id,lot,loadid)
  ON CONFLICT(bundle_id) DO UPDATE SET customer_id=excluded.customer_id,allocation_id=excluded.allocation_id,loading_id=excluded.loading_id,assigned_at=excluded.assigned_at
  WHERE copper_leftover_custody.loading_id IS DISTINCT FROM excluded.loading_id;
  IF r.location_id<>destination THEN$custody$);
  updated:=replace(updated,'''location_id'',destination,''allocation_id'',lot','''location_id'',destination,''customer_id'',d.customer_id,''allocation_id'',lot');
  updated:=replace(updated,'临时堆存区','剩余捆包堆存区');
  EXECUTE updated;
 END LOOP;
END $$;

-- Covers every insert path, including older API entry points. The base reservation
-- trigger still checks availability, scope, uniqueness and plan constraints.
CREATE FUNCTION v473_p3_reservation_customer() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner_id uuid; plan_customer uuid;BEGIN
 SELECT coalesce(p3.customer_id,b.customer_id) INTO owner_id FROM bundles b LEFT JOIN copper_leftover_custody p3 ON p3.bundle_id=b.id
 JOIN locations l ON l.id=b.location_id LEFT JOIN stock_map_cells cell ON cell.code=coalesce(l.map_cell_code,l.code)
 WHERE b.id=NEW.bundle_id AND (l.map_usage='LEFTOVER' OR cell.region_code='P3') FOR UPDATE OF b;
 IF FOUND THEN
  SELECT p.customer_id INTO plan_customer FROM allocations a JOIN sales_plans p ON p.id=a.plan_id WHERE a.id=NEW.allocation_id;
  IF owner_id IS DISTINCT FROM plan_customer THEN RAISE EXCEPTION '剩余捆包仅可用于同一客户的备货' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER v473_p3_reservation_customer BEFORE INSERT ON reservations FOR EACH ROW EXECUTE FUNCTION v473_p3_reservation_customer();
REVOKE ALL ON FUNCTION v473_p3_reservation_customer() FROM PUBLIC,musonoi_app;

DO $$ DECLARE definition text;BEGIN
 SELECT regexp_replace(pg_get_viewdef('inventory_view'::regclass,true),';\s*$','') INTO definition;
 EXECUTE 'CREATE OR REPLACE VIEW inventory_view AS SELECT prior.*, p3.customer_id AS p3_customer_id, customer.name AS p3_customer_name, (l.map_usage=''LEFTOVER'' OR coalesce(cell.region_code=''P3'',false)) AS p3_area, (l.map_usage IN(''TEMPORARY'',''TEMPORARY_LEGACY'') OR l.code=''临时堆存区'') AS p5_area FROM ('||definition||') prior JOIN bundles b ON b.id=prior.uuid JOIN locations l ON l.id=b.location_id LEFT JOIN copper_leftover_custody p3 ON p3.bundle_id=b.id LEFT JOIN copper_customers customer ON customer.id=p3.customer_id LEFT JOIN stock_map_cells cell ON cell.code=coalesce(l.map_cell_code,l.code)';
END $$;
