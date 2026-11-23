INSERT INTO permissions(code) VALUES ('customs:bp-template');
INSERT INTO role_permissions(role_code,permission_code) VALUES ('admin','customs:bp-template');
INSERT INTO role_permission_caps(role_code,permission_code) VALUES
 ('admin','customs:bp-template'),('logistics_manager','customs:bp-template'),('export_supervisor','customs:bp-template');

CREATE TABLE customs_bp_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_code text NOT NULL CHECK (product_code IN ('CU_CATHODE','CO_HYDROXIDE')),
 revision integer NOT NULL CHECK (revision>0),
 fields jsonb NOT NULL CHECK (jsonb_typeof(fields)='object'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(product_code,revision)
);
GRANT SELECT,INSERT ON customs_bp_templates TO musonoi_app;
