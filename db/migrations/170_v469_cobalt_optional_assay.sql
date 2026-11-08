-- Operational completion uses measured physical weight, seals and sampling.
-- Retain all recorded assay/metal values; absent values remain unknown.
ALTER TABLE co_loading_orders ALTER COLUMN cobalt_grade_pct DROP NOT NULL;
ALTER TABLE co_loading_orders ALTER COLUMN arecoms_input DROP NOT NULL;
CREATE OR REPLACE FUNCTION co_work_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w co_work_batches;p co_preparations;
BEGIN
 SELECT * INTO w FROM co_work_batches WHERE preparation_id=NEW.preparation_id;
 SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id;
 IF p.status<>'RECEIVED' OR p.bag_count<>(SELECT count(*) FROM co_inventory WHERE preparation_id=p.id)
 OR p.bag_count<>(SELECT count(*) FROM co_bag_work WHERE preparation_id=p.id)
 OR EXISTS(SELECT 1 FROM co_inventory WHERE preparation_id=p.id AND(status<>w.status OR loading_eligible)) THEN
  RAISE EXCEPTION 'CO_WORK_INVENTORY_INCOMPLETE' USING ERRCODE='23514';
 END IF;
 IF w.status IN('PENDING_COMPLETION_REVIEW','COMPLETED') AND EXISTS(
  SELECT 1 FROM co_bag_work WHERE preparation_id=p.id AND(actual_gross_kg IS NULL OR seal_no IS NULL OR NOT sampled)
 ) THEN RAISE EXCEPTION 'CO_WORK_REQUIREMENTS_INCOMPLETE' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
