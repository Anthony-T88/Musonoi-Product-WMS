-- Shared commercial/transport header is entered on the loading schedule.
-- Nullable additions preserve every historical group/document exactly as recorded.
ALTER TABLE loading_plan_groups ADD COLUMN invoice_no text,
 ADD COLUMN packing_list_no text GENERATED ALWAYS AS (CASE WHEN invoice_no IS NULL THEN NULL ELSE invoice_no||'PL' END) STORED,
 ADD COLUMN export_license_no text NOT NULL DEFAULT '',ADD COLUMN transporter text NOT NULL DEFAULT '',ADD COLUMN destination text NOT NULL DEFAULT '',
 ADD COLUMN updated_by uuid REFERENCES users(id),
 ADD CONSTRAINT loading_plan_header_lengths CHECK(invoice_no IS NULL OR(length(invoice_no) BETWEEN 1 AND 78 AND invoice_no=trim(invoice_no))),
 ADD CONSTRAINT loading_plan_transport_lengths CHECK(length(export_license_no)<=160 AND length(transporter)<=160 AND length(destination)<=1000);
ALTER TABLE loading_plan_documents ADD COLUMN invoice_no text;
CREATE FUNCTION v31_group_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' AND NEW.invoice_no IS NULL THEN RAISE EXCEPTION '请填写发票号，装箱单号将自动生成为发票号加PL' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.invoice_no,NEW.export_license_no,NEW.transporter,NEW.destination) IS DISTINCT FROM ROW(OLD.invoice_no,OLD.export_license_no,OLD.transporter,OLD.destination) THEN
 IF EXISTS(SELECT 1 FROM loading_plan_documents d JOIN loading_plan_matches m ON m.document_id=d.id WHERE d.group_id=OLD.id AND v31_load_posted(m.loading_id)) THEN RAISE EXCEPTION '已有车辆正式出库，发票及公共运输资料已锁定，不得修改' USING ERRCODE='23514';END IF;
 IF NEW.updated_by IS NULL THEN RAISE EXCEPTION '计划修改操作人缺失' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER loading_plan_header_guard BEFORE INSERT OR UPDATE ON loading_plan_groups FOR EACH ROW EXECUTE FUNCTION v31_group_header_guard();
CREATE FUNCTION v31_document_header_inherit() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE g loading_plan_groups;BEGIN
 SELECT * INTO g FROM loading_plan_groups WHERE id=NEW.group_id;
 IF g.invoice_no IS NOT NULL THEN
 NEW.invoice_no:=g.invoice_no;NEW.packing_list_no:=g.packing_list_no;NEW.export_license_no:=g.export_license_no;NEW.transporter:=g.transporter;NEW.destination:=g.destination;
 ELSIF TG_OP='INSERT' THEN RAISE EXCEPTION '请先在装车计划补充发票及运输资料，再创建车辆计划单' USING ERRCODE='23514';
 ELSIF NEW.packing_list_no IS DISTINCT FROM OLD.packing_list_no OR NEW.invoice_no IS DISTINCT FROM OLD.invoice_no THEN RAISE EXCEPTION '历史装箱单号不可手工修改；请在所属装车计划补充发票资料' USING ERRCODE='23514';
 END IF;RETURN NEW;END $$;
CREATE TRIGGER loading_plan_inherit_header BEFORE INSERT OR UPDATE ON loading_plan_documents FOR EACH ROW EXECUTE FUNCTION v31_document_header_inherit();
CREATE FUNCTION v31_group_header_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d loading_plan_documents;p sales_plans;n loading_plan_documents;BEGIN
 IF ROW(NEW.invoice_no,NEW.export_license_no,NEW.transporter,NEW.destination) IS NOT DISTINCT FROM ROW(OLD.invoice_no,OLD.export_license_no,OLD.transporter,OLD.destination) THEN RETURN NEW;END IF;
 SELECT * INTO p FROM sales_plans WHERE id=NEW.sales_plan_id;PERFORM v31_require_plan(NEW.updated_by,'loading-plan:write',p.project_id,p.customer_id);
 FOR d IN SELECT * FROM loading_plan_documents WHERE group_id=NEW.id AND cancelled_at IS NULL ORDER BY id FOR UPDATE LOOP
 UPDATE loading_plan_documents SET invoice_no=NEW.invoice_no,packing_list_no=NEW.packing_list_no,export_license_no=NEW.export_license_no,transporter=NEW.transporter,destination=NEW.destination,version=version+1,updated_at=clock_timestamp() WHERE id=d.id RETURNING * INTO n;
 PERFORM v31_sync_document(NEW.updated_by,d.id);
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data) VALUES(NEW.updated_by,'loading_plan_header_inherited','loading_plan_documents',d.id::text,to_jsonb(d),to_jsonb(n));
 END LOOP;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION v31_group_header_sync() FROM PUBLIC;
CREATE TRIGGER loading_plan_header_sync AFTER UPDATE ON loading_plan_groups FOR EACH ROW EXECUTE FUNCTION v31_group_header_sync();
