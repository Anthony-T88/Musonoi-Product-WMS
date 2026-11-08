-- Retain the last-administrator safeguard while accepting registered custom roles.
DO $$ DECLARE d text;old_condition text;BEGIN
 SELECT pg_get_functiondef('fixed_account_guard()'::regprocedure) INTO d;
 old_condition:='NEW.active AND NOT EXISTS(SELECT 1 FROM role_permission_caps WHERE role_code=NEW.role_code)';
 IF position(old_condition in d)=0 THEN RAISE EXCEPTION 'Expected account role guard missing';END IF;
 d:=replace(d,old_condition,$new$NEW.active AND NOT EXISTS(SELECT 1 FROM roles r WHERE r.code=NEW.role_code AND(r.code=ANY(ARRAY['admin','export_supervisor','logistics_manager','site_supervisor','logistics_office_operator','logistics_field_operator','production_operator','production_manager']) OR NOT r.built_in))$new$);
 d:=replace(d,'请选择现有五角色之一','请选择有效的内置或自定义角色');
 EXECUTE d;
END $$;
