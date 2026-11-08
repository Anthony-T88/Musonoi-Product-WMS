-- Additive identity protection. Preserve original labels and quarantine historical conflicts.
CREATE FUNCTION v265_bundle_key(label text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN upper(trim(label)) ~ '^MUS-[0-9]{4}-[0-9]{3}-[0-9]{2,}$'
 THEN regexp_replace(upper(trim(label)), '-0*([1-9][0-9]*)$', '-\1') ELSE upper(trim(label)) END
$$;
CREATE TABLE bundle_number_registry(number_key text PRIMARY KEY,owner_id uuid,conflicted boolean NOT NULL DEFAULT false,sources jsonb NOT NULL);
INSERT INTO bundle_number_registry
SELECT number_key,CASE WHEN count(DISTINCT owner_id)=1 AND count(DISTINCT line_id)<=1 THEN min(owner_id::text)::uuid END,
 count(DISTINCT owner_id)>1 OR count(DISTINCT line_id)>1,jsonb_agg(source)
FROM (
 SELECT v265_bundle_key(bundle_no) number_key,coalesce(receipt_id,id) owner_id,NULL::text line_id,jsonb_build_object('bundle_id',id,'bundle_no',bundle_no,'receipt_id',receipt_id) source FROM bundles
 UNION ALL
 SELECT v265_bundle_key(bundle_no),receipt_id,id::text,jsonb_build_object('line_id',id,'bundle_no',bundle_no,'receipt_id',receipt_id) FROM receipt_lines
) s GROUP BY number_key;
CREATE TABLE seal_number_registry(seal_key text PRIMARY KEY,bundle_id uuid REFERENCES bundles(id),conflicted boolean NOT NULL DEFAULT false,sources jsonb NOT NULL);
INSERT INTO seal_number_registry
SELECT upper(trim(seal)),CASE WHEN count(DISTINCT bid)=1 THEN min(bid::text)::uuid END,count(DISTINCT bid)>1,
 jsonb_agg(DISTINCT jsonb_build_object('bundle_id',bid,'seal_no',seal)) FROM (
 SELECT id bid,seal_no seal FROM bundles
 UNION ALL SELECT bundle_id,seal_no_snapshot FROM loading_items
 UNION ALL SELECT bundle_id,before_data->>'seal_no' FROM bundle_metadata_history
 UNION ALL SELECT bundle_id,after_data->>'seal_no' FROM bundle_metadata_history
 UNION ALL SELECT bundle_id,before_data->>'seal_no' FROM lot_work_history
 UNION ALL SELECT bundle_id,after_data->>'seal_no' FROM lot_work_history
 UNION ALL SELECT bundle_id,snapshot->>'seal_no' FROM lot_bundle_releases
) s WHERE bid IS NOT NULL AND nullif(trim(seal),'') IS NOT NULL GROUP BY upper(trim(seal));
CREATE FUNCTION v265_number_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k text;owner uuid;claim bundle_number_registry;BEGIN
 k:=v265_bundle_key(NEW.bundle_no);owner:=CASE WHEN TG_TABLE_NAME='bundles' THEN coalesce(NEW.receipt_id,NEW.id) ELSE NEW.receipt_id END;
 INSERT INTO bundle_number_registry VALUES(k,owner,false,jsonb_build_array(jsonb_build_object('table',TG_TABLE_NAME,'id',NEW.id,'bundle_no',NEW.bundle_no))) ON CONFLICT DO NOTHING;
 SELECT * INTO claim FROM bundle_number_registry WHERE number_key=k FOR UPDATE;
 IF claim.conflicted OR claim.owner_id IS DISTINCT FROM owner OR TG_TABLE_NAME='receipt_lines' AND EXISTS(SELECT 1 FROM receipt_lines WHERE v265_bundle_key(bundle_no)=k AND id<>NEW.id)
 OR TG_TABLE_NAME='bundles' AND EXISTS(SELECT 1 FROM bundles WHERE v265_bundle_key(bundle_no)=k AND id<>NEW.id) THEN
 RAISE EXCEPTION 'DUPLICATE_BUNDLE_NO' USING ERRCODE='23514',DETAIL=jsonb_build_object('bundle_no',NEW.bundle_no,'sources',claim.sources)::text;END IF;
 RETURN NEW;END $$;
CREATE TRIGGER v265_number_guard BEFORE INSERT OR UPDATE OF bundle_no ON bundles FOR EACH ROW EXECUTE FUNCTION v265_number_guard();
CREATE TRIGGER v265_number_guard BEFORE INSERT OR UPDATE OF bundle_no ON receipt_lines FOR EACH ROW EXECUTE FUNCTION v265_number_guard();
CREATE FUNCTION v265_seal_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE claim seal_number_registry;k text;BEGIN
 IF NEW.seal_no IS NULL THEN RETURN NEW;END IF;k:=upper(trim(NEW.seal_no));
 INSERT INTO seal_number_registry VALUES(k,NEW.id,false,jsonb_build_array(jsonb_build_object('bundle_id',NEW.id,'seal_no',NEW.seal_no))) ON CONFLICT DO NOTHING;
 SELECT * INTO claim FROM seal_number_registry WHERE seal_key=k FOR UPDATE;
 IF claim.conflicted OR claim.bundle_id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'DUPLICATE_SEAL_NO' USING ERRCODE='23514',DETAIL=jsonb_build_object('seal_no',NEW.seal_no,'bundle_no',NEW.bundle_no,'sources',claim.sources)::text;END IF;
 RETURN NEW;END $$;
CREATE TRIGGER v265_seal_guard BEFORE UPDATE OF seal_no ON bundles FOR EACH ROW EXECUTE FUNCTION v265_seal_guard();
CREATE FUNCTION v265_receipt_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item record;claim bundle_number_registry;BEGIN
 IF NEW.status IN('PENDING','CONFIRMED') THEN FOR item IN SELECT * FROM receipt_lines WHERE receipt_id=NEW.id LOOP
 SELECT * INTO claim FROM bundle_number_registry WHERE number_key=v265_bundle_key(item.bundle_no) FOR UPDATE;
 IF NOT FOUND OR claim.conflicted OR claim.owner_id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'DUPLICATE_BUNDLE_NO' USING ERRCODE='23514',DETAIL=jsonb_build_object('bundle_no',item.bundle_no)::text;END IF;
 END LOOP;END IF;RETURN NEW;END $$;
CREATE TRIGGER v265_receipt_identity BEFORE UPDATE OF status ON receipts FOR EACH ROW EXECUTE FUNCTION v265_receipt_identity_guard();
CREATE INDEX v265_bundle_key_lookup ON bundles(v265_bundle_key(bundle_no));
CREATE INDEX v265_line_key_lookup ON receipt_lines(v265_bundle_key(bundle_no));
REVOKE ALL ON bundle_number_registry,seal_number_registry FROM PUBLIC,musonoi_app;
GRANT SELECT ON bundle_number_registry,seal_number_registry TO musonoi_app;
REVOKE ALL ON FUNCTION v265_number_guard(),v265_seal_guard(),v265_receipt_identity_guard() FROM PUBLIC;
