-- The physical ledger is unchanged. Metal estimates are calculated in exact
-- decimal arithmetic from wet net kg, with rounding reserved for presentation.
CREATE FUNCTION co_estimated_metal_mt(net_kg numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT net_kg * 0.00036 $$;

CREATE VIEW co_metal_inventory AS
SELECT i.bag_id,i.preparation_id,p.document_no,p.preparation_batch_no,p.project_id,p.warehouse_id,
 i.received_at,b.bag_no,bw.seal_no,loc.code location_code,
 coalesce(e.state,CASE WHEN l.id IS NOT NULL THEN 'MATCHED' ELSE i.status END) status,
 sp.customer_id,sp.contract_id,sp.id sales_plan_id,
 CASE WHEN bw.actual_gross_kg IS NOT NULL THEN
   CASE WHEN bw.actual_net_kg>0 AND bw.actual_net_kg<'Infinity'::numeric THEN bw.actual_net_kg END
  WHEN b.expected_gross_kg>3 AND b.expected_gross_kg<'Infinity'::numeric THEN b.expected_gross_kg-3
 END net_kg,
 CASE WHEN bw.actual_gross_kg IS NOT NULL AND bw.actual_net_kg>0 AND bw.actual_net_kg<'Infinity'::numeric THEN 'MEASURED'
  WHEN bw.actual_gross_kg IS NULL AND b.expected_gross_kg>3 AND b.expected_gross_kg<'Infinity'::numeric THEN 'ESTIMATED'
  ELSE 'MISSING' END weight_basis
FROM co_inventory i
JOIN co_bags b ON b.id=i.bag_id
JOIN co_preparations p ON p.id=i.preparation_id AND p.status='RECEIVED'
LEFT JOIN co_bag_work bw ON bw.bag_id=i.bag_id
LEFT JOIN co_positions pos ON pos.bag_id=i.bag_id
LEFT JOIN co_locations loc ON loc.id=pos.location_id
LEFT JOIN co_loading_orders l ON l.preparation_id=p.id AND l.status='WAITING'
LEFT JOIN co_load_executions e ON e.order_id=l.id
LEFT JOIN co_sales_plans sp ON sp.id=l.sales_plan_id
WHERE i.status<>'OUTBOUND' AND i.product_code='CO_HYDROXIDE';

CREATE TABLE co_outbound_metal_snapshots(
 outbound_id uuid PRIMARY KEY REFERENCES co_outbounds(id),
 net_kg numeric CHECK(net_kg>0 AND net_kg<'Infinity'::numeric),
 estimated_metal_mt numeric GENERATED ALWAYS AS(co_estimated_metal_mt(net_kg)) STORED
);

-- Historical snapshots already contain the immutable actual wet net weight.
-- Preserve the source and leave legacy records with missing weights unresolved.
INSERT INTO co_outbound_metal_snapshots(outbound_id,net_kg)
SELECT id,CASE WHEN w ~ '^[0-9]+(\.[0-9]+)?$' THEN nullif(w::numeric,0) END
FROM co_outbounds CROSS JOIN LATERAL (SELECT snapshot#>>'{order,actual_net_kg}' AS w) src;

CREATE FUNCTION co_capture_outbound_metal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.co_outbound_metal_snapshots(outbound_id,net_kg)
 VALUES(NEW.id,(NEW.snapshot#>>'{order,actual_net_kg}')::numeric);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION co_capture_outbound_metal() FROM PUBLIC;
CREATE TRIGGER co_capture_outbound_metal AFTER INSERT ON co_outbounds
 FOR EACH ROW EXECUTE FUNCTION co_capture_outbound_metal();
CREATE TRIGGER co_outbound_metal_immutable BEFORE UPDATE OR DELETE ON co_outbound_metal_snapshots
 FOR EACH ROW EXECUTE FUNCTION co_immutable();

-- An append-only decision ledger. A proposed revision does not displace the
-- last effective confirmation while independent approval is in progress.
CREATE TABLE co_metal_events(
 outbound_id uuid NOT NULL REFERENCES co_outbounds(id),
 version integer NOT NULL CHECK(version>0),
 action text NOT NULL CHECK(action IN('SUBMITTED','CONFIRMED','REJECTED')),
 amount_mt numeric CHECK(amount_mt>0 AND amount_mt<'Infinity'::numeric AND scale(amount_mt)<=5),
 actor_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(outbound_id,version),
 CHECK((action='REJECTED')=(amount_mt IS NULL))
);
CREATE INDEX co_metal_confirmed ON co_metal_events(outbound_id,version DESC) WHERE action='CONFIRMED';
CREATE INDEX co_metal_outbound_posted ON co_outbounds(posted_at,id);
CREATE TRIGGER co_metal_events_immutable BEFORE UPDATE OR DELETE ON co_metal_events
 FOR EACH ROW EXECUTE FUNCTION co_immutable();

CREATE FUNCTION co_metal_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior co_metal_events; load_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('co-metal:'||NEW.outbound_id,0));
 SELECT order_id INTO STRICT load_id FROM co_outbounds WHERE id=NEW.outbound_id;
 SELECT * INTO prior FROM co_metal_events WHERE outbound_id=NEW.outbound_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>coalesce(prior.version,0)+1 THEN
  RAISE EXCEPTION 'CO_METAL_STALE' USING ERRCODE='23514';
 END IF;
 IF NEW.action='SUBMITTED' THEN
  IF prior.action='SUBMITTED' THEN RAISE EXCEPTION 'CO_METAL_PENDING' USING ERRCODE='23514'; END IF;
  IF NOT co_execution_authorized(NEW.actor_id,'outbound:logistics-review',load_id) THEN
   RAISE EXCEPTION 'CO_METAL_PERMISSION' USING ERRCODE='23514';
  END IF;
 ELSE
  IF prior.action IS DISTINCT FROM 'SUBMITTED' OR (NEW.action='CONFIRMED' AND NEW.amount_mt IS DISTINCT FROM prior.amount_mt) THEN
   RAISE EXCEPTION 'CO_METAL_STATE' USING ERRCODE='23514';
  END IF;
  IF NEW.actor_id=prior.actor_id OR NOT (
   co_execution_authorized(NEW.actor_id,'outbound:production-approve',load_id,'production_manager') OR
   co_execution_authorized(NEW.actor_id,'outbound:production-approve',load_id,'admin')) THEN
   RAISE EXCEPTION 'CO_METAL_PERMISSION' USING ERRCODE='23514';
  END IF;
 END IF;
 NEW.occurred_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER co_metal_event_guard BEFORE INSERT ON co_metal_events
 FOR EACH ROW EXECUTE FUNCTION co_metal_event_guard();

CREATE VIEW co_metal_outbound AS
SELECT o.id outbound_id,o.order_id,o.preparation_id,o.posted_at,m.net_kg,m.estimated_metal_mt,
 confirmed.amount_mt confirmed_metal_mt,confirmed.actor_id confirmed_by,confirmed.occurred_at confirmed_at,
 latest.action latest_action,latest.actor_id latest_actor_id,coalesce(latest.version,0) version,
 CASE WHEN latest.action='SUBMITTED' THEN latest.amount_mt END pending_metal_mt,
 CASE WHEN confirmed.version IS NULL THEN 'PENDING_ARECOMS' ELSE 'COMPLETED' END shipment_status,
 o.snapshot#>>'{order,arecoms_input}' legacy_metal_mt
FROM co_outbounds o
JOIN co_outbound_metal_snapshots m ON m.outbound_id=o.id
LEFT JOIN LATERAL(SELECT * FROM co_metal_events WHERE outbound_id=o.id ORDER BY version DESC LIMIT 1) latest ON true
LEFT JOIN LATERAL(SELECT * FROM co_metal_events WHERE outbound_id=o.id AND action='CONFIRMED' ORDER BY version DESC LIMIT 1) confirmed ON true;

GRANT SELECT ON co_metal_inventory,co_metal_outbound,co_outbound_metal_snapshots,co_metal_events TO musonoi_app;
GRANT INSERT ON co_metal_events TO musonoi_app;
