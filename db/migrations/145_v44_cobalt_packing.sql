-- Independent cobalt PL archive. Original copper documents and cobalt stock remain untouched.
CREATE FUNCTION co_packing_source(load_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('mapping_version',1,'product_code','CO_HYDROXIDE','order_id',o.order_id,'order_code',o.snapshot->'order'->>'code','outbound_id',o.id,'outbound_no',o.code,'document_no',o.snapshot->'plan'->>'packing_list_no','preparation_batch_no',p.preparation_batch_no,'contract_no',o.snapshot->'contract'->>'contract_no','export_license_no',o.snapshot->'plan'->>'export_license_no','shipping_date',((o.snapshot->'departure'->>'departed_at')::timestamptz AT TIME ZONE 'Africa/Lubumbashi')::date::text,'terms_of_sale',coalesce(o.snapshot->'contract'->>'terms_of_sale',''),'destination',o.snapshot->'plan'->>'destination','customer',o.snapshot->'customer','transport',o.snapshot->'order'->'transport_snapshot','bag_count',(o.snapshot->'order'->>'bag_count')::integer,'actual_gross_kg',o.snapshot->'order'->>'actual_gross_kg','actual_net_kg',o.snapshot->'order'->>'actual_net_kg','cobalt_grade_pct',o.snapshot->'order'->>'cobalt_grade_pct','arecoms_input',o.snapshot->'order'->>'arecoms_input','bags',(SELECT jsonb_agg(b.bag_snapshot ORDER BY b.bag_snapshot->>'bag_no') FROM co_outbound_bags b WHERE b.outbound_id=o.id)) FROM co_outbounds o JOIN co_preparations p ON p.id=o.preparation_id JOIN co_load_executions e ON e.order_id=o.order_id WHERE o.order_id=load_id AND e.state='OUTBOUND'$$;
CREATE TABLE co_packing_documents(
 order_id uuid PRIMARY KEY REFERENCES co_loading_orders(id),outbound_id uuid NOT NULL UNIQUE REFERENCES co_outbounds(id),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),document_no text NOT NULL UNIQUE,
 revision integer NOT NULL CHECK(revision>0),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE co_packing_revisions(
 order_id uuid NOT NULL REFERENCES co_packing_documents(order_id),revision integer NOT NULL CHECK(revision>0),document_no text NOT NULL,outbound_id uuid NOT NULL REFERENCES co_outbounds(id),
 snapshot jsonb NOT NULL,template_sha256 text NOT NULL CHECK(template_sha256='669728e8b9534f6182511a8f24c4c67439815e3d458ad64cde2a709e7dfafdfb'),template_content bytea NOT NULL,
 file_sha256 text NOT NULL CHECK(length(file_sha256)=64),content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 10485760),file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 160),
 generated_by uuid NOT NULL REFERENCES users(id),generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 1000),PRIMARY KEY(order_id,revision));
CREATE TRIGGER co_packing_revisions_immutable BEFORE UPDATE OR DELETE ON co_packing_revisions FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE FUNCTION co_packing_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE s jsonb;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_PACKING_NO_DELETE' USING ERRCODE='23514';END IF;
 PERFORM id FROM co_loading_orders WHERE id=NEW.order_id FOR UPDATE;PERFORM co_execution_validate(NEW.order_id);s:=co_packing_source(NEW.order_id);
 IF s IS NULL OR NEW.document_no IS DISTINCT FROM s->>'document_no' OR NEW.outbound_id IS DISTINCT FROM(s->>'outbound_id')::uuid THEN RAISE EXCEPTION 'CO_PACKING_SOURCE_REQUIRED' USING ERRCODE='23514';END IF;
 IF NOT co_execution_authorized(NEW.updated_by,'document:generate',NEW.order_id) OR NOT co_execution_authorized(NEW.updated_by,'inventory:export',NEW.order_id) OR NOT co_execution_authorized(NEW.updated_by,'load:read',NEW.order_id) THEN RAISE EXCEPTION 'CO_PACKING_PERMISSION' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN IF NEW.revision<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION 'CO_PACKING_VERSION' USING ERRCODE='23514';END IF;
 ELSE IF NEW.revision<>OLD.revision+1 OR(to_jsonb(NEW)-ARRAY['revision','updated_by','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['revision','updated_by','updated_at']) THEN RAISE EXCEPTION 'CO_PACKING_VERSION' USING ERRCODE='23514';END IF;END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_packing_document_guard BEFORE INSERT OR UPDATE OR DELETE ON co_packing_documents FOR EACH ROW EXECUTE FUNCTION co_packing_document_guard();
CREATE FUNCTION co_packing_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE d co_packing_documents;BEGIN
 SELECT * INTO d FROM co_packing_documents WHERE order_id=NEW.order_id FOR UPDATE;
 IF d.revision<>NEW.revision OR NEW.document_no<>d.document_no OR NEW.outbound_id<>d.outbound_id OR NEW.generated_by<>d.updated_by OR(NEW.snapshot-'generated_at') IS DISTINCT FROM co_packing_source(NEW.order_id) OR encode(sha256(NEW.content),'hex')<>NEW.file_sha256 OR encode(sha256(NEW.template_content),'hex')<>NEW.template_sha256 THEN RAISE EXCEPTION 'CO_PACKING_ARCHIVE_MISMATCH' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_packing_revision_guard BEFORE INSERT ON co_packing_revisions FOR EACH ROW EXECUTE FUNCTION co_packing_revision_guard();
CREATE FUNCTION co_packing_integrity() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE doc uuid;d co_packing_documents;BEGIN
 doc:=NEW.order_id;SELECT * INTO d FROM co_packing_documents WHERE order_id=doc;
 IF(SELECT count(*) FROM co_packing_revisions WHERE order_id=doc)<>d.revision OR(SELECT max(revision) FROM co_packing_revisions WHERE order_id=doc) IS DISTINCT FROM d.revision THEN RAISE EXCEPTION 'CO_PACKING_ARCHIVE_INCOMPLETE' USING ERRCODE='23514';END IF;RETURN NULL;
END$$;
CREATE CONSTRAINT TRIGGER co_packing_document_integrity AFTER INSERT OR UPDATE ON co_packing_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_packing_integrity();
CREATE CONSTRAINT TRIGGER co_packing_revision_integrity AFTER INSERT ON co_packing_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_packing_integrity();
GRANT SELECT,INSERT,UPDATE ON co_packing_documents TO musonoi_app;
GRANT SELECT,INSERT ON co_packing_revisions TO musonoi_app;
