'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui2',requiredMigration:'191_v481_contract_number_reuse.sql'});
