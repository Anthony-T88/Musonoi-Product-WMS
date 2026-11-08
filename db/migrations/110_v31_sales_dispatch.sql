ALTER TABLE customers ADD COLUMN address text NOT NULL DEFAULT '', ADD COLUMN email text NOT NULL DEFAULT '', ADD COLUMN phone text NOT NULL DEFAULT '';
ALTER TABLE customers ADD CONSTRAINT customer_contact_lengths CHECK(length(address)<=1000 AND length(email)<=320 AND length(phone)<=80);
CREATE TABLE sales_dispatch_imports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sales_plan_id uuid NOT NULL REFERENCES sales_plans(id),shipment_month text NOT NULL CHECK(shipment_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),file_name text NOT NULL,file_sha256 text NOT NULL,row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 5000),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sales_dispatch_vehicles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),import_id uuid NOT NULL REFERENCES sales_dispatch_imports(id),source_sheet text NOT NULL,source_row integer NOT NULL,truck_no text NOT NULL CHECK(length(truck_no) BETWEEN 1 AND 80),trailer_no text NOT NULL CHECK(length(trailer_no)<=80),UNIQUE(import_id,source_row));
CREATE INDEX sales_dispatch_plan_idx ON sales_dispatch_imports(sales_plan_id,shipment_month);
GRANT SELECT,INSERT ON sales_dispatch_imports,sales_dispatch_vehicles TO musonoi_app;
INSERT INTO permissions(code) VALUES('dispatch:read'),('dispatch:write');
INSERT INTO role_permissions(role_code,permission_code) SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE r.code IN('admin','logistics_manager','export_supervisor') AND p.code IN('dispatch:read','dispatch:write') ON CONFLICT DO NOTHING;
