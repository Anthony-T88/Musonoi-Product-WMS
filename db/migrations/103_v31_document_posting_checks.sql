-- Preserve the whole-truck posting path; validate linked document readiness before final posting.
ALTER FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) RENAME TO v31_multi_lot_action;
REVOKE ALL ON FUNCTION v31_multi_lot_action(uuid,uuid,int,text,jsonb) FROM PUBLIC,musonoi_app;
CREATE FUNCTION v26_load_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE x loading_plan_documents;BEGIN
 PERFORM pg_advisory_xact_lock(21004);
 IF action='manager-approve' THEN
 SELECT p.* INTO x FROM loading_plan_matches m JOIN loading_plan_documents p ON p.id=m.document_id WHERE m.loading_id=doc;
 IF FOUND AND(trim(x.packing_list_no)='' OR trim(x.export_license_no)='' OR trim(x.transporter)='' OR trim(x.destination)='' OR trim(x.vehicle_no)='' OR trim(x.shipment_batch_no)='') THEN RAISE EXCEPTION '请先由出口主管或物流经理补齐装车计划单的装箱单号、许可证号、运输商、目的地、车牌号及发运批次号，再审批正式出库' USING ERRCODE='23514';END IF;
 END IF;RETURN v31_multi_lot_action(actor,doc,expected,action,payload);END $$;
REVOKE ALL ON FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) TO musonoi_app;
-- Every stock history row carries the bundle's actual lot, including secondary lots.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v262_prior_load_action(uuid,uuid,int,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'''lot_no'',a.lot_no','''lot_no'',(SELECT aa.lot_no FROM reservations rr JOIN allocations aa ON aa.id=rr.allocation_id WHERE rr.id=i.reservation_id)');EXECUTE d;
END $$;
