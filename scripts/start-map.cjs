// Local TEST preview only. Keeps configured business database and .env unchanged.
const {config}=require('../server/config.cjs');
const cfg=config();if(cfg.environment!=='test')throw Error('Stock Map preview requires APP_ENV=test');
const fs=require('fs');let database='musonoi_map_development_test';
if(fs.existsSync('.runtime/stock-map-preview.json')){database=JSON.parse(fs.readFileSync('.runtime/stock-map-preview.json')).database;if(!/^musonoi_acceptance_v23_map_visual_\d+$/.test(database))throw Error('Invalid TEST preview database');}
const url=new URL(cfg.databaseUrl);url.pathname='/'+database;
require('../server/app.cjs').build({config:{...cfg,databaseUrl:url.href}})
 .then(a=>a.listen({host:'127.0.0.1',port:cfg.port}))
 .then(x=>console.log('V2.5.5 Stock Map isolated local preview: '+x))
 .catch(e=>{console.error(e.message);process.exitCode=1;});
