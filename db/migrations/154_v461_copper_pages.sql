-- Additive fields for the approved copper screens. Unknown legacy contract
-- quantities remain NULL; no historical quantity is inferred from sales plans.
ALTER TABLE customer_contracts ADD COLUMN contract_net_weight numeric(18,6)
 CHECK(contract_net_weight IS NULL OR contract_net_weight>0);
ALTER TABLE customer_contracts ADD COLUMN remark text NOT NULL DEFAULT '' CHECK(length(remark)<=2000);
ALTER TABLE management_warning_settings
 ADD COLUMN cu_stock_age_days integer NOT NULL DEFAULT 30 CHECK(cu_stock_age_days BETWEEN 1 AND 3650),
 ADD COLUMN cu_approval_hours integer NOT NULL DEFAULT 24 CHECK(cu_approval_hours BETWEEN 1 AND 87600),
 ADD COLUMN cu_plan_expiry_days integer NOT NULL DEFAULT 7 CHECK(cu_plan_expiry_days BETWEEN 0 AND 3650),
 ADD COLUMN cu_show_overview_alerts boolean NOT NULL DEFAULT true,
 ADD COLUMN cu_show_todo_reminders boolean NOT NULL DEFAULT true;
CREATE FUNCTION v461_warning_configure(actor uuid,p uuid,expected integer,b jsonb)
 RETURNS management_warning_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DECLARE d management_warning_settings;before_row jsonb;
 BEGIN
  SELECT to_jsonb(s) INTO before_row FROM management_warning_settings s WHERE project_id=p;
  -- Existing function enforces permission, full project scope, lock, version,
  -- existing thresholds and their audit. The entire operation is one transaction.
  SELECT * INTO d FROM v34_warning_configure(actor,p,expected,b);
  UPDATE management_warning_settings SET cu_stock_age_days=(b->>'cu_stock_age_days')::integer,
   cu_approval_hours=(b->>'cu_approval_hours')::integer,cu_plan_expiry_days=(b->>'cu_plan_expiry_days')::integer,
   cu_show_overview_alerts=(b->>'cu_show_overview_alerts')::boolean,
   cu_show_todo_reminders=(b->>'cu_show_todo_reminders')::boolean
  WHERE project_id=p RETURNING * INTO d;
  IF d.cu_stock_age_days IS NULL OR d.cu_approval_hours IS NULL OR d.cu_plan_expiry_days IS NULL
   OR d.cu_show_overview_alerts IS NULL OR d.cu_show_todo_reminders IS NULL THEN
   RAISE EXCEPTION '预警设置不完整' USING ERRCODE='23514';
  END IF;
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data)
   VALUES(actor,'copper_warning_settings_updated','management_warning_settings',p::text,before_row,to_jsonb(d));
  RETURN d;
 END $$;
REVOKE ALL ON FUNCTION v461_warning_configure(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v461_warning_configure(uuid,uuid,integer,jsonb) TO musonoi_app;
