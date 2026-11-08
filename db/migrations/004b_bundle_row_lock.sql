-- PostgreSQL row locks require an UPDATE privilege on at least one column.
-- This grants only the optimistic version column, not inventory quantities/status/location.
GRANT UPDATE(version) ON bundles TO musonoi_app;
