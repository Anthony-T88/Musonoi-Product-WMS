-- Incremental office/field duties; stock posting and independent approval unchanged.
INSERT INTO roles(code,name) VALUES('logistics_office_operator','物流办公室操作员'),('logistics_field_operator','物流现场操作员') ON CONFLICT(code) DO UPDATE SET name=excluded.name;
INSERT INTO permissions(code) VALUES('load:execute') ON CONFLICT DO NOTHING;
-- Keep legacy role definitions for historical audit interpretation.
INSERT INTO role_permissions SELECT r,p.permission_code FROM unnest(ARRAY['logistics_office_operator','logistics_field_operator']) r CROSS JOIN role_permissions p WHERE p.role_code='logistics_operator' ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps SELECT r,p.permission_code FROM unnest(ARRAY['logistics_office_operator','logistics_field_operator']) r CROSS JOIN role_permission_caps p WHERE p.role_code='logistics_operator' ON CONFLICT DO NOTHING;
DELETE FROM role_permissions WHERE role_code='logistics_office_operator' AND permission_code IN('allocation:write','sample:write','weigh:write','move:write','stocktake:write');
DELETE FROM role_permission_caps WHERE role_code='logistics_office_operator' AND permission_code IN('allocation:write','sample:write','weigh:write','move:write','stocktake:write');
DELETE FROM role_permissions WHERE role_code='logistics_field_operator' AND permission_code IN('load:write','loading-plan:match','loading-plan:write','customer:write','plan:write','dispatch:write','packing-template:write');
DELETE FROM role_permission_caps WHERE role_code='logistics_field_operator' AND permission_code IN('load:write','loading-plan:match','loading-plan:write','customer:write','plan:write','dispatch:write','packing-template:write');
INSERT INTO role_permission_caps SELECT role_code,'load:execute' FROM role_permissions WHERE permission_code='load:write' AND role_code NOT IN('logistics_office_operator') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT role_code,'load:execute' FROM role_permissions WHERE permission_code='load:write' AND role_code NOT IN('logistics_office_operator') ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps VALUES('logistics_field_operator','load:execute') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions VALUES('logistics_field_operator','load:execute') ON CONFLICT DO NOTHING;
UPDATE fixed_accounts SET role_code='logistics_office_operator' WHERE username='logistics_operator' AND role_code='logistics_operator';
UPDATE users SET role_code='logistics_office_operator',display_name=CASE WHEN display_name='物流操作员' THEN '物流办公室操作员' ELSE display_name END WHERE role_code='logistics_operator';
INSERT INTO fixed_accounts(username,role_code) VALUES('logistics_field_operator','logistics_field_operator'),('export_supervisor','export_supervisor') ON CONFLICT(username) DO NOTHING;
DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE role_code IN('logistics_office_operator','logistics_field_operator'));
-- The existing action dispatcher still enforces scope, version, state and dates.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v262_prior_load_action(uuid,uuid,integer,text,jsonb)'::regprocedure) INTO d;
 IF position($old$ELSE 'load:write' END$old$ in d)=0 THEN RAISE EXCEPTION 'Expected legacy load permission branch missing';END IF;
 d:=replace(d,$old$ELSE 'load:write' END$old$,$new$WHEN action='depart' THEN 'load:execute' ELSE 'load:write' END$new$);EXECUTE d;
END $$;
