-- Additive security metadata only. Existing audit rows, grants and identities are not rewritten.
ALTER TABLE audit_logs ADD COLUMN scope_context jsonb;
-- Runtime can verify the required migration without reading maintenance history directly.
CREATE VIEW security_schema_status AS SELECT version,checksum FROM schema_migrations ORDER BY version DESC LIMIT 1;
GRANT SELECT ON security_schema_status TO musonoi_app;

CREATE FUNCTION security_r3_scope_json(d jsonb, kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p text;w text;k text;loc record;
BEGIN
 p:=d->>'project_id';w:=d->>'warehouse_id';k:=d->>'customer_id';
 IF kind='projects' THEN p:=coalesce(d->>'id',p);END IF;
 IF kind='warehouses' THEN w:=coalesce(d->>'id',w);END IF;
 IF kind IN('customers','co_customer_profiles') THEN k:=coalesce(d->>'id',k);END IF;
 IF p IS NULL OR p!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RETURN NULL;END IF;
 IF w IS NOT NULL AND w!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR k IS NOT NULL AND k!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RETURN NULL;END IF;
 IF w IS NULL AND coalesce(d->>'location_id','')~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN
  SELECT project_id,warehouse_id INTO loc FROM public.locations WHERE id=(d->>'location_id')::uuid;
  IF loc.project_id::text=p THEN w:=loc.warehouse_id::text;END IF;
 END IF;
 RETURN jsonb_build_object('project_id',p::uuid::text,'warehouse_id',w::uuid::text,'customer_id',k::uuid::text);
END $$;

CREATE FUNCTION security_r3_entity_scope(kind text, identity text, depth integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d jsonb;s jsonb;parent_kind text;parent_id text;
BEGIN
 IF depth>3 OR kind<>ALL(ARRAY['projects','warehouses','customers','co_customer_profiles','bundles','receipts','allocations','sales_plans','customer_contracts','co_preparations','co_sales_plans','co_sales_contracts','co_locations','co_zones','co_loading_plans','co_loading_orders','loading_plan_documents','loading_orders','outbound_orders','stock_moves','stocktake_tasks','adjustment_tasks','vehicle_arrivals','co_dispatch_vehicles','sales_dispatch_vehicles','co_stocktake_tasks']) THEN RETURN NULL;END IF;
 IF identity IS NULL OR to_regclass('public.'||kind) IS NULL THEN RETURN NULL;END IF;
 IF identity!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RETURN NULL;END IF;
 identity:=identity::uuid::text;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id::text=$1',kind) INTO d USING identity;
 IF d IS NULL THEN RETURN NULL;END IF;
 s:=public.security_r3_scope_json(d,kind);IF s IS NOT NULL THEN RETURN s;END IF;
 IF d->>'preparation_id' IS NOT NULL THEN parent_kind:='co_preparations';parent_id:=d->>'preparation_id';
 ELSIF d->>'sales_plan_id' IS NOT NULL THEN parent_kind:=CASE WHEN kind LIKE 'co\_%' ESCAPE '\' THEN 'co_sales_plans' ELSE 'sales_plans' END;parent_id:=d->>'sales_plan_id';
 ELSIF d->>'allocation_id' IS NOT NULL THEN parent_kind:='allocations';parent_id:=d->>'allocation_id';
 ELSIF d->>'loading_id' IS NOT NULL THEN parent_kind:='loading_orders';parent_id:=d->>'loading_id';
 ELSIF kind='co_loading_orders' AND d->>'plan_id' IS NOT NULL THEN parent_kind:='co_loading_plans';parent_id:=d->>'plan_id';
 ELSE RETURN NULL;END IF;
 RETURN public.security_r3_entity_scope(parent_kind,parent_id,depth+1);
END $$;

CREATE FUNCTION security_r3_audit_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s jsonb;d jsonb;scopes jsonb:='[]'::jsonb;
BEGIN
 -- Ignore caller-supplied scope metadata. Unknown/system events remain administrator-only.
 NEW.scope_context:=NULL;
 s:=public.security_r3_entity_scope(NEW.entity_type,NEW.entity_id);
 IF s IS NULL THEN RETURN NEW;END IF;
 scopes:=jsonb_build_array(s);
 FOREACH d IN ARRAY ARRAY[NEW.before_data,NEW.after_data] LOOP
  IF d->>'project_id' IS NOT NULL THEN
   s:=public.security_r3_scope_json(d,NEW.entity_type);
   IF s IS NULL THEN RETURN NEW;END IF;
   scopes:=scopes||jsonb_build_array(s);
  END IF;
 END LOOP;
 SELECT jsonb_agg(DISTINCT x) INTO scopes FROM jsonb_array_elements(scopes) x;
 NEW.scope_context:=jsonb_build_object('version',1,'kind','SCOPED','basis','ENTITY_AND_PAYLOAD_AT_INSERT','scopes',scopes);
 RETURN NEW;
END $$;
CREATE TRIGGER aa_security_r3_audit_scope BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION security_r3_audit_scope();

CREATE FUNCTION security_r3_authorization_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_advisory_xact_lock(21002);RETURN NULL;END $$;
CREATE TRIGGER security_r3_permission_lock BEFORE INSERT OR UPDATE OR DELETE ON role_permissions FOR EACH STATEMENT EXECUTE FUNCTION security_r3_authorization_lock();
CREATE TRIGGER security_r3_scope_lock BEFORE INSERT OR UPDATE OR DELETE ON user_scopes FOR EACH STATEMENT EXECUTE FUNCTION security_r3_authorization_lock();

CREATE FUNCTION security_r3_revoke_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='role_permissions' THEN
  DELETE FROM public.sessions WHERE user_id IN(SELECT id FROM public.users WHERE role_code IN(CASE WHEN TG_OP<>'INSERT' THEN OLD.role_code END,CASE WHEN TG_OP<>'DELETE' THEN NEW.role_code END));
 ELSIF TG_TABLE_NAME='user_scopes' THEN
  DELETE FROM public.sessions WHERE user_id IN(CASE WHEN TG_OP<>'INSERT' THEN OLD.user_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.user_id END);
 ELSIF (NEW.role_code,NEW.active,NEW.password_hash,NEW.deleted_at) IS DISTINCT FROM (OLD.role_code,OLD.active,OLD.password_hash,OLD.deleted_at) THEN
  DELETE FROM public.sessions WHERE user_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER security_r3_permissions_revoke AFTER INSERT OR UPDATE OR DELETE ON role_permissions FOR EACH ROW EXECUTE FUNCTION security_r3_revoke_sessions();
CREATE TRIGGER security_r3_scopes_revoke AFTER INSERT OR UPDATE OR DELETE ON user_scopes FOR EACH ROW EXECUTE FUNCTION security_r3_revoke_sessions();
CREATE TRIGGER security_r3_accounts_revoke AFTER UPDATE ON users FOR EACH ROW EXECUTE FUNCTION security_r3_revoke_sessions();
REVOKE ALL ON FUNCTION security_r3_scope_json(jsonb,text),security_r3_entity_scope(text,text,integer),security_r3_audit_scope(),security_r3_authorization_lock(),security_r3_revoke_sessions() FROM PUBLIC;
