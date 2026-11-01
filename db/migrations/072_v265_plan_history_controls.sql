-- Preserve immutable plan identity while replacing the earlier reservation-only ceiling.
CREATE OR REPLACE FUNCTION plan_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p jsonb;total numeric;maximum numeric;minimum numeric;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sales plan history cannot be deleted' USING ERRCODE='23514';END IF;
 IF NEW.project_id<>OLD.project_id OR NEW.customer_id<>OLD.customer_id OR NEW.code<>OLD.code OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.origin<>OLD.origin THEN RAISE EXCEPTION 'Plan identity cannot change' USING ERRCODE='23514';END IF;
 p:=v265_plan_progress(OLD.id);total:=(p->>'effective_net_weight')::numeric;
 maximum:=NEW.target_weight*(1+coalesce(NEW.quantity_tolerance,0)/100);minimum:=NEW.target_weight*(1-coalesce(NEW.quantity_tolerance,0)/100);
 IF total>maximum THEN RAISE EXCEPTION 'SALES_PLAN_WEIGHT_EXCEEDED' USING ERRCODE='23514',DETAIL=p::text;END IF;
 IF NEW.planned_lot_count IS NOT NULL AND (p->>'used_lot_count')::integer>NEW.planned_lot_count THEN RAISE EXCEPTION 'LOT_COUNT_LIMIT_EXCEEDED' USING ERRCODE='23514',DETAIL=p::text;END IF;
 IF NEW.status='CLOSED' AND OLD.status IS DISTINCT FROM NEW.status AND(NEW.quantity_tolerance IS NULL OR NEW.preparation_month IS NULL OR NEW.planned_lot_count IS NULL OR(p->>'unknown_bundles')::integer>0 OR(p->>'assigned_net_weight')::numeric<>0 OR(p->>'outbound_net_weight')::numeric NOT BETWEEN minimum AND maximum) THEN RAISE EXCEPTION 'SALES_PLAN_COMPLETION_NOT_READY' USING ERRCODE='23514',DETAIL=p::text;END IF;
 RETURN NEW;END $$;
