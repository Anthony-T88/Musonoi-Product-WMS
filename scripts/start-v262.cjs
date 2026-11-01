// Copyright (c) 2026 唐雷 (Tang Lei). All rights reserved.
'use strict';
// Local preview only. Startup never migrates, seeds, resets or cleans a database.
const {config}=require('../server/config.cjs'),cfg=config();
if(cfg.environment!=='test')throw Error('Local V3.5 preview requires TEST');
const url=new URL(cfg.databaseUrl);url.pathname='/musonoi_v26_development_test';const port=Number(process.env.V262_PORT||4176);
require('../server/app.cjs').build({config:{...cfg,databaseUrl:url.href,port,origin:'http://127.0.0.1:'+port}}).then(a=>a.listen({host:'127.0.0.1',port})).then(address=>console.log('V3.5 local TEST: '+address)).catch(e=>{console.error(e.message);process.exitCode=1;});
