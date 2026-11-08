'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version,requiredMigration:'174_r3_reliable_audit_entity_scopes.sql'});
