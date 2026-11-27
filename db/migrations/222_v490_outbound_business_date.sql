-- Business dates do not change posting, physical exit or inventory timestamps.
CREATE TABLE outbound_date_declarations (
 copper_order_id uuid UNIQUE REFERENCES loading_orders(id),
 cobalt_departure_id uuid UNIQUE REFERENCES co_departures(id),
 declared_date date NOT NULL,
 declared_by uuid NOT NULL REFERENCES users(id),
 declared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (num_nonnulls(copper_order_id,cobalt_departure_id)=1)
);

CREATE TABLE outbound_date_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 copper_order_id uuid REFERENCES loading_orders(id),
 cobalt_order_id uuid REFERENCES co_loading_orders(id),
 original_date date NOT NULL,
 corrected_date date NOT NULL,
 reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
 requested_by uuid NOT NULL REFERENCES users(id),
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 logistics_by uuid REFERENCES users(id),
 logistics_at timestamptz,
 logistics_note text,
 production_by uuid REFERENCES users(id),
 production_at timestamptz,
 production_note text,
 state text NOT NULL DEFAULT 'PENDING_LOGISTICS',
 version integer NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 3),
 CHECK (num_nonnulls(copper_order_id,cobalt_order_id)=1),
 CHECK (original_date<>corrected_date),
 CHECK (logistics_by IS DISTINCT FROM requested_by),
 CHECK (production_by IS NULL OR (production_by<>requested_by AND production_by<>logistics_by)),
 CHECK (num_nonnulls(logistics_by,logistics_at,logistics_note) IN (0,3)),
 CHECK (num_nonnulls(production_by,production_at,production_note) IN (0,3)),
 CHECK (
  (state='PENDING_LOGISTICS' AND version=1 AND logistics_by IS NULL AND production_by IS NULL) OR
  (state='PENDING_PRODUCTION' AND version=2 AND logistics_by IS NOT NULL AND production_by IS NULL) OR
  (state='APPROVED' AND version=3 AND logistics_by IS NOT NULL AND production_by IS NOT NULL) OR
  (state='REJECTED' AND logistics_by IS NOT NULL AND
   ((version=2 AND production_by IS NULL) OR (version=3 AND production_by IS NOT NULL)))
 )
);
CREATE UNIQUE INDEX outbound_date_pending_copper ON outbound_date_corrections(copper_order_id)
 WHERE copper_order_id IS NOT NULL AND state IN ('PENDING_LOGISTICS','PENDING_PRODUCTION');
CREATE UNIQUE INDEX outbound_date_pending_cobalt ON outbound_date_corrections(cobalt_order_id)
 WHERE cobalt_order_id IS NOT NULL AND state IN ('PENDING_LOGISTICS','PENDING_PRODUCTION');
CREATE INDEX outbound_date_approved_copper ON outbound_date_corrections(copper_order_id,production_at DESC,id DESC)
 WHERE state='APPROVED';
CREATE INDEX outbound_date_approved_cobalt ON outbound_date_corrections(cobalt_order_id,production_at DESC,id DESC)
 WHERE state='APPROVED';

CREATE FUNCTION wms_copper_outbound_date(order_id uuid,as_of timestamptz DEFAULT NULL)
RETURNS date LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce(
  (SELECT corrected_date FROM outbound_date_corrections
   WHERE copper_order_id=$1 AND state='APPROVED' AND ($2 IS NULL OR production_at<=$2)
   ORDER BY production_at DESC,id DESC LIMIT 1),
  declaration.declared_date,
  (coalesce(l.actual_departed_at,l.manager_at,
   (SELECT max(o.departed_at) FROM outbound_orders o WHERE o.loading_id=l.id AND o.status='DEPARTED'))
   AT TIME ZONE 'Africa/Lubumbashi')::date)
 FROM loading_orders l LEFT JOIN outbound_date_declarations declaration
 ON declaration.copper_order_id=l.id AND ($2 IS NULL OR declaration.declared_at<=$2)
 WHERE l.id=$1
$$;

CREATE FUNCTION wms_cobalt_outbound_date(order_id uuid,as_of timestamptz DEFAULT NULL)
RETURNS date LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce(
  (SELECT corrected_date FROM outbound_date_corrections
   WHERE cobalt_order_id=$1 AND state='APPROVED' AND ($2 IS NULL OR production_at<=$2)
   ORDER BY production_at DESC,id DESC LIMIT 1),
  declaration.declared_date,
  (coalesce(d.departed_at,o.posted_at) AT TIME ZONE 'Africa/Lubumbashi')::date)
 FROM co_loading_orders l LEFT JOIN co_load_executions e ON e.order_id=l.id
 LEFT JOIN co_departures d ON d.id=e.departure_id
 LEFT JOIN outbound_date_declarations declaration ON declaration.cobalt_departure_id=d.id
  AND ($2 IS NULL OR declaration.declared_at<=$2)
 LEFT JOIN co_outbounds o ON o.order_id=l.id WHERE l.id=$1
$$;

GRANT SELECT,INSERT,UPDATE ON outbound_date_declarations,outbound_date_corrections TO musonoi_app;
REVOKE ALL ON FUNCTION wms_copper_outbound_date(uuid,timestamptz),wms_cobalt_outbound_date(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_copper_outbound_date(uuid,timestamptz),wms_cobalt_outbound_date(uuid,timestamptz) TO musonoi_app;

-- Accounts with both bundle permissions may review their own request.
DO $bundle$
DECLARE definition text;self_review_check text;
BEGIN
 SELECT pg_get_functiondef('bundle_correction_review(uuid,uuid,uuid,text,text)'::regprocedure) INTO definition;
 IF strpos(definition,'IF actor=q.requester_id OR NOT EXISTS')=0 THEN
  RAISE EXCEPTION 'Expected prior bundle correction author check';
 END IF;
 SELECT conname INTO STRICT self_review_check FROM pg_constraint
 WHERE conrelid='bundle_corrections'::regclass AND contype='c'
  AND strpos(pg_get_constraintdef(oid),'requester_id IS DISTINCT FROM reviewer_id')>0;
 EXECUTE format('ALTER TABLE bundle_corrections DROP CONSTRAINT %I',self_review_check);
 EXECUTE replace(definition,'IF actor=q.requester_id OR NOT EXISTS',$check$IF
  (actor=q.requester_id AND NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions p ON p.role_code=u.role_code
   WHERE u.id=actor AND p.permission_code='inventory:correct-request')) OR NOT EXISTS$check$);
END $bundle$;

-- The archived cobalt packing snapshot guard calls this source function.
DO $packing_date$
DECLARE definition text:=pg_get_functiondef('co_packing_source(uuid)'::regprocedure);
 old_date constant text:=$expr$((o.snapshot->'departure'->>'departed_at')::timestamptz AT TIME ZONE 'Africa/Lubumbashi')::date::text$expr$;
BEGIN
 IF strpos(definition,old_date)=0 THEN
  RAISE EXCEPTION 'Cobalt packing shipping date expression not found';
 END IF;
 EXECUTE replace(definition,old_date,'wms_cobalt_outbound_date(o.order_id)::text');
END $packing_date$;
