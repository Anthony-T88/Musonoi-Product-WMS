-- A counted bundle can have both a weight and a location discrepancy.
CREATE OR REPLACE FUNCTION v24_count_exceptions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE x jsonb;cat text;customer uuid;BEGIN
 IF NEW.status='APPROVED' AND OLD.status<>'APPROVED' THEN FOR x IN SELECT * FROM jsonb_array_elements(NEW.approved_report->'rows') LOOP
  FOR cat IN SELECT x->>'finding' WHERE x->>'finding' IN('GAIN','LOSS') UNION SELECT 'WEIGHT' WHERE x->>'finding' IN('WEIGHT','LOCATION') AND coalesce((x->>'weight_mismatch')::boolean,false) UNION SELECT 'LOCATION' WHERE coalesce((x->>'location_mismatch')::boolean,false) LOOP
   SELECT customer_id INTO customer FROM bundles WHERE bundle_no=x->>'bundle_no' AND project_id=NEW.project_id;
   PERFORM v24_raise_exception(NEW.reviewed_by,NEW.project_id,NEW.warehouse_id,customer,x->>'bundle_no',cat,'COUNT-'||NEW.id::text||'-'||(x->>'bundle_no')||'-'||cat,'STOCKTAKE',NEW.id,'盘点批准差异：'||x::text);
  END LOOP;
 END LOOP;END IF;RETURN NEW;END $$;
