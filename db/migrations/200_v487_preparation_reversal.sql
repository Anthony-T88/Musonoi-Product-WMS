-- Keep work attempts linked independently of the plan's current assignment.
ALTER TABLE preparation_plan_events ADD COLUMN allocation_id uuid REFERENCES allocations(id),
 ADD COLUMN co_preparation_id uuid REFERENCES co_preparations(id),
 ADD CONSTRAINT preparation_plan_event_one_work CHECK(num_nonnulls(allocation_id,co_preparation_id)<=1);
ALTER TABLE preparation_plan_events DROP CONSTRAINT preparation_plan_events_action_check,
 ADD CONSTRAINT preparation_plan_events_action_check
 CHECK(action IN('CREATE','EDIT','SUBMIT','APPROVE','REJECT','START','CANCEL','WORK_CANCEL','REUSE','FINAL_REVERSE'));
CREATE INDEX preparation_plan_attempts_copper ON preparation_plan_events(allocation_id) WHERE allocation_id IS NOT NULL;
CREATE INDEX preparation_plan_attempts_cobalt ON preparation_plan_events(co_preparation_id) WHERE co_preparation_id IS NOT NULL;

UPDATE preparation_plan_events e SET allocation_id=p.allocation_id,co_preparation_id=p.co_preparation_id
 FROM preparation_plans p WHERE e.plan_id=p.id AND e.action IN('START','CANCEL');

CREATE OR REPLACE FUNCTION preparation_plan_release_batch(work_id uuid, product text, actor uuid, cancelled_at timestamptz, note text, reconciled boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE p public.preparation_plans; cu uuid; co uuid;
BEGIN
 IF product='CU_CATHODE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.allocations w WHERE w.id=work_id
    AND public.copper_preparation_batch_released(w.workflow_state,w.status,w.cancellation_observation)) THEN RETURN; END IF;
  cu:=work_id;
 ELSIF product='CO_HYDROXIDE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.co_preparations w WHERE w.id=work_id AND w.status='WITHDRAWN') THEN RETURN; END IF;
  co:=work_id;
 ELSE RETURN; END IF;
 UPDATE public.preparation_plans
 SET state='APPROVED',allocation_id=NULL,co_preparation_id=NULL,version=version+1
 WHERE state=(CASE WHEN reconciled THEN 'CANCELLED' ELSE 'APPROVED' END)
  AND (allocation_id=cu OR co_preparation_id=co)
 RETURNING * INTO p;
 IF p.id IS NULL THEN RETURN; END IF;
 INSERT INTO public.preparation_plan_events(plan_id,action,actor_id,occurred_at,reason,allocation_id,co_preparation_id)
 VALUES(p.id,CASE WHEN reconciled THEN 'REUSE' ELSE 'WORK_CANCEL' END,actor,
  CASE WHEN reconciled THEN clock_timestamp() ELSE cancelled_at END,left(coalesce(note,''),1000),cu,co);
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data)
 VALUES(actor,'preparation_plan_available_again','preparation_plans',p.id::text,
  jsonb_build_object('state',CASE WHEN reconciled THEN 'CANCELLED' ELSE 'APPROVED' END,'work_id',work_id),
  jsonb_build_object('state',p.state,'version',p.version,'product_code',p.product_code,'project_id',p.project_id,
   'customer_id',p.customer_id,'warehouse_id',p.warehouse_id,'reason',coalesce(note,''),'reconciled',reconciled));
END $$;

-- Restore an older plan only where a replacement has never claimed its batch.
DO $$
DECLARE item record;
BEGIN
 FOR item IN
  SELECT DISTINCT ON(p.product_code,p.batch_no) p.id,p.product_code,
   coalesce(p.allocation_id,p.co_preparation_id) work_id,x.actor_id,x.occurred_at,x.reason
  FROM preparation_plans p
  JOIN LATERAL(SELECT actor_id,occurred_at,reason FROM preparation_plan_events
    WHERE plan_id=p.id AND action='CANCEL' ORDER BY occurred_at DESC,id LIMIT 1)x ON true
  WHERE p.state='CANCELLED'
   AND NOT EXISTS(SELECT 1 FROM preparation_plans q WHERE q.product_code=p.product_code AND q.batch_no=p.batch_no AND q.state<>'CANCELLED')
   AND NOT EXISTS(SELECT 1 FROM allocations a WHERE a.lot_no=p.batch_no AND NOT copper_preparation_batch_released(a.workflow_state,a.status,a.cancellation_observation))
   AND NOT EXISTS(SELECT 1 FROM co_preparations c WHERE c.preparation_batch_no=p.batch_no AND c.status<>'WITHDRAWN')
  ORDER BY p.product_code,p.batch_no,x.occurred_at DESC,p.id DESC
 LOOP
  PERFORM preparation_plan_release_batch(item.work_id,item.product_code,item.actor_id,item.occurred_at,item.reason,true);
 END LOOP;
END $$;

-- Allow the owner of an unreceived cobalt job to stop active work after returning
-- it from review. Preserve the original bag identities and all field observations.
DO $$
DECLARE definition text:=pg_get_functiondef('co_document_guard()'::regprocedure);
 pattern text:='ELSIF OLD.status=''DRAFT'' AND NEW.status=''WITHDRAWN'' THEN NULL;';
BEGIN
 IF strpos(definition,pattern)=0 THEN RAISE EXCEPTION 'Expected cobalt withdrawal guard'; END IF;
 EXECUTE replace(definition,pattern,'ELSIF OLD.status IN(''DRAFT'',''PREPARING'') AND NEW.status=''WITHDRAWN'' THEN NULL;');
END $$;

INSERT INTO permissions(code) VALUES('lot:reverse-request'),('lot:reverse-review');
INSERT INTO role_permissions(role_code,permission_code)
 VALUES('site_supervisor','lot:reverse-request'),('logistics_manager','lot:reverse-review');
INSERT INTO role_permission_caps(role_code,permission_code)
 SELECT role_code,permission_code FROM role_permissions WHERE permission_code IN('lot:reverse-request','lot:reverse-review');

CREATE TABLE preparation_reversals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 allocation_id uuid REFERENCES allocations(id),
 co_preparation_id uuid REFERENCES co_preparations(id),
 product_code text GENERATED ALWAYS AS(CASE WHEN allocation_id IS NOT NULL THEN 'CU_CATHODE' ELSE 'CO_HYDROXIDE' END) STORED,
 work_id uuid GENERATED ALWAYS AS(coalesce(allocation_id,co_preparation_id)) STORED,
 original_plan_id uuid REFERENCES preparation_plans(id),
 project_id uuid NOT NULL REFERENCES projects(id),
 warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 customer_id uuid REFERENCES customers(id),
 batch_no text NOT NULL,
 work_version integer NOT NULL CHECK(work_version>0),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
 observation text NOT NULL CHECK(length(trim(observation)) BETWEEN 1 AND 1000),
 stock_snapshot jsonb NOT NULL CHECK(jsonb_typeof(stock_snapshot)='array' AND jsonb_array_length(stock_snapshot)>0),
 requested_by uuid NOT NULL REFERENCES users(id),
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','APPROVED','REJECTED')),
 reviewed_by uuid REFERENCES users(id),
 reviewed_at timestamptz,
 approval_txid bigint,
 review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=1000),
 CHECK(num_nonnulls(allocation_id,co_preparation_id)=1),
 CHECK((state='APPROVED')=(approval_txid IS NOT NULL)),
 CHECK((state='PENDING')=(reviewed_at IS NULL AND reviewed_by IS NULL)),
 CHECK(state='PENDING' OR (reviewed_by IS NOT NULL AND reviewed_by<>requested_by AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX preparation_reversal_pending ON preparation_reversals(product_code,work_id) WHERE state='PENDING';
CREATE INDEX preparation_reversal_history ON preparation_reversals(product_code,work_id,requested_at DESC);
CREATE INDEX preparation_reversal_scope ON preparation_reversals(product_code,project_id,warehouse_id,customer_id) WHERE state='PENDING';
ALTER TABLE preparation_plans ADD COLUMN reversal_id uuid UNIQUE REFERENCES preparation_reversals(id);
GRANT SELECT ON preparation_reversals TO musonoi_app;

-- Reversed cobalt inventory retains formal receipt, weight, identity and physical
-- position. A replacement plan starts new work over the same confirmed bag IDs.
ALTER TABLE co_work_batches DROP CONSTRAINT co_work_batches_status_check,
 ADD CONSTRAINT co_work_batches_status_check CHECK(status IN('PREPARING','PENDING_COMPLETION_REVIEW','COMPLETED','REVERSED'));
ALTER TABLE co_inventory DROP CONSTRAINT co_inventory_status_check,
 ADD CONSTRAINT co_inventory_status_check CHECK(status IN('PREPARING','PENDING_COMPLETION_REVIEW','COMPLETED','REVERSED','OUTBOUND'));

-- Clients can read the result, but only these owner functions write requests,
-- change stock states, and attach the replacement to a formally received batch.
CREATE FUNCTION preparation_reversal_status(product text, doc uuid, lock_rows boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE a allocations; p co_preparations; w co_work_batches; info record; snapshot jsonb; obstruction text; result jsonb;
BEGIN
 IF product='CU_CATHODE' THEN
  IF lock_rows THEN
   PERFORM s.id FROM sales_plans s JOIN allocations x ON x.plan_id=s.id WHERE x.id=doc FOR UPDATE OF s;
   PERFORM id FROM allocations WHERE id=doc FOR UPDATE;
   PERFORM b.id FROM allocation_items ai JOIN bundles b ON b.id=ai.bundle_id WHERE ai.allocation_id=doc ORDER BY b.id FOR UPDATE OF b;
  END IF;
  SELECT * INTO a FROM allocations WHERE id=doc;
  SELECT s.project_id,s.customer_id,l.warehouse_id,q.id plan_id INTO info
   FROM sales_plans s LEFT JOIN locations l ON l.id=a.planned_location_id
   LEFT JOIN preparation_plans q ON q.allocation_id=a.id WHERE s.id=a.plan_id;
  IF a.id IS NULL OR info.warehouse_id IS NULL THEN RETURN NULL; END IF;
  result:=jsonb_build_object('version',a.version,'batch_no',a.lot_no,'state',a.workflow_state);
  IF a.workflow_state IS DISTINCT FROM 'PREPARED' OR a.status<>'LOCKED' OR a.reviewed_at IS NULL THEN obstruction:='NOT_FINAL';
  ELSIF EXISTS(
   SELECT 1 FROM loading_items i JOIN reservations r ON r.id=i.reservation_id JOIN loading_orders o ON o.id=i.loading_id
   WHERE r.allocation_id=doc AND (o.completed_at IS NOT NULL OR o.actual_departed_at IS NOT NULL OR o.manager_at IS NOT NULL
    OR o.status IN('LOADED','DEPARTED','REVERSED') OR o.workflow_state IN('READY','DEPARTED_PENDING','DEPARTED_CORRECTION','OUTBOUND'))
  ) THEN obstruction:='LOADED';
  ELSIF EXISTS(SELECT 1 FROM loading_plan_lot_locks WHERE allocation_id=doc)
   OR EXISTS(SELECT 1 FROM loading_items i JOIN reservations r ON r.id=i.reservation_id JOIN loading_orders o ON o.id=i.loading_id
      WHERE r.allocation_id=doc AND i.active AND o.status<>'CANCELLED')
   THEN obstruction:='MATCHED';
  ELSIF EXISTS(SELECT 1 FROM lot_bundle_releases WHERE allocation_id=doc)
   OR EXISTS(SELECT 1 FROM allocation_items i JOIN bundles b ON b.id=i.bundle_id
    WHERE i.allocation_id=doc AND (b.physical_status<>'IN_STOCK' OR b.location_id IS NULL
     OR NOT EXISTS(SELECT 1 FROM reservations r WHERE r.allocation_id=doc AND r.bundle_id=b.id AND r.released_at IS NULL)
     OR EXISTS(SELECT 1 FROM lot_work_items x WHERE x.allocation_id=doc AND x.bundle_id=b.id AND x.sample_stage='IN_PROGRESS')
     OR EXISTS(SELECT 1 FROM adjustment_lines x JOIN stock_adjustments sa ON sa.id=x.adjustment_id
         WHERE x.bundle_no=b.bundle_no AND sa.status IN('DRAFT','PENDING'))))
   THEN obstruction:='STOCK_CONFLICT';
  END IF;
  IF obstruction IS NULL AND lock_rows THEN
   SELECT jsonb_agg(jsonb_build_object('id',b.id,'number',b.bundle_no,'location_id',b.location_id,'location',l.code,
    'warehouse_id',l.warehouse_id,'version',b.version,'gross',i.gross_weight,'net',i.net_weight,'seal',b.seal_no) ORDER BY b.id)
   INTO snapshot FROM allocation_items i JOIN bundles b ON b.id=i.bundle_id JOIN locations l ON l.id=b.location_id WHERE i.allocation_id=doc;
  END IF;
 ELSIF product='CO_HYDROXIDE' THEN
  IF lock_rows THEN
   PERFORM id FROM co_preparations WHERE id=doc FOR UPDATE;
   PERFORM preparation_id FROM co_work_batches WHERE preparation_id=doc FOR UPDATE;
   PERFORM bag_id FROM co_positions WHERE preparation_id=doc ORDER BY bag_id FOR UPDATE;
   PERFORM bag_id FROM co_inventory WHERE preparation_id=doc ORDER BY bag_id FOR UPDATE;
  END IF;
  SELECT * INTO p FROM co_preparations WHERE id=doc;
  SELECT * INTO w FROM co_work_batches WHERE preparation_id=doc;
  IF p.id IS NULL THEN RETURN NULL; END IF;
  SELECT p.project_id,p.warehouse_id,q.customer_id,q.id plan_id INTO info
   FROM (SELECT 1) x LEFT JOIN preparation_plans q ON q.co_preparation_id=doc;
  result:=jsonb_build_object('version',w.version,'batch_no',p.preparation_batch_no,'state',w.status);
  IF p.status<>'RECEIVED' OR w.status IS DISTINCT FROM 'COMPLETED' THEN obstruction:='NOT_FINAL';
  ELSIF EXISTS(SELECT 1 FROM co_load_executions WHERE preparation_id=doc)
   OR EXISTS(SELECT 1 FROM co_outbounds WHERE preparation_id=doc)
   OR EXISTS(SELECT 1 FROM co_inventory WHERE preparation_id=doc AND status='OUTBOUND')
   THEN obstruction:='LOADED';
  ELSIF EXISTS(SELECT 1 FROM co_loading_orders WHERE preparation_id=doc AND status<>'CANCELLED')
   OR EXISTS(SELECT 1 FROM co_loading_bag_locks WHERE preparation_id=doc AND released_at IS NULL)
   OR EXISTS(SELECT 1 FROM co_loading_plans d WHERE d.preparation_id=doc AND d.status='DRAFT' AND NOT EXISTS(
       SELECT 1 FROM export_license_allocations license_link WHERE license_link.co_plan_id=d.id AND license_link.state='RELEASED'))
   THEN obstruction:='MATCHED';
  ELSIF w.amendment_status='PENDING'
   OR (SELECT count(*) FROM co_inventory i JOIN co_positions pos ON pos.bag_id=i.bag_id
        WHERE i.preparation_id=doc AND i.status='COMPLETED' AND NOT i.loading_eligible AND pos.location_id IS NOT NULL)<>p.bag_count
   THEN obstruction:='STOCK_CONFLICT';
  END IF;
  IF obstruction IS NULL AND lock_rows THEN
   SELECT jsonb_agg(jsonb_build_object('id',b.id,'number',b.bag_no,'location_id',pos.location_id,'location',l.code,
    'warehouse_id',p.warehouse_id,'version',x.version,'position_version',pos.version,'gross',x.actual_gross_kg,
    'net',x.actual_net_kg,'seal',x.seal_no,'sampled',x.sampled) ORDER BY b.id)
   INTO snapshot FROM co_bags b JOIN co_positions pos ON pos.bag_id=b.id JOIN co_locations l ON l.id=pos.location_id
    JOIN co_bag_work x ON x.bag_id=b.id WHERE b.preparation_id=doc;
  END IF;
 ELSE RETURN NULL;
 END IF;
 IF lock_rows AND coalesce(jsonb_array_length(snapshot),0)=0 THEN obstruction:=coalesce(obstruction,'STOCK_CONFLICT'); END IF;
 RETURN result||jsonb_build_object('project_id',info.project_id,'warehouse_id',info.warehouse_id,'customer_id',info.customer_id,
  'plan_id',info.plan_id,'block',obstruction,'snapshot',snapshot);
END $$;

CREATE FUNCTION preparation_reversal_authorize(actor uuid, product text, doc uuid, review boolean, facts jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE permission text:=CASE WHEN review THEN 'lot:reverse-review' ELSE 'lot:reverse-request' END;
 fixed_role text:=CASE WHEN review THEN 'logistics_manager' ELSE 'site_supervisor' END;
BEGIN
 IF facts IS NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND u.role_code=fixed_role)
  THEN RAISE EXCEPTION 'PREPARATION_REVERSAL_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM v23_require(actor,permission,(facts->>'project_id')::uuid,(facts->>'customer_id')::uuid,(facts->>'warehouse_id')::uuid);
 IF product='CU_CATHODE' THEN
  PERFORM v23_require(actor,permission,(facts->>'project_id')::uuid,(facts->>'customer_id')::uuid,l.warehouse_id)
  FROM allocation_items i JOIN bundles b ON b.id=i.bundle_id JOIN locations l ON l.id=b.location_id WHERE i.allocation_id=doc;
 ELSIF NOT co_work_authorized(actor,permission,doc,fixed_role) THEN
  RAISE EXCEPTION 'PREPARATION_REVERSAL_FORBIDDEN' USING ERRCODE='42501';
 END IF;
END $$;

CREATE FUNCTION preparation_reversal_request(actor uuid, product text, doc uuid, expected integer, note text, checked_stock text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE facts jsonb; rid uuid;
BEGIN
 facts:=preparation_reversal_status(product,doc,true);
 PERFORM preparation_reversal_authorize(actor,product,doc,false,facts);
 IF facts->>'block' IS NOT NULL THEN RAISE EXCEPTION 'PREPARATION_REVERSAL_%',facts->>'block' USING ERRCODE='23514'; END IF;
 IF (facts->>'version')::int IS DISTINCT FROM expected THEN RAISE EXCEPTION 'PREPARATION_REVERSAL_STALE' USING ERRCODE='23514'; END IF;
 INSERT INTO preparation_reversals(allocation_id,co_preparation_id,original_plan_id,project_id,warehouse_id,customer_id,batch_no,
  work_version,reason,observation,stock_snapshot,requested_by)
 VALUES(CASE WHEN product='CU_CATHODE' THEN doc END,CASE WHEN product='CO_HYDROXIDE' THEN doc END,
  (facts->>'plan_id')::uuid,(facts->>'project_id')::uuid,(facts->>'warehouse_id')::uuid,(facts->>'customer_id')::uuid,
  facts->>'batch_no',expected,trim(note),trim(checked_stock),facts->'snapshot',actor)
 RETURNING id INTO rid;
 RETURN rid;
END $$;

CREATE FUNCTION preparation_reversal_review(actor uuid, product text, doc uuid, rid uuid, decision text, note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE facts jsonb; q preparation_reversals; ap allocations; cw co_work_batches; stock record; reversed_at timestamptz:=clock_timestamp();
BEGIN
 facts:=preparation_reversal_status(product,doc,true);
 PERFORM preparation_reversal_authorize(actor,product,doc,true,facts);
 SELECT * INTO q FROM preparation_reversals WHERE id=rid AND product_code=product AND work_id=doc FOR UPDATE;
 IF q.state IS DISTINCT FROM 'PENDING' THEN RAISE EXCEPTION 'PREPARATION_REVERSAL_HANDLED' USING ERRCODE='23514'; END IF;
 IF actor=q.requested_by THEN RAISE EXCEPTION 'PREPARATION_REVERSAL_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF decision NOT IN('APPROVED','REJECTED') OR note IS NULL OR length(trim(note)) NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION 'PREPARATION_REVERSAL_INVALID' USING ERRCODE='23514';
 END IF;
 IF decision='APPROVED' THEN
  IF facts->>'block' IS NOT NULL THEN RAISE EXCEPTION 'PREPARATION_REVERSAL_%',facts->>'block' USING ERRCODE='23514'; END IF;
  IF (facts->>'version')::int IS DISTINCT FROM q.work_version OR facts->'snapshot' IS DISTINCT FROM q.stock_snapshot
   OR (facts->>'plan_id')::uuid IS DISTINCT FROM q.original_plan_id THEN
   RAISE EXCEPTION 'PREPARATION_REVERSAL_STALE' USING ERRCODE='23514';
  END IF;
 END IF;
 UPDATE preparation_reversals SET state=decision,reviewed_by=actor,reviewed_at=reversed_at,review_note=trim(note),
  approval_txid=CASE WHEN decision='APPROVED' THEN txid_current() END WHERE id=rid;
 IF decision='REJECTED' THEN RETURN rid; END IF;
 IF q.original_plan_id IS NOT NULL THEN
  UPDATE preparation_plans SET state='CANCELLED',version=version+1 WHERE id=q.original_plan_id AND state='APPROVED';
  IF NOT FOUND THEN RAISE EXCEPTION 'PREPARATION_REVERSAL_STALE' USING ERRCODE='23514'; END IF;
  INSERT INTO preparation_plan_events(plan_id,action,actor_id,reason,allocation_id,co_preparation_id)
   VALUES(q.original_plan_id,'FINAL_REVERSE',actor,trim(note),q.allocation_id,q.co_preparation_id);
 END IF;
 IF product='CU_CATHODE' THEN
  SELECT * INTO ap FROM allocations WHERE id=doc;
  PERFORM v24_revision();
  UPDATE allocations SET workflow_state='CANCELLED',status='RELEASED',cancelled_by=actor,cancelled_at=reversed_at,
   cancel_note=q.reason,cancellation_observation=jsonb_build_object('reversal_id',rid,'physical_state_verified',true,'observation',q.observation),
   released_at=reversed_at,release_reason=q.reason,version=version+1 WHERE id=doc;
  FOR stock IN SELECT b.id,b.location_id FROM allocation_items i JOIN bundles b ON b.id=i.bundle_id WHERE i.allocation_id=doc ORDER BY b.id LOOP
   UPDATE reservations SET released_at=reversed_at,released_by=actor,release_reason=q.reason
    WHERE allocation_id=doc AND bundle_id=stock.id AND released_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'PREPARATION_REVERSAL_STALE' USING ERRCODE='23514'; END IF;
   INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data)
    VALUES(stock.id,'UNLOCK',0,actor,jsonb_build_object('allocation_id',doc,'basis','FINAL_REVERSAL',
     'reversal_id',rid,'reason',q.reason,'physical_location_id',stock.location_id));
   PERFORM v24_capture_bundle(stock.id);
  END LOOP;
  INSERT INTO workflow_reviews(allocation_id,action,actor_id,note) VALUES(doc,'FINAL_REVERSE',actor,trim(note));
  INSERT INTO lot_work_history(allocation_id,action,actor_id,before_data,after_data,note)
   VALUES(doc,'FINAL_REVERSE',actor,to_jsonb(ap),jsonb_build_object('reversal_id',rid,'workflow_state','CANCELLED'),q.reason);
  PERFORM v262_sync_claims();
 ELSE
  UPDATE co_work_batches SET status='REVERSED',version=version+1,updated_by=actor,updated_at=reversed_at,
   last_action='FINAL_REVERSAL',last_reason=q.reason WHERE preparation_id=doc RETURNING * INTO cw;
  UPDATE co_inventory SET status='REVERSED' WHERE preparation_id=doc;
  INSERT INTO co_events(preparation_id,actor_id,action,from_status,to_status,reason)
   VALUES(doc,actor,'FINAL_REVERSAL','COMPLETED','REVERSED',q.reason);
 END IF;
 RETURN rid;
END $$;

CREATE FUNCTION cobalt_preparation_restart(actor uuid, new_plan uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p preparation_plans; q preparation_reversals; w co_work_batches; document co_preparations;
BEGIN
 SELECT * INTO p FROM preparation_plans WHERE id=new_plan FOR UPDATE;
 SELECT * INTO q FROM preparation_reversals WHERE id=p.reversal_id;
 SELECT * INTO document FROM co_preparations WHERE id=q.co_preparation_id FOR UPDATE;
 SELECT * INTO q FROM preparation_reversals WHERE id=p.reversal_id FOR UPDATE;
 SELECT * INTO w FROM co_work_batches WHERE preparation_id=document.id FOR UPDATE;
 IF p.state IS DISTINCT FROM 'APPROVED' OR p.co_preparation_id IS NOT NULL OR q.state IS DISTINCT FROM 'APPROVED'
  OR w.status IS DISTINCT FROM 'REVERSED' OR document.preparation_batch_no<>q.batch_no OR p.batch_no=q.batch_no
  OR (p.project_id,p.warehouse_id) IS DISTINCT FROM(q.project_id,q.warehouse_id)
  OR (q.customer_id IS NOT NULL AND q.customer_id IS DISTINCT FROM p.customer_id) THEN
  RAISE EXCEPTION 'PREPARATION_REVERSAL_STALE' USING ERRCODE='23514';
 END IF;
 PERFORM v23_require(actor,'co:create',p.project_id,p.customer_id,p.warehouse_id);
 IF NOT co_work_authorized(actor,'co:create',document.id) THEN RAISE EXCEPTION 'PREPARATION_REVERSAL_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM co_sales_plans s WHERE s.id=p.co_sales_plan_id AND s.status='OPEN' AND s.project_id=p.project_id
   AND s.customer_id=p.customer_id AND s.warehouse_id=p.warehouse_id)
  OR EXISTS(SELECT 1 FROM sales_plan_approvals a WHERE a.product_code=p.product_code AND a.plan_id=p.sales_plan_id AND a.state<>'APPROVED')
  OR EXISTS(SELECT 1 FROM co_load_executions WHERE preparation_id=document.id)
  OR (SELECT count(*) FROM co_inventory WHERE preparation_id=document.id AND status='REVERSED')<>document.bag_count
  THEN RAISE EXCEPTION 'PREPARATION_REVERSAL_STALE' USING ERRCODE='23514';
 END IF;
 -- The original plan retains the archive link in its final-reversal event.
 UPDATE preparation_plans SET co_preparation_id=NULL,version=version+1 WHERE co_preparation_id=document.id AND state='CANCELLED';
 UPDATE co_preparations SET preparation_batch_no=p.batch_no,version=version+1 WHERE id=document.id;
 UPDATE co_work_batches SET status='PREPARING',amendment_status='NONE',version=version+1,updated_by=actor,
  updated_at=clock_timestamp(),last_action='REVERSAL_RESTART',last_reason=q.batch_no WHERE preparation_id=document.id;
 UPDATE co_inventory SET status='PREPARING' WHERE preparation_id=document.id;
 INSERT INTO co_events(preparation_id,actor_id,action,from_status,to_status,reason)
  VALUES(document.id,actor,'REVERSAL_RESTART','REVERSED','PREPARING',q.batch_no);
 UPDATE preparation_plans SET co_preparation_id=document.id,version=version+1 WHERE id=p.id;
 INSERT INTO preparation_plan_events(plan_id,action,actor_id,co_preparation_id)
  VALUES(p.id,'START',actor,document.id);
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data)
  VALUES(actor,'preparation_plan_start','preparation_plans',p.id::text,
   jsonb_build_object('work_id',document.id,'project_id',p.project_id,'warehouse_id',p.warehouse_id,
    'customer_id',p.customer_id,'product_code',p.product_code,'reversal_id',q.id,'batch_no',p.batch_no));
 RETURN document.id;
END $$;

-- A cancelled plan can retain its archived event even after the physical
-- cobalt receipt is assigned to its successor.
ALTER TABLE preparation_plans DROP CONSTRAINT preparation_plans_work_state_check,
 ADD CONSTRAINT preparation_plans_work_state_check CHECK(
  state IN('APPROVED','CANCELLED') OR num_nonnulls(allocation_id,co_preparation_id)=0);

DO $$
DECLARE d text:=pg_get_functiondef('co_document_guard()'::regprocedure);
 needle text:=' IF (to_jsonb(NEW)-ARRAY[';
BEGIN
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Expected cobalt document identity guard'; END IF;
 EXECUTE replace(d,needle,$patch$
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND OLD.status='RECEIVED'
   AND NEW.version=OLD.version+1 AND NEW.preparation_batch_no<>OLD.preparation_batch_no
   AND (to_jsonb(NEW)-ARRAY['version','preparation_batch_no'])=(to_jsonb(OLD)-ARRAY['version','preparation_batch_no'])
   AND EXISTS(SELECT 1 FROM preparation_plans p JOIN preparation_reversals q ON q.id=p.reversal_id
    JOIN co_work_batches current_work ON current_work.preparation_id=q.co_preparation_id
    WHERE q.co_preparation_id=OLD.id AND q.batch_no=OLD.preparation_batch_no AND q.state='APPROVED'
     AND p.batch_no=NEW.preparation_batch_no AND p.state='APPROVED' AND p.co_preparation_id IS NULL AND current_work.status='REVERSED')
 THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY[$patch$);
END $$;

DO $$
DECLARE d text:=pg_get_functiondef('co_work_batch_guard()'::regprocedure);
 needle text:=' IF NEW.last_action IN(''WORK_SAVE'',''BULK_WEIGHT'',''BULK_SAMPLE'') THEN';
BEGIN
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Expected cobalt work guard'; END IF;
 EXECUTE replace(d,needle,$patch$
 IF NEW.last_action='FINAL_REVERSAL' THEN
  IF current_user<>'musonoi_owner' OR OLD.status<>'COMPLETED' OR NEW.status<>'REVERSED'
   OR NOT EXISTS(SELECT 1 FROM preparation_reversals q WHERE q.co_preparation_id=p.id AND q.state='APPROVED'
    AND q.batch_no=p.preparation_batch_no AND q.work_version=OLD.version AND q.reviewed_by=NEW.updated_by)
  THEN RAISE EXCEPTION 'CO_WORK_REVIEW_INVALID' USING ERRCODE='23514'; END IF;
  allowed:=allowed||ARRAY['status'];
 ELSIF NEW.last_action='REVERSAL_RESTART' THEN
  IF current_user<>'musonoi_owner' OR OLD.status<>'REVERSED' OR NEW.status<>'PREPARING' OR NEW.amendment_status<>'NONE'
   OR NOT co_work_authorized(NEW.updated_by,'co:create',p.id)
   OR NOT EXISTS(SELECT 1 FROM preparation_plans pp JOIN preparation_reversals q ON q.id=pp.reversal_id
     WHERE q.co_preparation_id=p.id AND q.state='APPROVED' AND pp.batch_no=p.preparation_batch_no
      AND pp.state='APPROVED' AND pp.co_preparation_id IS NULL)
  THEN RAISE EXCEPTION 'CO_WORK_REVIEW_INVALID' USING ERRCODE='23514'; END IF;
  allowed:=allowed||ARRAY['status','amendment_status'];
 ELSIF NEW.last_action IN('WORK_SAVE','BULK_WEIGHT','BULK_SAMPLE') THEN$patch$);
END $$;

REVOKE ALL ON FUNCTION preparation_reversal_status(text,uuid,boolean),
 preparation_reversal_authorize(uuid,text,uuid,boolean,jsonb),preparation_reversal_request(uuid,text,uuid,integer,text,text),
 preparation_reversal_review(uuid,text,uuid,uuid,text,text),cobalt_preparation_restart(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preparation_reversal_status(text,uuid,boolean),
 preparation_reversal_request(uuid,text,uuid,integer,text,text),preparation_reversal_review(uuid,text,uuid,uuid,text,text),
 cobalt_preparation_restart(uuid,uuid) TO musonoi_app;

-- The reservation guard keeps its original permission for every legacy release.
-- Only the same transaction as an approved reversal may use its narrower review grant.
DO $$
DECLARE d text:=pg_get_functiondef('reservation_guard()'::regprocedure);
 needle text:='PERFORM v23_require(NEW.released_by,''allocation:write'',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));';
BEGIN
 IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Expected copper reservation release guard'; END IF;
 EXECUTE replace(d,needle,$patch$
  PERFORM v23_require(NEW.released_by,
   CASE WHEN current_user='musonoi_owner' AND EXISTS(
    SELECT 1 FROM preparation_reversals pr WHERE pr.allocation_id=NEW.allocation_id AND pr.state='APPROVED'
     AND pr.reviewed_by=NEW.released_by AND pr.reviewed_at=NEW.released_at AND pr.approval_txid=txid_current()
     AND pr.id::text=a.cancellation_observation->>'reversal_id'
   ) THEN 'lot:reverse-review' ELSE 'allocation:write' END,
   p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));$patch$);
END $$;
