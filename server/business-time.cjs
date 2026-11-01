'use strict';
function display(value){if(!value)return '';const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;}
module.exports={display};
