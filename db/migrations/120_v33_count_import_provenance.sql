DO $$ DECLARE def text;BEGIN
 SELECT pg_get_functiondef('v33_prior_stocktake_record(uuid,uuid,int,jsonb)'::regprocedure) INTO def;
 def:=replace(def,'''MANUAL'',','CASE WHEN current_setting(''musonoi.stocktake_excel'',true)=doc::text THEN ''EXCEL'' ELSE ''MANUAL'' END,');EXECUTE def;
END $$;
CREATE FUNCTION v33_stocktake_excel(actor uuid,doc uuid,expected int,entries jsonb) RETURNS stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d stocktakes;BEGIN
 PERFORM set_config('musonoi.stocktake_excel',doc::text,true);d:=v27_stocktake_record(actor,doc,expected,entries);PERFORM set_config('musonoi.stocktake_excel','',true);RETURN d;END $$;
REVOKE ALL ON FUNCTION v33_stocktake_excel(uuid,uuid,int,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v33_stocktake_excel(uuid,uuid,int,jsonb) TO musonoi_app;
INSERT INTO role_permission_caps SELECT role_code,permission_code FROM role_permissions WHERE role_code IN('logistics_operator','site_supervisor','logistics_manager') AND permission_code IN('stocktake:read','stocktake:write','stocktake:review','adjust:read','adjust:write','adjust:approve','move:write') ON CONFLICT DO NOTHING;
INSERT INTO audit_logs(action,entity_type,after_data) VALUES('v33_role_permissions_extended','roles',jsonb_build_object('basis','V3.3库存盘点与货位管理任务书','roles',ARRAY['logistics_operator','site_supervisor','logistics_manager'],'new_roles',false,'existing_permissions_only',true));
