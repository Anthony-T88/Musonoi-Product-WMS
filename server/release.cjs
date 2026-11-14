'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui4',requiredMigration:'193_v481_copper_preparation_slots.sql'});
