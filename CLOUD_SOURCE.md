# V2.6.2 Codex cloud source snapshot

Prepared 2026-10-30 from the current local working files, including current V2.6.2 account lifecycle, internationalization and overview changes. This is a source snapshot, not the old V2.5.5 Git HEAD.

Includes frontend, backend, all 73 migration files through 065_v262_account_lock_order.sql, tests, documentation, lockfile and original stock-map PDF.

Excludes actual environment credentials, accounts/password handoff, database files and backups, uploads, runtime caches, test output, node_modules and prior Sites hosting configuration. Existing local data is unchanged.

Start with README.md, V2.6.2_HANDOFF.md and V2.6.2_SUPPLEMENT_RELEASE.md. The current start script targets a local TEST PostgreSQL database; cloud execution needs a separate TEST database and environment configuration. Uploading this source does not provision a cloud database or publish a running application. Do not run account resets, cleanup or seed scripts against existing business data.
