'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui1',requiredMigration:'186_v474_preparation_plans.sql'});
