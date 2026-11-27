-- Permit the built-in administrator to act at each business review stage.
-- The existing state transitions, actor permissions and data scope still apply.
CREATE FUNCTION wms_admin_self_review(actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND role_code='admin' AND active AND deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION wms_admin_self_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wms_admin_self_review(uuid) TO musonoi_app;

DO $date_checks$
DECLARE item record; removed integer:=0;
BEGIN
 FOR item IN SELECT conname FROM pg_constraint
  WHERE conrelid='outbound_date_corrections'::regclass AND contype='c'
   AND (strpos(pg_get_constraintdef(oid),'logistics_by IS DISTINCT FROM requested_by')>0
    OR (strpos(pg_get_constraintdef(oid),'production_by <> requested_by')>0
     AND strpos(pg_get_constraintdef(oid),'production_by <> logistics_by')>0))
 LOOP
  EXECUTE format('ALTER TABLE outbound_date_corrections DROP CONSTRAINT %I',item.conname);
  removed:=removed+1;
 END LOOP;
 IF removed<>2 THEN RAISE EXCEPTION 'Expected both prior outbound date reviewer checks'; END IF;
END $date_checks$;

CREATE FUNCTION wms_outbound_date_review_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
  RAISE EXCEPTION 'OUTBOUND_DATE_REQUESTER_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NEW.logistics_by IS NOT NULL AND (TG_OP='INSERT' OR NEW.logistics_by IS DISTINCT FROM OLD.logistics_by)
  AND NEW.logistics_by=NEW.requested_by AND NOT wms_admin_self_review(NEW.logistics_by) THEN
  RAISE EXCEPTION 'OUTBOUND_DATE_INDEPENDENT_REVIEW_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF NEW.production_by IS NOT NULL AND (TG_OP='INSERT' OR NEW.production_by IS DISTINCT FROM OLD.production_by)
  AND NEW.production_by IN(NEW.requested_by,NEW.logistics_by) AND NOT wms_admin_self_review(NEW.production_by) THEN
  RAISE EXCEPTION 'OUTBOUND_DATE_INDEPENDENT_REVIEW_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outbound_date_review_guard BEFORE INSERT OR UPDATE ON outbound_date_corrections
 FOR EACH ROW EXECUTE FUNCTION wms_outbound_date_review_guard();

DO $cobalt_metal_review$
DECLARE definition text:=pg_get_functiondef('co_metal_event_guard()'::regprocedure);
 old_check constant text:='IF NEW.actor_id=prior.actor_id THEN';
BEGIN
 IF strpos(definition,old_check)=0 THEN RAISE EXCEPTION 'Expected prior cobalt metal reviewer check'; END IF;
 EXECUTE replace(definition,old_check,
  'IF NEW.actor_id=prior.actor_id AND NOT wms_admin_self_review(NEW.actor_id) THEN');
END $cobalt_metal_review$;

-- Permit the active built-in administrator to verify evidence on their own
-- copper documents. Keep all permission, state, evidence and posting checks.
DO $copper_admin_review$
DECLARE patch record;definition text;
BEGIN
 FOR patch IN SELECT * FROM (VALUES
  ('v32_prior_correction_action(uuid,uuid,integer,text,text)',
   $old$IF action='verify-return' AND actor=q.requested_by THEN$old$,
   $new$IF action='verify-return' AND actor=q.requested_by AND NOT wms_admin_self_review(actor) THEN$new$),
  ('outbound_action(uuid,uuid,integer,text,jsonb)',
   $old$OR actor IN(d.packing_by,d.commerce_by)$old$,
   $new$OR (actor IN(d.packing_by,d.commerce_by) AND NOT wms_admin_self_review(actor))$new$),
  ('outbound_action(uuid,uuid,integer,text,jsonb)',
   $old$OR actor IN(d.commerce_by,d.gate_by)$old$,
   $new$OR (actor IN(d.commerce_by,d.gate_by) AND NOT wms_admin_self_review(actor))$new$),
  ('outbound_action(uuid,uuid,integer,text,jsonb)',
   $old$OR actor IN(d.reversal_requested_by,d.reversal_approved_by)$old$,
   $new$OR (actor IN(d.reversal_requested_by,d.reversal_approved_by) AND NOT wms_admin_self_review(actor))$new$),
  ('outbound_action(uuid,uuid,integer,text,jsonb)',
   $old$OR actor IN(d.reversal_requested_by,d.reversal_approved_by,d.return_verified_by)$old$,
   $new$OR (actor IN(d.reversal_requested_by,d.reversal_approved_by,d.return_verified_by) AND NOT wms_admin_self_review(actor))$new$)
 ) AS changes(signature,before_text,after_text) LOOP
  SELECT pg_get_functiondef(patch.signature::regprocedure) INTO definition;
  IF strpos(definition,patch.before_text)=0 THEN
   RAISE EXCEPTION 'Expected copper approval guard in %',patch.signature;
  END IF;
  EXECUTE replace(definition,patch.before_text,patch.after_text);
 END LOOP;
END $copper_admin_review$;

-- Keep the same workflow transitions, evidence, permissions and scoped review.
DO $admin_shared_approvals$
DECLARE patch record; definition text; independence_constraint text;
BEGIN
 FOR patch IN SELECT * FROM (VALUES
  ('preparation_reversal_review(uuid,text,uuid,uuid,text,text)',
   'IF actor=q.requested_by THEN',
   'IF actor=q.requested_by AND NOT wms_admin_self_review(actor) THEN'),
  ('v27_stocktake_record(uuid,uuid,integer,jsonb)',
   'WHERE o.counted_by=actor) THEN',
   'WHERE o.counted_by=actor) AND NOT wms_admin_self_review(actor) THEN'),
  ('v27_stocktake_resolve(uuid,uuid,integer,text,text,jsonb,text)',
   'OR((actor=d.created_by OR EXISTS(SELECT 1 FROM stocktake_observations WHERE stocktake_id=doc AND counted_by=actor))',
   'OR(NOT wms_admin_self_review(actor) AND (actor=d.created_by OR EXISTS(SELECT 1 FROM stocktake_observations WHERE stocktake_id=doc AND counted_by=actor))'),
  ('v27_stocktake_action(uuid,uuid,integer,text,text)',
   $message$RAISE EXCEPTION '盘点差异须先由独立人员复盘，再提交物流经理审批' USING ERRCODE='23514';$message$,
   $message$RAISE EXCEPTION USING MESSAGE=CASE WHEN wms_admin_self_review(actor)
    THEN '盘点差异须先完成复盘，再提交审批'
    ELSE '盘点差异须先由独立人员复盘，再提交物流经理审批' END, ERRCODE='23514';$message$)
 ) AS changes(routine,before_text,after_text) LOOP
  SELECT pg_get_functiondef(patch.routine::regprocedure) INTO definition;
  IF strpos(definition,patch.before_text)=0 THEN
   RAISE EXCEPTION 'Administrator review guard did not match %',patch.routine;
  END IF;
  EXECUTE replace(definition,patch.before_text,patch.after_text);
 END LOOP;

 -- Only the scoped review function above can write these records as the app role.
 -- The reviewer and time stamps stay mandatory for archived approvals.
 SELECT conname INTO STRICT independence_constraint FROM pg_constraint
 WHERE conrelid='preparation_reversals'::regclass AND contype='c'
  AND strpos(pg_get_constraintdef(oid),'reviewed_by <> requested_by')>0;
 EXECUTE format('ALTER TABLE preparation_reversals DROP CONSTRAINT %I',independence_constraint);
 ALTER TABLE preparation_reversals ADD CONSTRAINT preparation_reversal_review_stamps
 CHECK(state='PENDING' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL));
END $admin_shared_approvals$;
