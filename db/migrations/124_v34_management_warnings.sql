CREATE TABLE management_warning_settings(
 project_id uuid PRIMARY KEY REFERENCES projects(id),
 plan_overdue_days integer NOT NULL DEFAULT 0 CHECK(plan_overdue_days BETWEEN 0 AND 3650),
 document_hours integer NOT NULL DEFAULT 0 CHECK(document_hours BETWEEN 0 AND 87600),
 count_difference_days integer NOT NULL DEFAULT 0 CHECK(count_difference_days BETWEEN 0 AND 3650),
 version integer NOT NULL DEFAULT 1,updated_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT ON management_warning_settings TO musonoi_app;
CREATE FUNCTION v34_warning_configure(actor uuid,p uuid,expected integer,b jsonb) RETURNS management_warning_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d management_warning_settings;r exception_rules;BEGIN
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_code=u.role_code AND rp.permission_code='system:manage' WHERE u.id=actor AND u.active AND u.deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM user_scopes WHERE user_id=actor AND project_id=p AND warehouse_id IS NULL AND customer_id IS NULL) THEN RAISE EXCEPTION '没有项目预警设置权限' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(34001);SELECT * INTO d FROM management_warning_settings WHERE project_id=p FOR UPDATE;
 IF coalesce(d.version,0)<>expected THEN RAISE EXCEPTION '预警设置已变化，请刷新后重试' USING ERRCODE='23514';END IF;
 IF b ? 'loaded_hours' THEN
 SELECT * INTO r FROM exception_rules WHERE project_id=p;
 PERFORM exception_configure(actor,p,coalesce(r.version,0),jsonb_build_object('loaded_hours',b->>'loaded_hours','locked_days',coalesce(r.locked_days,30)::text,'weight_tolerance',coalesce(r.weight_tolerance,0)::text));
 END IF;
 INSERT INTO management_warning_settings(project_id,plan_overdue_days,document_hours,count_difference_days,updated_by)
 VALUES(p,(b->>'plan_overdue_days')::int,(b->>'document_hours')::int,(b->>'count_difference_days')::int,actor)
 ON CONFLICT(project_id) DO UPDATE SET plan_overdue_days=excluded.plan_overdue_days,document_hours=excluded.document_hours,count_difference_days=excluded.count_difference_days,version=management_warning_settings.version+1,updated_by=actor,updated_at=clock_timestamp() RETURNING * INTO d;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'management_warning_settings_updated','management_warning_settings',p::text,to_jsonb(d)||jsonb_build_object('loaded_hours',b->>'loaded_hours'));
 RETURN d;
END $$;
REVOKE ALL ON FUNCTION v34_warning_configure(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v34_warning_configure(uuid,uuid,integer,jsonb) TO musonoi_app;
CREATE INDEX IF NOT EXISTS v34_loading_manager_date ON loading_orders(manager_at,id) WHERE workflow_state='OUTBOUND';
CREATE INDEX IF NOT EXISTS v34_loading_plan_date ON loading_plan_documents(planned_load_date,id) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS v34_stocktake_phase_date ON stocktakes(phase,created_at,id);
