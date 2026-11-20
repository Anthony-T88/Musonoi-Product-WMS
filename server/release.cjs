'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.8.7-ui1',requiredMigration:'198_v487_preparation_batch_reuse.sql'});
