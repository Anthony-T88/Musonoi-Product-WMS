-- The older completion trigger is retained alongside plan_history_guard.
-- Its only exception is a fully approved close request in this transaction,
-- with every physical/unknown-weight and upper-quantity check still satisfied.
CREATE OR REPLACE FUNCTION v265_plan_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE progress jsonb;
BEGIN
 IF NEW.status='CLOSED' AND OLD.status IS DISTINCT FROM NEW.status THEN
  progress:=v265_plan_progress(OLD.id);
  IF NOT(progress->>'completion_eligible')::boolean THEN
   IF NOT v468_close_authorized('CU_CATHODE',OLD.id,OLD.version)
    OR NOT coalesce((progress->>'fields_complete')::boolean,false)
    OR coalesce((progress->>'unknown_bundles')::integer,0)>0
    OR coalesce((progress->>'assigned_net_weight')::numeric,0)<>0
    OR coalesce((progress->>'outbound_net_weight')::numeric,0)>(progress->>'maximum_weight')::numeric
   THEN RAISE EXCEPTION 'SALES_PLAN_COMPLETION_NOT_READY' USING ERRCODE='23514',DETAIL=progress::text;END IF;
  END IF;
 END IF;RETURN NEW;
END $$;
