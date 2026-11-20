'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version,requiredMigration:'197_v485_historical_departure_and_sales_links.sql'});
