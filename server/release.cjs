'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version,requiredMigration:'173_r3_security_scope_and_sessions.sql'});
