'use strict';
const net=require('node:net');
const normalize=ip=>String(ip||'').replace(/^::ffff:/i,'');
function policy(value){
 const entries=String(value||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(entries.some(ip=>!net.isIP(ip)))throw Object.assign(Error('TRUSTED_PROXY_IPS must contain exact proxy IP addresses'),{code:'PROXY_CONFIGURATION_INVALID'});
 const trusted=new Set(entries.map(normalize)),peer=ip=>trusted.has(normalize(ip));
 return {trust:entries.length?(ip,hop)=>hop===0&&peer(ip):false,validate(req){
  if(!peer(req.raw.socket.remoteAddress))return;
  const forwarded=req.headers['x-forwarded-for'];
  if(forwarded!==undefined&&(typeof forwarded!=='string'||!net.isIP(forwarded.trim())))throw Object.assign(Error('Invalid proxy forwarding header'),{statusCode:400});
 }};
}
module.exports={policy};
