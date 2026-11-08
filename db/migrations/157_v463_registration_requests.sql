-- Requests never create usable accounts until an authorized administrator approves.
CREATE TABLE registration_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 username text NOT NULL CHECK(username ~ '^[a-z][a-z0-9_]{2,39}$'),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
 password_hash text NOT NULL,
 contact text NOT NULL CHECK(length(contact) BETWEEN 1 AND 160),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by uuid REFERENCES users(id),
 review_reason text,
 approved_user_id uuid REFERENCES users(id),
 CHECK((status='PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL AND approved_user_id IS NULL)
   OR(status='APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND approved_user_id IS NOT NULL)
   OR(status='REJECTED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND approved_user_id IS NULL AND length(trim(review_reason))>0))
);
CREATE UNIQUE INDEX registration_requests_pending_username ON registration_requests(username) WHERE status='PENDING';
CREATE INDEX registration_requests_status_created ON registration_requests(status,created_at DESC);
GRANT SELECT,INSERT,UPDATE ON registration_requests TO musonoi_app;
