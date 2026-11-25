-- A new correction round begins when an authorized reviewer reopens the lot.
-- The original approval remains in the audit history.
CREATE FUNCTION v262_lot_approval_active(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce((
  SELECT r.action='APPROVE' FROM workflow_reviews r
  WHERE r.allocation_id=doc AND r.action IN('APPROVE','REOPEN')
  ORDER BY r.id DESC LIMIT 1
 ),false);
$$;
REVOKE ALL ON FUNCTION v262_lot_approval_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v262_lot_approval_active(uuid) TO musonoi_app;

DO $$
DECLARE
 definition text:=pg_get_functiondef('v262_preapproval_action(uuid,uuid,integer,text,jsonb)'::regprocedure);
 prior_guard text:=$old$IF EXISTS(SELECT 1 FROM workflow_reviews wr WHERE wr.allocation_id=doc AND wr.action='APPROVE') OR EXISTS(SELECT 1 FROM loading_orders WHERE allocation_id=doc) OR a.workflow_state IN('PREPARED','PARTIAL','FULFILLED') THEN RAISE EXCEPTION '已审核或进入装车流程的Lot禁止普通撤回/撤销，请走既有授权业务流程' USING ERRCODE='23514';END IF;$old$;
BEGIN
 IF strpos(definition,prior_guard)=0 THEN
  RAISE EXCEPTION 'Expected copper preapproval review guard';
 END IF;
 EXECUTE replace(definition,prior_guard,$guard$IF v262_lot_approval_active(doc)
  OR EXISTS(SELECT 1 FROM loading_orders WHERE allocation_id=doc)
  OR EXISTS(SELECT 1 FROM loading_plan_lot_locks WHERE allocation_id=doc)
  OR a.workflow_state IN('PREPARED','PARTIAL','FULFILLED') THEN
  RAISE EXCEPTION '已审核或进入装车流程的Lot禁止普通撤回/撤销，请走既有授权业务流程' USING ERRCODE='23514';
 END IF;
 IF action='revoke' AND EXISTS(SELECT 1 FROM preparation_reversals WHERE allocation_id=doc AND state='PENDING') THEN
  RAISE EXCEPTION '本备货单已有待审核的整批撤销申请，请先处理该申请' USING ERRCODE='23514';
 END IF;$guard$);
END $$;
