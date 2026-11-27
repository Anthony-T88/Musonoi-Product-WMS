'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.0-ui10',requiredMigration:'221_v490_configurable_business_roles.sql'});
