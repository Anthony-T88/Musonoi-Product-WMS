'use strict';
const {scryptSync,randomBytes,timingSafeEqual,createHash}=require('node:crypto');
function hashPassword(password){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
function verifyPassword(password,stored){const [salt,key]=stored.split(':');const actual=scryptSync(password,salt,64);const expected=Buffer.from(key,'hex');return expected.length===actual.length&&timingSafeEqual(actual,expected);}
const digest=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('hex');
module.exports={hashPassword,verifyPassword,digest,token};
