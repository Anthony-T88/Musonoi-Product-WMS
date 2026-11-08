-- Additive only. Historical gross weights remain NULL; no invented backfill.
ALTER TABLE receipt_lines ADD COLUMN gross_weight numeric(14,6),ADD COLUMN packaging_weight numeric(14,6),ADD COLUMN weight_rule_version text;
ALTER TABLE bundles ADD COLUMN gross_weight numeric(14,6),ADD COLUMN packaging_weight numeric(14,6),ADD COLUMN weight_rule_version text;
ALTER TABLE receipt_lines ADD CONSTRAINT receipt_weight_basis CHECK((gross_weight IS NULL AND packaging_weight IS NULL AND weight_rule_version IS NULL) OR(gross_weight IS NOT NULL AND packaging_weight=0.002500 AND weight_rule_version='PACK_2_5KG_V1' AND gross_weight>packaging_weight AND net_weight=gross_weight-packaging_weight));
ALTER TABLE bundles ADD CONSTRAINT original_weight_basis CHECK((gross_weight IS NULL AND packaging_weight IS NULL AND weight_rule_version IS NULL) OR(gross_weight IS NOT NULL AND packaging_weight=0.002500 AND weight_rule_version='PACK_2_5KG_V1' AND gross_weight>packaging_weight AND original_net_weight=gross_weight-packaging_weight));
CREATE FUNCTION ux_receipt_weight() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.gross_weight IS NULL OR NEW.gross_weight<=0.002500 THEN RAISE EXCEPTION 'New receipt requires gross weight greater than 2.5kg packaging' USING ERRCODE='23514';END IF;
 IF NEW.net_weight IS NOT NULL AND NEW.net_weight<>NEW.gross_weight-0.002500 THEN RAISE EXCEPTION 'Net weight disagrees with gross minus packaging' USING ERRCODE='23514';END IF;
 NEW.packaging_weight:=0.002500;NEW.weight_rule_version:='PACK_2_5KG_V1';NEW.net_weight:=NEW.gross_weight-NEW.packaging_weight;RETURN NEW;END $$;
CREATE TRIGGER ux_receipt_weight BEFORE INSERT OR UPDATE ON receipt_lines FOR EACH ROW EXECUTE FUNCTION ux_receipt_weight();
CREATE FUNCTION ux_bundle_weight() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE l receipt_lines;BEGIN
 IF NEW.receipt_line_id IS NOT NULL THEN SELECT * INTO l FROM receipt_lines WHERE id=NEW.receipt_line_id;NEW.gross_weight:=l.gross_weight;NEW.packaging_weight:=l.packaging_weight;NEW.weight_rule_version:=l.weight_rule_version;END IF;RETURN NEW;END $$;
CREATE TRIGGER ux_bundle_weight BEFORE INSERT ON bundles FOR EACH ROW EXECUTE FUNCTION ux_bundle_weight();
CREATE FUNCTION ux_weight_event() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE b bundles;BEGIN
 IF NEW.event_type='INBOUND' THEN SELECT * INTO b FROM bundles WHERE id=NEW.bundle_id;NEW.after_data:=NEW.after_data||jsonb_build_object('gross_weight',b.gross_weight,'packaging_weight',b.packaging_weight,'weight_rule_version',b.weight_rule_version,'net_weight',b.net_weight);END IF;RETURN NEW;END $$;
CREATE TRIGGER ux_weight_event BEFORE INSERT ON inventory_events FOR EACH ROW EXECUTE FUNCTION ux_weight_event();
DO $$ DECLARE def text;BEGIN
 SELECT pg_get_viewdef('inventory_view'::regclass,true) INTO def;def:=rtrim(trim(def),';');
 EXECUTE 'CREATE OR REPLACE VIEW inventory_view AS SELECT prior.*,b.gross_weight,b.packaging_weight,b.weight_rule_version,CASE WHEN b.gross_weight IS NULL THEN ''LEGACY_NET_ONLY'' WHEN b.net_weight<>b.original_net_weight THEN ''AUTHORIZED_ADJUSTED_NET'' ELSE ''GROSS_MINUS_PACKAGING'' END AS weight_basis,k.contract_no FROM ('||def||') prior JOIN bundles b ON b.id=prior.uuid LEFT JOIN sales_plans sp ON sp.code=prior.sales_plan_code LEFT JOIN customer_contracts k ON k.id=sp.contract_id';
END $$;
-- Preserve committed snapshots. Only newly captured snapshots carry the measurement basis.
DO $$ DECLARE def text;BEGIN
 SELECT pg_get_functiondef('v24_capture_bundle(uuid)'::regprocedure) INTO def;
 def:=replace(def,$old$'weight',b.net_weight::text$old$,$new$'gross_weight',b.gross_weight::text,'packaging_weight',b.packaging_weight::text,'weight_rule_version',b.weight_rule_version,'weight',b.net_weight::text$new$);EXECUTE def;
END $$;
