-- Record the actual final reviewer on the cobalt plan. Do not grant general
-- plan editing permission to a Commercial Department Manager.
DO $$DECLARE definition text;updated text;needle text;BEGIN
 SELECT pg_get_functiondef('co_sales_guard()'::regprocedure) INTO definition;
 needle:='IF NOT co_sales_authorized((d->>''updated_by'')::uuid,permission,pr,wh,cu) THEN';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Unexpected cobalt sales permission guard';END IF;
 updated:=replace(definition,needle,
 'IF TG_TABLE_NAME=''co_sales_plans'' AND TG_OP=''UPDATE'' THEN
   IF OLD.status=''OPEN'' AND NEW.status=''CLOSED'' AND v468_close_authorized(''CO_HYDROXIDE'',OLD.id,OLD.version)
    AND EXISTS(SELECT 1 FROM sales_plan_close_requests r WHERE r.product_code=''CO_HYDROXIDE'' AND r.plan_id=OLD.id AND r.plan_version=OLD.version AND r.state=''APPROVED'' AND r.applied_transaction=txid_current() AND r.commerce_reviewed_by=NEW.updated_by)
   THEN permission:=''plan:commerce-approve'';END IF;
  END IF;
  '||needle);
 EXECUTE updated;
END $$;
