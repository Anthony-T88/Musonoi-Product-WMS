-- TEST only. Execute in a transaction. No used execution/history may be erased.
SELECT pg_advisory_xact_lock(21001);SELECT pg_advisory_xact_lock(21002);
LOCK TABLE co_load_bags,co_load_exceptions,co_departures,co_outbound_bags,co_outbounds,co_execution_events,co_load_executions IN ACCESS EXCLUSIVE MODE;
DO $$BEGIN IF (SELECT environment FROM system_info)<>'test' OR EXISTS(SELECT 1 FROM co_load_bags) OR EXISTS(SELECT 1 FROM co_load_exceptions) OR EXISTS(SELECT 1 FROM co_departures) OR EXISTS(SELECT 1 FROM co_outbound_bags) OR EXISTS(SELECT 1 FROM co_outbounds) OR EXISTS(SELECT 1 FROM co_execution_events) OR EXISTS(SELECT 1 FROM co_load_executions) OR EXISTS(SELECT 1 FROM co_requests WHERE route LIKE '%/cobalt/execution/%') THEN RAISE EXCEPTION 'V43_USED_DATA_ROLLBACK_REFUSED';END IF;END$$;
DROP TRIGGER co_execution_inventory_integrity ON co_inventory;
DROP TRIGGER co_execution_position_integrity ON co_positions;
DROP TRIGGER co_execution_order_integrity ON co_loading_orders;
DROP TRIGGER co_execution_plan_integrity ON co_loading_plans;
DROP TRIGGER co_execution_lock_integrity ON co_loading_bag_locks;
DROP TRIGGER co_execution_block_reviews ON co_loading_reviews;
DROP TRIGGER co_execution_freeze_work ON co_work_batches;
DROP TRIGGER co_execution_freeze_bags ON co_bag_work;
CREATE OR REPLACE FUNCTION public.co_loading_order_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$DECLARE p co_sales_plans;d co_loading_plans;r co_loading_reviews;a co_vehicle_arrivals;v co_dispatch_vehicles;allowed text[];permission text;BEGIN
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
END$function$
;
CREATE OR REPLACE FUNCTION public.co_loading_plan_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$DECLARE p co_sales_plans;b co_preparations;permission text;allowed text[];r co_loading_reviews;l co_loading_orders;BEGIN
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
END$function$
;
CREATE OR REPLACE FUNCTION public.co_loading_bag_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$DECLARE l co_loading_orders;r co_loading_reviews;BEGIN
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
END$function$
;
CREATE OR REPLACE FUNCTION public.co_inventory_work_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM(to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'CO_RECEIPT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.status IS DISTINCT FROM(SELECT status FROM co_work_batches WHERE preparation_id=NEW.preparation_id) THEN RAISE EXCEPTION 'CO_INVENTORY_WORK_STATE_MISMATCH' USING ERRCODE='23514';END IF;RETURN NEW;END$function$
;
CREATE OR REPLACE FUNCTION public.co_position_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$DECLARE p co_preparations;w co_work_batches;l co_locations;BEGIN
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
END$function$
;
CREATE OR REPLACE FUNCTION public.co_location_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$DECLARE permission text;BEGIN
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
END$function$
;
CREATE OR REPLACE FUNCTION public.co_loading_validate(order_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$DECLARE l co_loading_orders;d co_loading_plans;p co_preparations;w co_work_batches;n integer;g numeric;net numeric;BEGIN
 SELECT * INTO l FROM co_loading_orders WHERE id=order_uuid;IF l.id IS NULL THEN RETURN;END IF;SELECT * INTO d FROM co_loading_plans WHERE id=l.plan_id;
 IF l.bag_count<>(SELECT count(*) FROM co_loading_bag_locks WHERE order_id=l.id) THEN RAISE EXCEPTION 'CO_LOADING_PARTIAL_BATCH_FORBIDDEN' USING ERRCODE='23514';END IF;
 IF l.status='CANCELLED' THEN IF EXISTS(SELECT 1 FROM co_loading_bag_locks WHERE order_id=l.id AND released_at IS NULL) THEN RAISE EXCEPTION 'CO_LOADING_RELEASE_INCOMPLETE' USING ERRCODE='23514';END IF;RETURN;END IF;
 SELECT * INTO p FROM co_preparations WHERE id=l.preparation_id;SELECT * INTO w FROM co_work_batches WHERE preparation_id=p.id;
 IF d.status<>'MATCHED' OR d.current_load_id IS DISTINCT FROM l.id OR d.arrival_id<>l.arrival_id OR p.status<>'RECEIVED' OR w.status IS DISTINCT FROM 'COMPLETED' OR w.amendment_status='PENDING' OR l.cobalt_grade_pct IS DISTINCT FROM w.cobalt_grade_pct OR l.arecoms_input IS DISTINCT FROM w.arecoms_input THEN RAISE EXCEPTION 'CO_LOADING_BATCH_NOT_READY' USING ERRCODE='23514';END IF;
 SELECT count(*),sum(bw.actual_gross_kg),sum(bw.actual_net_kg) INTO n,g,net FROM co_inventory i JOIN co_bag_work bw ON bw.bag_id=i.bag_id WHERE i.preparation_id=p.id AND i.status='COMPLETED' AND NOT i.loading_eligible AND bw.actual_gross_kg IS NOT NULL AND bw.seal_no IS NOT NULL AND bw.sampled;
 IF n<>p.bag_count OR l.bag_count<>n OR l.actual_gross_kg IS DISTINCT FROM g OR l.actual_net_kg IS DISTINCT FROM net OR (SELECT count(*) FROM co_loading_bag_locks WHERE order_id=l.id AND released_at IS NULL)<>n OR EXISTS(SELECT 1 FROM co_inventory i WHERE i.preparation_id=p.id AND NOT EXISTS(SELECT 1 FROM co_loading_bag_locks k WHERE k.order_id=l.id AND k.bag_id=i.bag_id AND k.released_at IS NULL)) THEN RAISE EXCEPTION 'CO_LOADING_PARTIAL_BATCH_FORBIDDEN' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM co_loading_bag_locks k LEFT JOIN co_positions pos ON pos.bag_id=k.bag_id LEFT JOIN co_locations loc ON loc.id=pos.location_id LEFT JOIN co_zones z ON z.id=loc.zone_id WHERE k.order_id=l.id AND(pos.bag_id IS NULL OR loc.id IS NULL OR NOT loc.active OR NOT z.active OR loc.occupied_by IS DISTINCT FROM p.id OR loc.project_id<>p.project_id OR loc.warehouse_id<>p.warehouse_id OR k.bag_snapshot->>'location_id' IS DISTINCT FROM loc.id::text)) THEN RAISE EXCEPTION 'CO_LOADING_POSITION_INVALID' USING ERRCODE='23514';END IF;
END$function$
;
CREATE OR REPLACE FUNCTION public.co_loading_freeze()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$DECLARE prep uuid;BEGIN
 IF TG_TABLE_NAME IN('co_positions','co_bag_work','co_work_batches') THEN
  prep:=OLD.preparation_id;PERFORM id FROM co_preparations WHERE id=prep FOR UPDATE;
  IF EXISTS(SELECT 1 FROM co_loading_orders WHERE preparation_id=prep AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_OCCUPIED' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_vehicle_arrivals' THEN IF EXISTS(SELECT 1 FROM co_loading_orders WHERE arrival_id=OLD.id AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_ARRIVAL_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_sales_plans' THEN IF EXISTS(SELECT 1 FROM co_loading_orders WHERE sales_plan_id=OLD.id AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_SALES_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_sales_contracts' THEN IF EXISTS(SELECT 1 FROM co_loading_orders l JOIN co_sales_plans p ON p.id=l.sales_plan_id WHERE p.contract_id=OLD.id AND l.status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_CONTRACT_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_locations' THEN IF EXISTS(SELECT 1 FROM co_positions p JOIN co_loading_bag_locks k ON k.bag_id=p.bag_id AND k.released_at IS NULL WHERE p.location_id=OLD.id) THEN RAISE EXCEPTION 'CO_LOADING_LOCATION_FROZEN' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_zones' THEN IF EXISTS(SELECT 1 FROM co_positions p JOIN co_locations loc ON loc.id=p.location_id JOIN co_loading_bag_locks k ON k.bag_id=p.bag_id AND k.released_at IS NULL WHERE loc.zone_id=OLD.id) THEN RAISE EXCEPTION 'CO_LOADING_LOCATION_FROZEN' USING ERRCODE='23514';END IF;
 ELSE IF EXISTS(SELECT 1 FROM co_loading_orders WHERE vehicle_id=OLD.id AND status='WAITING') THEN RAISE EXCEPTION 'CO_LOADING_VEHICLE_FROZEN' USING ERRCODE='23514';END IF;END IF;RETURN NEW;
END$function$
;
ALTER TABLE co_inventory DROP CONSTRAINT co_inventory_status_check;
ALTER TABLE co_inventory ADD CONSTRAINT co_inventory_status_check CHECK ((status = ANY (ARRAY['PREPARING'::text, 'PENDING_COMPLETION_REVIEW'::text, 'COMPLETED'::text])));
ALTER TABLE co_loading_orders DROP CONSTRAINT co_loading_orders_status_check;
ALTER TABLE co_loading_orders ADD CONSTRAINT co_loading_orders_status_check CHECK ((status = ANY (ARRAY['WAITING'::text, 'CANCELLED'::text])));
ALTER TABLE co_loading_plans DROP CONSTRAINT co_loading_plans_status_check;
ALTER TABLE co_loading_plans ADD CONSTRAINT co_loading_plans_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'MATCHED'::text])));
ALTER TABLE co_loading_plans DROP CONSTRAINT co_loading_plans_check;
ALTER TABLE co_loading_plans ADD CONSTRAINT co_loading_plans_check CHECK ((((status = 'DRAFT'::text) AND (current_load_id IS NULL)) OR ((status = 'MATCHED'::text) AND (current_load_id IS NOT NULL))));
CREATE OR REPLACE FUNCTION public.co_loading_arrival_valid(arrival uuid, sales uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
 SELECT EXISTS(SELECT 1 FROM co_vehicle_arrivals a JOIN co_dispatch_vehicles v ON v.id=a.dispatch_vehicle_id JOIN co_sales_plans p ON p.id=a.sales_plan_id JOIN co_sales_contracts k ON k.id=p.contract_id JOIN customers c ON c.id=p.customer_id WHERE a.id=arrival AND a.sales_plan_id=sales AND v.sales_plan_id=sales AND v.cancelled_at IS NULL AND p.status='OPEN' AND c.active AND k.active AND (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date BETWEEN k.effective_date AND k.end_date)$function$
;
ALTER TABLE co_load_executions DROP CONSTRAINT co_execution_departure;
DROP TABLE co_load_bags,co_load_exceptions,co_departures,co_outbound_bags,co_outbounds,co_execution_events,co_load_executions;
DROP SEQUENCE co_outbound_number;
DROP FUNCTION co_execution_authorized(actor uuid,permission text,load_id uuid,fixed_role text);
DROP FUNCTION co_execution_guard();
DROP FUNCTION co_execution_record_guard();
DROP FUNCTION co_outbound_bag_guard();
DROP FUNCTION co_execution_exception_guard();
DROP FUNCTION co_execution_validate(load_id uuid);
DROP FUNCTION co_execution_integrity();
DROP FUNCTION co_execution_freeze();
DROP FUNCTION co_execution_audit();
DELETE FROM schema_migrations WHERE version='144_v43_cobalt_execution.sql';
