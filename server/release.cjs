'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui6',requiredMigration:'194_v481_dispatch_and_approval.sql'});
