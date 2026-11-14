-- A dispatch-specific month applies to new entries. Existing vehicle and document links retain their original month.
CREATE TABLE dispatch_month_overrides (
 product_code text NOT NULL CHECK(product_code IN ('CU_CATHODE','CO_HYDROXIDE')),
 sales_plan_id uuid NOT NULL,
 shipment_month text NOT NULL CHECK(shipment_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(product_code,sales_plan_id)
);
INSERT INTO permissions(code) VALUES ('dispatch:month');
INSERT INTO role_permissions(role_code,permission_code)
 SELECT r.code,p FROM roles r CROSS JOIN (VALUES('dispatch:month'),('dispatch:read')) q(p)
 WHERE r.code IN('sales_operator','sales_manager') OR
       r.code='admin' AND EXISTS(SELECT 1 FROM role_permissions WHERE role_code=r.code AND permission_code='dispatch:write')
 ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps(role_code,permission_code)
 SELECT code,permission FROM roles CROSS JOIN (VALUES ('dispatch:month'),('dispatch:read')) list(permission)
 WHERE code IN('sales_operator','sales_manager') ON CONFLICT DO NOTHING;
GRANT SELECT,INSERT,UPDATE ON dispatch_month_overrides TO musonoi_app;

-- Keep scope, live grants, versions and approval order. A reviewer may also be the creator or a prior reviewer.
DO $$
DECLARE patch record; definition text;
BEGIN
 FOR patch IN SELECT * FROM (VALUES
 (1,'receipt_self_review_allowed(uuid)',$m$SELECT false$m$,$m$SELECT EXISTS(SELECT 1 FROM users u JOIN role_permissions p ON p.role_code=u.role_code WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND p.permission_code='receipt:review')$m$),
 (2,'receipt_independent_review_guard()',$m$ AND(TG_OP='INSERT'$m$,$m$ AND NOT receipt_self_review_allowed(NEW.reviewed_by) AND(TG_OP='INSERT'$m$),
 (3,'ux10_review_sales_plan(text,uuid,uuid,integer,text,text)',$m$ IF actor=a.submitted_by OR(stage='COMMERCE' AND actor=a.sales_reviewed_by) THEN RAISE EXCEPTION 'SALES_REVIEW_SELF' USING ERRCODE='23514';END IF;$m$,''),
 (4,'v468_review_plan_close(text,uuid,uuid,uuid,integer,text,text)',$m$ IF actor=request.requested_by OR(stage='COMMERCE' AND actor=request.sales_reviewed_by) THEN RAISE EXCEPTION 'SALES_REVIEW_SELF' USING ERRCODE='23514';END IF;$m$,''),
 (5,'v262_prior_lot_action(uuid,uuid,integer,text,jsonb)',$m$ IF (review OR action='cancel') AND (actor=a.created_by OR actor=a.submitted_by) THEN RAISE EXCEPTION '主管不能审核自己创建的Lot' USING ERRCODE='23514';END IF;$m$,''),
 (6,'v26_allocation_action(uuid,uuid,integer,text,text)',$m$ OR actor=a.created_by$m$,''),
 (7,'v262_prior_load_action(uuid,uuid,integer,text,jsonb)',$m$ OR actor=d.created_by OR actor=d.submitted_by$m$,''),
 (8,'v262_prior_load_action(uuid,uuid,integer,text,jsonb)',$m$ OR actor IN(d.created_by,d.submitted_by,d.departure_by)$m$,''),
 (9,'v31_prior_load_action(uuid,uuid,integer,text,jsonb)',$m$ OR actor=d.created_by OR actor IS NOT DISTINCT FROM d.submitted_by$m$,''),
 (10,'v31_prior_load_action(uuid,uuid,integer,text,jsonb)',$m$ OR actor=d.logistics_review_by$m$,''),
 (11,'v30_final_outbound_guard()',$m$ OR NEW.manager_by=NEW.logistics_review_by$m$,''),
 (12,'v32_prior_correction_action(uuid,uuid,integer,text,text)',$m$ IF actor=q.requested_by THEN RAISE EXCEPTION 'V27_INDEPENDENT_CORRECTION_REVIEWER_REQUIRED' USING ERRCODE='23514';END IF;$m$,$m$ IF action='verify-return' AND actor=q.requested_by THEN RAISE EXCEPTION 'V27_INDEPENDENT_CORRECTION_REVIEWER_REQUIRED' USING ERRCODE='23514';END IF;$m$),
 (13,'stocktake_action(uuid,uuid,integer,text,jsonb)',$m$ OR actor=d.created_by OR EXISTS(SELECT 1 FROM stocktake_observations WHERE stocktake_id=doc AND counted_by=actor)$m$,''),
 (14,'v33_prior_stocktake_action(uuid,uuid,integer,text,text)',$m$ IF review AND(actor=d.created_by OR EXISTS(SELECT 1 FROM stocktake_observations WHERE stocktake_id=doc AND counted_by=actor)) THEN RAISE EXCEPTION 'V27_INDEPENDENT_COUNT_REVIEWER_REQUIRED' USING ERRCODE='23514';END IF;$m$,''),
 (15,'adjustment_action(uuid,uuid,integer,text,text)',$m$IF d.status<>'PENDING' OR actor=d.created_by THEN$m$,$m$IF d.status<>'PENDING' THEN$m$),
 (16,'co_document_guard()',$m$ OR NEW.site_reviewed_by IN(OLD.created_by,w.submitted_by)$m$,''),
 (17,'co_document_guard()',$m$ OR NEW.production_reviewed_by IN(OLD.created_by,OLD.site_reviewed_by,w.submitted_by)$m$,''),
 (18,'co_receipt_guard()',$m$ OR p.production_reviewed_by=p.site_reviewed_by$m$,''),
 (19,'co_work_batch_guard()',$m$ OR NEW.updated_by IN(p.created_by,OLD.submitted_by)$m$,''),
 (20,'co_work_batch_guard()',$m$ OR NEW.updated_by IN(p.created_by,OLD.submitted_by,OLD.reviewed_by)$m$,''),
 (21,'co_work_batch_guard()',$m$ OR NEW.updated_by IN(p.created_by,OLD.amendment_requested_by)$m$,''),
 (22,'co_loading_review_guard()',$m$ OR NEW.reviewed_by IN(OLD.requested_by,l.created_by,d.created_by)$m$,''),
 (23,'co_execution_guard()',$m$ OR NEW.updated_by IN(OLD.started_by,OLD.confirmed_by,l.created_by,d.created_by)$m$,''),
 (24,'co_execution_guard()',$m$ OR NEW.updated_by IN(OLD.started_by,OLD.confirmed_by,OLD.submitted_by,l.created_by)$m$,''),
 (25,'co_execution_guard()',$m$ OR NEW.updated_by IN(OLD.started_by,OLD.confirmed_by,OLD.submitted_by,OLD.logistics_by,l.created_by,d.created_by,(SELECT actor_id FROM co_departures WHERE id=OLD.departure_id))$m$,''),
 (26,'co_execution_exception_guard()',$m$ OR NEW.resolved_by=OLD.opened_by$m$,''),
 (27,'co_metal_event_guard()',$m$NEW.actor_id=prior.actor_id OR NOT ($m$,$m$NOT ($m$),
 (28,'v451_co_count_action(uuid,uuid,integer,text,jsonb)',$m$IF actor=t.created_by OR actor=t.submitted_by OR EXISTS(SELECT 1 FROM co_stocktake_observations WHERE task_id=t.id AND round=t.round AND counted_by=actor) THEN RAISE EXCEPTION 'CO_COUNT_INDEPENDENT_REVIEW' USING ERRCODE='23514';END IF;$m$,''),
 (29,'v451_co_count_action(uuid,uuid,integer,text,jsonb)',$m$ OR actor=t.created_by OR actor=t.submitted_by OR EXISTS(SELECT 1 FROM co_stocktake_observations WHERE task_id=t.id AND round=t.round AND counted_by=actor)$m$,''),
 (30,'exception_action(uuid,uuid,integer,text,jsonb)',$m$ AND d.submitted_by<>actor$m$,''),
 (31,'outbound_action(uuid,uuid,integer,text,jsonb)',$m$ OR actor=w.created_by$m$,''),
 (32,'outbound_action(uuid,uuid,integer,text,jsonb)',$m$ OR actor=d.packing_by$m$,''),
 (35,'outbound_action(uuid,uuid,integer,text,jsonb)',$m$ OR actor=d.reversal_requested_by OR actor=d.departed_by$m$,'')
 ) AS changes(ordinal,routine,before_text,after_text) ORDER BY ordinal LOOP
  SELECT pg_get_functiondef(patch.routine::regprocedure) INTO definition;
  IF strpos(definition,patch.before_text)=0 THEN RAISE EXCEPTION 'Approval guard did not match %',patch.routine; END IF;
  EXECUTE replace(definition,patch.before_text,patch.after_text);
 END LOOP;
END $$;

ALTER TABLE sales_plan_approvals DROP CONSTRAINT sales_plan_approvals_check1, DROP CONSTRAINT sales_plan_approvals_check3,
 ADD CONSTRAINT sales_plan_approvals_review_stamps CHECK (
  (state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
  (state<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
 ),
 ADD CONSTRAINT sales_plan_approvals_final_stamps CHECK (
  flow_version=1 OR state<>'APPROVED' OR (sales_reviewed_by IS NOT NULL AND commerce_reviewed_by IS NOT NULL)
 );
ALTER TABLE sales_plan_close_requests DROP CONSTRAINT sales_plan_close_requests_check1, DROP CONSTRAINT sales_plan_close_requests_check2;
ALTER TABLE export_license_actions DROP CONSTRAINT export_license_actions_check1;
ALTER TABLE co_preparations DROP CONSTRAINT co_preparations_check1, DROP CONSTRAINT co_preparations_check2,
 ADD CONSTRAINT co_preparations_site_stamp CHECK(status NOT IN('PRODUCTION_PENDING','RECEIVED') OR(site_reviewed_by IS NOT NULL AND site_reviewed_at IS NOT NULL)),
 ADD CONSTRAINT co_preparations_production_stamp CHECK(status<>'RECEIVED' OR(production_reviewed_by IS NOT NULL AND production_reviewed_at IS NOT NULL AND production_reviewed_at>=site_reviewed_at));
ALTER TABLE stock_adjustments DROP CONSTRAINT stock_adjustments_check,
 ADD CONSTRAINT stock_adjustments_approval_stamp CHECK(status<>'APPLIED' OR(approved_by IS NOT NULL AND applied_revision IS NOT NULL));
