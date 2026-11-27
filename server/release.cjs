'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.0-ui7',requiredMigration:'219_v490_retire_access_change_approval.sql'});
