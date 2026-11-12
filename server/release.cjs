'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui2',requiredMigration:'185_v473_license_record_books.sql'});
