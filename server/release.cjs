'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.8.8-ui8',requiredMigration:'205_v488_dispatch_reimport.sql'});
