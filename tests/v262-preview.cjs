'use strict';
const cfg=require('../server/config.cjs').config(),source=require('../.runtime/v262-source.json');
if(!/^musonoi_v262_acceptance_\d+_test$/.test(source.database))throw Error('Isolated V2.6.2 copy required');
const url=new URL(cfg.databaseUrl);url.pathname='/'+source.database;
require('../server/app.cjs').build({config:{...cfg,databaseUrl:url.href,origin:'http://127.0.0.1:4182',port:4182}}).then(app=>app.listen({host:'127.0.0.1',port:4182})).then(()=>console.log('V2.6.2 isolated browser preview :4182')).catch(e=>{console.error(e.message);process.exitCode=1;});
