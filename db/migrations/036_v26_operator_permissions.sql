-- Authorized operations follow the existing data scopes; no approval rights granted.
INSERT INTO role_permissions SELECT 'operator',code FROM permissions WHERE code IN('allocation:read','allocation:write','load:read','load:write','outbound:read') ON CONFLICT DO NOTHING;
