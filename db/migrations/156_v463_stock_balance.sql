-- Append-only reporting facts. Existing business records and guards are unchanged.
LOCK TABLE co_inventory, co_bag_work, co_preparations IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE co_report_epoch(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), activated_at timestamptz NOT NULL);
INSERT INTO co_report_epoch VALUES(true,clock_timestamp());
CREATE TABLE co_report_inventory_state(
 bag_id uuid PRIMARY KEY REFERENCES co_bags(id), project_id uuid NOT NULL REFERENCES projects(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 bags integer NOT NULL CHECK(bags IN(0,1)), known_net_kg numeric NOT NULL CHECK(known_net_kg>=0), unknown_bags integer NOT NULL CHECK(unknown_bags BETWEEN 0 AND bags),
 ever_stock boolean NOT NULL, last_event_at timestamptz NOT NULL);
CREATE TABLE co_report_movements(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, bag_id uuid NOT NULL REFERENCES co_bags(id), project_id uuid NOT NULL REFERENCES projects(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 occurred_at timestamptz NOT NULL, kind text NOT NULL CHECK(kind IN('BASELINE','RECEIPT','OUTBOUND','RETURN','WEIGHT','TRANSFER','ADJUSTMENT')),
 bags_delta integer NOT NULL, known_net_delta_kg numeric NOT NULL, unknown_bags_delta integer NOT NULL,
 transaction_id bigint NOT NULL DEFAULT txid_current());
CREATE INDEX co_report_movements_scope_time ON co_report_movements(project_id,warehouse_id,occurred_at,id);
CREATE INDEX co_report_movements_bag ON co_report_movements(bag_id,id);
CREATE TRIGGER co_report_epoch_immutable BEFORE UPDATE OR DELETE ON co_report_epoch FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE TRIGGER co_report_movements_immutable BEFORE UPDATE OR DELETE ON co_report_movements FOR EACH ROW EXECUTE FUNCTION co_immutable();

CREATE FUNCTION co_report_fact(p_bag uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('project_id',p.project_id,'warehouse_id',p.warehouse_id,
  'bags',CASE WHEN p.status='RECEIVED' AND i.status<>'OUTBOUND' THEN 1 ELSE 0 END,
  'known_net_kg',CASE WHEN p.status='RECEIVED' AND i.status<>'OUTBOUND' AND w.actual_gross_kg IS NOT NULL THEN w.actual_net_kg ELSE 0 END::text,
  'unknown_bags',CASE WHEN p.status='RECEIVED' AND i.status<>'OUTBOUND' AND w.actual_gross_kg IS NULL THEN 1 ELSE 0 END,
  'received_at',i.received_at,'weight_at',w.weight_confirmed_at,
  'outbound_at',(SELECT o.posted_at FROM co_outbounds o WHERE o.preparation_id=p.id))
 FROM co_inventory i JOIN co_bags b ON b.id=i.bag_id JOIN co_preparations p ON p.id=i.preparation_id LEFT JOIN co_bag_work w ON w.bag_id=i.bag_id WHERE i.bag_id=p_bag
$$;
INSERT INTO co_report_inventory_state(bag_id,project_id,warehouse_id,bags,known_net_kg,unknown_bags,ever_stock,last_event_at)
 SELECT i.bag_id,(f->>'project_id')::uuid,(f->>'warehouse_id')::uuid,(f->>'bags')::integer,(f->>'known_net_kg')::numeric,(f->>'unknown_bags')::integer,true,e.activated_at
 FROM co_inventory i CROSS JOIN co_report_epoch e CROSS JOIN LATERAL co_report_fact(i.bag_id) f;
INSERT INTO co_report_movements(bag_id,project_id,warehouse_id,occurred_at,kind,bags_delta,known_net_delta_kg,unknown_bags_delta)
 SELECT bag_id,project_id,warehouse_id,last_event_at,'BASELINE',bags,known_net_kg,unknown_bags FROM co_report_inventory_state WHERE bags=1;

CREATE FUNCTION co_report_sync(p_bag uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f jsonb; old co_report_inventory_state%ROWTYPE; pr uuid; wh uuid; nb integer; nk numeric; nu integer; at_time timestamptz; k text; epoch_time timestamptz; had boolean;
BEGIN
 -- Serializes only reporting writes. No existing source row or business state is changed.
 PERFORM pg_advisory_xact_lock(463156);
 SELECT * INTO old FROM co_report_inventory_state WHERE bag_id=p_bag FOR UPDATE; had:=FOUND;
 f:=co_report_fact(p_bag); IF f IS NULL THEN RETURN; END IF;
 pr:=(f->>'project_id')::uuid; wh:=(f->>'warehouse_id')::uuid; nb:=(f->>'bags')::integer; nk:=(f->>'known_net_kg')::numeric; nu:=(f->>'unknown_bags')::integer;
 SELECT activated_at INTO epoch_time FROM co_report_epoch WHERE singleton;
 IF had AND old.project_id=pr AND old.warehouse_id=wh AND old.bags=nb AND old.known_net_kg=nk AND old.unknown_bags=nu THEN RETURN; END IF;
 k:=CASE WHEN coalesce(old.bags,0)=0 AND nb=1 THEN CASE WHEN coalesce(old.ever_stock,false) THEN 'RETURN' ELSE 'RECEIPT' END WHEN coalesce(old.bags,0)=1 AND nb=0 THEN 'OUTBOUND' ELSE 'WEIGHT' END;
 at_time:=GREATEST(epoch_time,coalesce(old.last_event_at,epoch_time),CASE WHEN k='RECEIPT' THEN coalesce((f->>'received_at')::timestamptz,clock_timestamp()) WHEN k='OUTBOUND' THEN coalesce((f->>'outbound_at')::timestamptz,clock_timestamp()) WHEN k='WEIGHT' THEN coalesce((f->>'weight_at')::timestamptz,clock_timestamp()) ELSE clock_timestamp() END);
 IF had AND (old.project_id<>pr OR old.warehouse_id<>wh) THEN
  INSERT INTO co_report_movements(bag_id,project_id,warehouse_id,occurred_at,kind,bags_delta,known_net_delta_kg,unknown_bags_delta) VALUES(p_bag,old.project_id,old.warehouse_id,at_time,'TRANSFER',-old.bags,-old.known_net_kg,-old.unknown_bags);
  INSERT INTO co_report_movements(bag_id,project_id,warehouse_id,occurred_at,kind,bags_delta,known_net_delta_kg,unknown_bags_delta) VALUES(p_bag,pr,wh,at_time,'TRANSFER',nb,nk,nu);
 ELSE
  IF nb<>coalesce(old.bags,0) OR nk<>coalesce(old.known_net_kg,0) OR nu<>coalesce(old.unknown_bags,0) THEN
   INSERT INTO co_report_movements(bag_id,project_id,warehouse_id,occurred_at,kind,bags_delta,known_net_delta_kg,unknown_bags_delta) VALUES(p_bag,pr,wh,at_time,k,nb-coalesce(old.bags,0),nk-coalesce(old.known_net_kg,0),nu-coalesce(old.unknown_bags,0));
  END IF;
 END IF;
 INSERT INTO co_report_inventory_state VALUES(p_bag,pr,wh,nb,nk,nu,coalesce(old.ever_stock,false) OR nb=1,at_time)
 ON CONFLICT(bag_id) DO UPDATE SET project_id=EXCLUDED.project_id,warehouse_id=EXCLUDED.warehouse_id,bags=EXCLUDED.bags,known_net_kg=EXCLUDED.known_net_kg,unknown_bags=EXCLUDED.unknown_bags,ever_stock=EXCLUDED.ever_stock,last_event_at=EXCLUDED.last_event_at;
END$$;
CREATE FUNCTION co_report_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item uuid;
BEGIN
 IF TG_TABLE_NAME='co_preparations' THEN
  FOR item IN SELECT bag_id FROM co_inventory WHERE preparation_id=NEW.id ORDER BY bag_id LOOP PERFORM co_report_sync(item); END LOOP;
 ELSE
  PERFORM co_report_sync(CASE WHEN TG_OP='DELETE' THEN OLD.bag_id ELSE NEW.bag_id END);
 END IF;
 RETURN NULL;
END$$;
-- Deferred capture sees the final received/weighted/outbound facts and frozen documents in the same transaction.
CREATE CONSTRAINT TRIGGER co_report_inventory_capture AFTER INSERT OR UPDATE OR DELETE ON co_inventory DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_report_capture();
CREATE CONSTRAINT TRIGGER co_report_weight_capture AFTER INSERT OR UPDATE OR DELETE ON co_bag_work DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_report_capture();
CREATE CONSTRAINT TRIGGER co_report_receipt_capture AFTER INSERT OR UPDATE ON co_preparations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_report_capture();
REVOKE ALL ON co_report_epoch,co_report_inventory_state,co_report_movements FROM PUBLIC,musonoi_app;
REVOKE ALL ON FUNCTION co_report_fact(uuid),co_report_sync(uuid),co_report_capture() FROM PUBLIC,musonoi_app;
GRANT SELECT ON co_report_epoch,co_report_movements TO musonoi_app;
