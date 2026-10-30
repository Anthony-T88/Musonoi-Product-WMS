-- Fresh databases without bundles at migration 017 may have no reporting epoch:
-- an INSERT...SELECT cannot see a revision inserted by a function in the same command.
-- Separate commands initialize only a missing epoch. Existing history is never rewritten.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM inventory_reporting_epoch) THEN
  PERFORM v24_revision();
  INSERT INTO inventory_reporting_epoch
  SELECT true,id,posted_at FROM inventory_revisions
  WHERE id=coalesce((SELECT min(revision_id) FROM inventory_history),
                    (SELECT id FROM inventory_revisions WHERE txid=txid_current()));
 END IF;
END $$;
