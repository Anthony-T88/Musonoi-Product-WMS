CREATE TABLE report_mail_transport (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 smtp_url text,
 sender text,
 login_name text,
 sealed_password text,
 version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
 updated_by uuid REFERENCES users(id),
 updated_at timestamptz,
 CHECK ((version = 0 AND smtp_url IS NULL AND sender IS NULL AND login_name IS NULL AND sealed_password IS NULL
                        AND updated_by IS NULL AND updated_at IS NULL) OR
        (version > 0 AND smtp_url IS NOT NULL AND sender IS NOT NULL AND login_name IS NOT NULL AND sealed_password IS NOT NULL
                     AND updated_by IS NOT NULL AND updated_at IS NOT NULL))
);
INSERT INTO report_mail_transport(singleton) VALUES (true);
REVOKE ALL ON report_mail_transport FROM PUBLIC,musonoi_app;
GRANT SELECT ON report_mail_transport TO musonoi_app;
GRANT UPDATE(smtp_url,sender,login_name,sealed_password,version,updated_by,updated_at) ON report_mail_transport TO musonoi_app;
