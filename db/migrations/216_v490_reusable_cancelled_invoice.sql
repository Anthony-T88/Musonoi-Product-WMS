-- An unconsumed cancellation keeps its allocation history without claiming the invoice.
DROP INDEX export_license_invoice_unique;
CREATE UNIQUE INDEX export_license_invoice_unique
 ON export_license_allocations(lower(invoice_no)) WHERE state<>'RELEASED';

ALTER TABLE co_loading_plans
 DROP CONSTRAINT co_loading_plans_status_check,
 DROP CONSTRAINT co_loading_plans_check,
 ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN cancelled_by uuid REFERENCES users(id),
 ADD COLUMN cancel_reason text,
 ADD CONSTRAINT co_loading_plans_status_check CHECK(status IN('DRAFT','MATCHED','OUTBOUND','CANCELLED')),
 ADD CONSTRAINT co_loading_plans_check CHECK(
  (status IN('DRAFT','CANCELLED') AND current_load_id IS NULL)
  OR (status IN('MATCHED','OUTBOUND') AND current_load_id IS NOT NULL)),
 ADD CONSTRAINT co_loading_cancel_details CHECK(
  (status='CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND
    cancel_reason IS NOT NULL AND length(btrim(cancel_reason)) BETWEEN 1 AND 1000)
  OR (status<>'CANCELLED' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL));

DO $$
DECLARE
 guard text:=pg_get_functiondef('co_loading_plan_guard()'::regprocedure);
 action_marker text:=$marker$ELSIF NEW.last_action='DOCUMENTS' THEN$marker$;
 batch_marker text:=$marker$OR b.status<>'RECEIVED' THEN$marker$;
BEGIN
 IF strpos(guard,action_marker)=0 OR strpos(guard,batch_marker)=0 THEN
  RAISE EXCEPTION 'Expected cobalt loading plan guard';
 END IF;
 guard:=replace(guard,batch_marker,$patch$OR (b.status<>'RECEIVED' AND NOT (TG_OP='UPDATE' AND NEW.last_action='CANCEL')) THEN$patch$);
 guard:=replace(guard,action_marker,$patch$ELSIF NEW.last_action='CANCEL' THEN
   allowed:=ARRAY['status','cancelled_at','cancelled_by','cancel_reason'];
   IF OLD.status<>'DRAFT' OR NEW.status<>'CANCELLED' OR NEW.cancelled_by IS DISTINCT FROM NEW.updated_by THEN
    RAISE EXCEPTION 'CO_LOADING_STATE' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.last_action='DOCUMENTS' THEN$patch$);
 EXECUTE guard;
END $$;

DO $$
DECLARE
 readiness text:=pg_get_functiondef('v468_close_readiness(text,uuid)'::regprocedure);
 marker text:='FROM co_loading_plans p WHERE p.sales_plan_id=plan AND NOT EXISTS(';
BEGIN
 IF strpos(readiness,marker)=0 THEN RAISE EXCEPTION 'Expected cobalt close readiness query'; END IF;
 EXECUTE replace(readiness,marker,$patch$FROM co_loading_plans p WHERE p.sales_plan_id=plan AND p.status<>'CANCELLED'
   AND NOT EXISTS(SELECT 1 FROM export_license_allocations x WHERE x.co_plan_id=p.id AND x.state='RELEASED')
   AND NOT EXISTS($patch$);
END $$;
