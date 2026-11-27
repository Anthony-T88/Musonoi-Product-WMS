'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.0-ui14',requiredMigration:'225_v490_dispatch_historical_detach.sql'});
