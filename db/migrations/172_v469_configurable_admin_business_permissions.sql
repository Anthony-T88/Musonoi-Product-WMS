-- Preserve all current grants. Administrators may configure their business
-- grants while account/role recovery authority remains protected.
CREATE OR REPLACE FUNCTION administrator_permissions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.role_code='admin' AND OLD.permission_code IN('users:manage','roles:manage') AND (TG_OP='DELETE' OR NEW.role_code<>'admin' OR NEW.permission_code<>OLD.permission_code) THEN RAISE EXCEPTION '系统管理员保留账户与权限管理能力' USING ERRCODE='23514';END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
-- Extend only the documented role-limited operations to an explicitly granted
-- administrator. Permission, active session, data scope, state, version and
-- independent-review checks remain part of each original function.
DO $$
DECLARE f record;definition text;
BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('ux10_plan_submission','ux10_review_sales_plan','v468_request_plan_close','v468_review_plan_close','v468_submit_legacy_plan_edit','co_work_authorized','co_execution_authorized','gate_exit_guard') LOOP
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'u.role_code=''sales_operator''','u.role_code IN(''sales_operator'',''admin'')');
  definition:=replace(definition,'u.role_code=expected_role','u.role_code IN(expected_role,''admin'')');
  definition:=replace(definition,'u.role_code=role_name','u.role_code IN(role_name,''admin'')');
  definition:=replace(definition,'fixed_role IS NULL OR u.role_code=fixed_role','fixed_role IS NULL OR u.role_code=fixed_role OR u.role_code=''admin''');
  definition:=replace(definition,'u.role_code IN(''sales_manager'',''sales_operator'')','u.role_code IN(''sales_manager'',''sales_operator'',''admin'')');
  EXECUTE definition;
 END LOOP;
END $$;
