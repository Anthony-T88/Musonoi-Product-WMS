-- Preserve imported dispatch identity and allow sales to maintain route details.
ALTER TABLE sales_dispatch_vehicles ADD COLUMN transporter text NOT NULL DEFAULT '' CHECK(length(transporter)<=160),
 ADD COLUMN destination text NOT NULL DEFAULT '' CHECK(length(destination)<=1000),
 ADD COLUMN transport_version integer NOT NULL DEFAULT 1 CHECK(transport_version>0);
GRANT UPDATE(transporter,destination,transport_version) ON sales_dispatch_vehicles TO musonoi_app;
ALTER TABLE co_dispatch_vehicles ADD COLUMN destination text NOT NULL DEFAULT '' CHECK(length(destination)<=1000);
ALTER TABLE co_loading_plans ADD COLUMN transporter text NOT NULL DEFAULT '' CHECK(length(transporter)<=160);
ALTER TABLE historical_sales_dispatch_links ADD COLUMN automatic boolean NOT NULL DEFAULT false;

DO $$
DECLARE d text:=pg_get_functiondef('co_sales_guard()'::regprocedure);
 marker text:='IF TG_OP=''DELETE'' THEN';
BEGIN
 IF strpos(d,marker)=0 OR strpos(d,'''truck_key'',''trailer_no'',''transporter''')=0 THEN
  RAISE EXCEPTION 'Expected cobalt dispatch guard';
 END IF;
 d:=replace(d,'''truck_key'',''trailer_no'',''transporter''','''truck_key'',''trailer_no'',''transporter'',''destination''');
 d:=replace(d,marker,$patch$IF TG_TABLE_NAME='co_dispatch_vehicles' AND TG_OP='UPDATE' THEN
  IF OLD.cancelled_at IS NULL AND NEW.version=OLD.version+1
   AND (to_jsonb(NEW)-ARRAY['transporter','destination','version','updated_by','updated_at'])
       =(to_jsonb(OLD)-ARRAY['transporter','destination','version','updated_by','updated_at']) THEN
   SELECT * INTO p FROM co_sales_plans WHERE id=OLD.sales_plan_id FOR UPDATE;
   IF NOT co_sales_authorized(NEW.updated_by,'dispatch:write',p.project_id,p.warehouse_id,p.customer_id)
    THEN RAISE EXCEPTION 'CO_SALES_SCOPE_PERMISSION' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN$patch$);
 EXECUTE d;
END $$;

DO $$
DECLARE d text:=pg_get_functiondef('co_loading_plan_guard()'::regprocedure);
 marker text:='''version'',''updated_by'',''updated_at'',''last_action'',''packing_list_no''';
BEGIN
 IF strpos(d,marker)=0 THEN RAISE EXCEPTION 'Expected cobalt loading plan guard'; END IF;
 -- Only a draft SAVE may change the transporter with other contract fields.
 d:=replace(d,'''destination'',''invoice_no''','''destination'',''transporter'',''invoice_no''');
 IF strpos(d,'''transporter''')=0 THEN RAISE EXCEPTION 'Expected cobalt loading plan SAVE fields'; END IF;
 EXECUTE d;
END $$;

DO $$
DECLARE d text:=pg_get_functiondef('co_loading_order_guard()'::regprocedure);
 marker text:='jsonb_build_object(''truck_no'',v.truck_no,''truck_key'',v.truck_key,''vehicle_id'',v.id)';
BEGIN
 IF strpos(d,marker)=0 THEN RAISE EXCEPTION 'Expected cobalt transport snapshot'; END IF;
 EXECUTE replace(d,marker,$patch$jsonb_build_object('truck_no',v.truck_no,'truck_key',v.truck_key,'vehicle_id',v.id,
  'transporter',coalesce(nullif(d.transporter,''),a.transporter))$patch$);
END $$;

INSERT INTO permissions(code) VALUES('customs:bp');
INSERT INTO role_permissions(role_code,permission_code) VALUES('logistics_office_operator','customs:bp'),('admin','customs:bp');
INSERT INTO role_permission_caps(role_code,permission_code) SELECT role_code,permission_code FROM role_permissions WHERE permission_code='customs:bp';

CREATE FUNCTION customs_bp_lock_cu(actor uuid, orders uuid[]) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF cardinality(orders) NOT BETWEEN 1 AND 200 OR NOT EXISTS(
  SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_code=u.role_code
  WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND rp.permission_code='customs:bp'
 ) THEN RAISE EXCEPTION 'BP_PERMISSION_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM l.id FROM loading_orders l WHERE l.id=ANY(orders)
 AND l.logistics_review_at IS NOT NULL AND EXISTS(SELECT 1 FROM user_scopes s
  WHERE s.user_id=actor AND s.project_id=l.project_id AND(s.customer_id IS NULL OR s.customer_id=l.customer_id))
 AND NOT EXISTS(SELECT 1 FROM loading_items i JOIN locations loc ON loc.id=i.original_location_id
  WHERE i.loading_id=l.id AND NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=actor AND s.project_id=l.project_id
   AND(s.customer_id IS NULL OR s.customer_id=l.customer_id) AND(s.warehouse_id IS NULL OR s.warehouse_id=loc.warehouse_id)))
 ORDER BY l.id FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION customs_bp_lock_cu(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customs_bp_lock_cu(uuid,uuid[]) TO musonoi_app;

CREATE TABLE customs_bp_counters(
 product_code text NOT NULL CHECK(product_code IN('CU_CATHODE','CO_HYDROXIDE')),
 business_year integer NOT NULL,
 last_number integer NOT NULL CHECK(last_number>0),
 PRIMARY KEY(product_code,business_year)
);
CREATE TABLE customs_bp_documents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_code text NOT NULL CHECK(product_code IN('CU_CATHODE','CO_HYDROXIDE')),
 document_no text NOT NULL CHECK(length(document_no) BETWEEN 1 AND 80),
 source_ids uuid[] NOT NULL CHECK(cardinality(source_ids) BETWEEN 1 AND 200),
 source_context jsonb NOT NULL CHECK(jsonb_typeof(source_context)='array'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(product_code,document_no)
);
GRANT SELECT,INSERT,UPDATE ON customs_bp_counters TO musonoi_app;
GRANT SELECT,INSERT ON customs_bp_documents TO musonoi_app;
