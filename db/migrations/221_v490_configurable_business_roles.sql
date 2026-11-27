-- Keep permission, scope, document ownership, state and independent review checks.
-- The two cobalt authorization helpers keep their historical signatures for existing callers.
DO $roles$
DECLARE change record;definition text;routine text;
BEGIN
 FOR change IN SELECT * FROM (VALUES
  (1,'ux10_plan_submission()',$patch$ AND u.role_code IN('sales_operator','admin','sales_manager')$patch$,$patch$$patch$),
  (2,'ux10_review_sales_plan(text,uuid,uuid,integer,text,text)',$patch$expected_role text;$patch$,$patch$$patch$),
  (3,'ux10_review_sales_plan(text,uuid,uuid,integer,text,text)',$patch$expected_role:=CASE WHEN stage='SALES' THEN 'sales_manager' ELSE 'commerce_manager' END;$patch$,$patch$$patch$),
  (4,'ux10_review_sales_plan(text,uuid,uuid,integer,text,text)',$patch$ AND u.role_code IN(expected_role,'admin')$patch$,$patch$$patch$),
  (5,'v468_request_plan_close(text,uuid,uuid,integer,text)',$patch$ AND u.role_code IN('sales_operator','admin')$patch$,$patch$$patch$),
  (6,'v468_review_plan_close(text,uuid,uuid,uuid,integer,text,text)',$patch$role_name text;$patch$,$patch$$patch$),
  (7,'v468_review_plan_close(text,uuid,uuid,uuid,integer,text,text)',$patch$
 role_name:=CASE WHEN stage='SALES' THEN 'sales_manager' ELSE 'commerce_manager' END;$patch$,$patch$$patch$),
  (8,'v468_review_plan_close(text,uuid,uuid,uuid,integer,text,text)',$patch$ AND u.role_code IN(role_name,'admin')$patch$,$patch$$patch$),
  (9,'v468_submit_legacy_plan_edit(text,uuid,uuid,integer)',$patch$ AND u.role_code IN('sales_operator','admin','sales_manager')$patch$,$patch$$patch$),
  (10,'co_work_authorized(uuid,text,uuid,text)',$patch$ AND(fixed_role IS NULL OR u.role_code=fixed_role OR u.role_code='admin')$patch$,$patch$$patch$),
  (11,'co_execution_authorized(uuid,text,uuid,text)',$patch$ AND(fixed_role IS NULL OR u.role_code=fixed_role OR u.role_code='admin')$patch$,$patch$$patch$),
  (12,'gate_exit_guard()',$patch$ AND u.role_code IN('sales_manager','sales_operator','admin')$patch$,$patch$$patch$),
  (13,'bundle_correction_request(uuid,uuid,integer,jsonb,text)',$patch$
    AND role_code IN('production_operator','logistics_field_operator')$patch$,$patch$$patch$),
  (14,'bundle_correction_review(uuid,uuid,uuid,text,text)',$patch$ AND role_code='production_manager'$patch$,$patch$$patch$),
  (15,'co_loading_review_guard()',$patch$;u users;BEGIN$patch$,$patch$;BEGIN$patch$),
  (16,'co_loading_review_guard()',$patch$  SELECT * INTO u FROM users WHERE id=NEW.reviewed_by;
$patch$,$patch$$patch$),
  (17,'co_loading_review_guard()',$patch$ OR u.role_code IS DISTINCT FROM 'site_supervisor'$patch$,$patch$$patch$),
  (18,'preparation_reversal_authorize(uuid,text,uuid,boolean,jsonb)',$patch$
 fixed_role text:=CASE WHEN review THEN 'logistics_manager' ELSE 'site_supervisor' END;$patch$,$patch$$patch$),
  (19,'preparation_reversal_authorize(uuid,text,uuid,boolean,jsonb)',$patch$ AND u.role_code=fixed_role$patch$,$patch$$patch$),
  (20,'preparation_reversal_authorize(uuid,text,uuid,boolean,jsonb)',$patch$co_work_authorized(actor,permission,doc,fixed_role)$patch$,$patch$co_work_authorized(actor,permission,doc)$patch$),
  (21,'co_metal_event_guard()',$patch$    AND (NEW.action='SUBMITTED' OR u.role_code IN('production_manager','admin'))
$patch$,$patch$$patch$),
  (22,'co_metal_event_guard()',$patch$ ELSIF NEW.action='SUBMITTED' THEN
  authorized:=co_execution_authorized(NEW.actor_id,required_permission,load_id);
 ELSE
  authorized:=co_execution_authorized(NEW.actor_id,required_permission,load_id,'production_manager')
           OR co_execution_authorized(NEW.actor_id,required_permission,load_id,'admin');$patch$,$patch$ ELSE
  authorized:=co_execution_authorized(NEW.actor_id,required_permission,load_id);$patch$)
 ) AS changes(ordinal,signature,before_text,after_text) ORDER BY ordinal LOOP
  IF routine IS DISTINCT FROM change.signature THEN
   IF routine IS NOT NULL THEN EXECUTE definition; END IF;
   routine:=change.signature;
   SELECT pg_get_functiondef(routine::regprocedure) INTO definition;
  END IF;
  IF strpos(definition,change.before_text)=0 THEN
   RAISE EXCEPTION 'Expected business role predicate in %',change.signature;
  END IF;
  definition:=replace(definition,change.before_text,change.after_text);
 END LOOP;
 EXECUTE definition;
END $roles$;

INSERT INTO permissions(code) VALUES('preparation-plan:write'),('preparation-plan:review');

-- Carry forward only the preparation plan actions each previously eligible role held.
WITH legacy(perm,prior_perm,role_code) AS (
 VALUES ('preparation-plan:write','plan:read','export_supervisor'),
        ('preparation-plan:write','plan:read','admin'),
        ('preparation-plan:review','allocation:review','logistics_manager'),
        ('preparation-plan:review','allocation:review','admin')
), added AS (
 INSERT INTO role_permissions(role_code,permission_code)
 SELECT l.role_code,l.perm FROM legacy l
 JOIN role_permissions p ON p.role_code=l.role_code AND p.permission_code=l.prior_perm
 RETURNING role_code,permission_code
), changed_roles AS (
 SELECT role_code,jsonb_agg(permission_code ORDER BY permission_code) added_permissions
 FROM added GROUP BY role_code
), bumped AS (
 UPDATE roles r SET version=r.version+1
 FROM changed_roles c WHERE c.role_code=r.code
 RETURNING r.code,r.version,c.added_permissions
)
INSERT INTO audit_logs(action,entity_type,entity_id,before_data,after_data)
SELECT 'role_permissions_changed','roles',code,jsonb_build_object('version',version-1),
 jsonb_build_object('version',version,'added_permissions',added_permissions,
  'migration','221_v490_configurable_business_roles')
FROM bumped;

INSERT INTO role_permission_caps(role_code,permission_code) VALUES
 ('export_supervisor','preparation-plan:write'),('admin','preparation-plan:write'),
 ('logistics_manager','preparation-plan:review'),('admin','preparation-plan:review');
