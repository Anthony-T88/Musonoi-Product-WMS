'use strict';
const version=require('../package.json').version;
module.exports=Object.freeze({version,displayVersion:version,frontendRevision:version+'-ui1',requiredMigration:'188_v476_document_drafts.sql'});
