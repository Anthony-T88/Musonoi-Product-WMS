'use strict';
const version=require('../package.json').version;
const frontendRevision=version+'-ui1';
module.exports=Object.freeze({version,displayVersion:frontendRevision,frontendRevision,requiredMigration:'195_v482_dispatch_vehicle_month.sql'});
