'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.8.7-ui2',requiredMigration:'199_v487_bundle_corrections.sql'});
