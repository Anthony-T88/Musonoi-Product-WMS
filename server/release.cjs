'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.0-ui2',requiredMigration:'213_v490_bundle_number_suffix.sql'});
