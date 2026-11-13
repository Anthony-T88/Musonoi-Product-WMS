'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui3',requiredMigration:'190_v478_historical_backfill.sql'});
