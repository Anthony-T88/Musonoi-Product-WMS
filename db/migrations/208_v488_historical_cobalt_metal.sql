-- Historical outbounds keep their own immutable source and participate in
-- the same ARECOMS decision rules as online outbounds.
CREATE TABLE co_historical_metal_events(
 outbound_id uuid NOT NULL REFERENCES historical_business_documents(id),
 version integer NOT NULL CHECK(version>0),
 action text NOT NULL CHECK(action IN('SUBMITTED','CONFIRMED','REJECTED')),
 amount_mt numeric CHECK(amount_mt>0 AND amount_mt<'Infinity'::numeric AND scale(amount_mt)<=5),
 actor_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(outbound_id,version),
 CHECK((action='REJECTED')=(amount_mt IS NULL))
);
CREATE INDEX co_historical_metal_confirmed ON co_historical_metal_events(outbound_id,version DESC) WHERE action='CONFIRMED';
CREATE TRIGGER co_historical_metal_events_immutable BEFORE UPDATE OR DELETE ON co_historical_metal_events
 FOR EACH ROW EXECUTE FUNCTION co_immutable();

CREATE OR REPLACE FUNCTION co_metal_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 historical boolean:=TG_TABLE_NAME='co_historical_metal_events';
 prior record;
 target record;
 load_id uuid;
 required_permission text;
 authorized boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('co-metal:'||NEW.outbound_id,0));
 IF historical THEN
  SELECT b.project_id,b.warehouse_id,b.customer_id INTO target
  FROM historical_business_documents d
  JOIN historical_backfills b ON b.source_id=d.source_id
  JOIN historical_movement_documents m ON m.id=b.source_id
  WHERE d.id=NEW.outbound_id AND d.kind='OUTBOUND' AND m.product_code='CO_HYDROXIDE'
   AND m.movement_type='OUTBOUND' AND m.voided_at IS NULL
   AND EXISTS(SELECT 1 FROM historical_movement_lines l WHERE l.document_id=m.id)
  FOR SHARE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'CO_METAL_NOT_POSTED' USING ERRCODE='23514'; END IF;
  SELECT e.* INTO prior FROM co_historical_metal_events e WHERE outbound_id=NEW.outbound_id ORDER BY version DESC LIMIT 1;
 ELSE
  SELECT order_id INTO STRICT load_id FROM co_outbounds WHERE id=NEW.outbound_id;
  SELECT e.* INTO prior FROM co_metal_events e WHERE outbound_id=NEW.outbound_id ORDER BY version DESC LIMIT 1;
 END IF;

 IF NEW.version<>coalesce(prior.version,0)+1 THEN RAISE EXCEPTION 'CO_METAL_STALE' USING ERRCODE='23514'; END IF;
 IF NEW.action='SUBMITTED' THEN
  IF prior.action='SUBMITTED' THEN RAISE EXCEPTION 'CO_METAL_PENDING' USING ERRCODE='23514'; END IF;
  required_permission:='outbound:logistics-review';
 ELSE
  IF prior.action IS DISTINCT FROM 'SUBMITTED' OR (NEW.action='CONFIRMED' AND NEW.amount_mt IS DISTINCT FROM prior.amount_mt) THEN
   RAISE EXCEPTION 'CO_METAL_STATE' USING ERRCODE='23514';
  END IF;
  IF NEW.actor_id=prior.actor_id THEN RAISE EXCEPTION 'CO_METAL_PERMISSION' USING ERRCODE='23514'; END IF;
  required_permission:='outbound:production-approve';
 END IF;

 IF historical THEN
  SELECT EXISTS(
   SELECT 1 FROM users u
   JOIN role_permissions r ON r.role_code=u.role_code AND r.permission_code=required_permission
   JOIN user_scopes s ON s.user_id=u.id AND s.project_id=target.project_id
   WHERE u.id=NEW.actor_id AND u.active AND u.deleted_at IS NULL
    AND (NEW.action='SUBMITTED' OR u.role_code IN('production_manager','admin'))
    AND (s.warehouse_id IS NULL OR s.warehouse_id=target.warehouse_id)
    AND (s.customer_id IS NULL OR s.customer_id=target.customer_id)
  ) INTO authorized;
 ELSIF NEW.action='SUBMITTED' THEN
  authorized:=co_execution_authorized(NEW.actor_id,required_permission,load_id);
 ELSE
  authorized:=co_execution_authorized(NEW.actor_id,required_permission,load_id,'production_manager')
           OR co_execution_authorized(NEW.actor_id,required_permission,load_id,'admin');
 END IF;
 IF NOT authorized THEN RAISE EXCEPTION 'CO_METAL_PERMISSION' USING ERRCODE='23514'; END IF;
 NEW.occurred_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER co_historical_metal_event_guard BEFORE INSERT ON co_historical_metal_events
 FOR EACH ROW EXECUTE FUNCTION co_metal_event_guard();

CREATE VIEW co_historical_metal_outbound AS
SELECT d.id outbound_id,d.id order_id,NULL::uuid preparation_id,
 d.business_date::timestamp AT TIME ZONE 'Africa/Lubumbashi' posted_at,weight.net_kg,
 co_estimated_metal_mt(weight.net_kg) estimated_metal_mt,
 confirmed.amount_mt confirmed_metal_mt,confirmed.actor_id confirmed_by,confirmed.occurred_at confirmed_at,
 latest.action latest_action,latest.actor_id latest_actor_id,coalesce(latest.version,0) version,
 CASE WHEN latest.action='SUBMITTED' THEN latest.amount_mt END pending_metal_mt,
 CASE WHEN confirmed.version IS NULL THEN 'PENDING_ARECOMS' ELSE 'COMPLETED' END shipment_status,
 NULL::text legacy_metal_mt,
 d.document_no outbound_code,coalesce(l.document_no,m.document_no) order_no,m.document_no,
 coalesce(nullif(m.source_facts->>'batch_no',''),nullif(m.source_facts->>'lot_no','')) preparation_batch_no,
 b.project_id,b.warehouse_id,b.customer_id,k.id contract_id,p.id sales_plan_id,
 coalesce(nullif(m.source_facts->>'customer',''),cu.name) customer_name,
 nullif(m.source_facts->>'contract_no','') contract_no,
 nullif(m.source_facts->>'truck','') truck_no,weight.bags,true historical_import,m.id historical_source_id
FROM historical_movement_documents m
JOIN historical_backfills b ON b.source_id=m.id
JOIN historical_business_documents d ON d.source_id=m.id AND d.kind='OUTBOUND'
LEFT JOIN historical_business_documents l ON l.source_id=m.id AND l.kind='LOADING_ORDER'
LEFT JOIN customers cu ON cu.id=b.customer_id
LEFT JOIN historical_sales_dispatch_links link ON link.source_id=m.id
LEFT JOIN co_dispatch_vehicles vehicle ON vehicle.id=link.co_dispatch_id AND vehicle.cancelled_at IS NULL
LEFT JOIN co_sales_plans p ON p.id=vehicle.sales_plan_id AND p.project_id=b.project_id
 AND p.warehouse_id=b.warehouse_id AND p.customer_id=b.customer_id
LEFT JOIN LATERAL(
 SELECT ct.id FROM co_sales_contracts ct WHERE ct.project_id=b.project_id AND ct.customer_id=b.customer_id
  AND ct.contract_no=m.source_facts->>'contract_no' ORDER BY ct.id LIMIT 1
) k ON true
JOIN LATERAL(
 SELECT sum(net_kg) net_kg,count(*)::int bags FROM historical_movement_lines WHERE document_id=m.id
) weight ON weight.bags>0
LEFT JOIN LATERAL(
 SELECT * FROM co_historical_metal_events WHERE outbound_id=d.id ORDER BY version DESC LIMIT 1
) latest ON true
LEFT JOIN LATERAL(
 SELECT * FROM co_historical_metal_events WHERE outbound_id=d.id AND action='CONFIRMED' ORDER BY version DESC LIMIT 1
) confirmed ON true
WHERE m.voided_at IS NULL AND m.product_code='CO_HYDROXIDE' AND m.movement_type='OUTBOUND';

GRANT SELECT ON co_historical_metal_outbound,co_historical_metal_events TO musonoi_app;
GRANT INSERT ON co_historical_metal_events TO musonoi_app;
