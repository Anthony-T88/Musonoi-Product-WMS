ALTER TABLE export_license_record_books
 ADD COLUMN swift_code text NOT NULL DEFAULT '',
 ADD CONSTRAINT export_license_record_books_swift_check CHECK (
  swift_code='' OR (kind IN ('issuing_bank_account','offshore_bank_account') AND
   swift_code ~ '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$')
 );
GRANT UPDATE(swift_code) ON export_license_record_books TO musonoi_app;

ALTER TABLE export_licenses
 ADD COLUMN issuing_bank_swift text NOT NULL DEFAULT ''
  CHECK (issuing_bank_swift='' OR issuing_bank_swift ~ '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
 ADD COLUMN offshore_bank_swift text NOT NULL DEFAULT ''
  CHECK (offshore_bank_swift='' OR offshore_bank_swift ~ '^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$');
