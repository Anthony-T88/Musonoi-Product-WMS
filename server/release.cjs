'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui3',requiredMigration:'192_v481_license_register.sql'});
