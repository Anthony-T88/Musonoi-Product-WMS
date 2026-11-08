-- Only future audit inserts use the extended resolver. No historical rows are updated.
CREATE OR REPLACE FUNCTION security_r3_entity_scope(kind text, identity text, depth integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d jsonb;s jsonb;parent_kind text;parent_id text;extra jsonb;pk text:='id';n integer;
BEGIN
 IF depth>8 OR identity IS NULL OR identity!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RETURN NULL;END IF;
 IF kind IN('sales_plan_review','sales_plan_close') THEN
  SELECT count(*) INTO n FROM (SELECT id FROM public.sales_plans WHERE id=identity::uuid UNION ALL SELECT id FROM public.co_sales_plans WHERE id=identity::uuid) x;
  IF n<>1 THEN RETURN NULL;END IF;
  kind:=CASE WHEN EXISTS(SELECT 1 FROM public.sales_plans WHERE id=identity::uuid) THEN 'sales_plans' ELSE 'co_sales_plans' END;
 END IF;
 IF kind IN('v26_submit','v26_allocation_action','v26_register_positions') THEN kind:='allocations';END IF;
 IF kind IN('v26_create_load','v26_resubmit_load','v26_load_action','fixed_edit_load') THEN kind:='loading_orders';END IF;
 IF kind='sales_dispatch' THEN kind:='sales_dispatch_imports';END IF;
 IF kind<>ALL(ARRAY['projects','warehouses','yards','locations','batches','customers','co_customer_profiles','bundles','receipts','allocations','sales_plans','customer_contracts','co_preparations','co_sales_plans','co_sales_contracts','co_locations','co_zones','co_loading_plans','co_loading_orders','co_outbounds','co_dispatch_vehicles','co_vehicle_arrivals','loading_plan_groups','loading_plan_documents','loading_orders','outbound_orders','stock_moves','stocktakes','co_stocktakes','stock_adjustments','inventory_exceptions','sampling_batches','weighings','outbound_corrections','vehicle_arrivals','sales_dispatch_imports','sales_dispatch_vehicles','customer_transport_book','gate_permits','gate_printers','exception_rules','management_warning_settings']) THEN RETURN NULL;END IF;
 IF kind IN('exception_rules','management_warning_settings') THEN pk:='project_id';END IF;
 IF to_regclass('public.'||kind) IS NULL THEN RETURN NULL;END IF;
 -- Typed UUID lookup retains the primary-key index (173 used id::text).
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE %I=$1',kind,pk) INTO d USING identity::uuid;
 IF d IS NULL THEN RETURN NULL;END IF;
 IF kind='gate_permits' THEN parent_kind:=CASE WHEN d->>'co_order_id' IS NOT NULL THEN 'co_loading_orders' ELSE 'loading_orders' END;parent_id:=coalesce(d->>'co_order_id',d->>'cu_loading_id');
 ELSIF kind IN('co_loading_plans','co_loading_orders') THEN parent_kind:='co_sales_plans';parent_id:=d->>'sales_plan_id';
 ELSIF kind='allocations' THEN parent_kind:='sales_plans';parent_id:=d->>'plan_id';
 ELSIF kind='loading_plan_documents' THEN parent_kind:='loading_plan_groups';parent_id:=d->>'group_id';
 ELSIF kind='sales_dispatch_vehicles' THEN parent_kind:='sales_dispatch_imports';parent_id:=d->>'import_id';
 ELSIF kind='stock_adjustments' THEN parent_kind:='inventory_exceptions';parent_id:=d->>'exception_id';
 ELSIF kind IN('outbound_corrections','outbound_orders') THEN parent_kind:='loading_orders';parent_id:=d->>'loading_id';
 ELSIF kind='co_outbounds' THEN parent_kind:='co_loading_orders';parent_id:=d->>'order_id';
 ELSIF kind='customer_transport_book' THEN parent_kind:='customers';parent_id:=d->>'customer_id';
 ELSIF d->>'sales_plan_id' IS NOT NULL THEN parent_kind:=CASE WHEN left(kind,3)='co_' THEN 'co_sales_plans' ELSE 'sales_plans' END;parent_id:=d->>'sales_plan_id';
 END IF;
 IF parent_id IS NOT NULL THEN s:=public.security_r3_entity_scope(parent_kind,parent_id,depth+1);ELSE s:=public.security_r3_scope_json(d,kind);END IF;
 IF s IS NULL AND d->>'warehouse_id' IS NOT NULL THEN s:=public.security_r3_entity_scope('warehouses',d->>'warehouse_id',depth+1);s:=s||jsonb_build_object('warehouse_id',d->>'warehouse_id','customer_id',d->>'customer_id');END IF;
 IF s IS NULL AND d->>'yard_id' IS NOT NULL THEN s:=public.security_r3_entity_scope('yards',d->>'yard_id',depth+1);END IF;
 IF kind IN('co_loading_plans','co_loading_orders') THEN
  extra:=public.security_r3_entity_scope('co_preparations',d->>'preparation_id',depth+1);
  IF extra IS NULL OR extra->>'project_id' IS DISTINCT FROM s->>'project_id' OR extra->>'warehouse_id' IS DISTINCT FROM s->>'warehouse_id' THEN RETURN NULL;END IF;
 END IF;
 IF kind='allocations' AND d->>'planned_location_id' IS NOT NULL THEN
  extra:=public.security_r3_entity_scope('locations',d->>'planned_location_id',depth+1);
  IF extra IS NULL OR extra->>'project_id' IS DISTINCT FROM s->>'project_id' THEN RETURN NULL;END IF;
  s:=s||jsonb_build_object('warehouse_id',extra->>'warehouse_id');
 END IF;
 RETURN s;
END $$;

CREATE FUNCTION security_r3_entity_scopes(kind text, identity text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s jsonb;result jsonb:='[]';x record;loc jsonb;loadid uuid;moveid uuid;
BEGIN
 IF kind='label_jobs' THEN
  IF identity IS NULL OR identity!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RETURN NULL;END IF;
  FOR x IN SELECT bundle_id FROM public.label_job_items WHERE job_id=identity::uuid LOOP
   loc:=public.security_r3_entity_scope('bundles',x.bundle_id::text);
   IF loc IS NULL THEN RETURN NULL;END IF;
   result:=result||jsonb_build_array(loc);
  END LOOP;
  IF jsonb_array_length(result)=0 THEN RETURN NULL;END IF;
  SELECT jsonb_agg(DISTINCT e) INTO result FROM jsonb_array_elements(result) e;
  RETURN result;
 END IF;
 s:=public.security_r3_entity_scope(kind,identity);
 IF s IS NULL THEN RETURN NULL;END IF;
 IF kind='loading_orders' THEN loadid:=identity::uuid;
 ELSIF kind='outbound_orders' THEN SELECT loading_id INTO loadid FROM public.outbound_orders WHERE id=identity::uuid;
 ELSIF kind='outbound_corrections' THEN SELECT loading_id INTO loadid FROM public.outbound_corrections WHERE id=identity::uuid;
 ELSIF kind='gate_permits' THEN SELECT cu_loading_id INTO loadid FROM public.gate_permits WHERE id=identity::uuid;
 END IF;
 IF loadid IS NOT NULL THEN
  FOR x IN SELECT DISTINCT original_location_id location_id FROM public.loading_items WHERE loading_id=loadid LOOP
   loc:=public.security_r3_entity_scope('locations',x.location_id::text);
   IF loc IS NULL OR loc->>'project_id' IS DISTINCT FROM s->>'project_id' THEN RETURN NULL;END IF;
   result:=result||jsonb_build_array(s||jsonb_build_object('warehouse_id',loc->>'warehouse_id'));
  END LOOP;
 END IF;
 IF kind='stock_moves' THEN
  FOR x IN SELECT from_location_id location_id FROM public.stock_move_items WHERE move_id=identity::uuid UNION SELECT target_location_id FROM public.stock_moves WHERE id=identity::uuid LOOP
   loc:=public.security_r3_entity_scope('locations',x.location_id::text);
   IF loc IS NULL OR loc->>'project_id' IS DISTINCT FROM s->>'project_id' THEN RETURN NULL;END IF;
   result:=result||jsonb_build_array(s||jsonb_build_object('warehouse_id',loc->>'warehouse_id'));
  END LOOP;
 END IF;
 IF kind IN('sampling_batches','weighings') THEN
  FOR x IN SELECT si.bundle_id FROM public.sampling_items si WHERE kind='sampling_batches' AND si.sample_id=identity::uuid UNION SELECT wi.bundle_id FROM public.weighing_items wi WHERE kind='weighings' AND wi.weighing_id=identity::uuid LOOP
   loc:=public.security_r3_entity_scope('bundles',x.bundle_id::text);
   IF loc IS NULL OR loc->>'project_id' IS DISTINCT FROM s->>'project_id' THEN RETURN NULL;END IF;
   result:=result||jsonb_build_array(s||jsonb_build_object('warehouse_id',loc->>'warehouse_id'));
  END LOOP;
 END IF;
 IF kind='stock_adjustments' THEN
  FOR x IN SELECT before_data d FROM public.adjustment_lines WHERE adjustment_id=identity::uuid UNION ALL SELECT after_data FROM public.adjustment_lines WHERE adjustment_id=identity::uuid LOOP
   IF x.d->>'project_id' IS NOT NULL THEN
    loc:=public.security_r3_scope_json(x.d,'bundles');
    IF loc IS NULL THEN RETURN NULL;END IF;
    result:=result||jsonb_build_array(loc);
   ELSIF x.d->>'location_id' IS NOT NULL THEN
    loc:=public.security_r3_entity_scope('locations',x.d->>'location_id');
    IF loc IS NULL OR loc->>'project_id' IS DISTINCT FROM s->>'project_id' THEN RETURN NULL;END IF;
    result:=result||jsonb_build_array(s||jsonb_build_object('warehouse_id',loc->>'warehouse_id'));
   END IF;
  END LOOP;
 END IF;
 IF jsonb_array_length(result)=0 THEN result:=jsonb_build_array(s);END IF;
 SELECT jsonb_agg(DISTINCT e) INTO result FROM jsonb_array_elements(result) e;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION security_r3_audit_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE scopes jsonb;s jsonb;d jsonb;
BEGIN
 NEW.scope_context:=NULL;
 scopes:=public.security_r3_entity_scopes(NEW.entity_type,NEW.entity_id);
 IF scopes IS NULL THEN RETURN NEW;END IF;
 -- Preserve 173's conservative before/after restriction. Payload cannot replace or
 -- remove authoritative scopes; invalid scope payloads stay administrator-only.
 FOREACH d IN ARRAY ARRAY[NEW.before_data,NEW.after_data] LOOP
  IF d->>'project_id' IS NOT NULL THEN
   s:=public.security_r3_scope_json(d,NEW.entity_type);
   IF s IS NULL THEN RETURN NEW;END IF;
   -- Do not add a broader duplicate when entity resolution supplies warehouses.
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scopes) e WHERE e->>'project_id'=s->>'project_id' AND (s->>'warehouse_id' IS NULL OR e->>'warehouse_id'=s->>'warehouse_id') AND e->>'customer_id' IS NOT DISTINCT FROM s->>'customer_id') THEN scopes:=scopes||jsonb_build_array(s);END IF;
  END IF;
 END LOOP;
 SELECT jsonb_agg(DISTINCT e) INTO scopes FROM jsonb_array_elements(scopes) e;
 NEW.scope_context:=jsonb_build_object('version',2,'kind','SCOPED','basis','AUTHORITATIVE_ENTITY_WITH_RESTRICTIVE_PAYLOAD','scopes',scopes);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION security_r3_entity_scopes(text,text) FROM PUBLIC;
