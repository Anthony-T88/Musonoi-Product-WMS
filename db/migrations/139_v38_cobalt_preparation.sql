-- Independent CO_HYDROXIDE model. No changes to copper business tables or views.
CREATE SEQUENCE co_preparation_number;
CREATE TABLE co_production_batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),
 project_id uuid NOT NULL REFERENCES projects(id),code text NOT NULL CHECK(length(code) BETWEEN 1 AND 80),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,code),UNIQUE(id,project_id));
CREATE TABLE co_preparations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),
 document_no text NOT NULL UNIQUE,preparation_batch_no text NOT NULL UNIQUE CHECK(preparation_batch_no=replace(document_no,'CO-PREP-','CO-LOT-')),
 project_id uuid NOT NULL REFERENCES projects(id),warehouse_id uuid NOT NULL REFERENCES warehouses(id),business_date date NOT NULL,
 bag_count integer NOT NULL CHECK(bag_count BETWEEN 1 AND 10000),status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','SITE_PENDING','PRODUCTION_PENDING','REJECTED','WITHDRAWN','RECEIVED')),
 version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),submitted_by uuid REFERENCES users(id),submitted_at timestamptz,
 site_reviewed_by uuid REFERENCES users(id),site_reviewed_at timestamptz,production_reviewed_by uuid REFERENCES users(id),production_reviewed_at timestamptz,
 CHECK(status NOT IN('PRODUCTION_PENDING','RECEIVED') OR (site_reviewed_by IS NOT NULL AND site_reviewed_at IS NOT NULL AND site_reviewed_by<>created_by)),
 CHECK(status<>'RECEIVED' OR (production_reviewed_by IS NOT NULL AND production_reviewed_at IS NOT NULL AND production_reviewed_at>=site_reviewed_at AND production_reviewed_by<>created_by AND production_reviewed_by<>site_reviewed_by)),
 UNIQUE(id,project_id));
CREATE TABLE co_preparation_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),preparation_id uuid NOT NULL,project_id uuid NOT NULL,production_batch_id uuid NOT NULL,
 bag_count integer NOT NULL CHECK(bag_count BETWEEN 1 AND 10000),
 FOREIGN KEY(preparation_id,project_id) REFERENCES co_preparations(id,project_id),FOREIGN KEY(production_batch_id,project_id) REFERENCES co_production_batches(id,project_id),UNIQUE(preparation_id,production_batch_id),UNIQUE(id,preparation_id));
CREATE TABLE co_number_counters(business_date date PRIMARY KEY,last_number bigint NOT NULL CHECK(last_number>0));
CREATE TABLE co_bags(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),
 preparation_id uuid NOT NULL REFERENCES co_preparations(id),line_id uuid NOT NULL,FOREIGN KEY(line_id,preparation_id) REFERENCES co_preparation_lines(id,preparation_id),
 business_date date NOT NULL,daily_number bigint NOT NULL CHECK(daily_number>0),bag_no text NOT NULL UNIQUE,
 expected_gross_kg numeric(12,3) NOT NULL DEFAULT 650 CHECK(expected_gross_kg=650),packaging_kg numeric(12,3) NOT NULL DEFAULT 3 CHECK(packaging_kg=3),expected_net_kg numeric(12,3) GENERATED ALWAYS AS(expected_gross_kg-packaging_kg) STORED,
 UNIQUE(business_date,daily_number),UNIQUE(id,preparation_id));
CREATE TABLE co_inventory(
 bag_id uuid PRIMARY KEY,preparation_id uuid NOT NULL,FOREIGN KEY(bag_id,preparation_id) REFERENCES co_bags(id,preparation_id),
 product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),status text NOT NULL DEFAULT 'PREPARING' CHECK(status='PREPARING'),
 loading_eligible boolean NOT NULL DEFAULT false CHECK(NOT loading_eligible),received_at timestamptz NOT NULL DEFAULT now(),received_by uuid NOT NULL REFERENCES users(id));
CREATE TABLE co_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,preparation_id uuid NOT NULL REFERENCES co_preparations(id),actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,from_status text,to_status text NOT NULL,reason text,occurred_at timestamptz NOT NULL DEFAULT now(),CHECK(action<>'REJECT' OR (reason IS NOT NULL AND length(trim(reason))>0)));
CREATE TABLE co_requests(actor_id uuid NOT NULL REFERENCES users(id),route text NOT NULL,key text NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,route,key));
CREATE INDEX co_preparations_scope ON co_preparations(project_id,warehouse_id,created_at DESC);
CREATE INDEX co_bags_document ON co_bags(preparation_id,daily_number);
CREATE INDEX co_events_document ON co_events(preparation_id,id);
CREATE FUNCTION co_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'CO_RECORD_IMMUTABLE' USING ERRCODE='23514';END$$;
CREATE TRIGGER co_bags_immutable BEFORE UPDATE OR DELETE ON co_bags FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE TRIGGER co_lines_immutable BEFORE UPDATE OR DELETE ON co_preparation_lines FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE TRIGGER co_batches_immutable BEFORE UPDATE OR DELETE ON co_production_batches FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE TRIGGER co_inventory_immutable BEFORE UPDATE OR DELETE ON co_inventory FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE TRIGGER co_events_immutable BEFORE UPDATE OR DELETE ON co_events FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE TRIGGER co_requests_immutable BEFORE UPDATE OR DELETE ON co_requests FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE FUNCTION co_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF TG_OP='DELETE' OR NEW.business_date<>OLD.business_date OR NEW.last_number<=OLD.last_number THEN RAISE EXCEPTION 'CO_COUNTER_CANNOT_REUSE' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE TRIGGER co_counter_monotonic BEFORE UPDATE OR DELETE ON co_number_counters FOR EACH ROW EXECUTE FUNCTION co_counter_guard();
CREATE FUNCTION co_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_DOCUMENT_CANNOT_DELETE' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-ARRAY['status','version','submitted_by','submitted_at','site_reviewed_by','site_reviewed_at','production_reviewed_by','production_reviewed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','submitted_by','submitted_at','site_reviewed_by','site_reviewed_at','production_reviewed_by','production_reviewed_at']) THEN RAISE EXCEPTION 'CO_DOCUMENT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.version<>OLD.version+1 OR NOT ((OLD.status IN('DRAFT','REJECTED') AND NEW.status IN('SITE_PENDING','WITHDRAWN')) OR (OLD.status='SITE_PENDING' AND NEW.status IN('PRODUCTION_PENDING','REJECTED','WITHDRAWN')) OR (OLD.status='PRODUCTION_PENDING' AND NEW.status IN('RECEIVED','REJECTED'))) THEN RAISE EXCEPTION 'CO_INVALID_TRANSITION' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE TRIGGER co_document_transition BEFORE UPDATE OR DELETE ON co_preparations FOR EACH ROW EXECUTE FUNCTION co_document_guard();
CREATE FUNCTION co_bag_identity() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE d co_preparations;BEGIN
 SELECT * INTO d FROM co_preparations WHERE id=NEW.preparation_id;
 IF d.status<>'DRAFT' OR d.business_date<>NEW.business_date OR NEW.bag_no<>('MUS-CO-'||to_char(d.business_date,'YYMMDD')||'-'||CASE WHEN NEW.daily_number<1000 THEN lpad(NEW.daily_number::text,3,'0') ELSE NEW.daily_number::text END) OR NOT EXISTS(SELECT 1 FROM co_number_counters WHERE business_date=NEW.business_date AND last_number>=NEW.daily_number) THEN RAISE EXCEPTION 'CO_BAG_IDENTITY_INVALID' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE TRIGGER co_bag_identity_check BEFORE INSERT ON co_bags FOR EACH ROW EXECUTE FUNCTION co_bag_identity();
CREATE FUNCTION co_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT 1 FROM co_preparations WHERE id=NEW.preparation_id AND status='RECEIVED' AND production_reviewed_by=NEW.received_by) THEN RAISE EXCEPTION 'CO_PRODUCTION_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE TRIGGER co_receipt_check BEFORE INSERT ON co_inventory FOR EACH ROW EXECUTE FUNCTION co_receipt_guard();
CREATE FUNCTION co_document_complete() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE d co_preparations;BEGIN
 SELECT * INTO d FROM co_preparations WHERE id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM warehouses WHERE id=d.warehouse_id AND project_id=d.project_id) OR d.bag_count<>(SELECT coalesce(sum(bag_count),0) FROM co_preparation_lines WHERE preparation_id=d.id) OR d.bag_count<>(SELECT count(*) FROM co_bags WHERE preparation_id=d.id) OR EXISTS(SELECT 1 FROM co_preparation_lines l WHERE l.preparation_id=d.id AND l.bag_count<>(SELECT count(*) FROM co_bags WHERE line_id=l.id)) OR (SELECT count(*) FROM co_inventory WHERE preparation_id=d.id)<>(CASE WHEN d.status='RECEIVED' THEN d.bag_count ELSE 0 END) THEN RAISE EXCEPTION 'CO_DOCUMENT_OR_RECEIPT_INCOMPLETE' USING ERRCODE='23514';END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER co_document_completeness AFTER INSERT OR UPDATE ON co_preparations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_document_complete();
-- Explicit new permissions; existing permission and role rows are preserved.
INSERT INTO permissions(code) VALUES('co:read'),('co:create'),('co:submit'),('co:site-review'),('co:production-review'),('co:withdraw');
INSERT INTO role_permissions(role_code,permission_code) SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE p.code LIKE 'co:%' AND (r.code='admin' OR (p.code='co:read' AND r.code IN('logistics_field_operator','logistics_office_operator','logistics_manager','site_supervisor','production_operator','production_manager','export_supervisor')) OR (p.code IN('co:create','co:submit','co:withdraw') AND r.code IN('logistics_field_operator','logistics_office_operator')) OR (p.code='co:site-review' AND r.code='site_supervisor') OR (p.code='co:production-review' AND r.code='production_manager'));
INSERT INTO role_permission_caps SELECT role_code,permission_code FROM role_permissions WHERE permission_code LIKE 'co:%';
GRANT SELECT,INSERT ON co_production_batches,co_preparation_lines,co_bags,co_inventory,co_events,co_requests TO musonoi_app;
GRANT SELECT,INSERT,UPDATE ON co_preparations,co_number_counters TO musonoi_app;
GRANT USAGE,SELECT ON SEQUENCE co_preparation_number,co_events_id_seq TO musonoi_app;
