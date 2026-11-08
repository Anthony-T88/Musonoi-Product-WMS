ALTER TABLE receipts ADD COLUMN requires_sheets boolean NOT NULL DEFAULT false;
ALTER TABLE receipt_lines ADD COLUMN sheets_per_bundle integer CHECK(sheets_per_bundle>0);
ALTER TABLE bundles ADD COLUMN sheets_per_bundle integer CHECK(sheets_per_bundle>0),ADD COLUMN seal_no text CHECK(seal_no IS NULL OR seal_no=trim(seal_no) AND length(seal_no)>0);
ALTER TABLE lot_work_items ADD COLUMN seal_valid boolean NOT NULL DEFAULT false;
ALTER TABLE loading_items ADD COLUMN seal_no_snapshot text,ADD COLUMN sheets_snapshot integer;
CREATE TABLE bundle_metadata_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,bundle_id uuid NOT NULL REFERENCES bundles(id),actor_id uuid NOT NULL REFERENCES users(id),kind text NOT NULL,before_data jsonb,after_data jsonb,reason text NOT NULL,txid bigint NOT NULL DEFAULT txid_current(),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER immutable_metadata BEFORE UPDATE OR DELETE ON bundle_metadata_history FOR EACH ROW EXECUTE FUNCTION v23_immutable();
CREATE TABLE lot_bundle_releases(allocation_id uuid NOT NULL REFERENCES allocations(id),bundle_id uuid NOT NULL REFERENCES bundles(id),loading_id uuid NOT NULL REFERENCES loading_orders(id),actor_id uuid NOT NULL REFERENCES users(id),snapshot jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(allocation_id,bundle_id));
CREATE TRIGGER immutable_releases BEFORE UPDATE OR DELETE ON lot_bundle_releases FOR EACH ROW EXECUTE FUNCTION v23_immutable();
CREATE TABLE lot_location_claims(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,location_id uuid NOT NULL REFERENCES locations(id),allocation_id uuid NOT NULL REFERENCES allocations(id),claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),released_at timestamptz,release_reason text);
CREATE UNIQUE INDEX one_live_lot_per_location ON lot_location_claims(location_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX one_live_location_per_lot ON lot_location_claims(allocation_id) WHERE released_at IS NULL;
-- A conflict aborts the entire migration. Existing records are never silently remapped.
DO $$ DECLARE conflicts text;BEGIN
 SELECT string_agg(location_id::text||': '||lots,'; ') INTO conflicts FROM(SELECT planned_location_id location_id,string_agg(lot_no,', ') lots FROM allocations WHERE planned_location_id IS NOT NULL AND workflow_state NOT IN('CANCELLED','FULFILLED') GROUP BY planned_location_id HAVING count(*)>1)x;
 IF conflicts IS NOT NULL THEN RAISE EXCEPTION '历史Lot货位独占冲突，需人工处理: %',conflicts;END IF;
END $$;
INSERT INTO lot_location_claims(location_id,allocation_id) SELECT planned_location_id,id FROM allocations WHERE planned_location_id IS NOT NULL AND workflow_state NOT IN('CANCELLED','FULFILLED');
CREATE FUNCTION v262_receipt_sheets() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM receipts WHERE id=NEW.receipt_id AND requires_sheets) AND NEW.sheets_per_bundle IS NULL THEN RAISE EXCEPTION '新入库捆包片数必填: %',NEW.bundle_no USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER receipt_sheets BEFORE INSERT OR UPDATE ON receipt_lines FOR EACH ROW EXECUTE FUNCTION v262_receipt_sheets();
CREATE FUNCTION v262_bundle_sheets() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.receipt_id IS NOT NULL THEN SELECT sheets_per_bundle INTO NEW.sheets_per_bundle FROM receipt_lines WHERE receipt_id=NEW.receipt_id AND bundle_no=NEW.bundle_no;END IF;RETURN NEW;END $$;
CREATE TRIGGER bundle_sheets BEFORE INSERT ON bundles FOR EACH ROW EXECUTE FUNCTION v262_bundle_sheets();
CREATE FUNCTION v262_loading_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN SELECT seal_no,sheets_per_bundle INTO NEW.seal_no_snapshot,NEW.sheets_snapshot FROM bundles WHERE id=NEW.bundle_id;RETURN NEW;END $$;
CREATE TRIGGER loading_metadata_snapshot BEFORE INSERT ON loading_items FOR EACH ROW EXECUTE FUNCTION v262_loading_snapshot();
-- Only audited owner services may change bundle metadata; legacy guards remain intact.
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('confirmed_bundle_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN',$new$BEGIN
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND NEW.version=OLD.version+1 AND (to_jsonb(NEW)-ARRAY['version','sheets_per_bundle','seal_no'])=(to_jsonb(OLD)-ARRAY['version','sheets_per_bundle','seal_no']) AND EXISTS(SELECT 1 FROM bundle_metadata_history h WHERE h.bundle_id=OLD.id AND h.txid=txid_current() AND h.after_data->>'seal_no' IS NOT DISTINCT FROM NEW.seal_no AND (h.after_data->>'sheets_per_bundle')::integer IS NOT DISTINCT FROM NEW.sheets_per_bundle) THEN RETURN NEW;END IF;
 $new$);EXECUTE d;END $$;
GRANT SELECT ON bundle_metadata_history,lot_bundle_releases,lot_location_claims TO musonoi_app;
-- No write grant on new state/history tables: SECURITY DEFINER services are the boundary.
