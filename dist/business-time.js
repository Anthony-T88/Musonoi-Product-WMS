'use strict';
const businessDateLabel=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
function displayBusinessDate(value){
 const text=String(value??'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
 const date=new Date(text+'T00:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===text?businessDateLabel.format(date):text;
}

// Store instants as ISO UTC; display and interpret business inputs in Lubumbashi.
const BusinessTime={zone:'Africa/Lubumbashi',parts(value=new Date()){const p=new Intl.DateTimeFormat('en-CA',{timeZone:this.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));return Object.fromEntries(p.map(x=>[x.type,x.value]));},input(value=new Date()){const p=this.parts(value);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;},today(){return this.input().slice(0,10);},display(value){if(!value)return '—';const p=this.parts(value);return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;},toISO(value){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))throw Error('请选择有效的当地日期和时间');return new Date(value+'+02:00').toISOString();}};
BusinessTime.longDate=displayBusinessDate;
if(typeof module!=='undefined'&&module.exports)module.exports={longDate:displayBusinessDate};
else for(const key of ['toLocaleString','toLocaleDateString','toLocaleTimeString']){const original=Date.prototype[key];Date.prototype[key]=function(locale,options){return original.call(this,locale,{timeZone:BusinessTime.zone,...options});};}
