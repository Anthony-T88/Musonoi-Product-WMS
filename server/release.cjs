'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui1',requiredMigration:'181_v471_sales_invoice_confirmation.sql'});
