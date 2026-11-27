-- The existing idempotency log distinguishes manual deletion from a file's cancellation marker.
CREATE FUNCTION co_dispatch_was_manually_deleted(p_id uuid,p_version integer,p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM co_requests r
  WHERE r.actor_id=p_actor AND r.route='POST /api/v1/cobalt/sales/vehicles/'||p_id::text||'/cancel'
   AND r.response @> jsonb_build_object('id',p_id,'version',p_version)
 )
$$;
REVOKE ALL ON FUNCTION co_dispatch_was_manually_deleted(uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION co_dispatch_was_manually_deleted(uuid,integer,uuid) TO musonoi_app;

-- Restore a manually deleted import row under the existing plan, actor and version guard.
DO $$
DECLARE
 definition text:=pg_get_functiondef('co_sales_guard()'::regprocedure);
 previous text:=$guard$ELSE IF OLD.cancelled_at IS NOT NULL OR EXISTS(SELECT 1 FROM co_vehicle_arrivals WHERE dispatch_vehicle_id=NEW.id AND registration_phase<>'CLEARED') THEN RAISE EXCEPTION 'CO_DISPATCH_LOCKED' USING ERRCODE='23514';END IF;END IF;$guard$;
 revised text:=$guard$ELSE
    IF EXISTS(SELECT 1 FROM co_vehicle_arrivals WHERE dispatch_vehicle_id=NEW.id AND registration_phase<>'CLEARED') THEN
     RAISE EXCEPTION 'CO_DISPATCH_LOCKED' USING ERRCODE='23514';
    END IF;
    IF OLD.cancelled_at IS NOT NULL THEN
     IF NEW.cancelled_at IS NOT NULL OR NEW.cancellation_reason IS NOT NULL
      OR NOT EXISTS(SELECT 1 FROM co_dispatch_imports i WHERE i.id=OLD.import_id
       AND i.sales_plan_id=NEW.sales_plan_id AND i.shipment_month=NEW.shipment_month)
      OR EXISTS(SELECT 1 FROM historical_sales_dispatch_links h WHERE h.co_dispatch_id=OLD.id)
      OR EXISTS(SELECT 1 FROM co_loading_orders o WHERE o.vehicle_id=OLD.id AND o.status IN('WAITING','OUTBOUND'))
      OR NOT co_dispatch_was_manually_deleted(OLD.id,OLD.version,OLD.updated_by) THEN
      RAISE EXCEPTION 'CO_DISPATCH_LOCKED' USING ERRCODE='23514';
     END IF;
     permission:='dispatch:write';
     allowed:=ARRAY['truck_key','cancelled_at','cancellation_reason'];
    END IF;
   END IF;$guard$;
BEGIN
 IF strpos(definition,previous)=0 THEN RAISE EXCEPTION 'Expected cobalt dispatch cancellation guard'; END IF;
 EXECUTE replace(definition,previous,revised);
END $$;
