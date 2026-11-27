-- Guard new loading-plan associations; existing document history stays readable.
CREATE FUNCTION copper_loading_preparation_completed(workflow text, stock_state text, reviewed timestamptz, source text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(workflow IN ('PREPARED','PARTIAL') AND stock_state='LOCKED'
  AND (reviewed IS NOT NULL OR source='LEGACY'),false)
$$;

CREATE FUNCTION cobalt_loading_preparation_available(preparation uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM co_preparations p JOIN co_work_batches w ON w.preparation_id=p.id
  WHERE p.id=preparation AND p.status='RECEIVED' AND w.status='COMPLETED' AND w.reviewed_at IS NOT NULL
   AND w.amendment_status<>'PENDING'
   AND NOT EXISTS (SELECT 1 FROM co_loading_orders l WHERE l.preparation_id=p.id AND l.status='WAITING')
   AND p.bag_count=(SELECT count(*) FROM co_bags b WHERE b.preparation_id=p.id)
   AND NOT EXISTS (
    SELECT 1 FROM co_bags b LEFT JOIN co_inventory i ON i.bag_id=b.id
    LEFT JOIN co_bag_work v ON v.bag_id=b.id LEFT JOIN co_positions pos ON pos.bag_id=b.id
    LEFT JOIN co_locations loc ON loc.id=pos.location_id LEFT JOIN co_zones z ON z.id=loc.zone_id
    WHERE b.preparation_id=p.id AND (i.status IS DISTINCT FROM 'COMPLETED' OR v.actual_gross_kg IS NULL
     OR nullif(btrim(v.seal_no),'') IS NULL OR v.sampled IS DISTINCT FROM true
     OR loc.active IS DISTINCT FROM true OR z.active IS DISTINCT FROM true OR loc.occupied_by IS DISTINCT FROM p.id
     OR loc.project_id IS DISTINCT FROM p.project_id OR loc.warehouse_id IS DISTINCT FROM p.warehouse_id)
   )
 )
$$;

CREATE FUNCTION loading_plan_lot_select_completed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a allocations;
BEGIN
 IF TG_OP='UPDATE' AND NEW.allocation_id=OLD.allocation_id AND NEW.document_id=OLD.document_id THEN RETURN NEW; END IF;
 SELECT * INTO a FROM allocations WHERE id=NEW.allocation_id FOR SHARE;
 IF NOT copper_loading_preparation_completed(a.workflow_state,a.status,a.reviewed_at,a.origin) THEN
  RAISE EXCEPTION '只能新增已审核完成的备货批次' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER loading_plan_lot_selection_complete BEFORE INSERT OR UPDATE OF allocation_id,document_id ON loading_plan_lots
 FOR EACH ROW EXECUTE FUNCTION loading_plan_lot_select_completed();

CREATE FUNCTION co_loading_plan_select_completed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.preparation_id=OLD.preparation_id THEN RETURN NEW; END IF;
 -- The existing loading-plan guard already locks the sales plan and receipt in that order.
 PERFORM 1 FROM co_work_batches WHERE preparation_id=NEW.preparation_id FOR SHARE;
 IF NOT cobalt_loading_preparation_available(NEW.preparation_id) THEN
  RAISE EXCEPTION 'CO_LOADING_NOT_READY' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER co_loading_plan_selection_complete BEFORE INSERT OR UPDATE OF preparation_id ON co_loading_plans
 FOR EACH ROW EXECUTE FUNCTION co_loading_plan_select_completed();

REVOKE ALL ON FUNCTION copper_loading_preparation_completed(text,text,timestamptz,text),cobalt_loading_preparation_available(uuid),
 loading_plan_lot_select_completed(),co_loading_plan_select_completed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION copper_loading_preparation_completed(text,text,timestamptz,text),cobalt_loading_preparation_available(uuid) TO musonoi_app;
