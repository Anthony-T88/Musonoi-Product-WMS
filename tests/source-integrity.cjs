'use strict';
// Checks the published source boundary after removal of superseded files.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),checks=[];
function exists(p){assert(fs.existsSync(p),'Missing current source dependency: '+path.relative(root,p));}
assert.equal(pkg.version,'2.6.2');checks.push('current version');
const files=[];for(const dir of ['server','dist','scripts','tests'])for(const name of fs.readdirSync(path.join(root,dir)))if(/\.(cjs|js)$/.test(name))files.push(path.join(root,dir,name));
for(const file of files){const text=fs.readFileSync(file,'utf8');new vm.Script(text,{filename:file});for(const match of text.matchAll(/\brequire\(\s*(['"])(\.[^'"]+)\1\s*\)/g)){if(match[2].includes('.runtime/'))continue;const p=path.resolve(path.dirname(file),match[2]);exists(fs.existsSync(p)?p:p+'.js');}}
checks.push('syntax and literal local modules: '+files.length);
for(const command of Object.values(pkg.scripts)){const m=command.match(/^node\s+([^\s]+)/);if(m)exists(path.join(root,m[1]));}checks.push('package commands');
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8'),boot=fs.readFileSync(path.join(root,'dist/boot.js'),'utf8');
for(const m of html.matchAll(/(?:src|href)=["'](\/[^"']+\.(?:js|css|png|svg|webmanifest))["']/g))exists(path.join(root,'dist',m[1].slice(1)));
for(const m of boot.matchAll(/load\(['"]([^'"]+)['"]\)/g))exists(path.join(root,'dist',m[1]));
assert(!boot.includes('demo-data.js'));assert(!html.includes('href="/demo"'));for(const p of ['server.cjs','test.cjs','dist/demo-data.js','dist/dashboard.js','dist/users.js'])assert(!fs.existsSync(path.join(root,p)),'Obsolete file retained: '+p);checks.push('current frontend assets and demo removal');
const docs=['README.md','RELEASE.md','API.md','HANDOFF.md','VALIDATION.md','CLOUD_SOURCE.md','db/MIGRATIONS.md'];for(const p of docs){exists(path.join(root,p));const text=fs.readFileSync(path.join(root,p),'utf8');assert(!/交付历史|初版交付|V2\.5\.5|V2\.6\.0|V2\.6\.1/.test(text),'Historical release notes remain in '+p);for(const m of text.matchAll(/\]\(([^)]+)\)/g)){if(/^[a-z]+:|^#/.test(m[1]))continue;exists(path.resolve(path.dirname(path.join(root,p)),m[1].split('#')[0]));}}checks.push('current documentation links and scope');
const migrations=fs.readdirSync(path.join(root,'db/migrations')).filter(x=>x.endsWith('.sql'));assert.equal(migrations.length,73);checks.push('complete current migration chain');
const box={};box.window=box;for(const p of ['dist/i18n-dictionary.js','dist/i18n-v262.js'])vm.runInNewContext(fs.readFileSync(path.join(root,p),'utf8'),box);assert(Object.values(box.TRANSLATIONS.en).every(x=>typeof x==='string'&&x.trim()));checks.push('translation resources');
console.log(JSON.stringify({status:'PASS',checks:checks.length,syntaxFiles:files.length,migrations:migrations.length,details:checks}));
