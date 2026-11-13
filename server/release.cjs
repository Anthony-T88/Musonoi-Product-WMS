'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui2',requiredMigration:'189_v477_historical_movements.sql'});
