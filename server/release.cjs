'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version,requiredMigration:'195_v482_dispatch_vehicle_month.sql'});
