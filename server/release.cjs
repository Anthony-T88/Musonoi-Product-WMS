'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version+'-r2',frontendRevision:version+'-r2',requiredMigration:'172_v469_configurable_admin_business_permissions.sql'});
