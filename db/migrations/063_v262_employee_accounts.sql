-- Additive account lifecycle. Existing IDs, passwords, roles and business references stay intact.
ALTER TABLE users ADD COLUMN deleted_at timestamptz,
 ADD COLUMN deleted_by uuid REFERENCES users(id), ADD COLUMN deletion_reason text,
 ADD COLUMN deleted_role_code text REFERENCES roles(code), ADD COLUMN last_login_at timestamptz;
ALTER TABLE users ADD CONSTRAINT deleted_account_inactive CHECK(deleted_at IS NULL OR NOT active);
UPDATE auth_policy_settings SET enabled=false WHERE key='fixed_accounts_only';
-- Keep the existing cap model; the five identities are initial accounts, not a login allowlist.
CREATE OR REPLACE FUNCTION fixed_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(21002);
 IF NEW.active AND NOT EXISTS(SELECT 1 FROM role_permission_caps WHERE role_code=NEW.role_code) THEN
  RAISE EXCEPTION '请选择现有五角色之一' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.role_code='admin' AND OLD.active AND OLD.deleted_at IS NULL
 AND (NOT NEW.active OR NEW.deleted_at IS NOT NULL OR NEW.role_code<>'admin')
 AND NOT EXISTS(SELECT 1 FROM users WHERE id<>OLD.id AND role_code='admin' AND active AND deleted_at IS NULL) THEN
  RAISE EXCEPTION '必须保留至少一个有效管理员' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
-- Deleted identities are refused in SQL-level permission checks as well as HTTP authentication.
-- Existing business functions already require active=true; the CHECK enforces that for deletion.
