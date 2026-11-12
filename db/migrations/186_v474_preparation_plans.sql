-- Plan approval precedes the existing physical preparation transaction.
CREATE TABLE preparation_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_code text NOT NULL CHECK(product_code IN ('CU_CATHODE','CO_HYDROXIDE')),
 project_id uuid NOT NULL REFERENCES projects(id),
 customer_id uuid NOT NULL,
 warehouse_id uuid,
 cu_sales_plan_id uuid REFERENCES sales_plans(id),
 co_sales_plan_id uuid REFERENCES co_sales_plans(id),
 sales_plan_id uuid GENERATED ALWAYS AS (coalesce(cu_sales_plan_id,co_sales_plan_id)) STORED,
 batch_no text NOT NULL,
 shipment_month text NOT NULL CHECK(shipment_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','PENDING','APPROVED','REJECTED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 allocation_id uuid UNIQUE REFERENCES allocations(id),
 co_preparation_id uuid UNIQUE REFERENCES co_preparations(id),
 UNIQUE(product_code,batch_no),
 FOREIGN KEY(project_id,customer_id) REFERENCES customers(project_id,id),
 FOREIGN KEY(project_id,warehouse_id) REFERENCES warehouses(project_id,id),
 CHECK((product_code='CU_CATHODE' AND cu_sales_plan_id IS NOT NULL AND co_sales_plan_id IS NULL
        AND warehouse_id IS NULL AND co_preparation_id IS NULL AND batch_no ~ '^RMM-CU-[0-9]{4}-(0[1-9]|[1-9][0-9])$')
    OR (product_code='CO_HYDROXIDE' AND cu_sales_plan_id IS NULL AND co_sales_plan_id IS NOT NULL
        AND warehouse_id IS NOT NULL AND allocation_id IS NULL AND batch_no ~ '^RMM-CO-[0-9]{4}-[0-9]{3,}$')),
 CHECK((allocation_id IS NULL AND co_preparation_id IS NULL) OR state='APPROVED')
);
CREATE INDEX preparation_plan_scope ON preparation_plans(product_code,project_id,customer_id,warehouse_id,created_at DESC);

CREATE TABLE preparation_plan_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL REFERENCES preparation_plans(id),
 action text NOT NULL CHECK(action IN ('CREATE','EDIT','SUBMIT','APPROVE','REJECT','START')),
 actor_id uuid NOT NULL REFERENCES users(id),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=1000)
);
CREATE INDEX preparation_plan_event_history ON preparation_plan_events(plan_id,occurred_at,id);

GRANT SELECT,INSERT,UPDATE ON preparation_plans TO musonoi_app;
GRANT SELECT,INSERT ON preparation_plan_events TO musonoi_app;

