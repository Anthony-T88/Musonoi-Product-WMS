'use strict';
const path=require('node:path');
console.log(JSON.stringify({status:'PASS',scope:'source hashes only',...require('../server/release-integrity.cjs').verify(path.resolve(__dirname,'..'))}));
