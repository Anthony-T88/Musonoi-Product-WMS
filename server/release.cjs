'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.8.7-ui3',requiredMigration:'200_v487_preparation_reversal.sql'});
