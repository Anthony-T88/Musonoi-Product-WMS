-- Permit only the selected, authorized product template for NEW revisions.
-- Original revisions and their immutable byte/hash checks remain unchanged.
ALTER TABLE co_packing_revisions DROP CONSTRAINT co_packing_revisions_template_sha256_check;
ALTER TABLE co_packing_revisions ADD CONSTRAINT co_packing_template_digest_format CHECK(template_sha256~'^[0-9a-f]{64}$');
CREATE FUNCTION ux11_co_packing_active_template() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_template uuid;approved_content bytea;approved_digest text;BEGIN
 SELECT active_template_id INTO current_template FROM co_document_settings WHERE singleton FOR SHARE;
 IF current_template IS NULL THEN
  IF NEW.template_sha256<>'669728e8b9534f6182511a8f24c4c67439815e3d458ad64cde2a709e7dfafdfb' THEN RAISE EXCEPTION 'CO_PACKING_TEMPLATE_NOT_ACTIVE' USING ERRCODE='23514';END IF;
 ELSE
  SELECT content,file_sha256 INTO approved_content,approved_digest FROM co_packing_templates WHERE id=current_template;
  IF approved_content IS NULL OR NEW.template_content IS DISTINCT FROM approved_content OR NEW.template_sha256 IS DISTINCT FROM approved_digest OR encode(sha256(approved_content),'hex')<>approved_digest THEN RAISE EXCEPTION 'CO_PACKING_TEMPLATE_NOT_ACTIVE' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;END$$;
CREATE TRIGGER co_packing_active_template_guard BEFORE INSERT ON co_packing_revisions FOR EACH ROW EXECUTE FUNCTION ux11_co_packing_active_template();
