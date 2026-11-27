'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.0-ui11',requiredMigration:'222_v490_outbound_business_date.sql'});
