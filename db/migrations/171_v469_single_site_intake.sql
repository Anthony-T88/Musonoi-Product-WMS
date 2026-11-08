-- Existing documents retain their original recorded flow. New documents use
-- preparation -> one site review -> final production receipt confirmation.
ALTER TABLE co_preparations ADD COLUMN intake_flow_version smallint NOT NULL DEFAULT 1 CHECK(intake_flow_version IN(1,2));
ALTER TABLE co_preparations ALTER COLUMN intake_flow_version SET DEFAULT 2;
ALTER TABLE co_preparations DROP CONSTRAINT co_preparations_status_check;
ALTER TABLE co_preparations ADD CONSTRAINT co_preparations_status_check CHECK(status IN('DRAFT','PREPARING','SITE_PENDING','PRODUCTION_PENDING','REJECTED','WITHDRAWN','RECEIVED'));
-- Preparation work and physical placement precede the formal inventory fact.
ALTER TABLE co_bag_work DROP CONSTRAINT co_bag_work_bag_id_fkey;
ALTER TABLE co_bag_work ADD CONSTRAINT co_bag_work_bag_id_fkey FOREIGN KEY(bag_id) REFERENCES co_bags(id);
ALTER TABLE co_positions DROP CONSTRAINT co_positions_bag_id_fkey;
ALTER TABLE co_positions ADD CONSTRAINT co_positions_bag_id_fkey FOREIGN KEY(bag_id) REFERENCES co_bags(id);

CREATE OR REPLACE FUNCTION co_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w co_work_batches;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_DOCUMENT_CANNOT_DELETE' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-ARRAY['status','version','submitted_by','submitted_at','site_reviewed_by','site_reviewed_at','production_reviewed_by','production_reviewed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','submitted_by','submitted_at','site_reviewed_by','site_reviewed_at','production_reviewed_by','production_reviewed_at']) THEN RAISE EXCEPTION 'CO_DOCUMENT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'CO_INVALID_TRANSITION' USING ERRCODE='23514';END IF;
 IF OLD.intake_flow_version=1 THEN
  IF NOT ((OLD.status IN('DRAFT','REJECTED') AND NEW.status IN('SITE_PENDING','WITHDRAWN')) OR (OLD.status='SITE_PENDING' AND NEW.status IN('PRODUCTION_PENDING','REJECTED','WITHDRAWN')) OR (OLD.status='PRODUCTION_PENDING' AND NEW.status IN('RECEIVED','REJECTED'))) THEN RAISE EXCEPTION 'CO_INVALID_TRANSITION' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO w FROM co_work_batches WHERE preparation_id=OLD.id;
 IF OLD.status='DRAFT' AND NEW.status='PREPARING' THEN
  IF NEW.submitted_by IS DISTINCT FROM OLD.created_by OR NOT co_work_authorized(NEW.submitted_by,'co:submit',OLD.id) THEN RAISE EXCEPTION 'CO_PERMISSION_DENIED' USING ERRCODE='23514';END IF;
 ELSIF OLD.status='DRAFT' AND NEW.status='WITHDRAWN' THEN NULL;
 ELSIF OLD.status='PREPARING' AND NEW.status='SITE_PENDING' AND w.status='PENDING_COMPLETION_REVIEW' THEN NULL;
 ELSIF OLD.status='SITE_PENDING' AND NEW.status='PREPARING' AND w.status='PREPARING' THEN NULL;
 ELSIF OLD.status='SITE_PENDING' AND NEW.status='PRODUCTION_PENDING' AND w.status='COMPLETED' THEN
  IF NEW.site_reviewed_by IS DISTINCT FROM w.reviewed_by OR NEW.site_reviewed_by IN(OLD.created_by,w.submitted_by) OR NOT co_work_authorized(NEW.site_reviewed_by,'co:completion-review',OLD.id,'site_supervisor') THEN RAISE EXCEPTION 'CO_WORK_REVIEW_INVALID' USING ERRCODE='23514';END IF;
 ELSIF OLD.status='PRODUCTION_PENDING' AND NEW.status='PREPARING' AND w.status='PREPARING' AND w.last_action='PRODUCTION_RETURN' THEN NULL;
 ELSIF OLD.status='PRODUCTION_PENDING' AND NEW.status='RECEIVED' AND w.status='COMPLETED' THEN
  IF NEW.production_reviewed_by IS NULL OR NEW.production_reviewed_by IN(OLD.created_by,OLD.site_reviewed_by,w.submitted_by) OR NOT co_work_authorized(NEW.production_reviewed_by,'co:production-review',OLD.id,'production_manager') THEN RAISE EXCEPTION 'CO_PRODUCTION_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'CO_INVALID_TRANSITION' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION co_initialize_before_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.intake_flow_version=2 AND OLD.status='DRAFT' AND NEW.status='PREPARING' THEN
  INSERT INTO public.co_work_batches(preparation_id) VALUES(NEW.id);
  INSERT INTO public.co_bag_work(bag_id,preparation_id) SELECT id,preparation_id FROM public.co_bags WHERE preparation_id=NEW.id;
  INSERT INTO public.co_positions(bag_id,preparation_id) SELECT id,preparation_id FROM public.co_bags WHERE preparation_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER co_initialize_before_receipt AFTER UPDATE ON co_preparations FOR EACH ROW EXECUTE FUNCTION co_initialize_before_receipt();
CREATE OR REPLACE FUNCTION co_work_initialize() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.co_work_batches(preparation_id) VALUES(NEW.preparation_id) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.co_bag_work WHERE bag_id=NEW.bag_id) THEN INSERT INTO public.co_bag_work(bag_id,preparation_id) VALUES(NEW.bag_id,NEW.preparation_id);END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION co_position_initialize() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.co_positions WHERE bag_id=NEW.bag_id) THEN INSERT INTO public.co_positions(bag_id,preparation_id) VALUES(NEW.bag_id,NEW.preparation_id);END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION co_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p co_preparations;w co_work_batches;
BEGIN
 SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id;
 IF p.status IS DISTINCT FROM 'RECEIVED' OR p.production_reviewed_by IS DISTINCT FROM NEW.received_by THEN RAISE EXCEPTION 'CO_PRODUCTION_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;
 IF p.intake_flow_version=2 THEN
  SELECT * INTO w FROM co_work_batches WHERE preparation_id=p.id;
  IF w.status IS DISTINCT FROM 'COMPLETED' OR NEW.status<>'COMPLETED' OR p.site_reviewed_by IS NULL OR p.production_reviewed_by=p.site_reviewed_by THEN RAISE EXCEPTION 'CO_WORK_REQUIREMENTS_INCOMPLETE' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION co_work_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w co_work_batches;p co_preparations;
BEGIN
 SELECT * INTO w FROM co_work_batches WHERE preparation_id=NEW.preparation_id;
 SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id;
 IF NOT (p.status='RECEIVED' OR p.intake_flow_version=2 AND p.status IN('PREPARING','SITE_PENDING','PRODUCTION_PENDING'))
 OR (SELECT count(*) FROM co_inventory WHERE preparation_id=p.id)<>(CASE WHEN p.status='RECEIVED' THEN p.bag_count ELSE 0 END)
 OR p.bag_count<>(SELECT count(*) FROM co_bag_work WHERE preparation_id=p.id)
 OR EXISTS(SELECT 1 FROM co_inventory WHERE preparation_id=p.id AND(status<>w.status OR loading_eligible)) THEN RAISE EXCEPTION 'CO_WORK_INVENTORY_INCOMPLETE' USING ERRCODE='23514';END IF;
 IF w.status IN('PENDING_COMPLETION_REVIEW','COMPLETED') AND EXISTS(SELECT 1 FROM co_bag_work WHERE preparation_id=p.id AND(actual_gross_kg IS NULL OR seal_no IS NULL OR NOT sampled)) THEN RAISE EXCEPTION 'CO_WORK_REQUIREMENTS_INCOMPLETE' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION co_work_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE p co_preparations;allowed text[];BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_WORK_CANNOT_DELETE' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id;
 IF NOT(p.status='RECEIVED' OR p.intake_flow_version=2 AND p.status IN('PREPARING','SITE_PENDING','PRODUCTION_PENDING')) THEN RAISE EXCEPTION 'CO_WORK_RECEIPT_REQUIRED' USING ERRCODE='23514';END IF;
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
 ELSIF NEW.last_action='PRODUCTION_RETURN' THEN
  IF p.intake_flow_version<>2 OR p.status<>'PRODUCTION_PENDING' OR OLD.status<>'COMPLETED' OR NEW.status<>'PREPARING' OR NOT co_work_authorized(NEW.updated_by,'co:production-review',p.id,'production_manager') OR NEW.updated_by IN(p.created_by,OLD.submitted_by,OLD.reviewed_by) OR length(trim(NEW.last_reason))=0 THEN RAISE EXCEPTION 'CO_WORK_REVIEW_INVALID' USING ERRCODE='23514';END IF;
  allowed:=allowed||ARRAY['status','reviewed_by','reviewed_at'];
 ELSIF NEW.last_action='AMENDMENT_REQUEST' THEN
  IF p.intake_flow_version=2 AND p.status<>'RECEIVED' THEN RAISE EXCEPTION 'CO_WORK_LOCKED' USING ERRCODE='23514';END IF;
  IF OLD.status<>'COMPLETED' OR NEW.status<>OLD.status OR OLD.amendment_status='PENDING' OR NEW.amendment_status<>'PENDING' OR NEW.amendment_requested_by IS DISTINCT FROM NEW.updated_by OR coalesce(length(trim(NEW.amendment_reason)),0)=0 OR NOT co_work_authorized(NEW.updated_by,'co:amend-request',p.id) THEN RAISE EXCEPTION 'CO_WORK_AMEND_INVALID' USING ERRCODE='23514';END IF;
  allowed:=allowed||ARRAY['amendment_status','amendment_requested_by','amendment_requested_at','amendment_reason','amendment_reviewed_by','amendment_reviewed_at'];
 ELSIF NEW.last_action IN('AMENDMENT_APPROVE','AMENDMENT_REJECT') THEN
  IF OLD.status<>'COMPLETED' OR OLD.amendment_status<>'PENDING' OR NEW.status<>(CASE WHEN NEW.last_action='AMENDMENT_APPROVE' THEN 'PREPARING' ELSE 'COMPLETED' END) OR NEW.amendment_status<>(CASE WHEN NEW.last_action='AMENDMENT_APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END) OR NEW.updated_by IN(p.created_by,OLD.amendment_requested_by) OR coalesce(length(trim(NEW.last_reason)),0)=0 OR NEW.amendment_reviewed_by IS DISTINCT FROM NEW.updated_by OR NEW.amendment_reviewed_at IS NULL OR NOT co_work_authorized(NEW.updated_by,'co:amend-review',p.id,'site_supervisor') THEN RAISE EXCEPTION 'CO_WORK_AMEND_REVIEW_INVALID' USING ERRCODE='23514';END IF;
  allowed:=allowed||ARRAY['status','amendment_status','amendment_reviewed_by','amendment_reviewed_at'];
 ELSE RAISE EXCEPTION 'CO_WORK_ACTION_INVALID' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN RAISE EXCEPTION 'CO_WORK_UNRELATED_CHANGE' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION co_position_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE p co_preparations;w co_work_batches;l co_locations;BEGIN
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM co_inventory WHERE bag_id=OLD.bag_id AND status='OUTBOUND') THEN
 IF OLD.location_id IS NULL OR NEW.location_id IS NOT NULL OR NEW.version<>OLD.version+1 OR(to_jsonb(NEW)-ARRAY['location_id','version','updated_by','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['location_id','version','updated_by','updated_at']) OR NOT EXISTS(SELECT 1 FROM co_outbound_bags b JOIN co_outbounds o ON o.id=b.outbound_id WHERE b.bag_id=OLD.bag_id AND o.posted_by=NEW.updated_by AND b.position_snapshot->>'location_id'=OLD.location_id::text) THEN RAISE EXCEPTION 'CO_EXECUTION_POSITION_POSTING' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_POSITION_NO_DELETE' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN IF NEW.location_id IS NOT NULL OR NEW.version<>1 OR NEW.updated_by IS NOT NULL THEN RAISE EXCEPTION 'CO_POSITION_INIT_ONLY' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
 SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id FOR UPDATE;
 SELECT * INTO w FROM co_work_batches WHERE preparation_id=p.id FOR UPDATE;
 IF NEW.bag_id<>OLD.bag_id OR NEW.preparation_id<>OLD.preparation_id OR NEW.version<>OLD.version+1 OR NEW.location_id IS NOT DISTINCT FROM OLD.location_id OR NOT(p.status='RECEIVED' OR p.intake_flow_version=2 AND p.status='PREPARING') OR w.status NOT IN('PREPARING','COMPLETED') OR w.amendment_status='PENDING' OR NOT co_location_authorized(NEW.updated_by,'co:locate',p.project_id,p.warehouse_id) THEN RAISE EXCEPTION 'CO_POSITION_STATE_PERMISSION' USING ERRCODE='23514';END IF;
 IF NEW.location_id IS NOT NULL THEN
  SELECT * INTO l FROM co_locations WHERE id=NEW.location_id FOR UPDATE;
  PERFORM id FROM co_zones WHERE id=l.zone_id FOR SHARE;
  IF l.id IS NULL OR l.project_id<>p.project_id OR l.warehouse_id<>p.warehouse_id OR NOT l.active OR l.occupied_by IS DISTINCT FROM p.id OR NOT EXISTS(SELECT 1 FROM co_zones z WHERE z.id=l.zone_id AND z.active) THEN RAISE EXCEPTION 'CO_POSITION_SCOPE_OCCUPANCY' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION co_location_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE permission text;BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='co_locations' THEN IF OLD.occupied_by IS NOT NULL AND EXISTS(SELECT 1 FROM co_outbounds WHERE preparation_id=OLD.occupied_by) THEN
 IF NEW.occupied_by IS NOT NULL OR NEW.version<>OLD.version+1 OR(to_jsonb(NEW)-ARRAY['occupied_by','version','updated_by','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['occupied_by','version','updated_by','updated_at']) OR EXISTS(SELECT 1 FROM co_positions WHERE location_id=OLD.id) OR NOT EXISTS(SELECT 1 FROM co_outbounds WHERE preparation_id=OLD.occupied_by AND posted_by=NEW.updated_by) THEN RAISE EXCEPTION 'CO_EXECUTION_LOCATION_POSTING' USING ERRCODE='23514';END IF;RETURN NEW;END IF;END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_LOCATION_NO_DELETE' USING ERRCODE='23514';END IF;
 permission:='co:location-manage';
 IF TG_OP='INSERT' AND NEW.version<>1 THEN RAISE EXCEPTION 'CO_LOCATION_INIT_VERSION' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='co_locations' THEN IF NEW.occupied_by IS DISTINCT FROM OLD.occupied_by THEN
   permission:='co:locate';
   IF (to_jsonb(NEW)-ARRAY['occupied_by','version','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['occupied_by','version','updated_by','updated_at']) THEN RAISE EXCEPTION 'CO_LOCATION_UNRELATED_CHANGE' USING ERRCODE='23514';END IF;
  END IF;END IF;
  IF (to_jsonb(NEW)-ARRAY['code','name','name_en','active','x','y','width','height','occupied_by','version','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['code','name','name_en','active','x','y','width','height','occupied_by','version','updated_by','updated_at']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'CO_LOCATION_IDENTITY_VERSION' USING ERRCODE='23514';END IF;
 END IF;
 IF NOT co_location_authorized(NEW.updated_by,permission,NEW.project_id,NEW.warehouse_id) OR NOT EXISTS(SELECT 1 FROM warehouses WHERE id=NEW.warehouse_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'CO_LOCATION_SCOPE_PERMISSION' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='co_locations' THEN
  IF permission='co:location-manage' AND NEW.active THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('co-layout:'||NEW.warehouse_id::text,0));
   IF EXISTS(SELECT 1 FROM co_locations a WHERE a.warehouse_id=NEW.warehouse_id AND a.id<>NEW.id AND a.active AND a.x<NEW.x+NEW.width AND a.x+a.width>NEW.x AND a.y<NEW.y+NEW.height AND a.y+a.height>NEW.y) THEN RAISE EXCEPTION 'CO_LOCATION_OVERLAP' USING ERRCODE='23514';END IF;
  END IF;
  IF TG_OP='INSERT' AND NEW.occupied_by IS NOT NULL THEN RAISE EXCEPTION 'CO_LOCATION_INSERT_OCCUPIED' USING ERRCODE='23514';END IF;
  IF NEW.occupied_by IS NOT NULL AND(NOT NEW.active OR NOT EXISTS(SELECT 1 FROM co_preparations p WHERE p.id=NEW.occupied_by AND p.project_id=NEW.project_id AND p.warehouse_id=NEW.warehouse_id AND (p.status='RECEIVED' OR p.intake_flow_version=2 AND p.status='PREPARING'))) THEN RAISE EXCEPTION 'CO_LOCATION_BATCH_SCOPE' USING ERRCODE='23514';END IF;
  IF NOT NEW.active AND EXISTS(SELECT 1 FROM co_positions WHERE location_id=NEW.id) THEN RAISE EXCEPTION 'CO_LOCATION_OCCUPIED' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT NEW.active AND EXISTS(SELECT 1 FROM co_locations l JOIN co_positions p ON p.location_id=l.id WHERE l.zone_id=NEW.id) THEN RAISE EXCEPTION 'CO_ZONE_OCCUPIED' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
