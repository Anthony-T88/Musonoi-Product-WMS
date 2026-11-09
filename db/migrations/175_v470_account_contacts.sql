ALTER TABLE users
  ADD COLUMN contact_phone text CHECK (length(contact_phone) BETWEEN 1 AND 40),
  ADD COLUMN contact_email text CHECK (length(contact_email) BETWEEN 1 AND 160);

ALTER TABLE registration_requests
  ADD COLUMN contact_phone text CHECK (length(contact_phone) BETWEEN 1 AND 40),
  ADD COLUMN contact_email text CHECK (length(contact_email) BETWEEN 1 AND 160);
