'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:'4.9.0-ui4',requiredMigration:'215_v490_report_mail_transport.sql'});
