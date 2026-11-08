-- TEST only. Execute inside a transaction. Refuse any used document/history model.
SELECT pg_advisory_xact_lock(21001);SELECT pg_advisory_xact_lock(21002);
LOCK TABLE co_packing_documents,co_packing_revisions IN ACCESS EXCLUSIVE MODE;
DO $$BEGIN IF(SELECT environment FROM system_info)<>'test' OR EXISTS(SELECT 1 FROM co_packing_documents) OR EXISTS(SELECT 1 FROM co_packing_revisions) OR EXISTS(SELECT 1 FROM co_requests WHERE route LIKE '%/cobalt/packing/%') THEN RAISE EXCEPTION 'V44_USED_DATA_ROLLBACK_REFUSED';END IF;END$$;
DROP TABLE co_packing_revisions,co_packing_documents;
DROP FUNCTION co_packing_integrity(),co_packing_revision_guard(),co_packing_document_guard(),co_packing_source(uuid);
DELETE FROM schema_migrations WHERE version='145_v44_cobalt_packing.sql';
