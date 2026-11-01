-- Count approval and adjustment preparation use the existing exception ledger.
INSERT INTO role_permissions VALUES('site_supervisor','exception:read'),('site_supervisor','exception:write'),('logistics_manager','exception:read'),('logistics_manager','exception:write'),('logistics_manager','exception:review') ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps SELECT role_code,permission_code FROM role_permissions WHERE role_code IN('site_supervisor','logistics_manager') AND permission_code IN('exception:read','exception:write','exception:review') ON CONFLICT DO NOTHING;
