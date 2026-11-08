-- Legacy pending receipts must not create new stock using an unverified net-only measurement.
-- Existing confirmed archives are never updated by this migration.
CREATE OR REPLACE FUNCTION ux_bundle_weight() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE l receipt_lines;BEGIN
 IF NEW.receipt_line_id IS NOT NULL THEN
 SELECT * INTO l FROM receipt_lines WHERE id=NEW.receipt_line_id;
 IF l.gross_weight IS NULL OR l.weight_rule_version IS NULL THEN RAISE EXCEPTION 'Legacy pending receipt requires verified gross weight; reject, verify and resubmit' USING ERRCODE='23514';END IF;
 NEW.gross_weight:=l.gross_weight;NEW.packaging_weight:=l.packaging_weight;NEW.weight_rule_version:=l.weight_rule_version;
 END IF;RETURN NEW;END $$;
