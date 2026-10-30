// Dedicated local TEST preview; never overwrites .env or the V2.5.5 preview configuration.
const {config}=require('../server/config.cjs');const cfg=config();
if(cfg.environment!=='test')throw Error('V2.6 local preview requires TEST');
const url=new URL(cfg.databaseUrl);url.pathname='/musonoi_v26_development_test';
require('../server/app.cjs').build({config:{...cfg,databaseUrl:url.href}}).then(a=>a.listen({host:'127.0.0.1',port:cfg.port})).then(x=>console.log('V2.6.0 isolated TEST preview: '+x)).catch(e=>{console.error(e.message);process.exitCode=1;});
