'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.8.8-ui7',requiredMigration:'204_v488_bank_swift.sql'});
