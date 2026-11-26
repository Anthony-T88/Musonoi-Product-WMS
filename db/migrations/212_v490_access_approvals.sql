INSERT INTO roles(code,name,name_en,built_in) VALUES('general_manager','总经理','General Manager',true);
INSERT INTO permissions(code) VALUES('access-change:approve');
INSERT INTO role_permission_caps VALUES('general_manager','access-change:approve');
INSERT INTO role_permissions VALUES('general_manager','access-change:approve');

DO $$
DECLARE definition text:=pg_get_functiondef('fixed_account_guard()'::regprocedure);
BEGIN
 IF strpos(definition,'r.code=ANY(ARRAY[')=0 THEN RAISE EXCEPTION 'Expected account role guard'; END IF;
 EXECUTE replace(definition,'r.code=ANY(ARRAY[','r.code=''general_manager'' OR r.code=ANY(ARRAY[');
END $$;

CREATE UNIQUE INDEX v490_active_general_manager ON users(role_code)
 WHERE role_code='general_manager' AND active AND deleted_at IS NULL;

-- The maintenance owner provisions and rotates this account. Ordinary app
-- connections may update its language and last-login time.
CREATE FUNCTION v490_protect_manager() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_user='musonoi_app' THEN
  IF TG_TABLE_NAME='users' THEN
   IF TG_OP='INSERT' THEN
    IF NEW.role_code='general_manager' THEN RAISE EXCEPTION 'GENERAL_MANAGER_RESERVED' USING ERRCODE='42501'; END IF;
   ELSIF TG_OP='DELETE' THEN
    IF OLD.role_code='general_manager' THEN RAISE EXCEPTION 'GENERAL_MANAGER_RESERVED' USING ERRCODE='42501'; END IF;
   ELSIF OLD.role_code='general_manager' OR NEW.role_code='general_manager' THEN
    IF to_jsonb(NEW)-ARRAY['last_login_at','language_code'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['last_login_at','language_code'] THEN
     RAISE EXCEPTION 'GENERAL_MANAGER_RESERVED' USING ERRCODE='42501';
    END IF;
   END IF;
  ELSIF TG_TABLE_NAME='roles' THEN
   IF (TG_OP<>'INSERT' AND OLD.code='general_manager') OR (TG_OP<>'DELETE' AND NEW.code='general_manager') THEN
    RAISE EXCEPTION 'GENERAL_MANAGER_RESERVED' USING ERRCODE='42501';
   END IF;
  ELSIF (TG_OP<>'INSERT' AND (OLD.role_code='general_manager' OR OLD.permission_code='access-change:approve'))
   OR (TG_OP<>'DELETE' AND (NEW.role_code='general_manager' OR NEW.permission_code='access-change:approve')) THEN
   RAISE EXCEPTION 'GENERAL_MANAGER_RESERVED' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER v490_manager_account BEFORE INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION v490_protect_manager();
CREATE TRIGGER v490_manager_role BEFORE INSERT OR UPDATE OR DELETE ON roles FOR EACH ROW EXECUTE FUNCTION v490_protect_manager();
CREATE TRIGGER v490_manager_grants BEFORE INSERT OR UPDATE OR DELETE ON role_permissions FOR EACH ROW EXECUTE FUNCTION v490_protect_manager();
CREATE TRIGGER v490_manager_caps BEFORE INSERT OR UPDATE OR DELETE ON role_permission_caps FOR EACH ROW EXECUTE FUNCTION v490_protect_manager();

CREATE TABLE access_change_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN('USER_CREATE','USER_UPDATE','USER_RESTORE','USER_PASSWORD_RESET','REGISTRATION_GRANT','ROLE_PERMISSIONS')),
 target_key text NOT NULL CHECK(length(target_key) BETWEEN 1 AND 80),
 target_label text NOT NULL CHECK(length(target_label) BETWEEN 1 AND 240),
 requested_by uuid NOT NULL REFERENCES users(id),
 requester_role text NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','APPROVED','REJECTED','STALE','WITHDRAWN')),
 before_data jsonb,
 after_data jsonb NOT NULL,
 payload jsonb NOT NULL,
 pending_password_hash text,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 reviewed_by uuid REFERENCES users(id),
 reviewed_at timestamptz,
 decision_note text CHECK(length(decision_note)<=500),
 CHECK((state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
       (state<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND pending_password_hash IS NULL)),
 CHECK(state IN('PENDING','WITHDRAWN') OR reviewed_by<>requested_by)
);
CREATE UNIQUE INDEX v490_access_one_pending ON access_change_requests(kind,target_key) WHERE state='PENDING';
CREATE INDEX v490_access_inbox ON access_change_requests(state,requested_at DESC,id);
CREATE INDEX v490_access_sender ON access_change_requests(requested_by,requested_at DESC,id);
REVOKE ALL ON access_change_requests FROM PUBLIC,musonoi_app;
GRANT SELECT,INSERT ON access_change_requests TO musonoi_app;
GRANT UPDATE(state,reviewed_by,reviewed_at,decision_note,pending_password_hash) ON access_change_requests TO musonoi_app;

CREATE FUNCTION v490_access_request_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state='PENDING' THEN RETURN NEW; END IF;
 ELSIF OLD.state='PENDING' AND NEW.state<>'PENDING' THEN
  IF NEW.state='WITHDRAWN' AND NEW.reviewed_by=OLD.requested_by THEN RETURN NEW; END IF;
  IF NEW.state<>'WITHDRAWN' AND EXISTS(
   SELECT 1 FROM users u WHERE u.id=NEW.reviewed_by AND u.role_code='general_manager' AND u.active AND u.deleted_at IS NULL
  ) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'ACCESS_APPROVAL_STATE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER v490_access_lifecycle BEFORE INSERT OR UPDATE ON access_change_requests
 FOR EACH ROW EXECUTE FUNCTION v490_access_request_lifecycle();

CREATE INDEX v490_audit_request ON audit_logs(request_id) WHERE request_id IS NOT NULL;
