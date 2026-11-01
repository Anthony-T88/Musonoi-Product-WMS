-- Incremental metadata only; existing actual arrival times remain unknown.
ALTER TABLE vehicle_arrivals ADD COLUMN arrived_at timestamptz;
ALTER TABLE customer_transport_book ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN updated_by uuid REFERENCES users(id);
ALTER FUNCTION v261_item_action(uuid,uuid,uuid,int,text,jsonb) RENAME TO v34_prior_weight_item;
REVOKE ALL ON FUNCTION v34_prior_weight_item(uuid,uuid,uuid,int,text,jsonb) FROM PUBLIC,musonoi_app;
CREATE FUNCTION v261_item_action(actor uuid,doc uuid,bid uuid,expected int,action text,payload jsonb) RETURNS allocations
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF action='weigh' AND payload ? 'gross_weight' THEN
  IF (payload->>'gross_weight') IS NULL OR (payload->>'gross_weight') !~ '^([0-9]+)(\.[0-9]{1,4})?$'
   OR (payload->>'gross_weight')::numeric <= 0.0025 OR (payload->>'gross_weight')::numeric > 3 THEN
   RAISE EXCEPTION '保存检斤的毛重必须大于0.0025吨且不超过3吨，最多4位小数' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN v34_prior_weight_item(actor,doc,bid,expected,action,payload);
END $$;
REVOKE ALL ON FUNCTION v261_item_action(uuid,uuid,uuid,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v261_item_action(uuid,uuid,uuid,int,text,jsonb) TO musonoi_app;
