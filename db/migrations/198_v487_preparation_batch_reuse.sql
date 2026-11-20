-- Release only terminal, pre-final-approval cancellations. Retain all work IDs,
-- batch numbers, stock history and original approval facts.
CREATE FUNCTION copper_preparation_batch_released(workflow text, stock_state text, observation jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT coalesce(workflow='CANCELLED' AND stock_state='RELEASED' AND observation->>'work_stopped'='true',false);
$$;
REVOKE ALL ON FUNCTION copper_preparation_batch_released(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION copper_preparation_batch_released(text,text,jsonb) TO musonoi_app;

ALTER TABLE allocations DROP CONSTRAINT allocations_lot_no_key;
CREATE UNIQUE INDEX allocations_reserved_lot_no ON allocations(lot_no)
 WHERE lot_no IS NOT NULL AND NOT copper_preparation_batch_released(workflow_state,status,cancellation_observation);
ALTER TABLE co_preparations DROP CONSTRAINT co_preparations_preparation_batch_no_key;
CREATE UNIQUE INDEX co_preparations_reserved_batch_no ON co_preparations(preparation_batch_no) WHERE status<>'WITHDRAWN';

ALTER TABLE preparation_plans
 DROP CONSTRAINT preparation_plans_product_code_batch_no_key,
 DROP CONSTRAINT preparation_plans_state_check,
 DROP CONSTRAINT preparation_plans_check1,
 ADD CONSTRAINT preparation_plans_state_check CHECK(state IN('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED')),
 ADD CONSTRAINT preparation_plans_work_state_check CHECK(
  (state NOT IN('APPROVED','CANCELLED') AND num_nonnulls(allocation_id,co_preparation_id)=0)
  OR state='APPROVED' OR (state='CANCELLED' AND num_nonnulls(allocation_id,co_preparation_id)=1)
 );
CREATE UNIQUE INDEX preparation_plans_reserved_batch_no ON preparation_plans(product_code,batch_no) WHERE state<>'CANCELLED';
ALTER TABLE preparation_plan_events DROP CONSTRAINT preparation_plan_events_action_check,
 ADD CONSTRAINT preparation_plan_events_action_check CHECK(action IN('CREATE','EDIT','SUBMIT','APPROVE','REJECT','START','CANCEL'));

-- Both cancellation routes enter through the recorded work event. The plan
-- releases its batch in the same transaction and keeps its original work link.
CREATE FUNCTION preparation_plan_release_batch(work_id uuid, product text, actor uuid, cancelled_at timestamptz, note text, reconciled boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE p public.preparation_plans;
BEGIN
 IF product='CU_CATHODE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.allocations w WHERE w.id=work_id
    AND public.copper_preparation_batch_released(w.workflow_state,w.status,w.cancellation_observation)) THEN RETURN; END IF;
  UPDATE public.preparation_plans SET state='CANCELLED',version=version+1
   WHERE allocation_id=work_id AND state='APPROVED' RETURNING * INTO p;
 ELSIF product='CO_HYDROXIDE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.co_preparations w WHERE w.id=work_id AND w.status='WITHDRAWN') THEN RETURN; END IF;
  UPDATE public.preparation_plans SET state='CANCELLED',version=version+1
   WHERE co_preparation_id=work_id AND state='APPROVED' RETURNING * INTO p;
 END IF;
 IF p.id IS NOT NULL THEN
  INSERT INTO public.preparation_plan_events(plan_id,action,actor_id,occurred_at,reason)
   VALUES(p.id,'CANCEL',actor,cancelled_at,coalesce(note,''));
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,occurred_at)
   VALUES(actor,'preparation_plan_cancel','preparation_plans',p.id::text,
    jsonb_build_object('state','APPROVED'),
    jsonb_build_object('state',p.state,'version',p.version,'product_code',p.product_code,
     'project_id',p.project_id,'customer_id',p.customer_id,'warehouse_id',p.warehouse_id,
     'work_id',work_id,'reason',coalesce(note,''),'reconciled',reconciled),cancelled_at);
 END IF;
END $$;

CREATE FUNCTION preparation_plan_release_from_copper() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.preparation_plan_release_batch(NEW.allocation_id,'CU_CATHODE',NEW.actor_id,NEW.occurred_at,NEW.note);
 RETURN NULL;
END $$;

CREATE FUNCTION preparation_plan_release_from_cobalt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.preparation_plan_release_batch(NEW.preparation_id,'CO_HYDROXIDE',NEW.actor_id,NEW.occurred_at,NEW.reason);
 RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION preparation_plan_release_batch(uuid,text,uuid,timestamptz,text,boolean),
 preparation_plan_release_from_copper(),preparation_plan_release_from_cobalt() FROM PUBLIC;
CREATE TRIGGER preparation_plan_batch_after_copper_revoke AFTER INSERT ON workflow_reviews
 FOR EACH ROW WHEN (NEW.allocation_id IS NOT NULL AND NEW.action='REVOKE')
 EXECUTE FUNCTION preparation_plan_release_from_copper();
CREATE TRIGGER preparation_plan_batch_after_cobalt_withdraw AFTER INSERT ON co_events
 FOR EACH ROW WHEN (NEW.action='WITHDRAW' AND NEW.to_status='WITHDRAWN')
 EXECUTE FUNCTION preparation_plan_release_from_cobalt();

-- Reconcile previously cancelled work with the recorded cancellation actor and time.
DO $$
DECLARE item record;
BEGIN
 FOR item IN
  SELECT w.id work_id,p.product_code,w.cancelled_by actor,w.cancelled_at happened,w.cancel_note note
  FROM preparation_plans p JOIN allocations w ON w.id=p.allocation_id
  WHERE p.state='APPROVED' AND copper_preparation_batch_released(w.workflow_state,w.status,w.cancellation_observation)
   AND w.cancelled_by IS NOT NULL AND w.cancelled_at IS NOT NULL
  UNION ALL
  SELECT w.id,p.product_code,e.actor_id,e.occurred_at,e.reason
  FROM preparation_plans p JOIN co_preparations w ON w.id=p.co_preparation_id
  JOIN LATERAL (SELECT actor_id,occurred_at,reason FROM co_events WHERE preparation_id=w.id
   AND action='WITHDRAW' AND to_status='WITHDRAWN' ORDER BY id DESC LIMIT 1) e ON true
  WHERE p.state='APPROVED' AND w.status='WITHDRAWN'
 LOOP
  PERFORM preparation_plan_release_batch(item.work_id,item.product_code,item.actor,item.happened,item.note,true);
 END LOOP;
END $$;
