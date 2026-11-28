'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.1',requiredMigration:'232_v491_dispatch_history_matching.sql'});
