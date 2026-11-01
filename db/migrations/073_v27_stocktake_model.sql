-- Extend existing stocktake records and immutable observation history.
ALTER TABLE stocktakes ADD COLUMN task_type text NOT NULL DEFAULT 'MONTHLY' CHECK(task_type IN('MONTHLY','SPECIAL')),
 ADD COLUMN phase text NOT NULL DEFAULT 'IN_PROGRESS' CHECK(phase IN('DRAFT','IN_PROGRESS','REVIEW','APPROVAL','ADJUSTMENTS','COMPLETED','CANCELLED')),
 ADD COLUMN cutoff_at timestamptz,ADD COLUMN remark text NOT NULL DEFAULT '',ADD COLUMN cancelled_by uuid REFERENCES users(id),ADD COLUMN cancelled_at timestamptz,ADD COLUMN cancel_reason text,
 ADD COLUMN verified_by uuid REFERENCES users(id),ADD COLUMN verified_at timestamptz;
UPDATE stocktakes SET phase=CASE status WHEN 'APPROVED' THEN 'COMPLETED' WHEN 'SUBMITTED' THEN 'APPROVAL' ELSE 'IN_PROGRESS' END;
ALTER TABLE stocktake_observations ALTER COLUMN actual_weight DROP NOT NULL,ALTER COLUMN actual_location_id DROP NOT NULL,
 ADD COLUMN present boolean NOT NULL DEFAULT true,ADD COLUMN actual_gross numeric(14,6),ADD COLUMN actual_state text CHECK(actual_state IN('AVAILABLE','RESERVED','LOADED','DEPARTED','UNKNOWN')),
 ADD COLUMN observed_at timestamptz,ADD COLUMN replaces_id bigint REFERENCES stocktake_observations(id);
CREATE UNIQUE INDEX stocktake_one_replacement ON stocktake_observations(replaces_id) WHERE replaces_id IS NOT NULL;
CREATE INDEX stocktake_phase_created ON stocktakes(phase,created_at DESC);
CREATE INDEX stocktake_observation_bundle ON stocktake_observations(stocktake_id,pass,bundle_no,id DESC);
CREATE TABLE stocktake_resolutions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,stocktake_id uuid NOT NULL REFERENCES stocktakes(id),pass integer NOT NULL,bundle_no text NOT NULL,finding text NOT NULL,method text NOT NULL CHECK(method IN('ADJUSTMENT','VERIFIED','INBOUND')),
 adjustment_id uuid REFERENCES stock_adjustments(id),receipt_id uuid REFERENCES receipts(id),reason text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(stocktake_id,pass,bundle_no));
CREATE TRIGGER stocktake_resolution_immutable BEFORE UPDATE OR DELETE ON stocktake_resolutions FOR EACH ROW EXECUTE FUNCTION v23_immutable();
GRANT SELECT ON stocktake_resolutions TO musonoi_app;
ALTER TABLE stock_adjustments ADD COLUMN stocktake_id uuid REFERENCES stocktakes(id);
CREATE INDEX adjustments_stocktake ON stock_adjustments(stocktake_id);
CREATE FUNCTION v27_stocktake_create(actor uuid,p uuid,w uuid,f jsonb,assignee uuid,kind text,cutoff timestamptz,note text) RETURNS stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d stocktakes;r bigint;BEGIN
 r:=v24_revision();PERFORM v24_count_require(actor,'stocktake:write',p,w);PERFORM v24_count_require(assignee,'stocktake:write',p,w);
 IF kind NOT IN('MONTHLY','SPECIAL') OR cutoff IS NULL OR cutoff>clock_timestamp() OR length(coalesce(note,''))>2000 OR NOT EXISTS(SELECT 1 FROM warehouses WHERE id=w AND project_id=p AND active) OR EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN('project_id','warehouse_id','yard_id','location_id','batch_id')) THEN RAISE EXCEPTION 'V27_INVALID_COUNT_SCOPE' USING ERRCODE='23514';END IF;
 IF f->>'location_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM locations WHERE id=(f->>'location_id')::uuid AND project_id=p AND warehouse_id=w AND active) THEN RAISE EXCEPTION 'V27_INVALID_COUNT_SCOPE' USING ERRCODE='23514';END IF;
 INSERT INTO stocktakes(project_id,warehouse_id,scope,snapshot_revision,snapshot_at,assigned_to,created_by,task_type,phase,cutoff_at,remark) VALUES(p,w,f||jsonb_build_object('project_id',p,'warehouse_id',w),r,v24_posting_time(),assignee,actor,kind,'DRAFT',cutoff,coalesce(note,'')) RETURNING * INTO d;
 INSERT INTO stocktake_steps(stocktake_id,action,pass,actor_id,note) VALUES(d.id,'DRAFT',1,actor,'Snapshot is frozen only when the task starts');
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'stocktake_drafted','stocktakes',d.id::text,to_jsonb(d));RETURN d;END $$;
CREATE FUNCTION v27_stocktake_record(actor uuid,doc uuid,expected int,entries jsonb) RETURNS stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d stocktakes;x jsonb;l locations;r bigint;observed timestamptz;rev bigint;weight numeric;gross numeric;label text;previous stocktake_observations;seen text[]:='{}';BEGIN
 r:=v24_revision();SELECT * INTO d FROM stocktakes WHERE id=doc FOR UPDATE;PERFORM v24_count_require(actor,'stocktake:write',d.project_id,d.warehouse_id);
 IF d.phase<>'IN_PROGRESS' OR d.status<>'OPEN' OR d.version IS DISTINCT FROM expected OR jsonb_typeof(entries)<>'array' OR jsonb_array_length(entries) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(entries) LOOP
 label:=upper(trim(x->>'bundle_no'));IF label IS NULL OR length(label)>512 OR label !~ '^[A-Z0-9][A-Z0-9._/-]+$' OR x->>'present' NOT IN('true','false') OR v265_bundle_key(label)=ANY(seen) THEN RAISE EXCEPTION 'V27_DUPLICATE_OR_INVALID_COUNT_ROW' USING ERRCODE='23514';END IF;seen:=array_append(seen,v265_bundle_key(label));
 SELECT bundle_no INTO label FROM bundles WHERE v265_bundle_key(bundle_no)=v265_bundle_key(label) AND project_id=d.project_id;IF NOT FOUND THEN label:=upper(trim(x->>'bundle_no'));END IF;
 observed:=coalesce((x->>'observed_at')::timestamptz,v24_posting_time());IF observed<d.snapshot_at OR observed>clock_timestamp()+interval '1 second' THEN RAISE EXCEPTION 'V27_INVALID_OBSERVATION_TIME' USING ERRCODE='23514';END IF;
 SELECT max(id) INTO rev FROM inventory_revisions WHERE posted_at<=observed;rev:=coalesce(rev,d.snapshot_revision);
 IF (x->>'present')::boolean THEN
 SELECT * INTO l FROM locations WHERE id=(x->>'actual_location_id')::uuid AND project_id=d.project_id AND warehouse_id=d.warehouse_id AND active;
 IF NOT FOUND OR(d.scope->>'location_id' IS NOT NULL AND l.id::text<>d.scope->>'location_id') OR(d.scope->>'yard_id' IS NOT NULL AND l.yard_id::text IS DISTINCT FROM d.scope->>'yard_id') THEN RAISE EXCEPTION 'V27_INVALID_COUNT_SCOPE' USING ERRCODE='23514';END IF;
 ELSE l.id:=NULL;END IF;
 gross:=NULL;weight:=NULL;IF nullif(x->>'actual_gross','') IS NOT NULL THEN
 IF (x->>'actual_gross')!~'^\d{1,8}(\.\d{1,4})?$' OR(x->>'actual_gross')::numeric<=0.0025 THEN RAISE EXCEPTION 'V27_INVALID_GROSS_WEIGHT' USING ERRCODE='23514';END IF;
 gross:=(x->>'actual_gross')::numeric;weight:=gross-0.0025;END IF;
 IF nullif(x->>'replaces_id','') IS NOT NULL THEN SELECT * INTO previous FROM stocktake_observations WHERE id=(x->>'replaces_id')::bigint AND stocktake_id=doc AND pass=d.current_pass AND bundle_no=label;
 IF NOT FOUND OR length(trim(coalesce(x->>'remark','')))=0 OR EXISTS(SELECT 1 FROM stocktake_observations WHERE replaces_id=previous.id) THEN RAISE EXCEPTION 'V27_INVALID_OBSERVATION_CORRECTION' USING ERRCODE='23514';END IF;
 ELSE IF EXISTS(SELECT 1 FROM stocktake_observations WHERE stocktake_id=doc AND pass=d.current_pass AND bundle_no=label) THEN RAISE EXCEPTION 'V27_DUPLICATE_OR_INVALID_COUNT_ROW' USING ERRCODE='23514';END IF;END IF;
 INSERT INTO stocktake_observations(stocktake_id,pass,bundle_no,actual_location_id,actual_weight,observed_revision,counted_by,counted_at,remark,source,present,actual_gross,actual_state,observed_at,replaces_id)
 VALUES(doc,d.current_pass,label,l.id,weight,rev,actor,v24_posting_time(),coalesce(x->>'remark',''),'MANUAL',(x->>'present')::boolean,gross,coalesce(x->>'actual_state','UNKNOWN'),observed,(x->>'replaces_id')::bigint);
 END LOOP;
 UPDATE stocktakes SET version=version+1 WHERE id=doc RETURNING * INTO d;INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'stocktake_observed','stocktakes',doc::text,jsonb_build_object('pass',d.current_pass,'rows',jsonb_array_length(entries)));RETURN d;END $$;
REVOKE ALL ON FUNCTION v27_stocktake_create(uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text),v27_stocktake_record(uuid,uuid,int,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v27_stocktake_create(uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text),v27_stocktake_record(uuid,uuid,int,jsonb) TO musonoi_app;
