-- Retain historical planned_lot_count values; only retire its required/count limit.
-- Quantity tolerance, weight ceilings, stock, seals and approval guards are retained.
DO $$ DECLARE definition text;updated text;BEGIN
 SELECT pg_get_functiondef('v265_plan_progress(uuid)'::regprocedure) INTO definition;
 IF position('p.preparation_month IS NOT NULL AND p.planned_lot_count IS NOT NULL' in definition)=0 THEN RAISE EXCEPTION 'Unexpected plan progress definition';END IF;
 updated:=replace(definition,'p.preparation_month IS NOT NULL AND p.planned_lot_count IS NOT NULL','p.preparation_month IS NOT NULL');
 updated:=replace(updated,'''remaining_lot_count'',p.planned_lot_count-lots.used','''remaining_lot_count'',NULL');
 EXECUTE updated;
 SELECT pg_get_functiondef('v265_lot_guard()'::regprocedure) INTO definition;
 IF position('IF (progress->>''used_lot_count'')::int>=p.planned_lot_count THEN' in definition)=0 THEN RAISE EXCEPTION 'Unexpected preparation guard definition';END IF;
 updated:=replace(definition,' OR p.planned_lot_count IS NULL','');
 updated:=replace(updated,'IF (progress->>''used_lot_count'')::int>=p.planned_lot_count THEN RAISE EXCEPTION ''LOT_COUNT_LIMIT_EXCEEDED'' USING ERRCODE=''23514'',DETAIL=progress::text;END IF;','');
 EXECUTE updated;
 SELECT pg_get_functiondef('plan_history_guard()'::regprocedure) INTO definition;
 IF position('IF NEW.planned_lot_count IS NOT NULL AND' in definition)=0 THEN RAISE EXCEPTION 'Unexpected plan history guard definition';END IF;
 updated:=replace(definition,'IF NEW.planned_lot_count IS NOT NULL AND (p->>''used_lot_count'')::integer>NEW.planned_lot_count THEN RAISE EXCEPTION ''LOT_COUNT_LIMIT_EXCEEDED'' USING ERRCODE=''23514'',DETAIL=p::text;END IF;','');
 updated:=replace(updated,' OR NEW.planned_lot_count IS NULL','');
 EXECUTE updated;
END $$;
