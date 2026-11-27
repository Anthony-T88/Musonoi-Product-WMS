-- Separate ARECOMS entry from approval of the physical Stock Issue.
DO $$
DECLARE
 definition text:=pg_get_functiondef('co_metal_event_guard()'::regprocedure);
 old_entry text:='required_permission:=''outbound:logistics-review'';';
 new_entry text:='required_permission:=''co:metal-submit'';';
BEGIN
 IF strpos(definition,old_entry)=0 THEN
  RAISE EXCEPTION 'Expected cobalt metal submission permission';
 END IF;
 EXECUTE replace(definition,old_entry,new_entry);
END $$;

INSERT INTO permissions(code) VALUES('co:metal-read'),('co:metal-submit');

WITH entry_roles AS (
 SELECT code role_code FROM roles WHERE code='logistics_office_operator'
 UNION
 SELECT role_code FROM role_permissions WHERE permission_code='outbound:logistics-review'
), added AS (
 INSERT INTO role_permissions(role_code,permission_code)
 SELECT role_code,permission_code FROM entry_roles
 CROSS JOIN (VALUES('co:metal-read'),('co:metal-submit')) p(permission_code)
 RETURNING role_code,permission_code
), changed_roles AS (
 SELECT role_code,jsonb_agg(permission_code ORDER BY permission_code) added_permissions
 FROM added GROUP BY role_code
), bumped AS (
 UPDATE roles r SET version=r.version+1
 FROM changed_roles c WHERE c.role_code=r.code
 RETURNING r.code,r.version,c.added_permissions
), revoked AS (
 DELETE FROM sessions s USING users u,bumped b WHERE s.user_id=u.id AND u.role_code=b.code
)
INSERT INTO audit_logs(action,entity_type,entity_id,before_data,after_data)
SELECT 'role_permissions_changed','roles',code,jsonb_build_object('version',version-1),
 jsonb_build_object('version',version,'added_permissions',added_permissions,'migration','220_v490_cobalt_metal_permissions')
FROM bumped;

WITH recommended_roles AS (
 SELECT code role_code FROM roles WHERE code IN('admin','logistics_office_operator')
 UNION
 SELECT role_code FROM role_permission_caps WHERE permission_code='outbound:logistics-review'
)
INSERT INTO role_permission_caps(role_code,permission_code)
SELECT role_code,permission_code FROM recommended_roles
CROSS JOIN (VALUES('co:metal-read'),('co:metal-submit')) p(permission_code);
