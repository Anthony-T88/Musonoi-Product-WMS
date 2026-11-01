CREATE TABLE loading_weight_warning_settings(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),fallback_net_tonnes numeric(12,4) CHECK(fallback_net_tonnes>0 AND fallback_net_tonnes<=1000),version integer NOT NULL DEFAULT 1,updated_by uuid REFERENCES users(id),updated_at timestamptz);
INSERT INTO loading_weight_warning_settings(singleton) VALUES(true);
GRANT SELECT,UPDATE ON loading_weight_warning_settings TO musonoi_app;
CREATE FUNCTION v32_assert_packing_number(number text,document uuid,loadid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE key text:=upper(trim(number));BEGIN
 PERFORM pg_advisory_xact_lock(21004);IF key='' THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM loading_plan_documents d JOIN loading_plan_groups g ON g.id=d.group_id WHERE upper(trim(d.packing_list_no))=key AND d.id IS DISTINCT FROM document AND d.cancelled_at IS NULL AND g.cancelled_at IS NULL AND NOT EXISTS(SELECT 1 FROM loading_plan_matches m WHERE m.document_id=d.id AND m.loading_id=loadid))
 OR EXISTS(SELECT 1 FROM packing_list_documents p WHERE upper(trim(p.document_no))=key AND p.loading_id IS DISTINCT FROM loadid) THEN RAISE EXCEPTION '装箱单号已被其他车辆或有效计划单使用：%',number USING ERRCODE='23514';END IF;
END $$;
CREATE FUNCTION v32_packing_number_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE loadid uuid;BEGIN
 IF TG_TABLE_NAME='loading_plan_documents' THEN
 IF NEW.cancelled_at IS NOT NULL OR EXISTS(SELECT 1 FROM loading_plan_groups WHERE id=NEW.group_id AND cancelled_at IS NOT NULL) THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND upper(trim(NEW.packing_list_no))=upper(trim(OLD.packing_list_no)) THEN RETURN NEW;END IF;
 SELECT loading_id INTO loadid FROM loading_plan_matches WHERE document_id=NEW.id;PERFORM v32_assert_packing_number(NEW.packing_list_no,NEW.id,loadid);
 ELSE SELECT document_id INTO loadid FROM loading_plan_matches WHERE loading_id=NEW.loading_id;PERFORM v32_assert_packing_number(NEW.document_no,loadid,NEW.loading_id);END IF;RETURN NEW;END $$;
CREATE TRIGGER zz_v32_packing_number BEFORE INSERT OR UPDATE ON loading_plan_documents FOR EACH ROW EXECUTE FUNCTION v32_packing_number_guard();
CREATE TRIGGER v32_packing_number BEFORE INSERT OR UPDATE ON packing_list_documents FOR EACH ROW EXECUTE FUNCTION v32_packing_number_guard();
REVOKE ALL ON FUNCTION v32_assert_packing_number(text,uuid,uuid),v32_packing_number_guard() FROM PUBLIC,musonoi_app;
