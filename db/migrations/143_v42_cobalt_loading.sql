-- Independent cobalt pre-loading documents and reservations. No copper or receipt/state rules replaced.
CREATE SEQUENCE co_loading_plan_number;
CREATE SEQUENCE co_loading_order_number;
CREATE TABLE co_loading_plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),
 code text NOT NULL UNIQUE DEFAULT('CO-LP-'||nextval('co_loading_plan_number')::text),sales_plan_id uuid NOT NULL REFERENCES co_sales_plans(id),preparation_id uuid NOT NULL REFERENCES co_preparations(id),arrival_id uuid NOT NULL REFERENCES co_vehicle_arrivals(id),
 planned_load_date date NOT NULL,destination text NOT NULL CHECK(length(trim(destination)) BETWEEN 1 AND 1000),invoice_no text CHECK(length(trim(invoice_no)) BETWEEN 1 AND 77),
 packing_list_no text GENERATED ALWAYS AS(CASE WHEN invoice_no IS NULL THEN NULL ELSE invoice_no||'-PL' END) STORED,export_license_no text NOT NULL DEFAULT '' CHECK(length(export_license_no)<=160),remark text NOT NULL DEFAULT '' CHECK(length(remark)<=1000),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','MATCHED')),current_load_id uuid,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_action text NOT NULL DEFAULT 'CREATE',
 CHECK((status='DRAFT' AND current_load_id IS NULL) OR(status='MATCHED' AND current_load_id IS NOT NULL)),UNIQUE(id,preparation_id,sales_plan_id));
CREATE TABLE co_loading_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),code text NOT NULL UNIQUE DEFAULT('CO-LOAD-'||nextval('co_loading_order_number')::text),
 plan_id uuid NOT NULL,preparation_id uuid NOT NULL,sales_plan_id uuid NOT NULL,FOREIGN KEY(plan_id,preparation_id,sales_plan_id) REFERENCES co_loading_plans(id,preparation_id,sales_plan_id),
 arrival_id uuid NOT NULL REFERENCES co_vehicle_arrivals(id),vehicle_id uuid NOT NULL REFERENCES co_dispatch_vehicles(id),truck_key text NOT NULL,transport_snapshot jsonb NOT NULL,plan_snapshot jsonb NOT NULL,
 bag_count integer NOT NULL CHECK(bag_count BETWEEN 1 AND 10000),actual_gross_kg numeric NOT NULL CHECK(actual_gross_kg>0),actual_net_kg numeric NOT NULL CHECK(actual_net_kg>0),cobalt_grade_pct numeric NOT NULL CHECK(cobalt_grade_pct>0 AND cobalt_grade_pct<=100),arecoms_input text NOT NULL,
 status text NOT NULL DEFAULT 'WAITING' CHECK(status IN('WAITING','CANCELLED')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_review_id uuid,
 UNIQUE(id,preparation_id));
ALTER TABLE co_loading_plans ADD CONSTRAINT co_loading_current_order FOREIGN KEY(current_load_id) REFERENCES co_loading_orders(id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX co_loading_one_plan ON co_loading_orders(plan_id) WHERE status='WAITING';
CREATE UNIQUE INDEX co_loading_one_batch ON co_loading_orders(preparation_id) WHERE status='WAITING';
CREATE UNIQUE INDEX co_loading_one_vehicle ON co_loading_orders(vehicle_id) WHERE status='WAITING';
CREATE UNIQUE INDEX co_loading_one_arrival ON co_loading_orders(arrival_id) WHERE status='WAITING';
CREATE UNIQUE INDEX co_loading_one_truck ON co_loading_orders(truck_key) WHERE status='WAITING';
CREATE TABLE co_loading_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES co_loading_orders(id),kind text NOT NULL CHECK(kind IN('CHANGE_VEHICLE','CANCEL_MATCH')),
 expected_order_version integer NOT NULL CHECK(expected_order_version>0),new_arrival_id uuid REFERENCES co_vehicle_arrivals(id),new_arrival_version integer,new_vehicle_version integer,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 requested_by uuid NOT NULL REFERENCES users(id),requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,review_note text,
 CHECK((kind='CANCEL_MATCH' AND new_arrival_id IS NULL AND new_arrival_version IS NULL AND new_vehicle_version IS NULL) OR(kind='CHANGE_VEHICLE' AND new_arrival_id IS NOT NULL AND new_arrival_version>0 AND new_vehicle_version>0)),
 CHECK((status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR(status<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),CHECK(status<>'REJECTED' OR length(trim(review_note))>0));
CREATE UNIQUE INDEX co_loading_one_pending_review ON co_loading_reviews(order_id) WHERE status='PENDING';
ALTER TABLE co_loading_orders ADD CONSTRAINT co_loading_last_review FOREIGN KEY(last_review_id) REFERENCES co_loading_reviews(id);
CREATE TABLE co_loading_bag_locks(
 order_id uuid NOT NULL,bag_id uuid NOT NULL REFERENCES co_inventory(bag_id),preparation_id uuid NOT NULL,
 FOREIGN KEY(order_id,preparation_id) REFERENCES co_loading_orders(id,preparation_id),FOREIGN KEY(bag_id,preparation_id) REFERENCES co_bags(id,preparation_id),PRIMARY KEY(order_id,bag_id),
 bag_snapshot jsonb NOT NULL,locked_by uuid NOT NULL REFERENCES users(id),locked_at timestamptz NOT NULL DEFAULT clock_timestamp(),released_at timestamptz,released_by uuid REFERENCES users(id),release_reason text,
 CHECK((released_at IS NULL AND released_by IS NULL AND release_reason IS NULL) OR(released_at IS NOT NULL AND released_by IS NOT NULL AND length(trim(release_reason))>0)));
CREATE UNIQUE INDEX co_loading_one_bag ON co_loading_bag_locks(bag_id) WHERE released_at IS NULL;
CREATE INDEX co_loading_bag_batch ON co_loading_bag_locks(preparation_id,order_id);
CREATE TABLE co_loading_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,plan_id uuid NOT NULL REFERENCES co_loading_plans(id),order_id uuid REFERENCES co_loading_orders(id),entity_type text NOT NULL,entity_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),before_data jsonb,after_data jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX co_loading_events_plan ON co_loading_events(plan_id,id);
CREATE TRIGGER co_loading_events_immutable BEFORE UPDATE OR DELETE ON co_loading_events FOR EACH ROW EXECUTE FUNCTION co_immutable();

CREATE FUNCTION co_loading_arrival_valid(arrival uuid,sales uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM co_vehicle_arrivals a JOIN co_dispatch_vehicles v ON v.id=a.dispatch_vehicle_id JOIN co_sales_plans p ON p.id=a.sales_plan_id JOIN co_sales_contracts k ON k.id=p.contract_id JOIN customers c ON c.id=p.customer_id WHERE a.id=arrival AND a.sales_plan_id=sales AND v.sales_plan_id=sales AND v.cancelled_at IS NULL AND p.status='OPEN' AND c.active AND k.active AND (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date BETWEEN k.effective_date AND k.end_date)$$;
CREATE FUNCTION co_loading_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE p co_sales_plans;b co_preparations;permission text;allowed text[];r co_loading_reviews;l co_loading_orders;BEGIN
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
CREATE TRIGGER co_loading_plan_guard BEFORE INSERT OR UPDATE OR DELETE ON co_loading_plans FOR EACH ROW EXECUTE FUNCTION co_loading_plan_guard();
CREATE FUNCTION co_loading_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE p co_sales_plans;d co_loading_plans;r co_loading_reviews;a co_vehicle_arrivals;v co_dispatch_vehicles;allowed text[];permission text;BEGIN
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
CREATE TRIGGER co_loading_order_guard BEFORE INSERT OR UPDATE OR DELETE ON co_loading_orders FOR EACH ROW EXECUTE FUNCTION co_loading_order_guard();
CREATE FUNCTION co_loading_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE l co_loading_orders;d co_loading_plans;p co_sales_plans;u users;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_LOADING_NO_DELETE' USING ERRCODE='23514';END IF;
 SELECT * INTO l FROM co_loading_orders WHERE id=NEW.order_id FOR UPDATE;SELECT * INTO d FROM co_loading_plans WHERE id=l.plan_id;SELECT * INTO p FROM co_sales_plans WHERE id=l.sales_plan_id;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING' OR NEW.version<>1 OR l.status<>'WAITING' OR NEW.expected_order_version<>l.version OR NOT co_sales_authorized(NEW.requested_by,'loading-plan:match',p.project_id,p.warehouse_id,p.customer_id) THEN RAISE EXCEPTION 'CO_LOADING_REQUEST_INVALID' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO u FROM users WHERE id=NEW.reviewed_by;
  IF OLD.status<>'PENDING' OR NEW.status NOT IN('APPROVED','REJECTED') OR NEW.version<>OLD.version+1 OR(to_jsonb(NEW)-ARRAY['status','version','reviewed_by','reviewed_at','review_note']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','version','reviewed_by','reviewed_at','review_note']) OR u.role_code IS DISTINCT FROM 'site_supervisor' OR NEW.reviewed_by IN(OLD.requested_by,l.created_by,d.created_by) OR NOT co_sales_authorized(NEW.reviewed_by,'co:loading-review',p.project_id,p.warehouse_id,p.customer_id) THEN RAISE EXCEPTION 'CO_LOADING_INDEPENDENT_SUPERVISOR_REQUIRED' USING ERRCODE='23514';END IF;
  IF l.status<>'WAITING' OR l.version<>NEW.expected_order_version THEN RAISE EXCEPTION 'CO_LOADING_VERSION' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_loading_review_guard BEFORE INSERT OR UPDATE OR DELETE ON co_loading_reviews FOR EACH ROW EXECUTE FUNCTION co_loading_review_guard();
CREATE FUNCTION co_loading_bag_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE l co_loading_orders;r co_loading_reviews;BEGIN
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
CREATE TRIGGER co_loading_bag_guard BEFORE INSERT OR UPDATE OR DELETE ON co_loading_bag_locks FOR EACH ROW EXECUTE FUNCTION co_loading_bag_guard();

CREATE FUNCTION co_loading_validate(order_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$DECLARE l co_loading_orders;d co_loading_plans;p co_preparations;w co_work_batches;n integer;g numeric;net numeric;BEGIN
 SELECT * INTO l FROM co_loading_orders WHERE id=order_uuid;IF l.id IS NULL THEN RETURN;END IF;SELECT * INTO d FROM co_loading_plans WHERE id=l.plan_id;
 IF l.bag_count<>(SELECT count(*) FROM co_loading_bag_locks WHERE order_id=l.id) THEN RAISE EXCEPTION 'CO_LOADING_PARTIAL_BATCH_FORBIDDEN' USING ERRCODE='23514';END IF;
 IF l.status='CANCELLED' THEN IF EXISTS(SELECT 1 FROM co_loading_bag_locks WHERE order_id=l.id AND released_at IS NULL) THEN RAISE EXCEPTION 'CO_LOADING_RELEASE_INCOMPLETE' USING ERRCODE='23514';END IF;RETURN;END IF;
 SELECT * INTO p FROM co_preparations WHERE id=l.preparation_id;SELECT * INTO w FROM co_work_batches WHERE preparation_id=p.id;
 IF d.status<>'MATCHED' OR d.current_load_id IS DISTINCT FROM l.id OR d.arrival_id<>l.arrival_id OR p.status<>'RECEIVED' OR w.status IS DISTINCT FROM 'COMPLETED' OR w.amendment_status='PENDING' OR l.cobalt_grade_pct IS DISTINCT FROM w.cobalt_grade_pct OR l.arecoms_input IS DISTINCT FROM w.arecoms_input THEN RAISE EXCEPTION 'CO_LOADING_BATCH_NOT_READY' USING ERRCODE='23514';END IF;
 SELECT count(*),sum(bw.actual_gross_kg),sum(bw.actual_net_kg) INTO n,g,net FROM co_inventory i JOIN co_bag_work bw ON bw.bag_id=i.bag_id WHERE i.preparation_id=p.id AND i.status='COMPLETED' AND NOT i.loading_eligible AND bw.actual_gross_kg IS NOT NULL AND bw.seal_no IS NOT NULL AND bw.sampled;
 IF n<>p.bag_count OR l.bag_count<>n OR l.actual_gross_kg IS DISTINCT FROM g OR l.actual_net_kg IS DISTINCT FROM net OR (SELECT count(*) FROM co_loading_bag_locks WHERE order_id=l.id AND released_at IS NULL)<>n OR EXISTS(SELECT 1 FROM co_inventory i WHERE i.preparation_id=p.id AND NOT EXISTS(SELECT 1 FROM co_loading_bag_locks k WHERE k.order_id=l.id AND k.bag_id=i.bag_id AND k.released_at IS NULL)) THEN RAISE EXCEPTION 'CO_LOADING_PARTIAL_BATCH_FORBIDDEN' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM co_loading_bag_locks k LEFT JOIN co_positions pos ON pos.bag_id=k.bag_id LEFT JOIN co_locations loc ON loc.id=pos.location_id LEFT JOIN co_zones z ON z.id=loc.zone_id WHERE k.order_id=l.id AND(pos.bag_id IS NULL OR loc.id IS NULL OR NOT loc.active OR NOT z.active OR loc.occupied_by IS DISTINCT FROM p.id OR loc.project_id<>p.project_id OR loc.warehouse_id<>p.warehouse_id OR k.bag_snapshot->>'location_id' IS DISTINCT FROM loc.id::text)) THEN RAISE EXCEPTION 'CO_LOADING_POSITION_INVALID' USING ERRCODE='23514';END IF;
END$$;
CREATE FUNCTION co_loading_integrity() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE key uuid;r co_loading_reviews;d co_loading_plans;BEGIN
 IF TG_TABLE_NAME='co_loading_orders' THEN key:=NEW.id;
 ELSIF TG_TABLE_NAME='co_loading_bag_locks' THEN key:=NEW.order_id;
 ELSIF TG_TABLE_NAME='co_loading_reviews' THEN
  SELECT * INTO r FROM co_loading_reviews WHERE id=NEW.id;key:=r.order_id;
  IF r.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM co_loading_orders WHERE id=r.order_id AND last_review_id=r.id) THEN RAISE EXCEPTION 'CO_LOADING_APPROVAL_NOT_APPLIED' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO d FROM co_loading_plans WHERE id=NEW.id;IF d.status='DRAFT' AND EXISTS(SELECT 1 FROM co_loading_orders WHERE plan_id=NEW.id AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_PLAN_STATE' USING ERRCODE='23514';END IF;
  key:=d.current_load_id;
 END IF;
 IF key IS NOT NULL THEN PERFORM co_loading_validate(key);END IF;RETURN NULL;
END$$;
CREATE CONSTRAINT TRIGGER co_loading_order_integrity AFTER INSERT OR UPDATE ON co_loading_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_loading_integrity();
CREATE CONSTRAINT TRIGGER co_loading_bag_integrity AFTER INSERT OR UPDATE ON co_loading_bag_locks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_loading_integrity();
CREATE CONSTRAINT TRIGGER co_loading_plan_integrity AFTER INSERT OR UPDATE ON co_loading_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_loading_integrity();
CREATE CONSTRAINT TRIGGER co_loading_review_integrity AFTER INSERT OR UPDATE ON co_loading_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_loading_integrity();

-- Additional locks, never remove/replace earlier identity, work, sales or position guards.
CREATE FUNCTION co_loading_freeze() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE prep uuid;BEGIN
 IF TG_TABLE_NAME IN('co_positions','co_bag_work','co_work_batches') THEN
  prep:=OLD.preparation_id;PERFORM id FROM co_preparations WHERE id=prep FOR UPDATE;
  IF EXISTS(SELECT 1 FROM co_loading_orders WHERE preparation_id=prep AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_OCCUPIED' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_vehicle_arrivals' THEN IF EXISTS(SELECT 1 FROM co_loading_orders WHERE arrival_id=OLD.id AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_ARRIVAL_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_sales_plans' THEN IF EXISTS(SELECT 1 FROM co_loading_orders WHERE sales_plan_id=OLD.id AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_SALES_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_sales_contracts' THEN IF EXISTS(SELECT 1 FROM co_loading_orders l JOIN co_sales_plans p ON p.id=l.sales_plan_id WHERE p.contract_id=OLD.id AND l.status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_CONTRACT_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_locations' THEN IF EXISTS(SELECT 1 FROM co_positions p JOIN co_loading_bag_locks k ON k.bag_id=p.bag_id AND k.released_at IS NULL WHERE p.location_id=OLD.id) THEN RAISE EXCEPTION 'CO_LOADING_LOCATION_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_zones' THEN IF EXISTS(SELECT 1 FROM co_positions p JOIN co_locations loc ON loc.id=p.location_id JOIN co_loading_bag_locks k ON k.bag_id=p.bag_id AND k.released_at IS NULL WHERE loc.zone_id=OLD.id) THEN RAISE EXCEPTION 'CO_LOADING_LOCATION_FROZEN' USING ERRCODE='23514';END IF;
 ELSE IF EXISTS(SELECT 1 FROM co_loading_orders WHERE vehicle_id=OLD.id AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_VEHICLE_FROZEN' USING ERRCODE='23514';END IF;END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_loading_freeze_position BEFORE UPDATE ON co_positions FOR EACH ROW EXECUTE FUNCTION co_loading_freeze();
CREATE TRIGGER co_loading_freeze_bag_work BEFORE UPDATE ON co_bag_work FOR EACH ROW EXECUTE FUNCTION co_loading_freeze();
CREATE TRIGGER co_loading_freeze_work_batch BEFORE UPDATE ON co_work_batches FOR EACH ROW EXECUTE FUNCTION co_loading_freeze();
CREATE TRIGGER co_loading_freeze_arrival BEFORE UPDATE ON co_vehicle_arrivals FOR EACH ROW EXECUTE FUNCTION co_loading_freeze();
CREATE TRIGGER co_loading_freeze_vehicle BEFORE UPDATE ON co_dispatch_vehicles FOR EACH ROW EXECUTE FUNCTION co_loading_freeze();
CREATE TRIGGER co_loading_freeze_sales BEFORE UPDATE ON co_sales_plans FOR EACH ROW EXECUTE FUNCTION co_loading_freeze();
CREATE TRIGGER co_loading_freeze_contract BEFORE UPDATE ON co_sales_contracts FOR EACH ROW EXECUTE FUNCTION co_loading_freeze();
CREATE TRIGGER co_loading_freeze_location BEFORE UPDATE ON co_locations FOR EACH ROW EXECUTE FUNCTION co_loading_freeze();
CREATE TRIGGER co_loading_freeze_zone BEFORE UPDATE ON co_zones FOR EACH ROW EXECUTE FUNCTION co_loading_freeze();
CREATE FUNCTION co_loading_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$DECLARE plan uuid;load uuid;actor uuid;data jsonb;BEGIN data:=to_jsonb(NEW);
 IF TG_TABLE_NAME='co_loading_plans' THEN plan:=NEW.id;load:=NEW.current_load_id;actor:=NEW.updated_by;
 ELSIF TG_TABLE_NAME='co_loading_orders' THEN plan:=NEW.plan_id;load:=NEW.id;actor:=NEW.updated_by;
 ELSE load:=(data->>'order_id')::uuid;SELECT plan_id INTO plan FROM public.co_loading_orders WHERE id=load;
 IF TG_TABLE_NAME='co_loading_reviews' THEN actor:=coalesce(NEW.reviewed_by,NEW.requested_by);ELSE actor:=coalesce(NEW.released_by,NEW.locked_by);END IF;END IF;
 INSERT INTO public.co_loading_events(plan_id,order_id,entity_type,entity_id,actor_id,before_data,after_data) VALUES(plan,load,TG_TABLE_NAME,CASE WHEN TG_TABLE_NAME='co_loading_bag_locks' THEN (data->>'bag_id')::uuid ELSE (data->>'id')::uuid END,actor,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,data);RETURN NEW;
END$$;
CREATE TRIGGER co_loading_plan_audit AFTER INSERT OR UPDATE ON co_loading_plans FOR EACH ROW EXECUTE FUNCTION co_loading_audit();
CREATE TRIGGER co_loading_order_audit AFTER INSERT OR UPDATE ON co_loading_orders FOR EACH ROW EXECUTE FUNCTION co_loading_audit();
CREATE TRIGGER co_loading_bag_audit AFTER INSERT OR UPDATE ON co_loading_bag_locks FOR EACH ROW EXECUTE FUNCTION co_loading_audit();
CREATE TRIGGER co_loading_review_audit AFTER INSERT OR UPDATE ON co_loading_reviews FOR EACH ROW EXECUTE FUNCTION co_loading_audit();
INSERT INTO permissions(code) VALUES('co:loading-review');
INSERT INTO role_permission_caps SELECT r.code,'co:loading-review' FROM roles r WHERE r.code IN('admin','site_supervisor') AND EXISTS(SELECT 1 FROM role_permissions p WHERE p.role_code=r.code AND p.permission_code='load:review');
INSERT INTO role_permissions SELECT role_code,permission_code FROM role_permission_caps WHERE permission_code='co:loading-review';
GRANT SELECT,INSERT,UPDATE ON co_loading_plans,co_loading_orders,co_loading_reviews TO musonoi_app;
GRANT SELECT,INSERT ON co_loading_bag_locks TO musonoi_app;
GRANT UPDATE(released_at,released_by,release_reason) ON co_loading_bag_locks TO musonoi_app;
GRANT SELECT ON co_loading_events TO musonoi_app;
GRANT USAGE ON SEQUENCE co_loading_plan_number,co_loading_order_number TO musonoi_app;
