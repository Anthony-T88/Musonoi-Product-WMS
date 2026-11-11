-- Keep prior rows for invalidated-device diagnostics and audit linkage.
ALTER TABLE sessions ADD COLUMN replaced_at timestamptz;
WITH ranked AS (
 SELECT token_hash, row_number() OVER(PARTITION BY user_id ORDER BY (expires_at > now()) DESC,created_at DESC,token_hash DESC) AS position
 FROM sessions
)
UPDATE sessions s SET replaced_at=clock_timestamp()
FROM ranked r WHERE r.token_hash=s.token_hash AND r.position>1;
CREATE UNIQUE INDEX sessions_one_current_per_user ON sessions(user_id) WHERE replaced_at IS NULL;
