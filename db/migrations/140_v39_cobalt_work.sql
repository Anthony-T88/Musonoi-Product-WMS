-- Preserve all V3.8 bag identities and receipt facts; mutable work is separate.
CREATE TABLE co_work_batches(
 preparation_id uuid PRIMARY KEY REFERENCES co_preparations(id),
 status text NOT NULL DEFAULT 'PREPARING' CHECK(status IN('PREPARING','PENDING_COMPLETION_REVIEW','COMPLETED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 cobalt_grade_pct numeric CHECK(cobalt_grade_pct>0 AND cobalt_grade_pct<=100),
 arecoms_quantity_mt numeric CHECK(arecoms_quantity_mt>0 AND arecoms_quantity_mt<'Infinity'::numeric),
 arecoms_input text,
 submitted_by uuid REFERENCES users(id),submitted_at timestamptz,reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,
 amendment_status text NOT NULL DEFAULT 'NONE' CHECK(amendment_status IN('NONE','PENDING','APPROVED','REJECTED')),
 amendment_requested_by uuid REFERENCES users(id),amendment_requested_at timestamptz,amendment_reason text,
 amendment_reviewed_by uuid REFERENCES users(id),amendment_reviewed_at timestamptz,
 updated_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_action text NOT NULL DEFAULT 'INIT',last_reason text,
 CHECK((arecoms_input IS NULL AND arecoms_quantity_mt IS NULL) OR (arecoms_input IS NOT NULL AND arecoms_quantity_mt IS NOT NULL AND arecoms_input~'^\d{1,16}(\.\d{1,12})?$' AND arecoms_input::numeric=arecoms_quantity_mt)),
 CHECK(status='PREPARING' OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
 CHECK(status<>'COMPLETED' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
 CHECK(amendment_status<>'PENDING' OR (status='COMPLETED' AND amendment_requested_by IS NOT NULL AND amendment_requested_at IS NOT NULL AND length(trim(amendment_reason))>0)));
CREATE TABLE co_bag_work(
 bag_id uuid PRIMARY KEY REFERENCES co_inventory(bag_id),preparation_id uuid NOT NULL REFERENCES co_work_batches(preparation_id),
 FOREIGN KEY(bag_id,preparation_id) REFERENCES co_bags(id,preparation_id),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 actual_gross_kg numeric CHECK(actual_gross_kg>3 AND actual_gross_kg<'Infinity'::numeric),
 actual_net_kg numeric GENERATED ALWAYS AS(actual_gross_kg-3) STORED,
 weight_confirmed_by uuid REFERENCES users(id),weight_confirmed_at timestamptz,
 seal_no text CHECK(length(seal_no) BETWEEN 1 AND 80 AND seal_no=trim(seal_no)),
 seal_key text GENERATED ALWAYS AS(lower(trim(seal_no))) STORED,
 sampled boolean NOT NULL DEFAULT false,sampled_by uuid REFERENCES users(id),sampled_at timestamptz,
 updated_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT co_work_seal_unique UNIQUE(seal_key) DEFERRABLE INITIALLY IMMEDIATE,
 CHECK((actual_gross_kg IS NULL AND weight_confirmed_by IS NULL AND weight_confirmed_at IS NULL) OR (actual_gross_kg IS NOT NULL AND weight_confirmed_by IS NOT NULL AND weight_confirmed_at IS NOT NULL)),
 CHECK((NOT sampled AND sampled_by IS NULL AND sampled_at IS NULL) OR (sampled AND sampled_by IS NOT NULL AND sampled_at IS NOT NULL)));
CREATE INDEX co_bag_work_batch ON co_bag_work(preparation_id,bag_id);
CREATE TABLE co_work_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,preparation_id uuid NOT NULL REFERENCES co_preparations(id),bag_id uuid REFERENCES co_bag_work(bag_id),
 actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,before_data jsonb NOT NULL,after_data jsonb NOT NULL,reason text,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX co_work_events_batch ON co_work_events(preparation_id,id);
CREATE TRIGGER co_work_events_immutable BEFORE UPDATE OR DELETE ON co_work_events FOR EACH ROW EXECUTE FUNCTION co_immutable();
-- Backfill only new work rows; defaults explicitly mean unconfirmed / unsampled.
INSERT INTO co_work_batches(preparation_id) SELECT id FROM co_preparations WHERE status='RECEIVED';
INSERT INTO co_bag_work(bag_id,preparation_id) SELECT i.bag_id,i.preparation_id FROM co_inventory i JOIN co_work_batches w ON w.preparation_id=i.preparation_id;
CREATE FUNCTION co_work_initialize() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
 INSERT INTO public.co_work_batches(preparation_id) VALUES(NEW.preparation_id) ON CONFLICT DO NOTHING;
 INSERT INTO public.co_bag_work(bag_id,preparation_id) VALUES(NEW.bag_id,NEW.preparation_id);RETURN NEW;END$$;
CREATE TRIGGER co_work_on_receipt AFTER INSERT ON co_inventory FOR EACH ROW EXECUTE FUNCTION co_work_initialize();
CREATE FUNCTION co_work_authorized(actor uuid,permission text,preparation uuid,fixed_role text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN role_permissions r ON r.role_code=u.role_code JOIN co_preparations p ON p.id=preparation WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND r.permission_code=permission AND(fixed_role IS NULL OR u.role_code=fixed_role) AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=u.id AND s.project_id=p.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=p.warehouse_id) AND s.customer_id IS NULL))$$;
CREATE FUNCTION co_work_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE p co_preparations;allowed text[];BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_WORK_CANNOT_DELETE' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id;
 IF p.status<>'RECEIVED' THEN RAISE EXCEPTION 'CO_WORK_RECEIPT_REQUIRED' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PREPARING' OR NEW.version<>1 OR NEW.cobalt_grade_pct IS NOT NULL OR NEW.arecoms_input IS NOT NULL OR NEW.last_action<>'INIT' THEN RAISE EXCEPTION 'CO_WORK_INIT_INVALID' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.preparation_id<>OLD.preparation_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.updated_by IS NULL THEN RAISE EXCEPTION 'CO_WORK_VERSION_OR_IDENTITY' USING ERRCODE='23514';END IF;
 allowed:=ARRAY['version','updated_by','updated_at','last_action','last_reason'];
 IF NEW.last_action IN('WORK_SAVE','BULK_WEIGHT','BULK_SAMPLE') THEN
  IF OLD.status<>'PREPARING' OR NEW.status<>OLD.status OR NOT co_work_authorized(NEW.updated_by,'co:work-edit',p.id) THEN RAISE EXCEPTION 'CO_WORK_LOCKED' USING ERRCODE='23514';END IF;
  IF NEW.last_action='WORK_SAVE' THEN allowed:=allowed||ARRAY['cobalt_grade_pct','arecoms_quantity_mt','arecoms_input'];END IF;
 ELSIF NEW.last_action='COMPLETION_SUBMIT' THEN
  IF OLD.status<>'PREPARING' OR NEW.status<>'PENDING_COMPLETION_REVIEW' OR NEW.submitted_by<>NEW.updated_by OR NOT co_work_authorized(NEW.updated_by,'co:work-submit',p.id) THEN RAISE EXCEPTION 'CO_WORK_SUBMIT_INVALID' USING ERRCODE='23514';END IF;
  allowed:=allowed||ARRAY['status','submitted_by','submitted_at','reviewed_by','reviewed_at','amendment_status'];
 ELSIF NEW.last_action IN('COMPLETION_APPROVE','COMPLETION_RETURN') THEN
  IF OLD.status<>'PENDING_COMPLETION_REVIEW' OR NEW.status<>(CASE WHEN NEW.last_action='COMPLETION_APPROVE' THEN 'COMPLETED' ELSE 'PREPARING' END) OR NEW.updated_by IN(p.created_by,OLD.submitted_by) OR NOT co_work_authorized(NEW.updated_by,'co:completion-review',p.id,'site_supervisor') THEN RAISE EXCEPTION 'CO_WORK_REVIEW_INVALID' USING ERRCODE='23514';END IF;
  IF NEW.last_action='COMPLETION_RETURN' AND coalesce(length(trim(NEW.last_reason)),0)=0 THEN RAISE EXCEPTION 'CO_REASON_REQUIRED' USING ERRCODE='23514';END IF;
  IF NEW.last_action='COMPLETION_APPROVE' AND(NEW.reviewed_by IS DISTINCT FROM NEW.updated_by OR NEW.reviewed_at IS NULL) THEN RAISE EXCEPTION 'CO_WORK_REVIEW_STAMP_REQUIRED' USING ERRCODE='23514';END IF;
  allowed:=allowed||ARRAY['status','reviewed_by','reviewed_at'];
 ELSIF NEW.last_action='AMENDMENT_REQUEST' THEN
  IF OLD.status<>'COMPLETED' OR NEW.status<>OLD.status OR OLD.amendment_status='PENDING' OR NEW.amendment_status<>'PENDING' OR NEW.amendment_requested_by IS DISTINCT FROM NEW.updated_by OR coalesce(length(trim(NEW.amendment_reason)),0)=0 OR NOT co_work_authorized(NEW.updated_by,'co:amend-request',p.id) THEN RAISE EXCEPTION 'CO_WORK_AMEND_INVALID' USING ERRCODE='23514';END IF;
  allowed:=allowed||ARRAY['amendment_status','amendment_requested_by','amendment_requested_at','amendment_reason','amendment_reviewed_by','amendment_reviewed_at'];
 ELSIF NEW.last_action IN('AMENDMENT_APPROVE','AMENDMENT_REJECT') THEN
  IF OLD.status<>'COMPLETED' OR OLD.amendment_status<>'PENDING' OR NEW.status<>(CASE WHEN NEW.last_action='AMENDMENT_APPROVE' THEN 'PREPARING' ELSE 'COMPLETED' END) OR NEW.amendment_status<>(CASE WHEN NEW.last_action='AMENDMENT_APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END) OR NEW.updated_by IN(p.created_by,OLD.amendment_requested_by) OR coalesce(length(trim(NEW.last_reason)),0)=0 OR NEW.amendment_reviewed_by IS DISTINCT FROM NEW.updated_by OR NEW.amendment_reviewed_at IS NULL OR NOT co_work_authorized(NEW.updated_by,'co:amend-review',p.id,'site_supervisor') THEN RAISE EXCEPTION 'CO_WORK_AMEND_REVIEW_INVALID' USING ERRCODE='23514';END IF;
  allowed:=allowed||ARRAY['status','amendment_status','amendment_reviewed_by','amendment_reviewed_at'];
 ELSE RAISE EXCEPTION 'CO_WORK_ACTION_INVALID' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN RAISE EXCEPTION 'CO_WORK_UNRELATED_CHANGE' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_work_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON co_work_batches FOR EACH ROW EXECUTE FUNCTION co_work_batch_guard();
CREATE FUNCTION co_bag_work_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE s text;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_WORK_CANNOT_DELETE' USING ERRCODE='23514';END IF;
 SELECT status INTO s FROM co_work_batches WHERE preparation_id=NEW.preparation_id FOR UPDATE;
 IF s IS DISTINCT FROM 'PREPARING' THEN RAISE EXCEPTION 'CO_WORK_LOCKED' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.actual_gross_kg IS NOT NULL OR NEW.seal_no IS NOT NULL OR NEW.sampled THEN RAISE EXCEPTION 'CO_BAG_WORK_INIT_INVALID' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
 IF NEW.bag_id<>OLD.bag_id OR NEW.preparation_id<>OLD.preparation_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NOT co_work_authorized(NEW.updated_by,'co:work-edit',NEW.preparation_id) THEN RAISE EXCEPTION 'CO_WORK_VERSION_OR_IDENTITY' USING ERRCODE='23514';END IF;
 IF NEW.actual_gross_kg IS DISTINCT FROM OLD.actual_gross_kg THEN
  IF NEW.actual_gross_kg IS NOT NULL AND(NEW.weight_confirmed_by IS DISTINCT FROM NEW.updated_by OR NEW.weight_confirmed_at IS NULL) THEN RAISE EXCEPTION 'CO_WEIGHT_STAMP_REQUIRED' USING ERRCODE='23514';END IF;
 ELSIF NEW.weight_confirmed_by IS DISTINCT FROM OLD.weight_confirmed_by OR NEW.weight_confirmed_at IS DISTINCT FROM OLD.weight_confirmed_at THEN RAISE EXCEPTION 'CO_WEIGHT_STAMP_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.sampled IS DISTINCT FROM OLD.sampled THEN
  IF NEW.sampled AND(NEW.sampled_by IS DISTINCT FROM NEW.updated_by OR NEW.sampled_at IS NULL) THEN RAISE EXCEPTION 'CO_SAMPLE_STAMP_REQUIRED' USING ERRCODE='23514';END IF;
 ELSIF NEW.sampled_by IS DISTINCT FROM OLD.sampled_by OR NEW.sampled_at IS DISTINCT FROM OLD.sampled_at THEN RAISE EXCEPTION 'CO_SAMPLE_STAMP_IMMUTABLE' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_bag_work_guard BEFORE INSERT OR UPDATE OR DELETE ON co_bag_work FOR EACH ROW EXECUTE FUNCTION co_bag_work_guard();
-- Narrowly extend only inventory workflow state. All receipt/identity facts and
-- loading_eligible=false remain immutable. co_bags and original shared guard stay intact.
ALTER TABLE co_inventory DROP CONSTRAINT co_inventory_status_check;
ALTER TABLE co_inventory ADD CONSTRAINT co_inventory_status_check CHECK(status IN('PREPARING','PENDING_COMPLETION_REVIEW','COMPLETED'));
CREATE FUNCTION co_inventory_work_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM(to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'CO_RECEIPT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.status IS DISTINCT FROM(SELECT status FROM co_work_batches WHERE preparation_id=NEW.preparation_id) THEN RAISE EXCEPTION 'CO_INVENTORY_WORK_STATE_MISMATCH' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE OR REPLACE TRIGGER co_inventory_immutable BEFORE UPDATE OR DELETE ON co_inventory FOR EACH ROW EXECUTE FUNCTION co_inventory_work_guard();
CREATE FUNCTION co_work_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE w co_work_batches;p co_preparations;BEGIN
 SELECT * INTO w FROM co_work_batches WHERE preparation_id=NEW.preparation_id;SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id;
 IF p.status<>'RECEIVED' OR p.bag_count<>(SELECT count(*) FROM co_inventory WHERE preparation_id=p.id) OR p.bag_count<>(SELECT count(*) FROM co_bag_work WHERE preparation_id=p.id) OR EXISTS(SELECT 1 FROM co_inventory WHERE preparation_id=p.id AND(status<>w.status OR loading_eligible)) THEN RAISE EXCEPTION 'CO_WORK_INVENTORY_INCOMPLETE' USING ERRCODE='23514';END IF;
 IF w.status IN('PENDING_COMPLETION_REVIEW','COMPLETED') AND(w.cobalt_grade_pct IS NULL OR w.arecoms_quantity_mt IS NULL OR EXISTS(SELECT 1 FROM co_bag_work WHERE preparation_id=p.id AND(actual_gross_kg IS NULL OR seal_no IS NULL OR NOT sampled))) THEN RAISE EXCEPTION 'CO_WORK_REQUIREMENTS_INCOMPLETE' USING ERRCODE='23514';END IF;RETURN NULL;
END$$;
CREATE CONSTRAINT TRIGGER co_work_complete_guard AFTER INSERT OR UPDATE ON co_work_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_work_complete_guard();
CREATE FUNCTION co_work_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
 INSERT INTO public.co_work_events(preparation_id,bag_id,actor_id,action,before_data,after_data,reason) VALUES(NEW.preparation_id,CASE WHEN TG_TABLE_NAME='co_bag_work' THEN (to_jsonb(NEW)->>'bag_id')::uuid ELSE NULL END,NEW.updated_by,CASE WHEN TG_TABLE_NAME='co_bag_work' THEN 'BAG_UPDATE' ELSE to_jsonb(NEW)->>'last_action' END,to_jsonb(OLD),to_jsonb(NEW),CASE WHEN TG_TABLE_NAME='co_work_batches' THEN to_jsonb(NEW)->>'last_reason' ELSE NULL END);RETURN NEW;
END$$;
CREATE TRIGGER co_bag_work_audit AFTER UPDATE ON co_bag_work FOR EACH ROW EXECUTE FUNCTION co_work_audit();
CREATE TRIGGER co_work_batch_audit AFTER UPDATE ON co_work_batches FOR EACH ROW EXECUTE FUNCTION co_work_audit();
INSERT INTO permissions(code) VALUES('co:work-edit'),('co:work-submit'),('co:completion-review'),('co:amend-request'),('co:amend-review');
INSERT INTO role_permissions SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE p.code IN('co:work-edit','co:work-submit','co:amend-request','co:completion-review','co:amend-review') AND(r.code='admin' OR(r.code IN('logistics_field_operator','logistics_office_operator') AND p.code IN('co:work-edit','co:work-submit','co:amend-request')) OR(r.code='site_supervisor' AND p.code IN('co:completion-review','co:amend-review')));
INSERT INTO role_permission_caps SELECT role_code,permission_code FROM role_permissions WHERE permission_code IN('co:work-edit','co:work-submit','co:amend-request','co:completion-review','co:amend-review');
GRANT SELECT,UPDATE ON co_work_batches,co_bag_work TO musonoi_app;
GRANT SELECT ON co_work_events TO musonoi_app;
GRANT UPDATE(status) ON co_inventory TO musonoi_app;
