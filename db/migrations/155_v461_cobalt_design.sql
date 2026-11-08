-- User-approved cobalt contract quantity and configurable warnings. Historical
-- contract quantities remain unknown. No business rows or old migrations change.
ALTER TABLE co_sales_contracts
 ADD COLUMN contract_net_weight numeric(18,6) CHECK(contract_net_weight IS NULL OR contract_net_weight>0),
 ADD COLUMN remark text NOT NULL DEFAULT '' CHECK(length(remark)<=2000);
ALTER TABLE management_warning_settings
 ADD COLUMN co_stock_age_days integer NOT NULL DEFAULT 30 CHECK(co_stock_age_days BETWEEN 1 AND 3650),
 ADD COLUMN co_approval_hours integer NOT NULL DEFAULT 24 CHECK(co_approval_hours BETWEEN 1 AND 87600),
 ADD COLUMN co_plan_expiry_days integer NOT NULL DEFAULT 7 CHECK(co_plan_expiry_days BETWEEN 0 AND 3650),
 ADD COLUMN co_show_overview_alerts boolean NOT NULL DEFAULT true,
 ADD COLUMN co_show_todo_reminders boolean NOT NULL DEFAULT true;
CREATE FUNCTION v461_co_warning_configure(actor uuid,p uuid,expected integer,b jsonb)
 RETURNS management_warning_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DECLARE d management_warning_settings;before_row jsonb;
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_code=u.role_code AND rp.permission_code='system:manage' WHERE u.id=actor AND u.active AND u.deleted_at IS NULL)
   OR NOT EXISTS(SELECT 1 FROM user_scopes WHERE user_id=actor AND project_id=p AND warehouse_id IS NULL AND customer_id IS NULL)
   THEN RAISE EXCEPTION '没有项目预警设置权限' USING ERRCODE='42501';END IF;
  -- Same lock and version as the copper settings; a stale tab cannot overwrite
  -- another product's settings. Only cobalt columns are updated here.
  PERFORM pg_advisory_xact_lock(34001);
  SELECT * INTO d FROM management_warning_settings WHERE project_id=p FOR UPDATE;
  IF coalesce(d.version,0)<>expected THEN RAISE EXCEPTION '预警设置已变化，请刷新后重试' USING ERRCODE='23514';END IF;
  before_row:=CASE WHEN d.project_id IS NULL THEN NULL ELSE to_jsonb(d) END;
  INSERT INTO management_warning_settings(project_id,co_stock_age_days,co_approval_hours,co_plan_expiry_days,co_show_overview_alerts,co_show_todo_reminders,updated_by)
   VALUES(p,(b->>'co_stock_age_days')::integer,(b->>'co_approval_hours')::integer,(b->>'co_plan_expiry_days')::integer,(b->>'co_show_overview_alerts')::boolean,(b->>'co_show_todo_reminders')::boolean,actor)
  ON CONFLICT(project_id) DO UPDATE SET co_stock_age_days=excluded.co_stock_age_days,co_approval_hours=excluded.co_approval_hours,
   co_plan_expiry_days=excluded.co_plan_expiry_days,co_show_overview_alerts=excluded.co_show_overview_alerts,co_show_todo_reminders=excluded.co_show_todo_reminders,
   version=management_warning_settings.version+1,updated_by=actor,updated_at=clock_timestamp() RETURNING * INTO d;
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data)
   VALUES(actor,'cobalt_warning_settings_updated','management_warning_settings',p::text,before_row,to_jsonb(d));
  RETURN d;
 END $$;
REVOKE ALL ON FUNCTION v461_co_warning_configure(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v461_co_warning_configure(uuid,uuid,integer,jsonb) TO musonoi_app;

-- Preserve the original guard for plans, dispatch, arrivals, identity, actor and
-- version checks; the contract's mutable field list gains only the two fields.
CREATE OR REPLACE FUNCTION co_sales_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE d jsonb;p co_sales_plans;v co_dispatch_vehicles;k co_sales_contracts;pr uuid;wh uuid;cu uuid;permission text;allowed text[];BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_SALES_NO_DELETE' USING ERRCODE='23514';END IF;d:=to_jsonb(NEW);
 IF TG_TABLE_NAME='co_sales_contracts' THEN
  pr:=NEW.project_id;cu:=NEW.customer_id;permission:='customer:write';allowed:=ARRAY['contract_no','effective_date','end_date','active','contract_net_weight','remark'];
  IF NOT EXISTS(SELECT 1 FROM customers WHERE id=cu AND project_id=pr) THEN RAISE EXCEPTION 'CO_SALES_CUSTOMER_PROJECT' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_sales_plans' THEN
  pr:=NEW.project_id;wh:=NEW.warehouse_id;cu:=NEW.customer_id;permission:='plan:write';allowed:=ARRAY['shipment_month','target_weight','planned_metal_mt','planned_vehicle_count','destination','remark','status'];
  IF NOT EXISTS(SELECT 1 FROM warehouses WHERE id=wh AND project_id=pr AND active) THEN RAISE EXCEPTION 'CO_SALES_WAREHOUSE' USING ERRCODE='23514';END IF;
  SELECT * INTO k FROM co_sales_contracts WHERE id=NEW.contract_id FOR SHARE;
  IF k.id IS NULL OR k.project_id<>pr OR k.customer_id<>cu THEN RAISE EXCEPTION 'CO_SALES_CONTRACT_PRODUCT' USING ERRCODE='23514';END IF;
  IF TG_OP='INSERT' THEN IF NEW.status<>'OPEN' THEN RAISE EXCEPTION 'CO_SALES_INITIAL_STATUS' USING ERRCODE='23514';END IF;END IF;
  IF NEW.status='OPEN' AND(NOT k.active OR (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date NOT BETWEEN k.effective_date AND k.end_date OR NOT EXISTS(SELECT 1 FROM customers WHERE id=cu AND active)) THEN RAISE EXCEPTION 'CO_SALES_CONTRACT_INVALID' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO p FROM co_sales_plans WHERE id=NEW.sales_plan_id FOR UPDATE;pr:=p.project_id;wh:=p.warehouse_id;cu:=p.customer_id;
  IF p.id IS NULL OR p.status<>'OPEN' THEN RAISE EXCEPTION 'CO_SALES_PLAN_CLOSED' USING ERRCODE='23514';END IF;
  IF TG_TABLE_NAME='co_dispatch_imports' THEN permission:='dispatch:write';allowed:=ARRAY[]::text[];
  ELSIF TG_TABLE_NAME='co_dispatch_vehicles' THEN
   permission:='dispatch:write';allowed:=ARRAY['truck_key','trailer_no','transporter','driver_name','passport_no','planned_arrival_date','capacity_tonnes','remark','cancelled_at','cancellation_reason'];
   IF TG_OP='INSERT' THEN IF NEW.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'CO_SALES_INITIAL_STATUS' USING ERRCODE='23514';END IF;
   ELSE IF OLD.cancelled_at IS NOT NULL OR EXISTS(SELECT 1 FROM co_vehicle_arrivals WHERE dispatch_vehicle_id=NEW.id) THEN RAISE EXCEPTION 'CO_DISPATCH_LOCKED' USING ERRCODE='23514';END IF;END IF;
  ELSE
   permission:='vehicle-arrival:write';allowed:=ARRAY['arrived_at','trailer_one','trailer_two','driver_name','passport_no','transporter','container_no','exception_remark'];
   SELECT * INTO v FROM co_dispatch_vehicles WHERE id=NEW.dispatch_vehicle_id FOR UPDATE;
   IF v.id IS NULL OR v.sales_plan_id<>p.id OR v.cancelled_at IS NOT NULL OR NEW.arrived_at>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'CO_ARRIVAL_INVALID' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 IF NOT co_sales_authorized((d->>'updated_by')::uuid,permission,pr,wh,cu) THEN RAISE EXCEPTION 'CO_SALES_SCOPE_PERMISSION' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='co_dispatch_imports' THEN IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CO_IMPORT_IMMUTABLE' USING ERRCODE='23514';END IF;
 ELSE
  IF TG_OP='INSERT' THEN IF NEW.version<>1 OR (d->>'created_by')::uuid IS DISTINCT FROM (d->>'updated_by')::uuid AND TG_TABLE_NAME<>'co_vehicle_arrivals' OR TG_TABLE_NAME='co_vehicle_arrivals' AND (d->>'registered_by')::uuid IS DISTINCT FROM (d->>'updated_by')::uuid THEN RAISE EXCEPTION 'CO_SALES_INITIAL_ACTOR_VERSION' USING ERRCODE='23514';END IF;
  ELSE
   IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-(allowed||ARRAY['version','updated_by','updated_at'])) IS DISTINCT FROM (to_jsonb(OLD)-(allowed||ARRAY['version','updated_by','updated_at'])) THEN RAISE EXCEPTION 'CO_SALES_IDENTITY_VERSION' USING ERRCODE='23514';END IF;
  END IF;
 END IF;RETURN NEW;
END$$;
