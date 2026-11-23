'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.8.8-ui4',requiredMigration:'201_v488_customs_dispatch.sql'});
