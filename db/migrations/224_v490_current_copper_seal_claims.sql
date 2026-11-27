-- Keep the registry as the concurrency guard and the audit tables as history.
CREATE INDEX v490_bundle_current_seal ON bundles(upper(btrim(seal_no)))
 WHERE seal_no IS NOT NULL;
CREATE INDEX v490_load_snapshot_seal ON loading_items(upper(btrim(seal_no_snapshot)))
 WHERE seal_no_snapshot IS NOT NULL AND NOT plan_removed;
CREATE INDEX v490_historical_seal_lookup ON historical_movement_lines(historical_unit_key(seal_no))
 WHERE seal_no IS NOT NULL;

CREATE FUNCTION v490_copper_seal_in_use(seal_key text) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM bundles b WHERE b.seal_no IS NOT NULL AND upper(btrim(b.seal_no))=$1
 ) OR EXISTS(
  SELECT 1 FROM loading_items i JOIN loading_orders o ON o.id=i.loading_id
  WHERE i.seal_no_snapshot IS NOT NULL AND upper(btrim(i.seal_no_snapshot))=$1 AND NOT i.plan_removed
   AND (i.active OR o.status IN('DEPARTED','REVERSED')
    OR EXISTS(SELECT 1 FROM packing_list_revisions p WHERE p.loading_id=o.id))
 ) OR EXISTS(
  SELECT 1 FROM historical_outbound_units u WHERE u.product_code='CU_CATHODE'
   AND u.seal_no IS NOT NULL AND historical_unit_key(u.seal_no)=historical_unit_key($1)
 );
$$;
REVOKE ALL ON FUNCTION v490_copper_seal_in_use(text) FROM PUBLIC,musonoi_app;

CREATE OR REPLACE FUNCTION v265_seal_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE claim seal_number_registry; old_key text; new_key text;
BEGIN
 new_key:=upper(btrim(NEW.seal_no));
 IF TG_OP='UPDATE' THEN old_key:=upper(btrim(OLD.seal_no)); END IF;

 IF new_key IS NOT NULL THEN
  INSERT INTO seal_number_registry(seal_key,bundle_id,conflicted,sources)
  VALUES(new_key,NEW.id,false,jsonb_build_array(jsonb_build_object('bundle_id',NEW.id,'seal_no',NEW.seal_no)))
  ON CONFLICT DO NOTHING;
  SELECT * INTO claim FROM seal_number_registry WHERE seal_key=new_key FOR UPDATE;
  IF claim.conflicted OR claim.bundle_id IS DISTINCT FROM NEW.id THEN
   RAISE EXCEPTION 'DUPLICATE_SEAL_NO' USING ERRCODE='23514',
    DETAIL=jsonb_build_object('seal_no',NEW.seal_no,'bundle_no',NEW.bundle_no,'sources',claim.sources)::text;
  END IF;
 END IF;

 IF old_key IS NOT NULL AND old_key IS DISTINCT FROM new_key THEN
  DELETE FROM seal_number_registry s
  WHERE s.seal_key=old_key AND s.bundle_id=NEW.id AND NOT s.conflicted
   AND NOT v490_copper_seal_in_use(old_key);
 END IF;
 RETURN NEW;
END $$;

-- Repair only superseded claims backed by an actual recorded seal change.
-- Unexplained historical claims and quarantined conflicts are left in place.
WITH replaced AS (
 SELECT DISTINCT h.bundle_id,upper(btrim(h.before_data->>'seal_no')) AS old_key
 FROM bundle_metadata_history h
 WHERE h.kind IN('SEAL','BUNDLE_CORRECTION') AND h.before_data->>'seal_no' IS NOT NULL
  AND h.after_data?'seal_no'
  AND upper(btrim(h.before_data->>'seal_no')) IS DISTINCT FROM upper(btrim(h.after_data->>'seal_no'))
)
DELETE FROM seal_number_registry s USING replaced a
WHERE s.seal_key=a.old_key AND s.bundle_id=a.bundle_id AND NOT s.conflicted
 AND NOT v490_copper_seal_in_use(s.seal_key);
