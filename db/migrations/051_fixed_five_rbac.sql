-- Incremental RBAC. Historical identities and business rows are retained.
INSERT INTO roles(code,name) VALUES ('site_supervisor','物流现场主管'),('logistics_operator','物流操作员'),('production_dept','生产管理部') ON CONFLICT(code) DO UPDATE SET name=excluded.name;
INSERT INTO permissions(code) SELECT unnest(ARRAY['customer:read','customer:write','plan:read','plan:write','lot:cancel-approve','roles:manage','system:manage']) ON CONFLICT DO NOTHING;
CREATE TABLE fixed_accounts(username text PRIMARY KEY,role_code text NOT NULL UNIQUE REFERENCES roles(code));
INSERT INTO fixed_accounts VALUES ('admin','admin'),('logistics_manager','logistics_manager'),('site_supervisor','site_supervisor'),('logistics_operator','logistics_operator'),('production_dept','production_dept');
CREATE TABLE auth_policy_settings(key text PRIMARY KEY,enabled boolean NOT NULL DEFAULT false);
INSERT INTO auth_policy_settings VALUES ('fixed_accounts_only',false),('production_receipt_self_review',false);
CREATE TABLE role_permission_caps(role_code text REFERENCES roles(code),permission_code text REFERENCES permissions(code),PRIMARY KEY(role_code,permission_code));
INSERT INTO role_permission_caps SELECT 'admin',code FROM permissions;
INSERT INTO role_permission_caps SELECT r,p FROM unnest(ARRAY['logistics_manager','site_supervisor','logistics_operator']) r CROSS JOIN unnest(ARRAY['master:read','dashboard:read','inventory:read','inventory:export','customer:read','plan:read','allocation:read','allocation:write','sample:read','weigh:read','load:read','load:write','outbound:read','report:read','label:print']) p;
INSERT INTO role_permission_caps SELECT r,p FROM unnest(ARRAY['logistics_manager','site_supervisor']) r CROSS JOIN unnest(ARRAY['allocation:review','load:review']) p;
INSERT INTO role_permission_caps SELECT 'logistics_manager',unnest(ARRAY['customer:write','plan:write','lot:cancel-approve','outbound:approve']);
INSERT INTO role_permission_caps SELECT 'production_dept',unnest(ARRAY['master:read','dashboard:read','inventory:read','receipt:read','receipt:write','receipt:review']);
DELETE FROM role_permissions WHERE role_code IN(SELECT role_code FROM fixed_accounts);
INSERT INTO role_permissions SELECT * FROM role_permission_caps;
CREATE FUNCTION fixed_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.active AND (SELECT enabled FROM auth_policy_settings WHERE key='fixed_accounts_only') AND NOT EXISTS(SELECT 1 FROM fixed_accounts WHERE username=NEW.username AND role_code=NEW.role_code) THEN RAISE EXCEPTION '仅允许五个固定账号及其指定角色' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER fixed_account_guard BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fixed_account_guard();
CREATE FUNCTION role_cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM fixed_accounts WHERE role_code=NEW.role_code) AND NOT EXISTS(SELECT 1 FROM role_permission_caps WHERE role_code=NEW.role_code AND permission_code=NEW.permission_code) THEN RAISE EXCEPTION '超出角色授权上限' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER role_cap_guard BEFORE INSERT OR UPDATE ON role_permissions FOR EACH ROW EXECUTE FUNCTION role_cap_guard();
ALTER TABLE audit_logs ADD COLUMN actor_role text;
CREATE FUNCTION audit_role_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN SELECT role_code INTO NEW.actor_role FROM users WHERE id=NEW.actor_id;RETURN NEW;END $$;
CREATE TRIGGER audit_role_snapshot BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_role_snapshot();
ALTER TABLE receipts ADD COLUMN submitted_by uuid REFERENCES users(id),ADD COLUMN self_review_exception boolean NOT NULL DEFAULT false;
ALTER TABLE allocations ADD COLUMN submitted_by uuid REFERENCES users(id);
ALTER TABLE loading_orders ADD COLUMN submitted_by uuid REFERENCES users(id);
CREATE FUNCTION receipt_self_review_allowed(actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM users u,system_info s,auth_policy_settings p WHERE u.id=actor AND u.active AND u.username='production_dept' AND u.role_code='production_dept' AND s.environment='test' AND p.key='production_receipt_self_review' AND p.enabled) $$;
ALTER TABLE receipts DROP CONSTRAINT receipts_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_check CHECK(status<>'CONFIRMED' OR (confirmed_at IS NOT NULL AND reviewed_by IS NOT NULL AND ((reviewed_by<>created_by AND reviewed_by IS DISTINCT FROM submitted_by) OR self_review_exception)));
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('confirm_receipt(uuid,uuid,integer)'::regprocedure) INTO d;
 d:=replace(d,'IF r.created_by=actor THEN','IF (r.created_by=actor OR r.submitted_by=actor) AND NOT receipt_self_review_allowed(actor) THEN');
 d:=replace(d,$old$SET status='CONFIRMED',reviewed_by=actor$old$,$new$SET status='CONFIRMED',self_review_exception=(actor=r.created_by OR actor=r.submitted_by),reviewed_by=actor$new$);
 d:=replace(d,$old$'code',r.code)$old$,$new$'code',r.code,'self_review_exception',(actor=r.created_by OR actor=r.submitted_by))$new$);EXECUTE d;
 SELECT pg_get_functiondef('v261_lot_action(uuid,uuid,integer,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,$old$CASE WHEN review THEN 'allocation:review' ELSE 'allocation:write' END$old$,$new$CASE WHEN action='cancel' THEN 'lot:cancel-approve' WHEN review THEN 'allocation:review' ELSE 'allocation:write' END$new$);
 d:=replace(d,'IF review AND actor=a.created_by THEN',$new$IF (review OR action='cancel') AND (actor=a.created_by OR actor=a.submitted_by) THEN$new$);
 d:=replace(d,$old$SET workflow_state='PENDING',submitted_at=$old$, $new$SET workflow_state='PENDING',submitted_by=actor,submitted_at=$new$);EXECUTE d;
 SELECT pg_get_functiondef('v26_load_action(uuid,uuid,integer,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'OR actor=d.created_by THEN','OR actor=d.created_by OR actor=d.submitted_by THEN');
 d:=replace(d,'actor IN(d.created_by,d.departure_by)','actor IN(d.created_by,d.submitted_by,d.departure_by)');EXECUTE d;
END $$;
-- Load creation is also submission; track trusted creator without inventing old submitters.
CREATE FUNCTION load_submission_actor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.workflow_state='PENDING' THEN NEW.submitted_by:=NEW.created_by;END IF;RETURN NEW;END $$;
CREATE TRIGGER load_submission_actor BEFORE INSERT ON loading_orders FOR EACH ROW EXECUTE FUNCTION load_submission_actor();
REVOKE ALL ON FUNCTION receipt_self_review_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receipt_self_review_allowed(uuid) TO musonoi_app;
GRANT SELECT ON fixed_accounts,role_permission_caps,auth_policy_settings TO musonoi_app;
GRANT SELECT,INSERT,DELETE ON role_permissions TO musonoi_app;
GRANT UPDATE ON auth_policy_settings TO musonoi_app;
