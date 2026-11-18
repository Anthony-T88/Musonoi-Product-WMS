'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui6',requiredMigration:'196_v485_vehicle_arrival_confirmation.sql'});
