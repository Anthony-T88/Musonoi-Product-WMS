-- Additive only: existing plans remain unlinked and are never assigned an invented contract.
CREATE TABLE customer_contracts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id),customer_id uuid NOT NULL,
 contract_no text NOT NULL UNIQUE CHECK(length(trim(contract_no)) BETWEEN 1 AND 80),
 effective_date date NOT NULL,end_date date NOT NULL,active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),version int NOT NULL DEFAULT 1,
 FOREIGN KEY(project_id,customer_id) REFERENCES customers(project_id,id),CHECK(end_date>=effective_date));
ALTER TABLE sales_plans ADD COLUMN contract_id uuid REFERENCES customer_contracts(id);
CREATE FUNCTION ux_valid_contract(cid uuid,pid uuid,cust uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k customer_contracts;BEGIN
 SELECT * INTO k FROM customer_contracts WHERE id=cid FOR SHARE;
 IF NOT FOUND OR k.project_id<>pid OR k.customer_id<>cust OR NOT k.active OR (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date NOT BETWEEN k.effective_date AND k.end_date OR NOT EXISTS(SELECT 1 FROM customers WHERE id=cust AND active FOR SHARE) THEN RAISE EXCEPTION 'Contract missing, inactive, outside validity or mismatched customer' USING ERRCODE='23514';END IF;
END $$;
CREATE FUNCTION ux_contract_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Contract history cannot be deleted' USING ERRCODE='23514';END IF;
 IF NEW.project_id<>OLD.project_id OR NEW.customer_id<>OLD.customer_id OR NEW.contract_no<>OLD.contract_no OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.id<>OLD.id OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Contract identity immutable or version conflict' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER contract_history BEFORE UPDATE OR DELETE ON customer_contracts FOR EACH ROW EXECUTE FUNCTION ux_contract_guard();
CREATE FUNCTION ux_plan_contract_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
 IF NEW.origin='LEGACY' AND current_user='musonoi_owner' THEN RETURN NEW;END IF;
 PERFORM ux_valid_contract(NEW.contract_id,NEW.project_id,NEW.customer_id);
 ELSIF NEW.contract_id IS DISTINCT FROM OLD.contract_id THEN
 IF OLD.contract_id IS NOT NULL OR EXISTS(SELECT 1 FROM allocations WHERE plan_id=OLD.id) THEN RAISE EXCEPTION 'Used plan contract cannot be replaced; create a new plan' USING ERRCODE='23514';END IF;
 PERFORM ux_valid_contract(NEW.contract_id,NEW.project_id,NEW.customer_id);
 END IF;RETURN NEW;END $$;
CREATE TRIGGER ux_plan_contract BEFORE INSERT OR UPDATE ON sales_plans FOR EACH ROW EXECUTE FUNCTION ux_plan_contract_guard();
CREATE FUNCTION ux_allocation_contract_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p sales_plans;a allocations;BEGIN
 IF TG_TABLE_NAME='allocations' THEN
 SELECT * INTO p FROM sales_plans WHERE id=NEW.plan_id FOR UPDATE;
 IF NEW.origin='LEGACY' AND current_user='musonoi_owner' THEN RETURN NEW;END IF;
 ELSE
 IF NEW.origin='LEGACY' AND current_user='musonoi_owner' THEN RETURN NEW;END IF;
 SELECT * INTO a FROM allocations WHERE id=NEW.allocation_id;
 SELECT * INTO p FROM sales_plans WHERE id=a.plan_id FOR UPDATE;
 END IF;
 PERFORM ux_valid_contract(p.contract_id,p.project_id,p.customer_id);RETURN NEW;END $$;
CREATE TRIGGER ux_allocation_contract BEFORE INSERT ON allocations FOR EACH ROW EXECUTE FUNCTION ux_allocation_contract_guard();
CREATE TRIGGER ux_reservation_contract BEFORE INSERT ON reservations FOR EACH ROW EXECUTE FUNCTION ux_allocation_contract_guard();
GRANT SELECT,INSERT,UPDATE ON customer_contracts TO musonoi_app;
