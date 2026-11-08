-- One user-facing Loading Plan holds its own commercial header, truck and lots.
ALTER TABLE loading_plan_documents ADD COLUMN direct_entry boolean NOT NULL DEFAULT false;
CREATE TABLE loading_plan_lots(document_id uuid NOT NULL REFERENCES loading_plan_documents(id),allocation_id uuid NOT NULL REFERENCES allocations(id),PRIMARY KEY(document_id,allocation_id));
GRANT SELECT,INSERT,DELETE ON loading_plan_lots TO musonoi_app;
CREATE OR REPLACE FUNCTION v31_document_header_inherit() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE g loading_plan_groups;BEGIN
 IF NEW.direct_entry THEN
 IF NEW.invoice_no IS NULL OR length(trim(NEW.invoice_no)) NOT BETWEEN 1 AND 77 OR NEW.invoice_no<>trim(NEW.invoice_no) THEN RAISE EXCEPTION '发票号须为1至77个字符' USING ERRCODE='23514';END IF;
 NEW.packing_list_no:=NEW.invoice_no||'-PL';RETURN NEW;END IF;
 SELECT * INTO g FROM loading_plan_groups WHERE id=NEW.group_id;
 IF g.invoice_no IS NOT NULL THEN NEW.invoice_no:=g.invoice_no;NEW.packing_list_no:=g.packing_list_no;NEW.export_license_no:=g.export_license_no;NEW.transporter:=g.transporter;NEW.destination:=g.destination;
 ELSIF TG_OP='INSERT' THEN RAISE EXCEPTION '请补充发票及运输资料' USING ERRCODE='23514';
 ELSIF NEW.packing_list_no IS DISTINCT FROM OLD.packing_list_no OR NEW.invoice_no IS DISTINCT FROM OLD.invoice_no THEN RAISE EXCEPTION '历史装箱单号不可手工修改' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('v31_group_header_sync()'::regprocedure) INTO d;d:=replace(d,'WHERE group_id=NEW.id AND cancelled_at IS NULL','WHERE group_id=NEW.id AND cancelled_at IS NULL AND NOT direct_entry');EXECUTE d;END $$;
CREATE FUNCTION v31_plan_lot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE x loading_plan_documents;p sales_plans;a allocations;s sales_plans;BEGIN
 SELECT * INTO x FROM loading_plan_documents WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END FOR UPDATE;
 IF EXISTS(SELECT 1 FROM loading_plan_matches WHERE document_id=x.id AND v31_load_posted(loading_id)) THEN RAISE EXCEPTION '正式出库后的计划批次不可修改' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 SELECT sp.* INTO p FROM loading_plan_groups g JOIN sales_plans sp ON sp.id=g.sales_plan_id WHERE g.id=x.group_id;
 SELECT * INTO a FROM allocations WHERE id=NEW.allocation_id;SELECT * INTO s FROM sales_plans WHERE id=a.plan_id;
 IF x.cancelled_at IS NOT NULL OR a.lot_no IS NULL OR a.workflow_state NOT IN('WORKING','RECTIFY','PENDING','PREPARED','PARTIAL') OR s.status<>'OPEN' OR s.project_id<>p.project_id OR s.customer_id<>p.customer_id OR s.contract_id IS DISTINCT FROM p.contract_id THEN RAISE EXCEPTION '备货批次与计划客户、合同不符或状态不可用' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER loading_plan_lot_guard BEFORE INSERT OR DELETE ON loading_plan_lots FOR EACH ROW EXECUTE FUNCTION v31_plan_lot_guard();
CREATE FUNCTION v31_check_plan_lots(doc uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM loading_plan_documents WHERE id=doc AND direct_entry) AND NOT EXISTS(SELECT 1 FROM loading_plan_lots WHERE document_id=doc) THEN RAISE EXCEPTION '装车计划单必须关联备货批次' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM loading_plan_matches m JOIN loading_items i ON i.loading_id=m.loading_id JOIN reservations r ON r.id=i.reservation_id WHERE m.document_id=doc AND NOT i.plan_removed AND EXISTS(SELECT 1 FROM loading_plan_lots WHERE document_id=doc) AND NOT EXISTS(SELECT 1 FROM loading_plan_lots q WHERE q.document_id=doc AND q.allocation_id=r.allocation_id)) THEN RAISE EXCEPTION '装车捆包必须属于计划单指定的备货批次' USING ERRCODE='23514';END IF;
 END $$;
CREATE FUNCTION v31_plan_lots_deferred() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM v31_check_plan_lots(CASE WHEN TG_TABLE_NAME='loading_plan_documents' THEN NEW.id WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER loading_plan_batch_required AFTER INSERT OR UPDATE ON loading_plan_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v31_plan_lots_deferred();
CREATE CONSTRAINT TRIGGER loading_plan_batch_consistency AFTER INSERT OR DELETE ON loading_plan_lots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v31_plan_lots_deferred();
CREATE FUNCTION v31_match_lots_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM v31_check_plan_lots(NEW.document_id);IF EXISTS(SELECT 1 FROM loading_items i JOIN reservations r ON r.id=i.reservation_id WHERE i.loading_id=NEW.loading_id AND NOT i.plan_removed AND EXISTS(SELECT 1 FROM loading_plan_lots WHERE document_id=NEW.document_id) AND NOT EXISTS(SELECT 1 FROM loading_plan_lots q WHERE q.document_id=NEW.document_id AND q.allocation_id=r.allocation_id)) THEN RAISE EXCEPTION '装车单捆包批次与计划单不匹配' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER loading_plan_match_lots BEFORE INSERT OR UPDATE ON loading_plan_matches FOR EACH ROW EXECUTE FUNCTION v31_match_lots_guard();
ALTER FUNCTION v31_save_load(uuid,uuid,int,uuid,int,uuid[],text) RENAME TO v31_before_lot_save_load;
REVOKE ALL ON FUNCTION v31_before_lot_save_load(uuid,uuid,int,uuid,int,uuid[],text) FROM PUBLIC,musonoi_app;
CREATE FUNCTION v31_save_load(actor uuid,doc uuid,expected int,lp uuid,lp_expected int,ids uuid[],note text) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE x loading_plan_documents;BEGIN
 PERFORM v24_revision();PERFORM pg_advisory_xact_lock(21004);
 IF lp IS NOT NULL THEN SELECT * INTO x FROM loading_plan_documents WHERE id=lp FOR UPDATE;
 IF x.direct_entry AND NOT EXISTS(SELECT 1 FROM loading_plan_lots WHERE document_id=lp) THEN RAISE EXCEPTION '请先补齐计划单批次' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM loading_plan_lots WHERE document_id=lp) AND ids IS NOT NULL AND EXISTS(SELECT 1 FROM reservations r WHERE r.bundle_id=ANY(ids) AND r.released_at IS NULL AND NOT EXISTS(SELECT 1 FROM loading_plan_lots q WHERE q.document_id=lp AND q.allocation_id=r.allocation_id)) THEN RAISE EXCEPTION '禁止选择计划单指定批次以外的捆包' USING ERRCODE='23514';END IF;
 END IF;RETURN v31_before_lot_save_load(actor,doc,expected,lp,lp_expected,ids,note);END $$;
REVOKE ALL ON FUNCTION v31_save_load(uuid,uuid,int,uuid,int,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v31_save_load(uuid,uuid,int,uuid,int,uuid[],text) TO musonoi_app;
