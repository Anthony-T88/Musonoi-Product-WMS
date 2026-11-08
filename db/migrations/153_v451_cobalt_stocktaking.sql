-- Independent cobalt counting reports. No copper or physical inventory writes.
CREATE SEQUENCE co_stocktake_number;
CREATE TABLE co_stocktakes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),code text NOT NULL UNIQUE DEFAULT('CO-CNT-'||lpad(nextval('co_stocktake_number')::text,7,'0')),project_id uuid NOT NULL REFERENCES projects(id),warehouse_id uuid NOT NULL REFERENCES warehouses(id),title text NOT NULL,status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','SUBMITTED','APPROVED','REJECTED','CANCELLED')),round integer NOT NULL DEFAULT 1,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),submitted_by uuid REFERENCES users(id),submitted_at timestamptz,reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,review_reason text,approved_report jsonb);
CREATE TABLE co_stocktake_rounds(task_id uuid NOT NULL REFERENCES co_stocktakes(id),round integer NOT NULL,snapshot jsonb NOT NULL,digest text NOT NULL,cutoff_at timestamptz NOT NULL,created_by uuid NOT NULL REFERENCES users(id),reason text NOT NULL,PRIMARY KEY(task_id,round));
CREATE TABLE co_stocktake_observations(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,task_id uuid NOT NULL,round integer NOT NULL,bag_id uuid NOT NULL REFERENCES co_bags(id),present boolean NOT NULL,actual_location_id uuid REFERENCES co_locations(id),actual_gross_kg numeric CHECK(actual_gross_kg>3 AND actual_gross_kg<'Infinity'::numeric),note text NOT NULL,counted_by uuid NOT NULL REFERENCES users(id),counted_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(task_id,round) REFERENCES co_stocktake_rounds(task_id,round),CHECK(present OR(actual_location_id IS NULL AND actual_gross_kg IS NULL)));
CREATE INDEX co_count_latest ON co_stocktake_observations(task_id,round,bag_id,id DESC);
CREATE TABLE co_stocktake_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,task_id uuid NOT NULL REFERENCES co_stocktakes(id),actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,round integer NOT NULL,note text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER co_count_task_owner BEFORE UPDATE OR DELETE ON co_stocktakes FOR EACH ROW EXECUTE FUNCTION v23_state_owner();
DO $$DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['co_stocktake_rounds','co_stocktake_observations','co_stocktake_events'] LOOP EXECUTE format('CREATE TRIGGER co_count_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION co_immutable()',tab);END LOOP;END$$;
CREATE FUNCTION v451_co_count_scope(actor uuid,p uuid,w uuid,permission text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions r ON r.role_code=u.role_code WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND r.permission_code=permission) THEN RAISE EXCEPTION 'CO_COUNT_PERMISSION' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM warehouses WHERE id=w AND project_id=p) OR NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=actor AND s.project_id=p AND(s.warehouse_id IS NULL OR s.warehouse_id=w) AND s.customer_id IS NULL) THEN RAISE EXCEPTION 'CO_COUNT_SCOPE' USING ERRCODE='23514';END IF;END$$;
CREATE FUNCTION v451_co_count_snapshot(p uuid,w uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('bag_id',i.bag_id,'bag_no',b.bag_no,'preparation_id',p1.id,'batch_no',p1.preparation_batch_no,'inventory_status',i.status,'location_id',pos.location_id,'location_code',loc.code,'position_version',pos.version,'work_version',bw.version,'actual_gross_kg',bw.actual_gross_kg::text,'actual_net_kg',bw.actual_net_kg::text,'seal_no',bw.seal_no) ORDER BY b.bag_no),'[]'::jsonb) FROM co_inventory i JOIN co_preparations p1 ON p1.id=i.preparation_id JOIN co_bags b ON b.id=i.bag_id LEFT JOIN co_positions pos ON pos.bag_id=i.bag_id LEFT JOIN co_locations loc ON loc.id=pos.location_id LEFT JOIN co_bag_work bw ON bw.bag_id=i.bag_id WHERE p1.project_id=p AND p1.warehouse_id=w AND i.status<>'OUTBOUND'$$;
CREATE FUNCTION v451_co_count_report(doc uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH task AS(SELECT * FROM co_stocktakes WHERE id=doc),latest AS(SELECT DISTINCT ON(o.bag_id) o.* FROM co_stocktake_observations o,task t WHERE o.task_id=t.id AND o.round=t.round ORDER BY o.bag_id,o.id DESC),rows AS(SELECT s.value book,o.id observation_id,o.present,o.actual_location_id,o.actual_gross_kg::text actual_gross_kg,CASE WHEN o.actual_gross_kg IS NOT NULL THEN (o.actual_gross_kg-3)::text END actual_net_kg,o.note,o.counted_by,o.counted_at,(o.id IS NOT NULL AND(NOT o.present OR o.actual_location_id IS DISTINCT FROM (s.value->>'location_id')::uuid OR(o.actual_gross_kg IS NOT NULL AND o.actual_gross_kg IS DISTINCT FROM (s.value->>'actual_gross_kg')::numeric))) difference FROM task t JOIN co_stocktake_rounds r ON r.task_id=t.id AND r.round=t.round CROSS JOIN LATERAL jsonb_array_elements(r.snapshot) s LEFT JOIN latest o ON o.bag_id=(s.value->>'bag_id')::uuid)
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(rows) ORDER BY book->>'bag_no'),'[]'::jsonb),'summary',jsonb_build_object('expected',count(*),'observed',count(observation_id),'found',count(*) FILTER(WHERE present),'missing',count(*) FILTER(WHERE present=false),'differences',count(*) FILTER(WHERE difference),'unconfirmed_weights',count(*) FILTER(WHERE present AND actual_gross_kg IS NULL)),'inventory_adjusted',false) FROM rows$$;
CREATE FUNCTION v451_co_count_action(actor uuid,doc uuid,expected integer,action text,b jsonb) RETURNS co_stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t co_stocktakes;s jsonb;current_digest text;r co_stocktake_rounds;x jsonb;bag jsonb;location uuid;gross numeric;note text;report jsonb;permission text;BEGIN
 IF action='create' THEN
  PERFORM v451_co_count_scope(actor,(b->>'project_id')::uuid,(b->>'warehouse_id')::uuid,'stocktake:write');
  IF length(btrim(coalesce(b->>'title',''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'CO_COUNT_INPUT' USING ERRCODE='23514';END IF;
  INSERT INTO co_stocktakes(project_id,warehouse_id,title,created_by) VALUES((b->>'project_id')::uuid,(b->>'warehouse_id')::uuid,btrim(b->>'title'),actor) RETURNING * INTO t;
  s:=v451_co_count_snapshot(t.project_id,t.warehouse_id);INSERT INTO co_stocktake_rounds VALUES(t.id,1,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),statement_timestamp(),actor,'Create counting baseline');
 ELSE
  SELECT * INTO t FROM co_stocktakes WHERE id=doc FOR UPDATE;
  IF NOT FOUND OR t.version<>expected THEN RAISE EXCEPTION 'CO_COUNT_STALE' USING ERRCODE='23514';END IF;
  permission:=CASE WHEN action IN('approve','reject') THEN 'stocktake:review' ELSE 'stocktake:write' END;PERFORM v451_co_count_scope(actor,t.project_id,t.warehouse_id,permission);
  IF action='observe' THEN
   IF t.status NOT IN('OPEN','REJECTED') OR jsonb_typeof(b->'items')<>'array' OR jsonb_array_length(b->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'CO_COUNT_STATE' USING ERRCODE='23514';END IF;
   SELECT * INTO r FROM co_stocktake_rounds WHERE task_id=t.id AND round=t.round;
   IF(SELECT count(*) FROM jsonb_array_elements(b->'items'))<>(SELECT count(DISTINCT value->>'bag_id') FROM jsonb_array_elements(b->'items')) THEN RAISE EXCEPTION 'CO_COUNT_INPUT' USING ERRCODE='23514';END IF;
   FOR x IN SELECT value FROM jsonb_array_elements(b->'items') LOOP
    SELECT value INTO bag FROM jsonb_array_elements(r.snapshot) WHERE value->>'bag_id'=x->>'bag_id';
    IF bag IS NULL OR jsonb_typeof(x->'present') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CO_COUNT_INPUT' USING ERRCODE='23514';END IF;
    location:=nullif(x->>'actual_location_id','')::uuid;gross:=nullif(x->>'actual_gross_kg','')::numeric;note:=coalesce(x->>'note','');
    IF length(note)>1000 OR(gross IS NOT NULL AND(gross<=3 OR gross>=100000000 OR gross::text!~'^\d+(\.\d{1,3})?$')) OR(location IS NOT NULL AND NOT EXISTS(SELECT 1 FROM co_locations WHERE id=location AND project_id=t.project_id AND warehouse_id=t.warehouse_id AND active)) THEN RAISE EXCEPTION 'CO_COUNT_INPUT' USING ERRCODE='23514';END IF;
    IF NOT(x->>'present')::boolean THEN location:=NULL;gross:=NULL;END IF;
    INSERT INTO co_stocktake_observations(task_id,round,bag_id,present,actual_location_id,actual_gross_kg,note,counted_by) VALUES(t.id,t.round,(x->>'bag_id')::uuid,(x->>'present')::boolean,location,gross,note,actor);
   END LOOP;
   UPDATE co_stocktakes SET status='OPEN',reviewed_by=NULL,reviewed_at=NULL,review_reason=NULL,version=version+1 WHERE id=t.id RETURNING * INTO t;
  ELSIF action='refresh' THEN
   IF t.status NOT IN('OPEN','REJECTED') OR length(btrim(coalesce(b->>'note','')))<5 THEN RAISE EXCEPTION 'CO_COUNT_STATE' USING ERRCODE='23514';END IF;
   s:=v451_co_count_snapshot(t.project_id,t.warehouse_id);UPDATE co_stocktakes SET round=round+1,status='OPEN',version=version+1,submitted_by=NULL,submitted_at=NULL,reviewed_by=NULL,reviewed_at=NULL WHERE id=t.id RETURNING * INTO t;
   INSERT INTO co_stocktake_rounds VALUES(t.id,t.round,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),statement_timestamp(),actor,b->>'note');
  ELSIF action IN('submit','approve') THEN
   IF action='submit' AND t.status NOT IN('OPEN','REJECTED') OR action='approve' AND t.status<>'SUBMITTED' THEN RAISE EXCEPTION 'CO_COUNT_STATE' USING ERRCODE='23514';END IF;
   s:=v451_co_count_snapshot(t.project_id,t.warehouse_id);current_digest:=encode(sha256(convert_to(s::text,'UTF8')),'hex');SELECT * INTO r FROM co_stocktake_rounds WHERE task_id=t.id AND round=t.round;
   IF current_digest<>r.digest THEN RAISE EXCEPTION 'CO_COUNT_STOCK_CHANGED' USING ERRCODE='23514';END IF;
   report:=v451_co_count_report(t.id);IF report->'summary'->>'expected'<>report->'summary'->>'observed' THEN RAISE EXCEPTION 'CO_COUNT_INCOMPLETE' USING ERRCODE='23514';END IF;
   IF action='approve' THEN
    IF actor=t.created_by OR actor=t.submitted_by OR EXISTS(SELECT 1 FROM co_stocktake_observations WHERE task_id=t.id AND round=t.round AND counted_by=actor) THEN RAISE EXCEPTION 'CO_COUNT_INDEPENDENT_REVIEW' USING ERRCODE='23514';END IF;
    UPDATE co_stocktakes SET status='APPROVED',reviewed_by=actor,reviewed_at=clock_timestamp(),review_reason=coalesce(b->>'note',''),approved_report=report||jsonb_build_object('baseline_digest',r.digest,'review_digest',current_digest,'review_cutoff_at',statement_timestamp()),version=version+1 WHERE id=t.id RETURNING * INTO t;
   ELSE UPDATE co_stocktakes SET status='SUBMITTED',submitted_by=actor,submitted_at=clock_timestamp(),version=version+1 WHERE id=t.id RETURNING * INTO t;END IF;
  ELSIF action='reject' THEN
   IF t.status<>'SUBMITTED' OR length(btrim(coalesce(b->>'note','')))<5 OR actor=t.created_by OR actor=t.submitted_by OR EXISTS(SELECT 1 FROM co_stocktake_observations WHERE task_id=t.id AND round=t.round AND counted_by=actor) THEN RAISE EXCEPTION 'CO_COUNT_INDEPENDENT_REVIEW' USING ERRCODE='23514';END IF;
   UPDATE co_stocktakes SET status='REJECTED',reviewed_by=actor,reviewed_at=clock_timestamp(),review_reason=b->>'note',version=version+1 WHERE id=t.id RETURNING * INTO t;
  ELSIF action='cancel' THEN
   IF t.status NOT IN('OPEN','REJECTED') OR length(btrim(coalesce(b->>'note','')))<5 THEN RAISE EXCEPTION 'CO_COUNT_STATE' USING ERRCODE='23514';END IF;UPDATE co_stocktakes SET status='CANCELLED',version=version+1 WHERE id=t.id RETURNING * INTO t;
  ELSE RAISE EXCEPTION 'CO_COUNT_INPUT' USING ERRCODE='23514';END IF;
 END IF;
 INSERT INTO co_stocktake_events(task_id,actor_id,action,round,note) VALUES(t.id,actor,action,t.round,left(coalesce(b->>'note',''),1000));RETURN t;END$$;
REVOKE ALL ON co_stocktakes,co_stocktake_rounds,co_stocktake_observations,co_stocktake_events FROM PUBLIC,musonoi_app;
GRANT SELECT ON co_stocktakes,co_stocktake_rounds,co_stocktake_observations,co_stocktake_events TO musonoi_app;
REVOKE ALL ON FUNCTION v451_co_count_action(uuid,uuid,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v451_co_count_action(uuid,uuid,integer,text,jsonb) TO musonoi_app;
