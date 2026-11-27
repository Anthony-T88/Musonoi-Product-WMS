'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.0-ui6',requiredMigration:'217_v490_loading_completed_preparation.sql'});
