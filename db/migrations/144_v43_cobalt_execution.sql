-- V4.3 independent cobalt execution; no copper function or historical migration is changed.
CREATE TABLE co_load_executions(
 order_id uuid PRIMARY KEY REFERENCES co_loading_orders(id),preparation_id uuid NOT NULL UNIQUE REFERENCES co_preparations(id),
 state text NOT NULL DEFAULT 'LOADING' CHECK(state IN('LOADING','REVIEW_PENDING','LOADED','DEPARTED','OUTBOUND_PENDING','LOGISTICS_APPROVED','OUTBOUND_CORRECTION','OUTBOUND')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),started_by uuid NOT NULL REFERENCES users(id),started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 confirmation_version integer,confirmed_by uuid REFERENCES users(id),confirmed_at timestamptz,load_reviewed_by uuid REFERENCES users(id),load_reviewed_at timestamptz,
 departure_id uuid,submitted_by uuid REFERENCES users(id),submitted_at timestamptz,logistics_by uuid REFERENCES users(id),logistics_at timestamptz,production_by uuid REFERENCES users(id),production_at timestamptz,
 updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_action text NOT NULL DEFAULT 'START',last_note text NOT NULL DEFAULT '',
 CHECK(state IN('LOADING','REVIEW_PENDING') OR(load_reviewed_by IS NOT NULL AND load_reviewed_at IS NOT NULL)),
 CHECK(state IN('LOADING','REVIEW_PENDING','LOADED') OR departure_id IS NOT NULL),CHECK(state<>'OUTBOUND' OR production_by IS NOT NULL));
CREATE TABLE co_load_bags(
 order_id uuid NOT NULL REFERENCES co_load_executions(order_id),confirmation_version integer NOT NULL CHECK(confirmation_version>0),bag_id uuid NOT NULL REFERENCES co_inventory(bag_id),
 bag_snapshot jsonb NOT NULL,confirmed_by uuid NOT NULL REFERENCES users(id),confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(order_id,confirmation_version,bag_id));
CREATE TABLE co_load_exceptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES co_load_executions(order_id),bag_id uuid REFERENCES co_inventory(bag_id),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','RESOLVED')),version integer NOT NULL DEFAULT 1 CHECK(version>0),opened_by uuid NOT NULL REFERENCES users(id),opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resolved_by uuid REFERENCES users(id),resolved_at timestamptz,resolution text,CHECK((state='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution IS NULL) OR(state='RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND length(trim(resolution))>0)));
CREATE TABLE co_departures(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES co_load_executions(order_id),revision integer NOT NULL CHECK(revision>0),prior_id uuid REFERENCES co_departures(id),
 departed_at timestamptz NOT NULL,transport_snapshot jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),note text NOT NULL DEFAULT '',
 UNIQUE(order_id,revision),UNIQUE(prior_id),CHECK((revision=1 AND prior_id IS NULL) OR(revision>1 AND prior_id IS NOT NULL AND length(trim(note))>0)));
ALTER TABLE co_load_executions ADD CONSTRAINT co_execution_departure FOREIGN KEY(departure_id) REFERENCES co_departures(id) DEFERRABLE INITIALLY DEFERRED;
CREATE SEQUENCE co_outbound_number;
CREATE TABLE co_outbounds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE DEFAULT('CO-OUT-'||nextval('co_outbound_number')::text),order_id uuid NOT NULL UNIQUE REFERENCES co_load_executions(order_id),preparation_id uuid NOT NULL UNIQUE REFERENCES co_preparations(id),
 posted_by uuid NOT NULL REFERENCES users(id),posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),snapshot jsonb NOT NULL);
CREATE TABLE co_outbound_bags(
 outbound_id uuid NOT NULL REFERENCES co_outbounds(id),bag_id uuid PRIMARY KEY REFERENCES co_inventory(bag_id),order_id uuid NOT NULL REFERENCES co_loading_orders(id),bag_snapshot jsonb NOT NULL,position_snapshot jsonb NOT NULL);
CREATE TABLE co_execution_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,order_id uuid NOT NULL REFERENCES co_loading_orders(id),entity_type text NOT NULL,entity_id text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),before_data jsonb,after_data jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX co_execution_exceptions_order ON co_load_exceptions(order_id,state);
CREATE INDEX co_outbound_bags_document ON co_outbound_bags(outbound_id,bag_id);
CREATE INDEX co_execution_events_order ON co_execution_events(order_id,id);
CREATE TRIGGER co_execution_events_immutable BEFORE UPDATE OR DELETE ON co_execution_events FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE TRIGGER co_load_bags_immutable BEFORE UPDATE OR DELETE ON co_load_bags FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE TRIGGER co_departures_immutable BEFORE UPDATE OR DELETE ON co_departures FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE TRIGGER co_outbounds_immutable BEFORE UPDATE OR DELETE ON co_outbounds FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE TRIGGER co_outbound_bags_immutable BEFORE UPDATE OR DELETE ON co_outbound_bags FOR EACH ROW EXECUTE FUNCTION co_immutable();

CREATE FUNCTION co_execution_authorized(actor uuid,permission text,load_id uuid,fixed_role text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM co_loading_orders l JOIN co_sales_plans p ON p.id=l.sales_plan_id JOIN users u ON u.id=actor JOIN role_permissions r ON r.role_code=u.role_code AND r.permission_code=permission WHERE l.id=load_id AND u.active AND u.deleted_at IS NULL AND(fixed_role IS NULL OR u.role_code=fixed_role) AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=u.id AND s.project_id=p.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=p.warehouse_id) AND(s.customer_id IS NULL OR s.customer_id=p.customer_id)))$$;
CREATE FUNCTION co_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE l co_loading_orders;e co_load_executions;d co_loading_plans;allowed text[];perm text;fixed_role text;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_EXECUTION_NO_DELETE' USING ERRCODE='23514';END IF;
 SELECT * INTO l FROM co_loading_orders WHERE id=NEW.order_id FOR UPDATE;SELECT * INTO d FROM co_loading_plans WHERE id=l.plan_id;
 IF l.status<>'WAITING' OR l.preparation_id<>NEW.preparation_id OR d.current_load_id IS DISTINCT FROM l.id THEN RAISE EXCEPTION 'CO_EXECUTION_MATCH_REQUIRED' USING ERRCODE='23514';END IF;
 PERFORM co_loading_validate(l.id);
 IF EXISTS(SELECT 1 FROM co_loading_reviews WHERE order_id=l.id AND status='PENDING') THEN RAISE EXCEPTION 'CO_EXECUTION_REVIEW_PENDING' USING ERRCODE='23514';END IF;
 perm:='load:write';allowed:=ARRAY['state','version','updated_by','updated_at','last_action','last_note'];
 IF TG_OP='INSERT' THEN IF NEW.state<>'LOADING' OR NEW.version<>1 OR NEW.last_action<>'START' OR NEW.updated_by<>NEW.started_by OR NEW.confirmation_version IS NOT NULL OR NEW.departure_id IS NOT NULL OR NEW.production_by IS NOT NULL OR NEW.logistics_by IS NOT NULL OR NEW.confirmed_by IS NOT NULL OR NEW.load_reviewed_by IS NOT NULL OR NEW.submitted_by IS NOT NULL THEN RAISE EXCEPTION 'CO_EXECUTION_INIT' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW.version<>OLD.version+1 OR OLD.state='OUTBOUND' THEN RAISE EXCEPTION 'CO_EXECUTION_VERSION_STATE' USING ERRCODE='23514';END IF;
  IF NEW.last_action='CONFIRM' THEN
   IF OLD.state<>'LOADING' OR NEW.state<>'REVIEW_PENDING' OR NEW.confirmation_version<>NEW.version OR NEW.confirmed_by IS DISTINCT FROM NEW.updated_by OR NEW.confirmed_at IS NULL THEN RAISE EXCEPTION 'CO_EXECUTION_STATE' USING ERRCODE='23514';END IF;
   allowed:=allowed||ARRAY['confirmation_version','confirmed_by','confirmed_at','load_reviewed_by','load_reviewed_at'];
  ELSIF NEW.last_action IN('LOAD_APPROVE','LOAD_REJECT') THEN
   perm:='load:review';fixed_role:='site_supervisor';
   IF OLD.state<>'REVIEW_PENDING' OR NEW.state<>(CASE WHEN NEW.last_action='LOAD_APPROVE' THEN 'LOADED' ELSE 'LOADING' END) OR NEW.updated_by IN(OLD.started_by,OLD.confirmed_by,l.created_by,d.created_by) THEN RAISE EXCEPTION 'CO_EXECUTION_INDEPENDENT_REVIEW' USING ERRCODE='23514';END IF;
   IF NEW.last_action='LOAD_APPROVE' AND(NEW.load_reviewed_by IS DISTINCT FROM NEW.updated_by OR NEW.load_reviewed_at IS NULL) THEN RAISE EXCEPTION 'CO_EXECUTION_REVIEW_STAMP' USING ERRCODE='23514';END IF;
   IF NEW.last_action='LOAD_REJECT' AND length(trim(NEW.last_note))=0 THEN RAISE EXCEPTION 'CO_EXECUTION_REASON_REQUIRED' USING ERRCODE='23514';END IF;
   allowed:=allowed||ARRAY['load_reviewed_by','load_reviewed_at'];
  ELSIF NEW.last_action='EXCEPTION' THEN
   IF OLD.state NOT IN('LOADING','REVIEW_PENDING') OR NEW.state<>'LOADING' OR length(trim(NEW.last_note))=0 THEN RAISE EXCEPTION 'CO_EXECUTION_STATE' USING ERRCODE='23514';END IF;
  ELSIF NEW.last_action='DEPART' THEN
   perm:='load:execute';IF OLD.state<>'LOADED' OR NEW.state<>'DEPARTED' OR NEW.departure_id IS NULL THEN RAISE EXCEPTION 'CO_EXECUTION_STATE' USING ERRCODE='23514';END IF;allowed:=allowed||ARRAY['departure_id'];
  ELSIF NEW.last_action='DEPARTURE_CORRECT' THEN
   perm:='outbound:logistics-review';IF OLD.state NOT IN('DEPARTED','OUTBOUND_CORRECTION') OR NEW.state<>'DEPARTED' OR NEW.departure_id IS NOT DISTINCT FROM OLD.departure_id OR length(trim(NEW.last_note))=0 THEN RAISE EXCEPTION 'CO_EXECUTION_STATE' USING ERRCODE='23514';END IF;allowed:=allowed||ARRAY['departure_id','logistics_by','logistics_at'];
  ELSIF NEW.last_action='OUTBOUND_SUBMIT' THEN
   IF OLD.state NOT IN('DEPARTED','OUTBOUND_CORRECTION') OR NEW.state<>'OUTBOUND_PENDING' OR NEW.submitted_by IS DISTINCT FROM NEW.updated_by OR NEW.submitted_at IS NULL OR(OLD.state='OUTBOUND_CORRECTION' AND length(trim(NEW.last_note))=0) THEN RAISE EXCEPTION 'CO_EXECUTION_STATE' USING ERRCODE='23514';END IF;
   allowed:=allowed||ARRAY['submitted_by','submitted_at','logistics_by','logistics_at'];
  ELSIF NEW.last_action IN('LOGISTICS_APPROVE','LOGISTICS_REJECT') THEN
   perm:='outbound:logistics-review';IF OLD.state<>'OUTBOUND_PENDING' OR NEW.state<>(CASE WHEN NEW.last_action='LOGISTICS_APPROVE' THEN 'LOGISTICS_APPROVED' ELSE 'OUTBOUND_CORRECTION' END) OR NEW.updated_by IN(OLD.started_by,OLD.confirmed_by,OLD.submitted_by,l.created_by) THEN RAISE EXCEPTION 'CO_EXECUTION_INDEPENDENT_REVIEW' USING ERRCODE='23514';END IF;
   IF NEW.last_action='LOGISTICS_APPROVE' AND(NEW.logistics_by IS DISTINCT FROM NEW.updated_by OR NEW.logistics_at IS NULL) THEN RAISE EXCEPTION 'CO_EXECUTION_REVIEW_STAMP' USING ERRCODE='23514';END IF;
   IF NEW.last_action='LOGISTICS_REJECT' AND length(trim(NEW.last_note))=0 THEN RAISE EXCEPTION 'CO_EXECUTION_REASON_REQUIRED' USING ERRCODE='23514';END IF;allowed:=allowed||ARRAY['logistics_by','logistics_at'];
  ELSIF NEW.last_action IN('PRODUCTION_APPROVE','PRODUCTION_REJECT') THEN
   perm:='outbound:production-approve';fixed_role:='production_manager';
   IF OLD.state<>'LOGISTICS_APPROVED' OR NEW.state<>(CASE WHEN NEW.last_action='PRODUCTION_APPROVE' THEN 'OUTBOUND' ELSE 'OUTBOUND_CORRECTION' END) OR NEW.updated_by IN(OLD.started_by,OLD.confirmed_by,OLD.submitted_by,OLD.logistics_by,l.created_by,d.created_by,(SELECT actor_id FROM co_departures WHERE id=OLD.departure_id)) THEN RAISE EXCEPTION 'CO_EXECUTION_INDEPENDENT_REVIEW' USING ERRCODE='23514';END IF;
   IF NEW.last_action='PRODUCTION_APPROVE' THEN
    IF NEW.production_by IS DISTINCT FROM NEW.updated_by OR NEW.production_at IS NULL OR coalesce(trim(d.packing_list_no),'')='' OR trim(d.export_license_no)='' THEN RAISE EXCEPTION 'CO_EXECUTION_DOCUMENTS_REQUIRED' USING ERRCODE='23514';END IF;
   ELSIF length(trim(NEW.last_note))=0 THEN RAISE EXCEPTION 'CO_EXECUTION_REASON_REQUIRED' USING ERRCODE='23514';END IF;allowed:=allowed||ARRAY['production_by','production_at'];
  ELSE RAISE EXCEPTION 'CO_EXECUTION_ACTION' USING ERRCODE='23514';END IF;
  IF(to_jsonb(NEW)-allowed) IS DISTINCT FROM(to_jsonb(OLD)-allowed) THEN RAISE EXCEPTION 'CO_EXECUTION_UNRELATED_CHANGE' USING ERRCODE='23514';END IF;
 END IF;
 IF NOT co_execution_authorized(NEW.updated_by,perm,l.id,fixed_role) THEN RAISE EXCEPTION 'CO_EXECUTION_PERMISSION' USING ERRCODE='23514';END IF;
 IF NEW.state<>'LOADING' AND EXISTS(SELECT 1 FROM co_load_exceptions WHERE order_id=l.id AND state='OPEN') THEN RAISE EXCEPTION 'CO_EXECUTION_EXCEPTION_OPEN' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_execution_guard BEFORE INSERT OR UPDATE OR DELETE ON co_load_executions FOR EACH ROW EXECUTE FUNCTION co_execution_guard();

CREATE FUNCTION co_execution_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE e co_load_executions;l co_loading_orders;prior co_departures;b jsonb;BEGIN
 SELECT * INTO e FROM co_load_executions WHERE order_id=NEW.order_id FOR UPDATE;SELECT * INTO l FROM co_loading_orders WHERE id=e.order_id;
 IF TG_TABLE_NAME='co_load_bags' THEN
  IF e.state<>'REVIEW_PENDING' OR NEW.confirmation_version<>e.confirmation_version OR NEW.confirmed_by<>e.confirmed_by THEN RAISE EXCEPTION 'CO_EXECUTION_BAG_CONFIRMATION' USING ERRCODE='23514';END IF;
  SELECT bag_snapshot INTO b FROM co_loading_bag_locks WHERE order_id=e.order_id AND bag_id=NEW.bag_id AND released_at IS NULL;IF b IS NULL THEN RAISE EXCEPTION 'CO_EXECUTION_BAG_CONFIRMATION' USING ERRCODE='23514';END IF;NEW.bag_snapshot:=b;
 ELSIF TG_TABLE_NAME='co_departures' THEN
  IF NEW.departed_at<greatest(e.confirmed_at,e.load_reviewed_at) OR NEW.departed_at>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'CO_EXECUTION_DEPARTURE_DATE' USING ERRCODE='23514';END IF;
  IF NEW.revision=1 THEN IF e.state<>'LOADED' OR NEW.prior_id IS NOT NULL OR NOT co_execution_authorized(NEW.actor_id,'load:execute',e.order_id) THEN RAISE EXCEPTION 'CO_EXECUTION_DEPARTURE_STATE' USING ERRCODE='23514';END IF;
  ELSE SELECT * INTO prior FROM co_departures WHERE id=e.departure_id;IF e.state NOT IN('DEPARTED','OUTBOUND_CORRECTION') OR NEW.revision<>prior.revision+1 OR NEW.prior_id IS DISTINCT FROM prior.id OR NOT co_execution_authorized(NEW.actor_id,'outbound:logistics-review',e.order_id) THEN RAISE EXCEPTION 'CO_EXECUTION_CORRECTION_STATE' USING ERRCODE='23514';END IF;END IF;NEW.transport_snapshot:=l.transport_snapshot;
 ELSE
  IF e.state<>'OUTBOUND' OR NEW.preparation_id<>e.preparation_id OR NEW.posted_by IS DISTINCT FROM e.production_by OR NOT co_execution_authorized(NEW.posted_by,'outbound:production-approve',e.order_id,'production_manager') THEN RAISE EXCEPTION 'CO_EXECUTION_OUTBOUND_STATE' USING ERRCODE='23514';END IF;
  NEW.snapshot:=jsonb_build_object('order',to_jsonb(l),'execution',to_jsonb(e),'departure',(SELECT to_jsonb(d) FROM co_departures d WHERE id=e.departure_id),'plan',(SELECT to_jsonb(p) FROM co_loading_plans p WHERE id=l.plan_id),'sales_plan',(SELECT to_jsonb(p) FROM co_sales_plans p WHERE id=l.sales_plan_id),'customer',(SELECT to_jsonb(c) FROM customers c JOIN co_sales_plans p ON p.customer_id=c.id WHERE p.id=l.sales_plan_id),'contract',(SELECT to_jsonb(k) FROM co_sales_contracts k JOIN co_sales_plans p ON p.contract_id=k.id WHERE p.id=l.sales_plan_id));
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_load_bag_record_guard BEFORE INSERT ON co_load_bags FOR EACH ROW EXECUTE FUNCTION co_execution_record_guard();
CREATE TRIGGER co_departure_record_guard BEFORE INSERT ON co_departures FOR EACH ROW EXECUTE FUNCTION co_execution_record_guard();
CREATE TRIGGER co_outbound_record_guard BEFORE INSERT ON co_outbounds FOR EACH ROW EXECUTE FUNCTION co_execution_record_guard();
CREATE FUNCTION co_outbound_bag_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE o co_outbounds;BEGIN
 SELECT * INTO o FROM co_outbounds WHERE id=NEW.outbound_id;IF NEW.order_id IS DISTINCT FROM o.order_id THEN RAISE EXCEPTION 'CO_EXECUTION_OUTBOUND_BAG' USING ERRCODE='23514';END IF;
 SELECT k.bag_snapshot,to_jsonb(p) INTO NEW.bag_snapshot,NEW.position_snapshot FROM co_loading_bag_locks k JOIN co_positions p ON p.bag_id=k.bag_id WHERE k.order_id=o.order_id AND k.bag_id=NEW.bag_id AND k.released_at IS NULL;
 IF NEW.bag_snapshot IS NULL OR NEW.position_snapshot->>'location_id' IS NULL THEN RAISE EXCEPTION 'CO_EXECUTION_OUTBOUND_BAG' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_outbound_bag_guard BEFORE INSERT ON co_outbound_bags FOR EACH ROW EXECUTE FUNCTION co_outbound_bag_guard();
CREATE FUNCTION co_execution_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE e co_load_executions;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_EXECUTION_NO_DELETE' USING ERRCODE='23514';END IF;SELECT * INTO e FROM co_load_executions WHERE order_id=NEW.order_id FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF e.state NOT IN('LOADING','REVIEW_PENDING') OR NEW.state<>'OPEN' OR NEW.version<>1 OR NOT co_execution_authorized(NEW.opened_by,'load:write',e.order_id) OR(NEW.bag_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM co_loading_bag_locks WHERE order_id=e.order_id AND bag_id=NEW.bag_id AND released_at IS NULL)) THEN RAISE EXCEPTION 'CO_EXECUTION_EXCEPTION_INVALID' USING ERRCODE='23514';END IF;
 ELSE
  IF OLD.state<>'OPEN' OR NEW.state<>'RESOLVED' OR NEW.version<>OLD.version+1 OR coalesce(length(trim(NEW.resolution)),0)=0 OR NEW.resolved_at IS NULL OR NEW.resolved_by=OLD.opened_by OR NOT co_execution_authorized(NEW.resolved_by,'load:review',e.order_id,'site_supervisor') OR(to_jsonb(NEW)-ARRAY['state','version','resolved_by','resolved_at','resolution']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','resolved_by','resolved_at','resolution']) THEN RAISE EXCEPTION 'CO_EXECUTION_EXCEPTION_REVIEW' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_execution_exception_guard BEFORE INSERT OR UPDATE OR DELETE ON co_load_exceptions FOR EACH ROW EXECUTE FUNCTION co_execution_exception_guard();

CREATE FUNCTION co_execution_validate(load_id uuid) RETURNS void LANGUAGE plpgsql AS $$DECLARE e co_load_executions;l co_loading_orders;o co_outbounds;d co_departures;n integer;BEGIN
 SELECT * INTO e FROM co_load_executions WHERE order_id=load_id;IF e.order_id IS NULL THEN RETURN;END IF;SELECT * INTO l FROM co_loading_orders WHERE id=load_id;
 IF e.state<>'OUTBOUND' THEN PERFORM co_loading_validate(load_id);END IF;
 IF e.state NOT IN('LOADING') THEN
  IF EXISTS(SELECT 1 FROM co_load_exceptions WHERE order_id=load_id AND state='OPEN') OR l.bag_count<>(SELECT count(*) FROM co_load_bags WHERE order_id=load_id AND confirmation_version=e.confirmation_version) OR EXISTS(SELECT 1 FROM co_loading_bag_locks k WHERE k.order_id=load_id AND NOT EXISTS(SELECT 1 FROM co_load_bags b WHERE b.order_id=k.order_id AND b.bag_id=k.bag_id AND b.confirmation_version=e.confirmation_version AND b.bag_snapshot=k.bag_snapshot)) THEN RAISE EXCEPTION 'CO_EXECUTION_PARTIAL_OR_EXCEPTION' USING ERRCODE='23514';END IF;
 END IF;
 IF e.departure_id IS NOT NULL THEN SELECT * INTO d FROM co_departures WHERE id=e.departure_id;IF d.order_id IS DISTINCT FROM load_id OR d.transport_snapshot IS DISTINCT FROM l.transport_snapshot THEN RAISE EXCEPTION 'CO_EXECUTION_DEPARTURE_LINK' USING ERRCODE='23514';END IF;END IF;
 IF EXISTS(SELECT 1 FROM co_departures departure_row WHERE departure_row.order_id=load_id AND departure_row.id IS DISTINCT FROM e.departure_id AND NOT EXISTS(SELECT 1 FROM co_departures next WHERE next.prior_id=departure_row.id)) THEN RAISE EXCEPTION 'CO_EXECUTION_ORPHAN_DEPARTURE' USING ERRCODE='23514';END IF;
 IF e.state='OUTBOUND' THEN
  SELECT * INTO o FROM co_outbounds WHERE order_id=load_id;
  IF o.id IS NULL OR l.status<>'OUTBOUND' OR(SELECT status FROM co_loading_plans WHERE id=l.plan_id)<>'OUTBOUND' OR(SELECT count(*) FROM co_outbound_bags WHERE outbound_id=o.id)<>l.bag_count OR EXISTS(SELECT 1 FROM co_inventory i LEFT JOIN co_outbound_bags b ON b.bag_id=i.bag_id WHERE i.preparation_id=e.preparation_id AND(i.status<>'OUTBOUND' OR b.outbound_id IS DISTINCT FROM o.id)) OR EXISTS(SELECT 1 FROM co_loading_bag_locks WHERE order_id=load_id AND released_at IS NULL) OR EXISTS(SELECT 1 FROM co_positions WHERE preparation_id=e.preparation_id AND location_id IS NOT NULL) OR EXISTS(SELECT 1 FROM co_locations WHERE occupied_by=e.preparation_id) THEN RAISE EXCEPTION 'CO_EXECUTION_OUTBOUND_INCOMPLETE' USING ERRCODE='23514';END IF;
 ELSE IF l.status<>'WAITING' OR EXISTS(SELECT 1 FROM co_outbounds WHERE order_id=load_id) OR EXISTS(SELECT 1 FROM co_inventory WHERE preparation_id=e.preparation_id AND status='OUTBOUND') THEN RAISE EXCEPTION 'CO_EXECUTION_EARLY_OUTBOUND' USING ERRCODE='23514';END IF;END IF;
END$$;
CREATE FUNCTION co_execution_integrity() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE load_id uuid;BEGIN
 IF TG_TABLE_NAME='co_inventory' OR TG_TABLE_NAME='co_positions' THEN SELECT order_id INTO load_id FROM co_load_executions WHERE preparation_id=NEW.preparation_id;
 ELSIF TG_TABLE_NAME='co_loading_plans' THEN load_id:=NEW.current_load_id;
 ELSIF TG_TABLE_NAME='co_loading_orders' THEN load_id:=NEW.id;
 ELSE load_id:=(to_jsonb(NEW)->>'order_id')::uuid;END IF;
 IF load_id IS NOT NULL THEN PERFORM co_execution_validate(load_id);END IF;RETURN NULL;
END$$;
CREATE CONSTRAINT TRIGGER co_execution_integrity AFTER INSERT OR UPDATE ON co_load_executions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE CONSTRAINT TRIGGER co_execution_bags_integrity AFTER INSERT ON co_load_bags DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE CONSTRAINT TRIGGER co_execution_departures_integrity AFTER INSERT ON co_departures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE CONSTRAINT TRIGGER co_execution_outbounds_integrity AFTER INSERT ON co_outbounds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE CONSTRAINT TRIGGER co_execution_outbound_bags_integrity AFTER INSERT ON co_outbound_bags DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE CONSTRAINT TRIGGER co_execution_inventory_integrity AFTER UPDATE ON co_inventory DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE CONSTRAINT TRIGGER co_execution_position_integrity AFTER UPDATE ON co_positions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE CONSTRAINT TRIGGER co_execution_order_integrity AFTER UPDATE ON co_loading_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE CONSTRAINT TRIGGER co_execution_plan_integrity AFTER UPDATE ON co_loading_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE CONSTRAINT TRIGGER co_execution_lock_integrity AFTER UPDATE ON co_loading_bag_locks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE CONSTRAINT TRIGGER co_execution_exception_integrity AFTER INSERT OR UPDATE ON co_load_exceptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_execution_integrity();
CREATE FUNCTION co_execution_freeze() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_TABLE_NAME='co_loading_reviews' THEN PERFORM id FROM co_loading_orders WHERE id=NEW.order_id FOR UPDATE;IF EXISTS(SELECT 1 FROM co_load_executions WHERE order_id=NEW.order_id) THEN RAISE EXCEPTION 'CO_EXECUTION_STARTED_NO_REMATCH' USING ERRCODE='23514';END IF;
 ELSE IF EXISTS(SELECT 1 FROM co_load_executions WHERE preparation_id=OLD.preparation_id) THEN RAISE EXCEPTION 'CO_EXECUTION_WORK_FROZEN' USING ERRCODE='23514';END IF;END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_execution_block_reviews BEFORE INSERT ON co_loading_reviews FOR EACH ROW EXECUTE FUNCTION co_execution_freeze();
CREATE TRIGGER co_execution_freeze_work BEFORE UPDATE ON co_work_batches FOR EACH ROW EXECUTE FUNCTION co_execution_freeze();
CREATE TRIGGER co_execution_freeze_bags BEFORE UPDATE ON co_bag_work FOR EACH ROW EXECUTE FUNCTION co_execution_freeze();
CREATE FUNCTION co_execution_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$DECLARE data jsonb;actor uuid;BEGIN
 data:=to_jsonb(NEW);actor:=coalesce((data->>'updated_by')::uuid,(data->>'resolved_by')::uuid,(data->>'opened_by')::uuid,(data->>'actor_id')::uuid,(data->>'posted_by')::uuid,(data->>'confirmed_by')::uuid);
 INSERT INTO public.co_execution_events(order_id,entity_type,entity_id,actor_id,before_data,after_data) VALUES((data->>'order_id')::uuid,TG_TABLE_NAME,coalesce(data->>'id',data->>'order_id'),actor,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,data);RETURN NEW;
END$$;
CREATE TRIGGER co_execution_audit AFTER INSERT OR UPDATE ON co_load_executions FOR EACH ROW EXECUTE FUNCTION co_execution_audit();
CREATE TRIGGER co_execution_exception_audit AFTER INSERT OR UPDATE ON co_load_exceptions FOR EACH ROW EXECUTE FUNCTION co_execution_audit();
CREATE TRIGGER co_execution_departure_audit AFTER INSERT ON co_departures FOR EACH ROW EXECUTE FUNCTION co_execution_audit();
CREATE TRIGGER co_execution_outbound_audit AFTER INSERT ON co_outbounds FOR EACH ROW EXECUTE FUNCTION co_execution_audit();
CREATE TRIGGER co_execution_bag_audit AFTER INSERT ON co_load_bags FOR EACH ROW EXECUTE FUNCTION co_execution_audit();
GRANT SELECT,INSERT,UPDATE ON co_load_executions,co_load_exceptions TO musonoi_app;
GRANT SELECT,INSERT ON co_load_bags,co_departures,co_outbounds,co_outbound_bags TO musonoi_app;
GRANT SELECT ON co_execution_events TO musonoi_app;
GRANT USAGE ON SEQUENCE co_outbound_number TO musonoi_app;

-- Only the controlled formal outbound branch extends earlier cobalt guards.
ALTER TABLE co_inventory DROP CONSTRAINT co_inventory_status_check;
ALTER TABLE co_inventory ADD CONSTRAINT co_inventory_status_check CHECK(status IN('PREPARING','PENDING_COMPLETION_REVIEW','COMPLETED','OUTBOUND'));
ALTER TABLE co_loading_orders DROP CONSTRAINT co_loading_orders_status_check;
ALTER TABLE co_loading_orders ADD CONSTRAINT co_loading_orders_status_check CHECK(status IN('WAITING','CANCELLED','OUTBOUND'));
ALTER TABLE co_loading_plans DROP CONSTRAINT co_loading_plans_status_check;
ALTER TABLE co_loading_plans ADD CONSTRAINT co_loading_plans_status_check CHECK(status IN('DRAFT','MATCHED','OUTBOUND'));
ALTER TABLE co_loading_plans DROP CONSTRAINT co_loading_plans_check;
ALTER TABLE co_loading_plans ADD CONSTRAINT co_loading_plans_check CHECK((status='DRAFT' AND current_load_id IS NULL) OR(status IN('MATCHED','OUTBOUND') AND current_load_id IS NOT NULL));
CREATE OR REPLACE FUNCTION co_loading_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE p co_sales_plans;d co_loading_plans;r co_loading_reviews;a co_vehicle_arrivals;v co_dispatch_vehicles;allowed text[];permission text;BEGIN
 IF TG_OP='UPDATE' AND NEW.status='OUTBOUND' THEN
 IF OLD.status<>'WAITING' OR NEW.version<>OLD.version+1 OR(to_jsonb(NEW)-ARRAY['status','version','updated_by','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','version','updated_by','updated_at']) OR NOT EXISTS(SELECT 1 FROM co_outbounds o JOIN co_load_executions e ON e.order_id=o.order_id WHERE o.order_id=NEW.id AND e.state='OUTBOUND' AND o.posted_by=NEW.updated_by) OR NOT co_execution_authorized(NEW.updated_by,'outbound:production-approve',NEW.id,'production_manager') THEN RAISE EXCEPTION 'CO_EXECUTION_ORDER_POSTING' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_LOADING_NO_DELETE' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM co_sales_plans WHERE id=NEW.sales_plan_id FOR UPDATE;SELECT * INTO d FROM co_loading_plans WHERE id=NEW.plan_id FOR UPDATE;
 permission:='loading-plan:match';
 IF TG_OP='INSERT' THEN
  NEW.plan_snapshot:=to_jsonb(d);IF NEW.status<>'WAITING' OR NEW.version<>1 OR NEW.last_review_id IS NOT NULL OR NEW.updated_by<>NEW.created_by OR d.status<>'DRAFT' OR d.arrival_id<>NEW.arrival_id OR NOT co_work_authorized(NEW.updated_by,'loading-plan:match',NEW.preparation_id) THEN RAISE EXCEPTION 'CO_LOADING_MATCH_INVALID' USING ERRCODE='23514';END IF;
 ELSE
  permission:='co:loading-review';SELECT * INTO r FROM co_loading_reviews WHERE id=NEW.last_review_id FOR UPDATE;
  IF OLD.status<>'WAITING' OR NEW.version<>OLD.version+1 OR NEW.last_review_id IS NOT DISTINCT FROM OLD.last_review_id OR r.status IS DISTINCT FROM 'APPROVED' OR r.order_id<>OLD.id OR r.expected_order_version<>OLD.version OR r.reviewed_by IS DISTINCT FROM NEW.updated_by THEN RAISE EXCEPTION 'CO_LOADING_REVIEW_REQUIRED' USING ERRCODE='23514';END IF;
  allowed:=ARRAY['version','updated_by','updated_at','last_review_id'];
  IF r.kind='CANCEL_MATCH' THEN IF NEW.status<>'CANCELLED' THEN RAISE EXCEPTION 'CO_LOADING_STATE' USING ERRCODE='23514';END IF;allowed:=allowed||ARRAY['status'];
  ELSE IF NEW.status<>OLD.status OR NEW.arrival_id<>r.new_arrival_id OR NEW.arrival_id=OLD.arrival_id THEN RAISE EXCEPTION 'CO_LOADING_STATE' USING ERRCODE='23514';END IF;allowed:=allowed||ARRAY['arrival_id','vehicle_id','truck_key','transport_snapshot'];END IF;
  IF(to_jsonb(NEW)-allowed) IS DISTINCT FROM(to_jsonb(OLD)-allowed) THEN RAISE EXCEPTION 'CO_LOADING_IDENTITY' USING ERRCODE='23514';END IF;
 END IF;
 IF NOT co_sales_authorized(NEW.updated_by,permission,p.project_id,p.warehouse_id,p.customer_id) THEN RAISE EXCEPTION 'CO_LOADING_PERMISSION' USING ERRCODE='23514';END IF;
 IF NEW.status='WAITING' THEN
  SELECT * INTO a FROM co_vehicle_arrivals WHERE id=NEW.arrival_id FOR UPDATE;SELECT * INTO v FROM co_dispatch_vehicles WHERE id=NEW.vehicle_id FOR UPDATE;
  IF NOT co_loading_arrival_valid(NEW.arrival_id,p.id) OR a.dispatch_vehicle_id<>v.id OR NEW.truck_key<>v.truck_key THEN RAISE EXCEPTION 'CO_LOADING_VEHICLE_INVALID' USING ERRCODE='23514';END IF;
  IF TG_OP='UPDATE' THEN IF a.version<>r.new_arrival_version OR v.version<>r.new_vehicle_version THEN RAISE EXCEPTION 'CO_LOADING_TARGET_STALE' USING ERRCODE='23514';END IF;END IF;
  NEW.transport_snapshot:=to_jsonb(a)||jsonb_build_object('truck_no',v.truck_no,'truck_key',v.truck_key,'vehicle_id',v.id);
 END IF;RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION co_loading_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE p co_sales_plans;b co_preparations;permission text;allowed text[];r co_loading_reviews;l co_loading_orders;BEGIN
 IF TG_OP='UPDATE' AND NEW.last_action='POST_OUTBOUND' THEN
 IF OLD.status<>'MATCHED' OR NEW.status<>'OUTBOUND' OR NEW.version<>OLD.version+1 OR(to_jsonb(NEW)-ARRAY['status','version','updated_by','updated_at','last_action','packing_list_no']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','version','updated_by','updated_at','last_action','packing_list_no']) OR NOT EXISTS(SELECT 1 FROM co_loading_orders posted_load JOIN co_outbounds o ON o.order_id=posted_load.id WHERE posted_load.id=NEW.current_load_id AND posted_load.plan_id=NEW.id AND posted_load.status='OUTBOUND' AND o.posted_by=NEW.updated_by) THEN RAISE EXCEPTION 'CO_EXECUTION_PLAN_POSTING' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_LOADING_NO_DELETE' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM co_sales_plans WHERE id=NEW.sales_plan_id FOR UPDATE;SELECT * INTO b FROM co_preparations WHERE id=NEW.preparation_id FOR UPDATE;
 IF p.id IS NULL OR b.id IS NULL OR p.project_id<>b.project_id OR p.warehouse_id<>b.warehouse_id OR b.status<>'RECEIVED' THEN RAISE EXCEPTION 'CO_LOADING_SCOPE' USING ERRCODE='23514';END IF;
 permission:='loading-plan:write';allowed:=ARRAY['preparation_id','arrival_id','planned_load_date','destination','invoice_no','packing_list_no','export_license_no','remark'];
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.current_load_id IS NOT NULL OR NEW.version<>1 OR NEW.last_action<>'CREATE' OR NEW.updated_by<>NEW.created_by OR NOT co_loading_arrival_valid(NEW.arrival_id,p.id) THEN RAISE EXCEPTION 'CO_LOADING_PLAN_INIT' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'CO_LOADING_VERSION' USING ERRCODE='23514';END IF;
  IF NEW.last_action='MATCH' THEN
   permission:='loading-plan:match';allowed:=ARRAY['status','current_load_id'];
   IF OLD.status<>'DRAFT' OR NEW.status<>'MATCHED' THEN RAISE EXCEPTION 'CO_LOADING_STATE' USING ERRCODE='23514';END IF;
  ELSIF NEW.last_action='REVIEW_APPLY' THEN
   permission:='co:loading-review';allowed:=ARRAY['status','current_load_id','arrival_id'];
   SELECT * INTO l FROM co_loading_orders WHERE id=OLD.current_load_id;SELECT * INTO r FROM co_loading_reviews WHERE id=l.last_review_id;
   IF OLD.status<>'MATCHED' OR r.status IS DISTINCT FROM 'APPROVED' OR r.reviewed_by IS DISTINCT FROM NEW.updated_by OR (r.kind='CANCEL_MATCH' AND(NEW.status<>'DRAFT' OR NEW.current_load_id IS NOT NULL)) OR(r.kind='CHANGE_VEHICLE' AND(NEW.status<>'MATCHED' OR NEW.current_load_id<>OLD.current_load_id OR NEW.arrival_id<>r.new_arrival_id)) THEN RAISE EXCEPTION 'CO_LOADING_REVIEW_REQUIRED' USING ERRCODE='23514';END IF;
  ELSIF NEW.last_action='DOCUMENTS' THEN
   IF OLD.status<>'MATCHED' OR NEW.status<>OLD.status THEN RAISE EXCEPTION 'CO_LOADING_STATE' USING ERRCODE='23514';END IF;allowed:=ARRAY['invoice_no','packing_list_no','export_license_no','remark'];
  ELSIF NEW.last_action='SAVE' THEN
   IF OLD.status<>'DRAFT' OR NEW.status<>OLD.status OR NOT co_loading_arrival_valid(NEW.arrival_id,p.id) THEN RAISE EXCEPTION 'CO_LOADING_STATE' USING ERRCODE='23514';END IF;
  ELSE RAISE EXCEPTION 'CO_LOADING_ACTION' USING ERRCODE='23514';END IF;
  -- Generated Packing List number is computed after BEFORE triggers.
  IF (to_jsonb(NEW)-(allowed||ARRAY['version','updated_by','updated_at','last_action','packing_list_no'])) IS DISTINCT FROM(to_jsonb(OLD)-(allowed||ARRAY['version','updated_by','updated_at','last_action','packing_list_no'])) THEN RAISE EXCEPTION 'CO_LOADING_IDENTITY' USING ERRCODE='23514';END IF;
 END IF;
 IF NOT co_sales_authorized(NEW.updated_by,permission,p.project_id,p.warehouse_id,p.customer_id) THEN RAISE EXCEPTION 'CO_LOADING_PERMISSION' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION co_loading_bag_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE l co_loading_orders;r co_loading_reviews;BEGIN
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM co_outbounds o WHERE o.order_id=OLD.order_id) THEN
 IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR NEW.release_reason<>'FORMAL_OUTBOUND' OR(to_jsonb(NEW)-ARRAY['released_at','released_by','release_reason']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['released_at','released_by','release_reason']) OR NOT EXISTS(SELECT 1 FROM co_outbounds o JOIN co_loading_orders posted_load ON posted_load.id=o.order_id JOIN co_outbound_bags b ON b.outbound_id=o.id WHERE o.order_id=NEW.order_id AND b.bag_id=NEW.bag_id AND posted_load.status='OUTBOUND' AND o.posted_by=NEW.released_by) THEN RAISE EXCEPTION 'CO_EXECUTION_LOCK_POSTING' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_LOADING_NO_DELETE' USING ERRCODE='23514';END IF;
 SELECT * INTO l FROM co_loading_orders WHERE id=NEW.order_id FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF l.status<>'WAITING' OR NEW.locked_by<>l.created_by OR NEW.released_at IS NOT NULL THEN RAISE EXCEPTION 'CO_LOADING_LOCK_INVALID' USING ERRCODE='23514';END IF;
  SELECT jsonb_build_object('bag_id',b.id,'bag_no',b.bag_no,'production_batch_code',pb.code,'actual_gross_kg',w.actual_gross_kg::text,'actual_net_kg',w.actual_net_kg::text,'seal_no',w.seal_no,'sampled',w.sampled,'location_id',pos.location_id,'location_code',loc.code,'position_version',pos.version) INTO NEW.bag_snapshot FROM co_bags b JOIN co_preparation_lines line ON line.id=b.line_id JOIN co_production_batches pb ON pb.id=line.production_batch_id JOIN co_bag_work w ON w.bag_id=b.id JOIN co_positions pos ON pos.bag_id=b.id LEFT JOIN co_locations loc ON loc.id=pos.location_id WHERE b.id=NEW.bag_id AND b.preparation_id=NEW.preparation_id;
  IF NEW.bag_snapshot IS NULL THEN RAISE EXCEPTION 'CO_LOADING_BAG_MISSING' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO r FROM co_loading_reviews WHERE id=l.last_review_id;
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR l.status<>'CANCELLED' OR r.kind IS DISTINCT FROM 'CANCEL_MATCH' OR r.status IS DISTINCT FROM 'APPROVED' OR NEW.released_by IS DISTINCT FROM r.reviewed_by OR(to_jsonb(NEW)-ARRAY['released_at','released_by','release_reason']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['released_at','released_by','release_reason']) THEN RAISE EXCEPTION 'CO_LOADING_RELEASE_REVIEW_REQUIRED' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION co_inventory_work_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='UPDATE' AND (NEW.status='OUTBOUND' OR OLD.status='OUTBOUND') THEN
 IF OLD.status<>'COMPLETED' OR NEW.status<>'OUTBOUND' OR(to_jsonb(NEW)-'status') IS DISTINCT FROM(to_jsonb(OLD)-'status') OR NOT EXISTS(SELECT 1 FROM co_outbound_bags b JOIN co_outbounds o ON o.id=b.outbound_id JOIN co_loading_orders l ON l.id=o.order_id JOIN co_load_executions e ON e.order_id=o.order_id WHERE b.bag_id=NEW.bag_id AND o.preparation_id=NEW.preparation_id AND l.status='OUTBOUND' AND e.state='OUTBOUND') THEN RAISE EXCEPTION 'CO_EXECUTION_INVENTORY_POSTING' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM(to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'CO_RECEIPT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.status IS DISTINCT FROM(SELECT status FROM co_work_batches WHERE preparation_id=NEW.preparation_id) THEN RAISE EXCEPTION 'CO_INVENTORY_WORK_STATE_MISMATCH' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE OR REPLACE FUNCTION co_position_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE p co_preparations;w co_work_batches;l co_locations;BEGIN
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM co_inventory WHERE bag_id=OLD.bag_id AND status='OUTBOUND') THEN
 IF OLD.location_id IS NULL OR NEW.location_id IS NOT NULL OR NEW.version<>OLD.version+1 OR(to_jsonb(NEW)-ARRAY['location_id','version','updated_by','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['location_id','version','updated_by','updated_at']) OR NOT EXISTS(SELECT 1 FROM co_outbound_bags b JOIN co_outbounds o ON o.id=b.outbound_id WHERE b.bag_id=OLD.bag_id AND o.posted_by=NEW.updated_by AND b.position_snapshot->>'location_id'=OLD.location_id::text) THEN RAISE EXCEPTION 'CO_EXECUTION_POSITION_POSTING' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_POSITION_NO_DELETE' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN IF NEW.location_id IS NOT NULL OR NEW.version<>1 OR NEW.updated_by IS NOT NULL THEN RAISE EXCEPTION 'CO_POSITION_INIT_ONLY' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
 SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id FOR UPDATE;
 SELECT * INTO w FROM co_work_batches WHERE preparation_id=p.id FOR UPDATE;
 IF NEW.bag_id<>OLD.bag_id OR NEW.preparation_id<>OLD.preparation_id OR NEW.version<>OLD.version+1 OR NEW.location_id IS NOT DISTINCT FROM OLD.location_id OR p.status<>'RECEIVED' OR w.status NOT IN('PREPARING','COMPLETED') OR w.amendment_status='PENDING' OR NOT co_location_authorized(NEW.updated_by,'co:locate',p.project_id,p.warehouse_id) THEN RAISE EXCEPTION 'CO_POSITION_STATE_PERMISSION' USING ERRCODE='23514';END IF;
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
  IF NEW.occupied_by IS NOT NULL AND(NOT NEW.active OR NOT EXISTS(SELECT 1 FROM co_preparations p WHERE p.id=NEW.occupied_by AND p.project_id=NEW.project_id AND p.warehouse_id=NEW.warehouse_id AND p.status='RECEIVED')) THEN RAISE EXCEPTION 'CO_LOCATION_BATCH_SCOPE' USING ERRCODE='23514';END IF;
  IF NOT NEW.active AND EXISTS(SELECT 1 FROM co_positions WHERE location_id=NEW.id) THEN RAISE EXCEPTION 'CO_LOCATION_OCCUPIED' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT NEW.active AND EXISTS(SELECT 1 FROM co_locations l JOIN co_positions p ON p.location_id=l.id WHERE l.zone_id=NEW.id) THEN RAISE EXCEPTION 'CO_ZONE_OCCUPIED' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION co_loading_validate(order_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$DECLARE l co_loading_orders;d co_loading_plans;p co_preparations;w co_work_batches;n integer;g numeric;net numeric;BEGIN
 SELECT * INTO l FROM co_loading_orders WHERE id=order_uuid;IF l.id IS NULL THEN RETURN;END IF;IF l.status='OUTBOUND' THEN PERFORM co_execution_validate(order_uuid);RETURN;END IF;SELECT * INTO d FROM co_loading_plans WHERE id=l.plan_id;
 IF l.bag_count<>(SELECT count(*) FROM co_loading_bag_locks WHERE order_id=l.id) THEN RAISE EXCEPTION 'CO_LOADING_PARTIAL_BATCH_FORBIDDEN' USING ERRCODE='23514';END IF;
 IF l.status='CANCELLED' THEN IF EXISTS(SELECT 1 FROM co_loading_bag_locks WHERE order_id=l.id AND released_at IS NULL) THEN RAISE EXCEPTION 'CO_LOADING_RELEASE_INCOMPLETE' USING ERRCODE='23514';END IF;RETURN;END IF;
 SELECT * INTO p FROM co_preparations WHERE id=l.preparation_id;SELECT * INTO w FROM co_work_batches WHERE preparation_id=p.id;
 IF d.status<>'MATCHED' OR d.current_load_id IS DISTINCT FROM l.id OR d.arrival_id<>l.arrival_id OR p.status<>'RECEIVED' OR w.status IS DISTINCT FROM 'COMPLETED' OR w.amendment_status='PENDING' OR l.cobalt_grade_pct IS DISTINCT FROM w.cobalt_grade_pct OR l.arecoms_input IS DISTINCT FROM w.arecoms_input THEN RAISE EXCEPTION 'CO_LOADING_BATCH_NOT_READY' USING ERRCODE='23514';END IF;
 SELECT count(*),sum(bw.actual_gross_kg),sum(bw.actual_net_kg) INTO n,g,net FROM co_inventory i JOIN co_bag_work bw ON bw.bag_id=i.bag_id WHERE i.preparation_id=p.id AND i.status='COMPLETED' AND NOT i.loading_eligible AND bw.actual_gross_kg IS NOT NULL AND bw.seal_no IS NOT NULL AND bw.sampled;
 IF n<>p.bag_count OR l.bag_count<>n OR l.actual_gross_kg IS DISTINCT FROM g OR l.actual_net_kg IS DISTINCT FROM net OR (SELECT count(*) FROM co_loading_bag_locks WHERE order_id=l.id AND released_at IS NULL)<>n OR EXISTS(SELECT 1 FROM co_inventory i WHERE i.preparation_id=p.id AND NOT EXISTS(SELECT 1 FROM co_loading_bag_locks k WHERE k.order_id=l.id AND k.bag_id=i.bag_id AND k.released_at IS NULL)) THEN RAISE EXCEPTION 'CO_LOADING_PARTIAL_BATCH_FORBIDDEN' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM co_loading_bag_locks k LEFT JOIN co_positions pos ON pos.bag_id=k.bag_id LEFT JOIN co_locations loc ON loc.id=pos.location_id LEFT JOIN co_zones z ON z.id=loc.zone_id WHERE k.order_id=l.id AND(pos.bag_id IS NULL OR loc.id IS NULL OR NOT loc.active OR NOT z.active OR loc.occupied_by IS DISTINCT FROM p.id OR loc.project_id<>p.project_id OR loc.warehouse_id<>p.warehouse_id OR k.bag_snapshot->>'location_id' IS DISTINCT FROM loc.id::text)) THEN RAISE EXCEPTION 'CO_LOADING_POSITION_INVALID' USING ERRCODE='23514';END IF;
END$$;

CREATE OR REPLACE FUNCTION co_loading_freeze() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE prep uuid;BEGIN
 IF TG_TABLE_NAME IN('co_positions','co_bag_work','co_work_batches') THEN
  prep:=OLD.preparation_id;PERFORM id FROM co_preparations WHERE id=prep FOR UPDATE;
  IF EXISTS(SELECT 1 FROM co_loading_orders WHERE preparation_id=prep AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_OCCUPIED' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_vehicle_arrivals' THEN IF EXISTS(SELECT 1 FROM co_loading_orders WHERE arrival_id=OLD.id AND status IN('WAITING','OUTBOUND')) THEN RAISE EXCEPTION 'CO_LOADING_ARRIVAL_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_sales_plans' THEN IF EXISTS(SELECT 1 FROM co_loading_orders WHERE sales_plan_id=OLD.id AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_SALES_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_sales_contracts' THEN IF EXISTS(SELECT 1 FROM co_loading_orders l JOIN co_sales_plans p ON p.id=l.sales_plan_id WHERE p.contract_id=OLD.id AND l.status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_CONTRACT_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_locations' THEN IF EXISTS(SELECT 1 FROM co_positions p JOIN co_loading_bag_locks k ON k.bag_id=p.bag_id AND k.released_at IS NULL WHERE p.location_id=OLD.id) THEN RAISE EXCEPTION 'CO_LOADING_LOCATION_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_zones' THEN IF EXISTS(SELECT 1 FROM co_positions p JOIN co_locations loc ON loc.id=p.location_id JOIN co_loading_bag_locks k ON k.bag_id=p.bag_id AND k.released_at IS NULL WHERE loc.zone_id=OLD.id) THEN RAISE EXCEPTION 'CO_LOADING_LOCATION_FROZEN' USING ERRCODE='23514';END IF;
 ELSE IF EXISTS(SELECT 1 FROM co_loading_orders WHERE vehicle_id=OLD.id AND status IN('WAITING','OUTBOUND')) THEN RAISE EXCEPTION 'CO_LOADING_VEHICLE_FROZEN' USING ERRCODE='23514';END IF;END IF;RETURN NEW;
END$$;

CREATE OR REPLACE FUNCTION co_loading_arrival_valid(arrival uuid,sales uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM co_vehicle_arrivals a JOIN co_dispatch_vehicles v ON v.id=a.dispatch_vehicle_id JOIN co_sales_plans p ON p.id=a.sales_plan_id JOIN co_sales_contracts k ON k.id=p.contract_id JOIN customers c ON c.id=p.customer_id WHERE a.id=arrival AND a.sales_plan_id=sales AND v.sales_plan_id=sales AND v.cancelled_at IS NULL AND NOT EXISTS(SELECT 1 FROM co_loading_orders used JOIN co_load_executions e ON e.order_id=used.id WHERE used.arrival_id=a.id AND e.departure_id IS NOT NULL) AND p.status='OPEN' AND c.active AND k.active AND (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date BETWEEN k.effective_date AND k.end_date)$$;
