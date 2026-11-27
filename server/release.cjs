'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.0-ui17',requiredMigration:'230_v490_return_stock_evidence.sql'});
