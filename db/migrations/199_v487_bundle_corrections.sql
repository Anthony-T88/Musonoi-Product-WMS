-- The old printer configuration is retired. Keep records and permission history.
DELETE FROM role_permissions WHERE permission_code='printer:manage';
DELETE FROM role_permission_caps WHERE permission_code='printer:manage';

INSERT INTO permissions(code) VALUES('inventory:correct-request'),('inventory:correct-review');
INSERT INTO role_permission_caps(role_code,permission_code) VALUES
 ('production_operator','inventory:correct-request'),('logistics_field_operator','inventory:correct-request'),
 ('production_manager','inventory:correct-review');
INSERT INTO role_permissions(role_code,permission_code) VALUES
 ('production_operator','inventory:correct-request'),('logistics_field_operator','inventory:correct-request'),
 ('production_manager','inventory:correct-review');

CREATE TABLE bundle_corrections(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 bundle_id uuid NOT NULL REFERENCES bundles(id),
 bundle_version integer NOT NULL,
 original jsonb NOT NULL,
 changes jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 requester_id uuid NOT NULL REFERENCES users(id),
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','APPROVED','REJECTED')),
 reviewer_id uuid REFERENCES users(id),
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '',
 applied_txid bigint,
 CHECK((state='PENDING')=(reviewed_at IS NULL) AND (reviewed_at IS NULL)=(reviewer_id IS NULL)),
 CHECK((state='APPROVED')=(applied_txid IS NOT NULL)),
 CHECK(requester_id IS DISTINCT FROM reviewer_id)
);
CREATE UNIQUE INDEX bundle_correction_one_pending ON bundle_corrections(bundle_id) WHERE state='PENDING';
CREATE INDEX bundle_correction_history ON bundle_corrections(bundle_id,requested_at DESC,id);
REVOKE ALL ON bundle_corrections FROM PUBLIC,musonoi_app;
GRANT SELECT ON bundle_corrections TO musonoi_app;

CREATE FUNCTION bundle_correction_available(bid uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.bundles b WHERE b.id=bid AND b.physical_status='IN_STOCK'
  AND b.sample_status<>'SAMPLING'
  AND NOT EXISTS(SELECT 1 FROM public.reservations r WHERE r.bundle_id=b.id AND r.released_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM public.loading_items i WHERE i.bundle_id=b.id AND i.active)
  AND NOT EXISTS(SELECT 1 FROM public.adjustment_lines i JOIN public.stock_adjustments a ON a.id=i.adjustment_id
   WHERE i.bundle_no=b.bundle_no AND a.status IN('DRAFT','PENDING')));
$$;

-- Permit only the exact approved metadata change, without rewriting the receipt, mass or location.
DO $$
DECLARE definition text; updated text;
BEGIN
 SELECT pg_get_functiondef('confirmed_bundle_guard()'::regprocedure) INTO definition;
 updated:=regexp_replace(definition,'BEGIN', $guard$BEGIN
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND NEW.version=OLD.version+1
  AND (to_jsonb(NEW)-ARRAY['version','sheets_per_bundle','seal_no','production_date'])=
      (to_jsonb(OLD)-ARRAY['version','sheets_per_bundle','seal_no','production_date'])
  AND EXISTS(SELECT 1 FROM bundle_corrections q WHERE q.bundle_id=OLD.id AND q.bundle_version=OLD.version
   AND q.state='APPROVED' AND q.applied_txid=txid_current()
   AND NEW.sheets_per_bundle IS NOT DISTINCT FROM coalesce((q.changes->>'sheets_per_bundle')::integer,OLD.sheets_per_bundle)
   AND NEW.seal_no IS NOT DISTINCT FROM coalesce(q.changes->>'seal_no',OLD.seal_no)
   AND NEW.production_date IS NOT DISTINCT FROM coalesce((q.changes->>'production_date')::date,OLD.production_date))
 THEN RETURN NEW; END IF;
 $guard$);
 IF updated=definition THEN RAISE EXCEPTION 'Bundle immutability guard could not be extended'; END IF;
 EXECUTE updated;
END $$;

CREATE FUNCTION bundle_correction_request(actor uuid,bid uuid,expected integer,proposed jsonb,note text)
RETURNS bundle_corrections LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b bundles; q bundle_corrections; before_values jsonb; effective jsonb;
BEGIN
 PERFORM v24_revision();
 SELECT * INTO b FROM bundles WHERE id=bid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_NOT_FOUND' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND active AND deleted_at IS NULL
    AND role_code IN('production_operator','logistics_field_operator'))
 THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_ROLE' USING ERRCODE='42501'; END IF;
 PERFORM v23_require(actor,'inventory:read',b.project_id,b.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 PERFORM v23_require(actor,'inventory:correct-request',b.project_id,b.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 IF expected IS DISTINCT FROM b.version OR NOT bundle_correction_available(b.id)
 THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_STALE_OR_LOCKED' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(proposed) IS DISTINCT FROM 'object'
  OR proposed-ARRAY['sheets_per_bundle','seal_no','production_date']<>'{}'::jsonb
  OR coalesce(length(btrim(note)),0) NOT BETWEEN 1 AND 1000
 THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_INVALID' USING ERRCODE='23514'; END IF;
 IF proposed?'sheets_per_bundle' AND (jsonb_typeof(proposed->'sheets_per_bundle')<>'number'
  OR (proposed->>'sheets_per_bundle') !~ '^[1-9][0-9]{0,9}$' OR (proposed->>'sheets_per_bundle')::numeric>2147483647)
  OR proposed?'seal_no' AND (jsonb_typeof(proposed->'seal_no')<>'string'
    OR length(btrim(proposed->>'seal_no')) NOT BETWEEN 1 AND 512 OR btrim(proposed->>'seal_no')<>proposed->>'seal_no')
  OR proposed?'production_date' AND (jsonb_typeof(proposed->'production_date')<>'string'
    OR (proposed->>'production_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR (proposed->>'production_date')::date>(b.inbound_at AT TIME ZONE 'Africa/Lubumbashi')::date)
 THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_INVALID' USING ERRCODE='23514'; END IF;
 before_values:=jsonb_build_object('sheets_per_bundle',b.sheets_per_bundle,'seal_no',b.seal_no,'production_date',b.production_date);
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO effective FROM jsonb_each(proposed)
  WHERE value IS DISTINCT FROM before_values->key;
 IF effective='{}'::jsonb THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_NO_CHANGE' USING ERRCODE='23514'; END IF;
 INSERT INTO bundle_corrections(bundle_id,bundle_version,original,changes,reason,requester_id)
  VALUES(b.id,b.version,before_values,effective,btrim(note),actor) RETURNING * INTO q;
 RETURN q;
END $$;

CREATE FUNCTION bundle_correction_review(actor uuid,bid uuid,rid uuid,decision text,note text)
RETURNS bundle_corrections LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b bundles; q bundle_corrections; after_values jsonb;
BEGIN
 PERFORM v24_revision();
 SELECT * INTO b FROM bundles WHERE id=bid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_NOT_FOUND' USING ERRCODE='23514'; END IF;
 SELECT * INTO q FROM bundle_corrections WHERE id=rid AND bundle_id=bid FOR UPDATE;
 IF NOT FOUND OR q.state<>'PENDING' THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_ALREADY_REVIEWED' USING ERRCODE='23514'; END IF;
 IF actor=q.requester_id OR NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND active AND deleted_at IS NULL AND role_code='production_manager')
 THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_ROLE' USING ERRCODE='42501'; END IF;
 PERFORM v23_require(actor,'inventory:read',b.project_id,b.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 PERFORM v23_require(actor,'inventory:correct-review',b.project_id,b.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 IF decision IS NULL OR decision NOT IN('APPROVED','REJECTED') OR length(coalesce(note,''))>1000
  OR decision='REJECTED' AND coalesce(length(btrim(note)),0)=0
 THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_INVALID' USING ERRCODE='23514'; END IF;
 IF decision='APPROVED' AND (b.version<>q.bundle_version OR NOT bundle_correction_available(b.id) OR
    EXISTS(SELECT 1 FROM reservations r WHERE r.bundle_id=b.id AND r.locked_at>=q.requested_at))
 THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_STALE_OR_LOCKED' USING ERRCODE='23514'; END IF;
 UPDATE bundle_corrections SET state=decision,reviewer_id=actor,reviewed_at=clock_timestamp(),review_note=coalesce(btrim(note),''),
  applied_txid=CASE WHEN decision='APPROVED' THEN txid_current() END WHERE id=q.id RETURNING * INTO q;
 IF decision='APPROVED' THEN
  after_values:=q.original||q.changes;
  INSERT INTO bundle_metadata_history(bundle_id,actor_id,kind,before_data,after_data,reason)
   VALUES(b.id,actor,'BUNDLE_CORRECTION',q.original,after_values,q.reason);
  IF q.changes?'seal_no' THEN
   UPDATE bundles SET version=version+1,sheets_per_bundle=(after_values->>'sheets_per_bundle')::integer,
    production_date=(after_values->>'production_date')::date,seal_no=after_values->>'seal_no' WHERE id=b.id;
  ELSE
   UPDATE bundles SET version=version+1,sheets_per_bundle=(after_values->>'sheets_per_bundle')::integer,
    production_date=(after_values->>'production_date')::date WHERE id=b.id;
  END IF;
  PERFORM v24_capture_bundle(b.id);
 END IF;
 RETURN q;
END $$;

-- All unlocked in-stock sheet corrections follow the approved request path.
DO $$
DECLARE definition text; updated text;
BEGIN
 SELECT pg_get_functiondef('v262_correct_sheets(uuid,uuid,integer,integer,text)'::regprocedure) INTO definition;
 updated:=replace(definition,' IF b.version IS DISTINCT FROM expected', $guard$ IF b.physical_status='IN_STOCK'
  AND NOT EXISTS(SELECT 1 FROM reservations WHERE bundle_id=bid AND released_at IS NULL)
 THEN RAISE EXCEPTION 'BUNDLE_CORRECTION_APPROVAL_REQUIRED' USING ERRCODE='23514'; END IF;
 IF b.version IS DISTINCT FROM expected$guard$);
 IF updated=definition THEN RAISE EXCEPTION 'Uncontrolled sheet correction guard not found'; END IF;
 EXECUTE updated;
END $$;

REVOKE ALL ON FUNCTION bundle_correction_available(uuid),bundle_correction_request(uuid,uuid,integer,jsonb,text),
 bundle_correction_review(uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bundle_correction_available(uuid),bundle_correction_request(uuid,uuid,integer,jsonb,text),
 bundle_correction_review(uuid,uuid,uuid,text,text) TO musonoi_app;
