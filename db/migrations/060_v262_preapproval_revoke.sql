ALTER TABLE allocations ADD COLUMN withdrawn_by uuid REFERENCES users(id),ADD COLUMN withdrawn_at timestamptz;
CREATE FUNCTION v262_preapproval_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a allocations;p sales_plans;u users;b bundles;note text;facts boolean;beforedata jsonb;BEGIN
 PERFORM v24_revision();SELECT * INTO a FROM allocations WHERE id=doc FOR UPDATE;SELECT * INTO p FROM sales_plans WHERE id=a.plan_id;SELECT * INTO u FROM users WHERE id=actor AND active;
 IF a.workflow_version IS DISTINCT FROM '2.6.1' OR a.version IS DISTINCT FROM expected OR action NOT IN('withdraw','revoke') THEN RAISE EXCEPTION 'Lot状态/版本已变化，请刷新核对；不覆盖已有审批' USING ERRCODE='23514';END IF;
 IF u.role_code NOT IN('admin','logistics_manager','site_supervisor','logistics_operator') OR u.id IS NULL OR (u.role_code='logistics_operator' AND a.created_by<>actor) THEN RAISE EXCEPTION '只能撤销自己创建的Lot，或由授权物流主管处理' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM workflow_reviews wr WHERE wr.allocation_id=doc AND wr.action='APPROVE') OR EXISTS(SELECT 1 FROM loading_orders WHERE allocation_id=doc) OR a.workflow_state IN('PREPARED','PARTIAL','FULFILLED') THEN RAISE EXCEPTION '已审核或进入装车流程的Lot禁止普通撤回/撤销，请走既有授权业务流程' USING ERRCODE='23514';END IF;
 FOR b IN SELECT bb.* FROM allocation_items ai JOIN bundles bb ON bb.id=ai.bundle_id WHERE ai.allocation_id=doc ORDER BY bb.id FOR UPDATE OF bb LOOP
 PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 END LOOP;
 PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=a.planned_location_id));beforedata:=to_jsonb(a);
 IF action='withdraw' THEN
 IF a.workflow_state<>'PENDING' OR a.created_by<>actor THEN RAISE EXCEPTION '仅创建人可以撤回待审核Lot；主管可按原权限驳回待整改' USING ERRCODE='42501';END IF;
 UPDATE allocations SET workflow_state='WORKING',withdrawn_by=actor,withdrawn_at=clock_timestamp(),version=version+1 WHERE id=doc RETURNING * INTO a;
 INSERT INTO workflow_reviews(allocation_id,action,actor_id,note) VALUES(doc,'WITHDRAW',actor,'创建人撤回审核；捆包和规划货位继续锁定');
 ELSE
 IF a.workflow_state NOT IN('WORKING','RECTIFY') THEN RAISE EXCEPTION '待审核Lot必须先撤回审核；仅作业中或待整改可以撤销' USING ERRCODE='23514';END IF;
 note:=trim(coalesce(payload->>'reason',payload->>'note',''));IF length(note) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION '撤销原因必填，最多1000字符' USING ERRCODE='23514';END IF;
 IF coalesce(payload->>'work_stopped','')<>'true' OR coalesce(payload->>'physical_state_verified',payload->>'current_state_verified','')<>'true' THEN RAISE EXCEPTION '请确认已停止原备货作业，并核实全部捆包当前实物位置' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM lot_work_items WHERE allocation_id=doc AND sample_stage='IN_PROGRESS') THEN RAISE EXCEPTION '仍有捆包在实验室取样中，须先登记返回并重新打包，不能自动撤销' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM allocation_items ai JOIN bundles bb ON bb.id=ai.bundle_id WHERE ai.allocation_id=doc AND (bb.physical_status<>'IN_STOCK' OR NOT EXISTS(SELECT 1 FROM reservations r WHERE r.allocation_id=doc AND r.bundle_id=bb.id AND r.released_at IS NULL) OR EXISTS(SELECT 1 FROM loading_items li WHERE li.bundle_id=bb.id AND li.active) OR EXISTS(SELECT 1 FROM stock_adjustments sa JOIN adjustment_lines al ON al.adjustment_id=sa.id WHERE al.bundle_no=bb.bundle_no AND sa.status IN('DRAFT','PENDING')))) THEN RAISE EXCEPTION '捆包锁定、实物或装车/调整状态存在冲突，整单未撤销' USING ERRCODE='23514';END IF;
 SELECT EXISTS(SELECT 1 FROM lot_work_history h WHERE h.allocation_id=doc AND h.action IN('WEIGH','SAMPLE-STAGE','SEAL','INHERIT')) OR EXISTS(SELECT 1 FROM allocation_items ai JOIN inventory_events e ON e.bundle_id=ai.bundle_id WHERE ai.allocation_id=doc AND e.event_type IN('MOVE','ADJUST_LOCATION') AND e.occurred_at>=a.created_at) INTO facts;
 IF facts AND nullif(trim(payload->>'observation'),'') IS NULL THEN RAISE EXCEPTION '已经发生检斤、取样、铅封或移位，请填写现场作业及位置核实说明' USING ERRCODE='23514';END IF;
 UPDATE allocations SET workflow_state='CANCELLED',status='RELEASED',cancelled_by=actor,cancelled_at=clock_timestamp(),cancel_note=note,cancellation_observation=payload,released_at=clock_timestamp(),release_reason=note,version=version+1 WHERE id=doc RETURNING * INTO a;
 FOR b IN SELECT bb.* FROM allocation_items ai JOIN bundles bb ON bb.id=ai.bundle_id WHERE ai.allocation_id=doc ORDER BY bb.id LOOP
 UPDATE reservations SET released_at=clock_timestamp(),released_by=actor,release_reason=note WHERE allocation_id=doc AND bundle_id=b.id AND released_at IS NULL;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(b.id,'UNLOCK',0,actor,jsonb_build_object('allocation_id',doc,'basis','PREAPPROVAL_REVOKE','reason',note,'physical_location_id',b.location_id));
 PERFORM v24_capture_bundle(b.id);END LOOP;
 INSERT INTO workflow_reviews(allocation_id,action,actor_id,note) VALUES(doc,'REVOKE',actor,note);
 END IF;
 INSERT INTO lot_work_history(allocation_id,action,actor_id,before_data,after_data,note) VALUES(doc,upper(action),actor,beforedata,to_jsonb(a),coalesce(note,'撤回审核，保持锁定'));
 PERFORM v262_sync_claims();RETURN a;
END $$;
REVOKE ALL ON FUNCTION v262_preapproval_action(uuid,uuid,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v262_preapproval_action(uuid,uuid,int,text,jsonb) TO musonoi_app;
-- Retired cancel endpoint cannot bypass the pre-approval-only boundary.
ALTER FUNCTION v261_lot_action(uuid,uuid,int,text,jsonb) RENAME TO v262_prior_lot_action;
REVOKE ALL ON FUNCTION v262_prior_lot_action(uuid,uuid,int,text,jsonb) FROM musonoi_app;
CREATE FUNCTION v261_lot_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF action='cancel' THEN RETURN v262_preapproval_action(actor,doc,expected,'revoke',payload||jsonb_build_object('work_stopped',coalesce((payload->>'current_state_verified')::boolean,false)));END IF;
 RETURN v262_prior_lot_action(actor,doc,expected,action,payload);
END $$;
REVOKE ALL ON FUNCTION v261_lot_action(uuid,uuid,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v261_lot_action(uuid,uuid,int,text,jsonb) TO musonoi_app;
-- Do not release a location while any on-site physical stock remains there.
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('v262_sync_claims()'::regprocedure) INTO d;
 d:=replace(d,'FROM bundles b JOIN allocation_items ai ON ai.bundle_id=b.id WHERE ai.allocation_id=q.allocation_id AND b.location_id=q.location_id','FROM bundles b WHERE b.location_id=q.location_id');EXECUTE d;END $$;
