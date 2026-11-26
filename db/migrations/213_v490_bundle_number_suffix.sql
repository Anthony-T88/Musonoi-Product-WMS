-- Preserve the original labels while extending the existing identity registry to suffixes.
LOCK TABLE bundles, receipt_lines, bundle_number_registry IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION v265_bundle_key(label text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE
  WHEN upper(trim(label)) ~ '^MUS-[0-9]{4}-[0-9]{1,3}-0*[1-9][0-9]*[A-Z]+$' THEN
   split_part(upper(trim(label)),'-',1)||'-'||split_part(trim(label),'-',2)||'-'||
   lpad(split_part(trim(label),'-',3),3,'0')||'-'||ltrim(split_part(upper(trim(label)),'-',4),'0')
  WHEN upper(trim(label)) ~ '^MUS-[0-9]{4}-[0-9]{1,3}-[0-9]+$' THEN
   split_part(upper(trim(label)),'-',1)||'-'||split_part(label,'-',2)||'-'||lpad(split_part(label,'-',3),3,'0')||'-'||
   coalesce(nullif(ltrim(split_part(label,'-',4),'0'),''),'0')
  ELSE upper(trim(label))
 END
$$;

-- Merge old aliases into their canonical keys and keep the existing conflict quarantine.
WITH aliases AS (
 DELETE FROM bundle_number_registry
 WHERE number_key ~ '^MUS-[0-9]{4}-[0-9]{1,3}-0*[1-9][0-9]*[A-Z]+$'
   AND number_key <> v265_bundle_key(number_key)
 RETURNING number_key,v265_bundle_key(number_key) AS canonical_key,owner_id,conflicted,sources
), grouped AS (
 SELECT a.canonical_key,min(a.owner_id::text)::uuid AS owner_id,
  bool_or(a.conflicted OR a.owner_id IS NULL) OR count(DISTINCT a.owner_id)>1 AS conflicted,
  coalesce(jsonb_agg(e.source ORDER BY a.number_key,e.ordinality) FILTER (WHERE e.source IS NOT NULL),'[]'::jsonb) AS sources
 FROM aliases a LEFT JOIN LATERAL jsonb_array_elements(a.sources) WITH ORDINALITY e(source,ordinality) ON true
 GROUP BY a.canonical_key
)
INSERT INTO bundle_number_registry AS registry(number_key,owner_id,conflicted,sources)
SELECT canonical_key,CASE WHEN conflicted THEN NULL ELSE owner_id END,conflicted,sources FROM grouped
ON CONFLICT(number_key) DO UPDATE SET
 owner_id=CASE WHEN registry.conflicted OR EXCLUDED.conflicted OR registry.owner_id IS DISTINCT FROM EXCLUDED.owner_id
   THEN NULL ELSE registry.owner_id END,
 conflicted=registry.conflicted OR EXCLUDED.conflicted OR registry.owner_id IS DISTINCT FROM EXCLUDED.owner_id,
 sources=registry.sources||EXCLUDED.sources;

REINDEX INDEX v265_bundle_key_lookup;
REINDEX INDEX v265_line_key_lookup;

CREATE OR REPLACE FUNCTION v26_receipt_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r receipts; batch_code text;
BEGIN
 SELECT * INTO r FROM receipts WHERE id=NEW.receipt_id;
 IF r.workflow_version='2.6' THEN
  IF r.number_rule_version='MUS_V261' THEN
   IF NEW.bundle_no !~ '^MUS-[0-9]{4}-[0-9]{3}-[0-9]{2,}[A-Z]*$' OR split_part(NEW.bundle_no,'-',4) !~ '[1-9]' THEN
    RAISE EXCEPTION '捆包编号须包含至少两位非全零序号，序号后可加字母' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.bundle_no !~ '^MUS-[0-9]{4}-[0-9]{3}-[1-9][0-9]*[A-Z]*$' THEN
   RAISE EXCEPTION '历史生产编号格式无效' USING ERRCODE='23514';
  END IF;
  batch_code:=split_part(NEW.bundle_no,'-',1)||'-'||split_part(NEW.bundle_no,'-',2)||'-'||split_part(NEW.bundle_no,'-',3);
  IF NOT EXISTS(SELECT 1 FROM batches WHERE id=NEW.batch_id AND project_id=r.project_id AND code=batch_code)
   OR NOT EXISTS(SELECT 1 FROM locations WHERE id=NEW.location_id AND project_id=r.project_id AND code='临时堆存区')
   OR NOT EXISTS(SELECT 1 FROM customers WHERE id=r.customer_id AND project_id=r.project_id AND lower(name)='musonoi') THEN
   RAISE EXCEPTION '生产入库批次/客户/临时区不匹配' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
