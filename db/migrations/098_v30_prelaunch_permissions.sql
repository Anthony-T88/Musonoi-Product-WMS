-- Permission recommendations replace hard role ceilings. No inventory reset here.
INSERT INTO roles(code,name) VALUES('production_operator','生产管理部操作员'),('production_manager','生产管理部经理') ON CONFLICT(code) DO UPDATE SET name=excluded.name;
INSERT INTO role_permission_caps(role_code,permission_code)
 SELECT r,p FROM unnest(ARRAY['production_operator','production_manager']) r CROSS JOIN unnest(ARRAY['master:read','dashboard:read','inventory:read','receipt:read']) p ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps VALUES('production_operator','receipt:write'),('production_manager','receipt:review') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT role_code,permission_code FROM role_permission_caps WHERE role_code IN('production_operator','production_manager') ON CONFLICT DO NOTHING;
DROP TRIGGER role_cap_guard ON role_permissions;
INSERT INTO role_permissions SELECT 'admin',code FROM permissions ON CONFLICT DO NOTHING;
UPDATE users SET role_code='production_operator',display_name='生产管理部操作员' WHERE username='production_dept' AND role_code='production_dept';
UPDATE fixed_accounts SET role_code='production_operator' WHERE username='production_dept';
INSERT INTO fixed_accounts VALUES('production_manager','production_manager') ON CONFLICT DO NOTHING;
DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE username='production_dept');
UPDATE auth_policy_settings SET enabled=false WHERE key='production_receipt_self_review';
CREATE OR REPLACE FUNCTION receipt_self_review_allowed(actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT false $$;
CREATE FUNCTION receipt_independent_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='CONFIRMED' AND(NEW.reviewed_by=NEW.created_by OR NEW.reviewed_by=NEW.submitted_by OR NEW.self_review_exception)
 AND(TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'CONFIRMED' OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by) THEN
 RAISE EXCEPTION '入库必须由其他授权审核人确认，禁止自审' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER receipt_independent_review BEFORE INSERT OR UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION receipt_independent_review_guard();
-- The administrator identity always retains all permissions, even when a
-- delegated role manager edits another role. Normal role grants remain flexible.
CREATE FUNCTION administrator_permissions_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND OLD.role_code='admin' THEN RAISE EXCEPTION '系统管理员保留最高管理权限' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND OLD.role_code='admin' THEN RAISE EXCEPTION '系统管理员保留最高管理权限' USING ERRCODE='23514';END IF;RETURN COALESCE(NEW,OLD);END $$;
CREATE TRIGGER administrator_permissions BEFORE UPDATE OR DELETE ON role_permissions FOR EACH ROW EXECUTE FUNCTION administrator_permissions_guard();
