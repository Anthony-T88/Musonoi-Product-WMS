-- A supervisor can reopen an approved, never-loaded Lot for an audited correction.
-- Existing reservations and confirmed physical position remain; shipment stages are not undone.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v261_lot_action(uuid,uuid,int,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,$old$review:=action IN('approve','reject');$old$,$new$review:=action IN('approve','reject','reopen');$new$);
 d:=replace(d,$old$IF action='submit' THEN$old$,$new$IF action='reopen' THEN
 IF a.workflow_state<>'PREPARED' OR note='' OR EXISTS(SELECT 1 FROM loading_items z JOIN allocation_items ai ON ai.bundle_id=z.bundle_id WHERE ai.allocation_id=doc) THEN RAISE EXCEPTION '授权更正仅限尚未产生装车记录的已备货Lot，原因必填' USING ERRCODE='23514';END IF;
 UPDATE allocations SET workflow_state='RECTIFY',review_note='授权更正：'||note,version=version+1 WHERE id=doc;
 ELSIF action='submit' THEN$new$);EXECUTE d;
 -- Once storage has actually been confirmed, reopening cannot pretend goods reverted
 -- to the temporary owner classification merely because work resumed.
 SELECT pg_get_functiondef('storage_assert_location(uuid,boolean)'::regprocedure) INTO d;
 d:=replace(d,$old$a.workflow_state IN('WORKING','PENDING','RECTIFY') THEN b.customer_id$old$,$new$a.workflow_state IN('WORKING','PENDING','RECTIFY') AND NOT EXISTS(SELECT 1 FROM workflow_reviews wr WHERE wr.allocation_id=a.id AND wr.action='APPROVE') THEN b.customer_id$new$);EXECUTE d;
END $$;
