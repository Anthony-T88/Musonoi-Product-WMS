'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.0-ui9',requiredMigration:'220_v490_cobalt_metal_permissions.sql'});
