'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.0-ui15',requiredMigration:'227_v490_dispatch_removal_evidence.sql'});
