-- V2.3.1: additive workflow permissions and sampling history.
INSERT INTO roles(code,name) VALUES('production','生产管理人员'),('commerce','商务复核人员'),('security','安保核验人员');
INSERT INTO permissions(code) VALUES('sample:read'),('sample:write'),('weigh:read'),('weigh:write'),('load:read'),('load:write'),('outbound:read'),('outbound:packing'),('outbound:commerce'),('outbound:gate'),('outbound:depart'),('outbound:supervise'),('move:write');
INSERT INTO role_permissions SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE (r.code IN('admin','supervisor') AND p.code IN('sample:read','sample:write','weigh:read','weigh:write','load:read','load:write','outbound:read','outbound:supervise','move:write')) OR(r.code='admin' AND p.code LIKE 'outbound:%') OR(r.code IN('operator','production') AND p.code IN('sample:read','sample:write','weigh:read','weigh:write','load:read','load:write','outbound:read','move:write')) OR(r.code IN('sales','readonly','commerce','security') AND p.code IN('sample:read','weigh:read','load:read','outbound:read')) OR(r.code='production' AND p.code IN('outbound:packing','outbound:depart')) OR(r.code='commerce' AND p.code='outbound:commerce') OR(r.code='security' AND p.code='outbound:gate') OR(r.code IN('production','commerce','security') AND p.code IN('inventory:read','inventory:export','master:read')) ON CONFLICT DO NOTHING;
CREATE FUNCTION v23_require(actor uuid,permission text,project uuid,customer uuid,warehouse uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions p ON p.role_code=u.role_code WHERE u.id=actor AND u.active AND p.permission_code=permission) OR NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=actor AND s.project_id=project AND(s.customer_id IS NULL OR s.customer_id=customer) AND(s.warehouse_id IS NULL OR s.warehouse_id=warehouse)) THEN RAISE EXCEPTION 'Workflow permission or data scope denied' USING ERRCODE='23514';END IF;
END $$;
REVOKE ALL ON FUNCTION v23_require(uuid,text,uuid,uuid,uuid) FROM PUBLIC;
CREATE FUNCTION v23_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Workflow history is append-only' USING ERRCODE='23514';END $$;
CREATE FUNCTION v23_state_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' OR current_user<>'musonoi_owner' THEN RAISE EXCEPTION 'Workflow transitions require authorized database function' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TABLE sampling_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE DEFAULT('SMP-'||gen_random_uuid()::text),project_id uuid NOT NULL REFERENCES projects(id),customer_id uuid NOT NULL REFERENCES customers(id),sample_date date NOT NULL,agency text NOT NULL CHECK(length(trim(agency)) BETWEEN 1 AND 160),status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','REGISTERED','PASSED','FAILED','CANCELLED')),result text NOT NULL DEFAULT '',created_by uuid NOT NULL REFERENCES users(id),result_by uuid REFERENCES users(id),result_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,FOREIGN KEY(project_id,customer_id) REFERENCES customers(project_id,id));
CREATE TABLE sampling_items(sample_id uuid NOT NULL REFERENCES sampling_batches(id),bundle_id uuid NOT NULL REFERENCES bundles(id),original_sample_status text NOT NULL,PRIMARY KEY(sample_id,bundle_id));
CREATE INDEX sampling_bundle ON sampling_items(bundle_id);
CREATE TRIGGER sampling_state BEFORE UPDATE OR DELETE ON sampling_batches FOR EACH ROW EXECUTE FUNCTION v23_state_owner();
CREATE TRIGGER sampling_items_history BEFORE UPDATE OR DELETE ON sampling_items FOR EACH ROW EXECUTE FUNCTION v23_immutable();
CREATE TABLE workflow_attachments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN('sample','weigh')),document_id uuid NOT NULL,filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 120),mime text NOT NULL CHECK(mime IN('application/pdf','image/png','image/jpeg')),content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 262144),sha256 text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER attachment_history BEFORE UPDATE OR DELETE ON workflow_attachments FOR EACH ROW EXECUTE FUNCTION v23_immutable();
ALTER TABLE inventory_events DROP CONSTRAINT inventory_events_event_type_check;
ALTER TABLE inventory_events DROP CONSTRAINT inventory_events_check;
ALTER TABLE inventory_events ADD CHECK(event_type IN('INBOUND','LOCK','UNLOCK','SAMPLE','WEIGH','LOAD','UNLOAD','MOVE','OUTBOUND','REVERSAL'));
ALTER TABLE inventory_events ADD CHECK((event_type IN('INBOUND','REVERSAL') AND physical_delta>0) OR(event_type='OUTBOUND' AND physical_delta<0) OR(event_type IN('LOCK','UNLOCK','SAMPLE','WEIGH','LOAD','UNLOAD','MOVE') AND physical_delta=0));
CREATE OR REPLACE FUNCTION confirmed_bundle_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bundle history cannot be deleted' USING ERRCODE='23514';END IF;
 IF current_user='musonoi_owner' THEN
 IF (to_jsonb(NEW)-ARRAY['version','sample_status','location_id','physical_status'])<>(to_jsonb(OLD)-ARRAY['version','sample_status','location_id','physical_status']) THEN RAISE EXCEPTION 'Bundle weight and origin immutable' USING ERRCODE='23514';END IF;
 ELSE IF(to_jsonb(NEW)-'version')<>(to_jsonb(OLD)-'version') THEN RAISE EXCEPTION 'Direct inventory changes forbidden' USING ERRCODE='23514';END IF;END IF;
 IF NEW.version<>OLD.version+1 AND NEW.version<>OLD.version THEN RAISE EXCEPTION 'Invalid inventory version' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE OR REPLACE FUNCTION event_consistency_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.event_type NOT IN('LOCK','UNLOCK') AND current_user<>'musonoi_owner' THEN RAISE EXCEPTION 'Inventory event must use authorized function' USING ERRCODE='23514';END IF;
 IF NEW.event_type='LOCK' AND NOT EXISTS(SELECT 1 FROM reservations WHERE bundle_id=NEW.bundle_id AND allocation_id=(NEW.after_data->>'allocation_id')::uuid AND released_at IS NULL AND locked_by=NEW.actor_id) THEN RAISE EXCEPTION 'No matching active reservation' USING ERRCODE='23514';END IF;
 IF NEW.event_type='UNLOCK' AND NOT EXISTS(SELECT 1 FROM reservations WHERE bundle_id=NEW.bundle_id AND allocation_id=(NEW.after_data->>'allocation_id')::uuid AND released_at IS NOT NULL AND released_by=NEW.actor_id) THEN RAISE EXCEPTION 'No matching release' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE FUNCTION sampling_action(actor uuid,doc uuid,expected int,action text,details text DEFAULT '') RETURNS sampling_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE s sampling_batches;b bundles;w uuid;BEGIN
 SELECT * INTO s FROM sampling_batches WHERE id=doc FOR UPDATE;
 IF NOT FOUND OR s.version<>expected THEN RAISE EXCEPTION 'Sample version conflict' USING ERRCODE='23514';END IF;
 IF NOT((action='register' AND s.status='DRAFT') OR(action IN('PASSED','FAILED','cancel') AND s.status='REGISTERED')) THEN RAISE EXCEPTION 'Invalid sample transition' USING ERRCODE='23514';END IF;
 IF action<>'register' AND length(trim(details)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Result or cancellation reason required' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM sampling_items WHERE sample_id=doc) THEN RAISE EXCEPTION 'Sample is empty' USING ERRCODE='23514';END IF;
 FOR b IN SELECT x.* FROM bundles x JOIN sampling_items i ON i.bundle_id=x.id WHERE i.sample_id=doc ORDER BY x.id FOR UPDATE OF x LOOP
 SELECT warehouse_id INTO w FROM locations WHERE id=b.location_id;PERFORM v23_require(actor,'sample:write',s.project_id,s.customer_id,w);
 IF b.project_id<>s.project_id OR(action='register' AND b.physical_status<>'IN_STOCK') THEN RAISE EXCEPTION 'Sample bundle unavailable' USING ERRCODE='23514';END IF;
 END LOOP;
 UPDATE sampling_batches SET status=CASE action WHEN 'register' THEN 'REGISTERED' WHEN 'cancel' THEN 'CANCELLED' ELSE action END,result=details,result_by=CASE WHEN action='register' THEN NULL ELSE actor END,result_at=CASE WHEN action='register' THEN NULL ELSE now() END,version=version+1 WHERE id=doc RETURNING * INTO s;
 FOR b IN SELECT x.* FROM bundles x JOIN sampling_items i ON i.bundle_id=x.id WHERE i.sample_id=doc ORDER BY x.id LOOP
 UPDATE bundles SET sample_status=CASE WHEN EXISTS(SELECT 1 FROM sampling_items i JOIN sampling_batches x ON x.id=i.sample_id WHERE i.bundle_id=b.id AND x.status='REGISTERED') THEN 'SAMPLING' WHEN EXISTS(SELECT 1 FROM sampling_items i JOIN sampling_batches x ON x.id=i.sample_id WHERE i.bundle_id=b.id AND x.status IN('PASSED','FAILED')) THEN 'SAMPLED' ELSE (SELECT original_sample_status FROM sampling_items i JOIN sampling_batches x ON x.id=i.sample_id WHERE i.bundle_id=b.id ORDER BY x.created_at LIMIT 1) END,version=version+1 WHERE id=b.id;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(b.id,'SAMPLE',0,actor,jsonb_build_object('sample_id',doc,'code',s.code,'status',s.status));END LOOP;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'sample_'||action,'sampling_batches',doc::text,to_jsonb(s));RETURN s;
END $$;
REVOKE ALL ON FUNCTION sampling_action(uuid,uuid,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sampling_action(uuid,uuid,int,text,text) TO musonoi_app;
GRANT SELECT,INSERT ON sampling_batches,sampling_items,workflow_attachments TO musonoi_app;
