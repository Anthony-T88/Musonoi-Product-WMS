-- Keep every prior decision. Retire unexecuted requests without applying their payloads.
DROP TRIGGER v490_access_lifecycle ON access_change_requests;
ALTER TABLE access_change_requests
 DROP CONSTRAINT access_change_requests_state_check,
 DROP CONSTRAINT access_change_requests_check,
 DROP CONSTRAINT access_change_requests_check1,
 ADD CONSTRAINT access_change_requests_state_check
  CHECK(state IN('PENDING','APPROVED','REJECTED','STALE','WITHDRAWN','RETIRED')),
 ADD CONSTRAINT access_change_request_review_record CHECK(
  (state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL)
  OR (state='RETIRED' AND reviewed_by IS NULL AND reviewed_at IS NOT NULL AND pending_password_hash IS NULL)
  OR (state NOT IN('PENDING','RETIRED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND pending_password_hash IS NULL)),
 ADD CONSTRAINT access_change_request_review_identity
  CHECK(state IN('PENDING','WITHDRAWN','RETIRED') OR reviewed_by<>requested_by);

WITH retired AS (
 UPDATE access_change_requests
 SET state='RETIRED', reviewed_at=clock_timestamp(), pending_password_hash=NULL,
     decision_note='权限变更审批功能已停用，原申请未执行。'
 WHERE state='PENDING'
 RETURNING id,kind,target_key,requested_by,decision_note
)
INSERT INTO audit_logs(action,entity_type,entity_id,before_data,after_data)
 SELECT 'access_change_retired','access_change_requests',id::text,
  jsonb_build_object('state','PENDING'),
  jsonb_build_object('state','RETIRED','kind',kind,'target',target_key,'requested_by',requested_by,'reason',decision_note)
 FROM retired;

CREATE OR REPLACE FUNCTION v490_access_request_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 RAISE EXCEPTION 'ACCESS_APPROVAL_RETIRED' USING ERRCODE='55000';
END $$;
CREATE TRIGGER v490_access_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON access_change_requests
 FOR EACH ROW EXECUTE FUNCTION v490_access_request_lifecycle();
REVOKE INSERT ON access_change_requests FROM musonoi_app;
REVOKE UPDATE(state,reviewed_by,reviewed_at,decision_note,pending_password_hash) ON access_change_requests FROM musonoi_app;

DELETE FROM role_permissions WHERE permission_code='access-change:approve';
DELETE FROM role_permission_caps WHERE permission_code='access-change:approve';
DELETE FROM permissions WHERE code='access-change:approve';
