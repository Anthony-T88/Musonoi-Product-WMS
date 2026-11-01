'use strict';
// Copyright (c) 2026 唐雷 (Tang Lei). All rights reserved.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function verify(root){const manifest=JSON.parse(fs.readFileSync(path.join(root,'SOURCE_MANIFEST.json'),'utf8'));if(manifest.version!==require('../package.json').version)throw Error('Release manifest version mismatch');for(const file of manifest.files){const absolute=path.resolve(root,file.path);if(!absolute.startsWith(path.resolve(root)+path.sep)||/(^|\/)(\.runtime|\.git|backups|uploads|node_modules)(\/|$)/.test(file.path))throw Error('Unsafe source manifest entry');if(crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')!==file.sha256)throw Error('Release integrity mismatch: '+file.path);}return {version:manifest.version,files:manifest.files.length};}
module.exports={verify};
