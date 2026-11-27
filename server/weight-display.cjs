'use strict';
const {englishBase}=require('./languages.cjs');
function unit(req){return englishBase(req.user?.language_code)?'MT':'吨';}
function headings(values,req){return values.map(v=>typeof v==='string'?v.replace(/吨|\bt\b/g,unit(req)):v);}
module.exports={unit,headings};
