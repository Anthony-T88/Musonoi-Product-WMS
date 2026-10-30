-- P5 bounds are the exact union of the existing 34 PDF-derived rectangles.
-- Keep original cells, locations, bundle IDs, positions and historical events.
DO $$ DECLARE conflicts text;BEGIN
 IF NOT EXISTS(SELECT 1 FROM stock_map_source WHERE source_sha256='1d439f6744c8d9c776ee5a63f76104e3b9209c129e675cbb57aec2b4ccce9c8d') OR (SELECT count(*) FROM stock_map_cells WHERE region_code='P5' AND x IS NOT NULL)<>34 THEN RAISE EXCEPTION 'P5现场图来源或34格几何无法核实，迁移拒绝';END IF;
 SELECT string_agg(a.lot_no,', ') INTO conflicts FROM allocations a JOIN locations l ON l.id=a.planned_location_id JOIN stock_map_cells c ON c.code=coalesce(l.map_cell_code,l.code) WHERE c.region_code='P5' AND a.workflow_state NOT IN('CANCELLED','FULFILLED');
 IF conflicts IS NOT NULL THEN RAISE EXCEPTION 'P5仍有有效Lot规划占用，须先业务核查处理，不能自动释放: %',conflicts;END IF;
END $$;
ALTER TABLE locations ADD COLUMN map_usage text NOT NULL DEFAULT 'REVIEW' CHECK(map_usage IN('FORMAL','TEMPORARY','TEMPORARY_LEGACY','REVIEW')),ADD COLUMN map_parent_id uuid REFERENCES locations(id),ADD COLUMN map_review_note text NOT NULL DEFAULT '';
CREATE TABLE location_map_policy_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,location_id uuid NOT NULL REFERENCES locations(id),before_data jsonb NOT NULL,after_data jsonb NOT NULL,reason text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER immutable_map_policy BEFORE UPDATE OR DELETE ON location_map_policy_history FOR EACH ROW EXECUTE FUNCTION v23_immutable();
CREATE TEMP TABLE v262_map_before ON COMMIT DROP AS SELECT id,to_jsonb(l) data FROM locations l;
INSERT INTO stock_map_cells(code,region_code,display_order,x,y,width,height) SELECT 'P5','P5',500,min(x),min(y),max(x+width)-min(x),max(y+height)-min(y) FROM stock_map_cells WHERE region_code='P5';
UPDATE locations l SET map_usage='FORMAL' FROM stock_map_cells c WHERE c.code=coalesce(l.map_cell_code,l.code) AND c.region_code IN('P1','P2','P3','P4') AND c.x IS NOT NULL AND l.active;
UPDATE locations SET map_usage='TEMPORARY',map_cell_code='P5',map_review_note='P5公共临时堆存区；保留原临时区货位ID和实物记录' WHERE code='临时堆存区' AND EXISTS(SELECT 1 FROM locations old JOIN stock_map_cells c ON c.code=coalesce(old.map_cell_code,old.code) WHERE old.project_id=locations.project_id AND old.warehouse_id=locations.warehouse_id AND c.region_code='P5');
UPDATE locations l SET map_usage='TEMPORARY_LEGACY',map_parent_id=p.id,map_review_note='历史P5子货位并入公共区域展示，原位置及流水不改写' FROM locations p,stock_map_cells c WHERE c.code=coalesce(l.map_cell_code,l.code) AND c.region_code='P5' AND c.code<>'P5' AND p.project_id=l.project_id AND p.warehouse_id=l.warehouse_id AND p.map_usage='TEMPORARY';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM locations l JOIN stock_map_cells c ON c.code=coalesce(l.map_cell_code,l.code) WHERE c.region_code='P5' AND c.code<>'P5' AND l.map_parent_id IS NULL) THEN RAISE EXCEPTION 'P5历史子货位缺少可核实公共临时区关联，拒绝迁移';END IF;END $$;
UPDATE locations SET map_review_note='无法关联现场图：从地图及新Lot正式货位选择隐藏，保留档案待核查' WHERE map_usage='REVIEW';
INSERT INTO location_map_policy_history(location_id,before_data,after_data,reason) SELECT l.id,b.data,to_jsonb(l),'V2.6.2补充优化：依原图P5公共临时区及正式货位展示策略；不移动实物' FROM locations l JOIN v262_map_before b ON b.id=l.id;
UPDATE stock_map_regions SET slot_count=1 WHERE code='P5';
UPDATE stock_map_source SET notes=notes||' | P5 public temporary area: union of original 34 digitized cells; original cells archived, no stock movement.',version=version+1;
-- New Lots must select a mapped, active P1-P4 formal slot; shared P5 is never claimed.
ALTER FUNCTION v261_create(uuid,uuid,text,uuid,jsonb) RENAME TO v262_before_public_create;
REVOKE ALL ON FUNCTION v262_before_public_create(uuid,uuid,text,uuid,jsonb) FROM musonoi_app;
CREATE FUNCTION v261_create(actor uuid,plan uuid,lot text,planned uuid,entries jsonb) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM locations l JOIN stock_map_cells c ON c.code=coalesce(l.map_cell_code,l.code) WHERE l.id=planned AND l.active AND l.map_usage='FORMAL' AND c.region_code IN('P1','P2','P3','P4') AND c.x IS NOT NULL) THEN RAISE EXCEPTION '请选择已在现场图定位的有效正式货位；P5临时堆存区及未定位货位不可独占' USING ERRCODE='23514';END IF;
 RETURN v262_before_public_create(actor,plan,lot,planned,entries);
END $$;
REVOKE ALL ON FUNCTION v261_create(uuid,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v261_create(uuid,uuid,text,uuid,jsonb) TO musonoi_app;
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('storage_assert_location(uuid,boolean)'::regprocedure) INTO d;
 d:=replace(d,'SELECT * INTO cap FROM locations WHERE id=loc;', 'SELECT * INTO cap FROM locations WHERE id=loc;IF cap.map_usage IN(''TEMPORARY'',''TEMPORARY_LEGACY'') THEN customer_check:=false;END IF;');EXECUTE d;END $$;
GRANT SELECT ON location_map_policy_history TO musonoi_app;
